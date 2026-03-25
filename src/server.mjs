import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { config } from './config.mjs';
import { appendMessages, getStats } from './storage.mjs';
import { getStitchedContext } from './engine.mjs';

let requestStats = { openai_requests: 0, anthropic_requests: 0 };

function _getNewMessages(existing, incoming) {
  if (!existing || existing.length === 0) return incoming;
  
  const existingFingerprints = new Set();
  const last100 = existing.slice(-100);
  for (const m of last100) {
    let content = m.content || "";
    if (Array.isArray(content)) {
      content = content.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
    }
    existingFingerprints.add(`${m.role}:${content}`);
  }
  
  const newMsgs = [];
  for (const m of incoming) {
    let content = m.content || "";
    if (Array.isArray(content)) {
      content = content.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
    }
    if (!existingFingerprints.has(`${m.role}:${content}`)) {
      newMsgs.push(m);
    }
  }
  return newMsgs;
}

async function handleChatCompletions(req, res, bodyStr) {
  requestStats.openai_requests++;
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
  }
  
  const incomingMessages = body.messages || [];
  if (incomingMessages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: "No messages provided", type: "invalid_request_error" } }));
  }
  
  // Session ID resolution: header → query param → hash of system/first message
  let sessionId = req.headers["x-stitcher-session"] || req.headers["x-neverforget-session"];
  if (!sessionId) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    sessionId = urlObj.searchParams.get("session");
  }
  if (!sessionId) {
    let firstContent = incomingMessages[0].content || "";
    if (typeof firstContent !== "string") firstContent = JSON.stringify(firstContent);
    sessionId = crypto.createHash("md5").update(firstContent).digest("hex").substring(0, 12);
  }

  // Sanitize session ID to prevent path traversal
  sessionId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');

  let existingMessages;
  try {
    ({ messages: existingMessages } = getStitchedContext(sessionId));
  } catch (e) {
    console.error("Error reading session:", e.message);
    existingMessages = [];
  }
  const newIncoming = _getNewMessages(existingMessages, incomingMessages);
  
  if (newIncoming.length > 0) {
    try {
      appendMessages(sessionId, newIncoming);
    } catch (e) {
      console.error("Error storing messages:", e.message);
    }
  }
  
  let stitchedMessages;
  try {
    ({ messages: stitchedMessages } = getStitchedContext(sessionId));
  } catch (e) {
    console.error("Error stitching context:", e.message);
    stitchedMessages = incomingMessages;
  }
  
  const proxyBody = { ...body, messages: stitchedMessages };
  if (!proxyBody.model && config.default_model) {
    proxyBody.model = config.default_model;
  }
  
  const proxyBodyStr = JSON.stringify(proxyBody);
  
  let baseUrl = config.upstream_url.replace(/\/$/, "");
  // If upstream already ends with /v1, don't double it
  let upstreamUrl;
  if (baseUrl.endsWith("/v1")) {
    upstreamUrl = `${baseUrl}/chat/completions`;
  } else if (baseUrl.includes("/v1/")) {
    // Already has full path somehow
    upstreamUrl = baseUrl;
  } else {
    upstreamUrl = `${baseUrl}/v1/chat/completions`;
  }
  
  const urlObj = new URL(upstreamUrl);
  
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(proxyBodyStr)
  };
  
  // Forward auth headers — check all common patterns
  if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"];
  else if (req.headers["api-key"]) headers["api-key"] = req.headers["api-key"];
  else if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"];
  else if (config.api_key) headers["authorization"] = `Bearer ${config.api_key}`;

  // Forward Anthropic-specific headers
  if (req.headers["anthropic-version"]) headers["anthropic-version"] = req.headers["anthropic-version"];
  
  const isStream = !!body.stream;
  const clientModule = urlObj.protocol === "https:" ? https : http;
  
  const proxyReq = clientModule.request(upstreamUrl, {
    method: "POST",
    headers,
    timeout: 300000 // 5 mins
  }, (proxyRes) => {
    // Forward headers from upstream to client
    const responseHeaders = { ...proxyRes.headers };
    res.writeHead(proxyRes.statusCode, responseHeaders);
    
    if (isStream) {
      let fullAssistantContent = "";
      let assistantRole = "assistant";
      let sseBuffer = "";  // Buffer for incomplete SSE lines
      
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
        sseBuffer += chunk.toString('utf-8');
        
        // Process complete lines only
        const lines = sseBuffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        sseBuffer = lines.pop() || "";
        
        for (const line of lines) {
          const tLine = line.trim();
          if (tLine.startsWith("data: ") && tLine !== "data: [DONE]") {
            const dataStr = tLine.substring(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.choices && data.choices.length > 0) {
                  const delta = data.choices[0].delta || {};
                  if (delta.role) assistantRole = delta.role;
                  if (delta.content) fullAssistantContent += delta.content;
                }
              } catch (e) { /* partial JSON, skip */ }
            }
          }
        }
      });
      
      proxyRes.on('end', () => {
        // Process any remaining data in buffer
        if (sseBuffer.trim()) {
          const tLine = sseBuffer.trim();
          if (tLine.startsWith("data: ") && tLine !== "data: [DONE]") {
            const dataStr = tLine.substring(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.choices && data.choices.length > 0) {
                  const delta = data.choices[0].delta || {};
                  if (delta.role) assistantRole = delta.role;
                  if (delta.content) fullAssistantContent += delta.content;
                }
              } catch (e) { }
            }
          }
        }
        
        if (fullAssistantContent) {
          try {
            appendMessages(sessionId, [{ role: assistantRole, content: fullAssistantContent }]);
          } catch (e) {
            console.error("Error storing assistant response:", e.message);
          }
        }
        res.end();
      });

      proxyRes.on('error', (err) => {
        console.error("Upstream response stream error:", err.message);
        res.end();
      });
    } else {
      const chunks = [];
      proxyRes.on('data', chunk => {
        chunks.push(chunk);
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          try {
            const responseData = Buffer.concat(chunks).toString('utf-8');
            const respJson = JSON.parse(responseData);
            if (respJson.choices && respJson.choices.length > 0) {
              const assistantMsg = respJson.choices[0].message;
              if (assistantMsg) {
                appendMessages(sessionId, [assistantMsg]);
              }
            }
          } catch (e) {
            // Non-JSON or malformed response, skip storing
          }
        }
        res.end();
      });
      proxyRes.on('error', (err) => {
        console.error("Upstream response error:", err.message);
        res.end();
      });
    }
  });
  
  proxyReq.on('error', (err) => {
    console.error("Proxy connection error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Bad Gateway — upstream unreachable", type: "proxy_error" } }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Request timeout'));
  });
  
  proxyReq.write(proxyBodyStr);
  proxyReq.end();
}


