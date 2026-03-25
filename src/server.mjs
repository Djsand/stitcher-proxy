import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { config } from './config.mjs';
import { appendMessages, getStats } from './storage.mjs';
import { getStitchedContext } from './engine.mjs';

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
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch (e) {
    res.writeHead(400);
    return res.end("Invalid JSON body");
  }
  
  const incomingMessages = body.messages || [];
  if (incomingMessages.length === 0) {
    res.writeHead(400);
    return res.end("No messages provided");
  }
  
  let sessionId = req.headers["x-stitcher-session"];
  if (!sessionId) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    sessionId = urlObj.searchParams.get("session");
  }
  if (!sessionId) {
    let firstContent = incomingMessages[0].content || "";
    if (typeof firstContent !== "string") firstContent = JSON.stringify(firstContent);
    sessionId = crypto.createHash("md5").update(firstContent).digest("hex").substring(0, 12);
  }

  const { messages: existingMessages } = getStitchedContext(sessionId);
  const newIncoming = _getNewMessages(existingMessages, incomingMessages);
  
  if (newIncoming.length > 0) {
    appendMessages(sessionId, newIncoming);
  }
  
  const { messages: stitchedMessages } = getStitchedContext(sessionId);
  
  const proxyBody = { ...body, messages: stitchedMessages };
  if (!proxyBody.model && config.default_model) {
    proxyBody.model = config.default_model;
  }
  
  const proxyBodyStr = JSON.stringify(proxyBody);
  
  let baseUrl = config.upstream_url.replace(/\/$/, "");
  let upstreamUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const urlObj = new URL(upstreamUrl);
  
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(proxyBodyStr)
  };
  
  if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"];
  else if (req.headers["api-key"]) headers["api-key"] = req.headers["api-key"];
  else if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"];
  else if (config.api_key) headers["authorization"] = `Bearer ${config.api_key}`;
  
  const isStream = !!body.stream;
  const clientModule = urlObj.protocol === "https:" ? https : http;
  
  const proxyReq = clientModule.request(upstreamUrl, {
    method: "POST",
    headers,
    timeout: 300000 // 5 mins
  }, (proxyRes) => {
    // Forward headers from upstream to client
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    
    if (isStream) {
      let fullAssistantContent = "";
      let assistantRole = "assistant";
      
      proxyRes.on('data', (chunk) => {
        res.write(chunk);
        const chunkStr = chunk.toString('utf-8');
        const lines = chunkStr.split('\n');
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
              } catch (e) { }
            }
          }
        }
      });
      
      proxyRes.on('end', () => {
        if (fullAssistantContent) {
          appendMessages(sessionId, [{ role: assistantRole, content: fullAssistantContent }]);
        }
        res.end();
      });
    } else {
      let responseData = "";
      proxyRes.on('data', chunk => {
        responseData += chunk;
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        if (proxyRes.statusCode === 200) {
          try {
            const respJson = JSON.parse(responseData);
            if (respJson.choices && respJson.choices.length > 0) {
              const assistantMsg = respJson.choices[0].message;
              if (assistantMsg) {
                appendMessages(sessionId, [assistantMsg]);
              }
            }
          } catch (e) {}
        }
        res.end();
      });
    }
  });
  
  proxyReq.on('error', (err) => {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway");
    }
  });
  
  proxyReq.write(proxyBodyStr);
  proxyReq.end();
}

export function startServer() {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    
    if (req.method === 'GET' && urlObj.pathname === '/v1/stitcher/stats') {
      const stats = getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats));
    }
    
    if (req.method === 'POST' && urlObj.pathname === '/v1/chat/completions') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => handleChatCompletions(req, res, bodyStr));
      return;
    }
    
    res.writeHead(404);
    res.end('Not Found');
  });
  
  server.listen(config.port, '0.0.0.0', () => {
    // CLI handles console logging
  });
}
