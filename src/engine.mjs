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
  return union === 0 ? 0.0 : intersection / union;
}

function estimateTokens(text) {
  // Use Buffer.byteLength for accurate multi-byte character handling (e.g. Danish æøå, CJK)
  const byteLen = Buffer.byteLength(text, 'utf-8');
  return Math.max(1, Math.floor(byteLen / config.chars_per_token));
}

function _extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => typeof p === "object" && p.type === "text")
      .map(p => p.text || "")
      .join(" ");
  }
  return JSON.stringify(content);
}

function readJsonlMessages(filepath) {
  const messages = [];
  let content;
  try {
    content = fs.readFileSync(filepath, "utf-8");
  } catch (e) {
    // File might have been deleted between listing and reading
    return messages;
  }
  
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
            const msgText = _extractText(msg.content);
            const recentAssistant = messages.slice(-10).filter(m => m.role === "assistant").slice(-5);
            let isDup = false;
            for (const m of recentAssistant) {
              const oldText = _extractText(m.content);
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
      // Skip corrupted JSON lines silently
    }
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
    const newText = _extractText(messages[idxNew].content);
    
    if (!newText || condensed.has(idxNew)) continue;
    
    for (let j = i - 1; j >= Math.max(i - 6, 0); j--) {
      const idxOld = assistantIndices[j];
      if (condensed.has(idxOld)) continue;
      
      const oldText = _extractText(messages[idxOld].content);
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
  // Reserve ~5% for the upstream model's response
  const budgetTokens = Math.floor(maxTokens * 0.95);

  for (let i = allFiles.length - 1; i >= 0; i--) {
    const filepath = allFiles[i];
    const fileMessages = readJsonlMessages(filepath);
    if (fileMessages.length === 0) continue;
    
    const fileText = JSON.stringify(fileMessages);
    const fileTokens = estimateTokens(fileText);

    if (totalTokens + fileTokens > budgetTokens) {
      // Partial file: read messages backward until budget exhausted
      for (let j = fileMessages.length - 1; j >= 0; j--) {
        const msg = fileMessages[j];
        const msgTokens = estimateTokens(JSON.stringify(msg));
        if (totalTokens + msgTokens > budgetTokens) break;
        selectedMessages.push(msg);
        totalTokens += msgTokens;
      }
      break;
    }

    // Full file fits: add all messages (backward order)
    for (let j = fileMessages.length - 1; j >= 0; j--) {
      selectedMessages.push(fileMessages[j]);
    }
    totalTokens += fileTokens;
  }

  // Restore chronological order
  selectedMessages.reverse();
  
  // Condense repetitive assistant messages
  const condensed = _condenseRepetitive(selectedMessages);
  
  return { messages: condensed, totalTokens };
}