async function handleAnthropicMessages(req, res, bodyStr) {
  requestStats.anthropic_requests++;
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
  }
  
  let incomingMessages = [];
  if (body.system) {
    incomingMessages.push({ role: "system", content: body.system });
  }
  if (body.messages && Array.isArray(body.messages)) {
    incomingMessages = incomingMessages.concat(body.messages);
  }
  
  if (incomingMessages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: "No messages provided", type: "invalid_request_error" } }));
  }
  
  // Session ID resolution
  let sessionId = req.headers["x-stitcher-session"] || req.headers["x-neverforget-session"];
  if (!sessionId) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    sessionId = urlObj.searchParams.get("session");
  }
  if (!sessionId) {
    let firstContent = incomingMessages[0].content || "";
    if (typeof firstContent !== "string") firstContent = JSON.stringify(firstContent);
    sessionId = crypto.createHash("md5").update(firstContent).digest("hex").substring(0, 12);
  }

  // Sanitize session ID
  sessionId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');

  let existingMessages;
  try {
    ({ messages: existingMessages } = getStitchedContext(sessionId));
  } catch (e) {
    console.error("Error reading session:", e.message);
    existingMessages = [];
  }
  const newIncoming = _getNewMessages(existingMessages, incomingMessages);
  
  if (newIncoming.length > 0) {
    try {
      appendMessages(sessionId, newIncoming);
    } catch (e) {
      console.error("Error storing messages:", e.message);
    }
  }
  
  let stitchedMessages;
  try {
    ({ messages: stitchedMessages } = getStitchedContext(sessionId));
  } catch (e) {
    console.error("Error stitching context:", e.message);
    stitchedMessages = incomingMessages;
  }
  
  let outSystem = [];
  let outMessages = [];
  
  for (const m of stitchedMessages) {
    if (m.role === "system") {
      if (typeof m.content === "string") {
        outSystem.push({ type: "text", text: m.content });
      } else if (Array.isArray(m.content)) {
        outSystem = outSystem.concat(m.content);
      } else {
        outSystem.push({ type: "text", text: JSON.stringify(m.content) });
      }
    } else {
      outMessages.push(m);
    }
  }
  
  const proxyBody = { ...body, messages: outMessages };
  if (outSystem.length > 0) {
    let isAllText = outSystem.every(b => b.type === "text" && typeof b.text === "string");
    if (isAllText) {
      proxyBody.system = outSystem.map(b => b.text).join("\n\n");
    } else {
      proxyBody.system = outSystem;
    }
  } else {
    delete proxyBody.system;
  }
  
  if (!proxyBody.model && config.default_model) {
    proxyBody.model = config.default_model;
  }
  
  const proxyBodyStr = JSON.stringify(proxyBody);
  
  // Use Anthropic-specific upstream (NOT the OpenAI upstream)
  let baseUrl = (config.anthropic_upstream_url || "https://api.anthropic.com").replace(/\/$/, "");
  let upstreamUrl;
  if (baseUrl.endsWith("/v1")) {
    upstreamUrl = `${baseUrl}/messages`;
  } else if (baseUrl.includes("/v1/")) {
    upstreamUrl = baseUrl;
  } else {
    upstreamUrl = `${baseUrl}/v1/messages`;
  }
  
  const urlObj = new URL(upstreamUrl);
  
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(proxyBodyStr)
  };
  
  // Anthropic uses x-api-key, not Bearer tokens
  if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"];
  else if (req.headers["api-key"]) headers["x-api-key"] = req.headers["api-key"];
  else if (req.headers["authorization"]) {
    const auth = req.headers["authorization"];
    if (auth.toLowerCase().startsWith("bearer ")) {
      headers["x-api-key"] = auth.substring(7);
    } else {
      headers["x-api-key"] = auth;
    }
  } else if (config.api_key) headers["x-api-key"] = config.api_key;
  
  if (req.headers["anthropic-version"]) {
    headers["anthropic-version"] = req.headers["anthropic-version"];
  } else {
    headers["anthropic-version"] = "2023-06-01";
  }

  const isStream = !!body.stream;
  const clientModule = urlObj.protocol === "https:" ? https : http;
  
  const proxyReq = clientModule.request(upstreamUrl, {
    method: "POST",
    headers,
    timeout: 300000
  }, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    res.writeHead(proxyRes.statusCode, responseHeaders);
    
    if (isStream) {
      let fullAssistantContent = "";
      let sseBuffer = "";
      
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
        sseBuffer += chunk.toString('utf-8');
        
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || "";
        
        for (const line of lines) {
          const tLine = line.trim();
          if (tLine.startsWith("data: ")) {
            const dataStr = tLine.substring(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.type === "content_block_delta" && data.delta && data.delta.type === "text_delta") {
                  fullAssistantContent += data.delta.text || "";
                } else if (data.type === "message_delta" && data.delta && data.delta.text) {
                  // Fallback for some formats
                  fullAssistantContent += data.delta.text || "";
                }
              } catch (e) { /* partial JSON */ }
            }
          }
        }
      });
      
      proxyRes.on('end', () => {
        if (sseBuffer.trim()) {
          const tLine = sseBuffer.trim();
          if (tLine.startsWith("data: ")) {
            const dataStr = tLine.substring(6).trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.type === "content_block_delta" && data.delta && data.delta.type === "text_delta") {
                  fullAssistantContent += data.delta.text || "";
                } else if (data.type === "message_delta" && data.delta && data.delta.text) {
                  fullAssistantContent += data.delta.text || "";
                }
              } catch (e) { }
            }
          }
        }
        
        if (fullAssistantContent) {
          try {
            appendMessages(sessionId, [{ role: "assistant", content: fullAssistantContent }]);
          } catch (e) {
            console.error("Error storing assistant response:", e.message);
          }
        }
        res.end();
      });

      proxyRes.on('error', (err) => {
        console.error("Upstream response stream error:", err.message);
        res.end();
      });
    } else {
      const chunks = [];
      proxyRes.on('data', chunk => {
        chunks.push(chunk);
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          try {
            const responseData = Buffer.concat(chunks).toString('utf-8');
            const respJson = JSON.parse(responseData);
            if (respJson.content && Array.isArray(respJson.content)) {
              const textBlocks = respJson.content.filter(c => c.type === "text").map(c => c.text).join("");
              if (textBlocks) {
                appendMessages(sessionId, [{ role: "assistant", content: textBlocks }]);
              } else {
                appendMessages(sessionId, [{ role: "assistant", content: respJson.content }]);
              }
            } else if (respJson.content && typeof respJson.content === "string") {
              appendMessages(sessionId, [{ role: "assistant", content: respJson.content }]);
            }
          } catch (e) {
            // skip
          }
        }
        res.end();
      });
      proxyRes.on('error', (err) => {
        console.error("Upstream response error:", err.message);
        res.end();
      });
    }
  });
  
  proxyReq.on('error', (err) => {
    console.error("Proxy connection error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Bad Gateway — upstream unreachable", type: "proxy_error" } }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Request timeout'));
  });
  
  proxyReq.write(proxyBodyStr);
  proxyReq.end();
}

