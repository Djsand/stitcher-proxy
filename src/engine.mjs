import fs from 'fs';
import { config } from './config.mjs';
import { getSessionFiles } from './storage.mjs';

function _textSimilarity(a, b) {
  if (!a || !b) return 0.0;
  if (a === b) return 1.0;
  a = a.substring(0, 500);
  b = b.substring(0, 500);
  
  const trigramsA = new Set();
  const trigramsB = new Set();
  for (let i = 0; i < a.length - 2; i++) trigramsA.add(a.substring(i, i+3));
  for (let i = 0; i < b.length - 2; i++) trigramsB.add(b.substring(i, i+3));
  
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0.0;
  
  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }
  const union = trigramsA.size + trigramsB.size - intersection;
  return intersection / union;
}

function estimateTokens(text) {
  return Math.floor(text.length / config.chars_per_token);
}

function readJsonlMessages(filepath) {
  const messages = [];
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        if (record.type === "message" && record.message) {
          const msg = record.message;
          if (["system", "user", "assistant"].includes(msg.role)) {
            if (msg.role === "assistant" && messages.length > 0) {
              let msgText = msg.content || "";
              if (Array.isArray(msgText)) {
                msgText = msgText.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
              }
              const recentAssistant = messages.slice(-10).filter(m => m.role === "assistant").slice(-5);
              let isDup = false;
              for (const m of recentAssistant) {
                let oldText = m.content || "";
                if (Array.isArray(oldText)) {
                  oldText = oldText.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
                }
                if (_textSimilarity(oldText, msgText) > config.dedup_threshold) {
                  isDup = true;
                  break;
                }
              }
              if (isDup) continue;
            }
            messages.push(msg);
          }
        }
      } catch (e) {
        // ignore JSON parse error
      }
    }
  } catch (e) {
    // ignore
  }
  return messages;
}

function _condenseRepetitive(messages) {
  if (messages.length < 4) return messages;
  const assistantIndices = [];
  messages.forEach((m, i) => { if (m.role === "assistant") assistantIndices.push(i); });
  if (assistantIndices.length < 2) return messages;

  const condensed = new Set();
  for (let i = assistantIndices.length - 1; i > 0; i--) {
    const idxNew = assistantIndices[i];
    let newText = messages[idxNew].content || "";
    if (Array.isArray(newText)) newText = newText.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
    
    if (!newText || condensed.has(idxNew)) continue;
    
    for (let j = i - 1; j >= Math.max(i - 6, 0); j--) {
      const idxOld = assistantIndices[j];
      if (condensed.has(idxOld)) continue;
      
      let oldText = messages[idxOld].content || "";
      if (Array.isArray(oldText)) oldText = oldText.filter(p => typeof p === "object" && p.type === "text").map(p => p.text || "").join(" ");
      
      if (!oldText) continue;
      
      const sim = _textSimilarity(newText, oldText);
      if (sim > config.condense_threshold) {
        condensed.add(idxOld);
      }
    }
  }

  if (condensed.size === 0) return messages;

  return messages.map((msg, i) => {
    if (condensed.has(i)) {
      return {
        role: msg.role,
        content: "[Prior response — similar content repeated below, skipped for context optimization]"
      };
    }
    return msg;
  });
}

export function getStitchedContext(sessionId) {
  const allFiles = getSessionFiles(sessionId);
  if (allFiles.length === 0) return { messages: [], totalTokens: 0 };
  
  const selectedMessages = [];
  let totalTokens = 0;
  const maxTokens = config.max_tokens;

  for (let i = allFiles.length - 1; i >= 0; i--) {
    const filepath = allFiles[i];
    const fileMessages = readJsonlMessages(filepath);
    const fileText = JSON.stringify(fileMessages);
    const fileTokens = estimateTokens(fileText);

    if (totalTokens + fileTokens > maxTokens) {
      for (let j = fileMessages.length - 1; j >= 0; j--) {
        const msg = fileMessages[j];
        const msgTokens = estimateTokens(JSON.stringify(msg));
        if (totalTokens + msgTokens > maxTokens) break;
        selectedMessages.push(msg);
        totalTokens += msgTokens;
      }
      break;
    }

    for (let j = fileMessages.length - 1; j >= 0; j--) {
      selectedMessages.push(fileMessages[j]);
    }
    totalTokens += fileTokens;
  }

  selectedMessages.reverse();
  const condensed = _condenseRepetitive(selectedMessages);
  
  return { messages: condensed, totalTokens };
}
