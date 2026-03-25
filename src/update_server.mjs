import fs from 'fs';

const serverMjsPath = '/Users/nicolaisand/Desktop/neverforget/src/server.mjs';
let content = fs.readFileSync(serverMjsPath, 'utf8');

const anthropicFunc = `
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
    const urlObj = new URL(req.url, \`http://\${req.headers.host || 'localhost'}\`);
    sessionId = urlObj.searchParams.get("session");
  }
  if (!sessionId) {
    let firstContent = incomingMessages[0].content || "";
    if (typeof firstContent !== "string") firstContent = JSON.stringify(firstContent);
    sessionId = crypto.createHash("md5").update(firstContent).digest("hex").substring(0, 12);
  }

  // Sanitize session ID
  sessionId = sessionId.replace(/[^a-zA-Z0-9_\\-]/g, '_');

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
      proxyBody.system = outSystem.map(b => b.text).join("\\n\\n");
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
  
  let baseUrl = config.upstream_url.replace(/\\/$/, "");
  let upstreamUrl;
  if (baseUrl.endsWith("/v1")) {
    upstreamUrl = \`\${baseUrl}/messages\`;
  } else if (baseUrl.includes("/v1/")) {
    upstreamUrl = baseUrl;
  } else {
    upstreamUrl = \`\${baseUrl}/v1/messages\`;
  }
  
  const urlObj = new URL(upstreamUrl);
  
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(proxyBodyStr)
  };
  
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
        
        const lines = sseBuffer.split('\\n');
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
`;

content = content.replace('function handlePassthrough(req, res) {', anthropicFunc);

const openaiRouteStr = `if (req.method === 'POST' && urlObj.pathname === '/v1/chat/completions') {`;
const combinedRouteStr = `if (req.method === 'POST' && (urlObj.pathname === '/v1/chat/completions' || urlObj.pathname === '/v1/messages')) {`;
content = content.replace(openaiRouteStr, combinedRouteStr);

const oldHandlerStr = `if (!res.writableEnded) {
          handleChatCompletions(req, res, bodyStr);
        }`;
const newHandlerStr = `if (!res.writableEnded) {
          if (urlObj.pathname === '/v1/messages') {
            handleAnthropicMessages(req, res, bodyStr);
          } else {
            handleChatCompletions(req, res, bodyStr);
          }
        }`;
content = content.replace(oldHandlerStr, newHandlerStr);

const oldStatsRouteStr = `try {
        const stats = getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(stats));`;
const newStatsRouteStr = `try {
        const stats = getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...stats, ...requestStats }));`;
content = content.replace(oldStatsRouteStr, newStatsRouteStr);

fs.writeFileSync(serverMjsPath, content, 'utf8');
console.log('Script updated successfully.');