function handlePassthrough(req, res) {

  let baseUrl = config.upstream_url.replace(/\/$/, "");
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  // Build upstream URL preserving the path
  let upstreamPath = urlObj.pathname + urlObj.search;
  let upstreamUrl = baseUrl + upstreamPath;
  
  const upstreamUrlObj = new URL(upstreamUrl);
  const clientModule = upstreamUrlObj.protocol === "https:" ? https : http;

  // Forward most headers, skip hop-by-hop
  const headers = { ...req.headers };
  delete headers['host'];
  delete headers['connection'];
  delete headers['x-stitcher-session'];
  delete headers['x-neverforget-session'];
  
  // Add auth if not present
  if (!headers['authorization'] && !headers['api-key'] && !headers['x-api-key'] && config.api_key) {
    headers['authorization'] = `Bearer ${config.api_key}`;
  }

  const proxyReq = clientModule.request(upstreamUrl, {
    method: req.method,
    headers,
    timeout: 300000
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error("Passthrough proxy error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Bad Gateway", type: "proxy_error" } }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Request timeout'));
  });

  req.pipe(proxyReq);
}

export function startServer() {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    // Health check
    if (req.method === 'GET' && (urlObj.pathname === '/health' || urlObj.pathname === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: "ok", service: "neverforget" }));
    }
    
    if (req.method === 'GET' && urlObj.pathname === '/v1/stitcher/stats') {
      try {
        const stats = getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...stats, ...requestStats }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: "Internal error fetching stats" } }));
      }
    }
    
    if (req.method === 'POST' && (urlObj.pathname === '/v1/chat/completions' || urlObj.pathname === '/v1/messages')) {
      let bodyStr = '';
      let bodySize = 0;
      const maxBodySize = 50 * 1024 * 1024; // 50MB limit
      
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > maxBodySize) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: "Request body too large" } }));
          req.destroy();
          return;
        }
        bodyStr += chunk;
      });
      req.on('end', () => {
        if (!res.writableEnded) {
          if (urlObj.pathname === '/v1/messages') {
            handleAnthropicMessages(req, res, bodyStr);
          } else {
            handleChatCompletions(req, res, bodyStr);
          }
        }
      });
      req.on('error', (err) => {
        console.error("Request read error:", err.message);
        if (!res.headersSent) {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
      return;
    }
    
    // Passthrough: forward any other /v1/* request to upstream
    if (urlObj.pathname.startsWith('/v1/')) {
      return handlePassthrough(req, res);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: "Not Found" } }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Try a different port with --port.`);
      process.exit(1);
    }
    console.error("Server error:", err);
  });
  
  server.listen(config.port, '0.0.0.0', () => {
    // CLI handles console logging
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
