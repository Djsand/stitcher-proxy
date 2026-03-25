import fs from 'fs';
import path from 'path';
import { config } from './config.mjs';

export function getSessionDir(sessionId) {
  // Sanitize session ID to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const sessionDir = path.join(config.data_dir, safeId);
  fs.mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

export function getActiveFile(sessionDir) {
  return path.join(sessionDir, "active.jsonl");
}

function _rollFile(sessionDir, activeFile) {
  const existingRolls = [];
  let files;
  try {
    files = fs.readdirSync(sessionDir);
  } catch (e) {
    return; // Can't list dir, skip rolling
  }
  
  for (const file of files) {
    if (file.startsWith("active.") && file.endsWith(".jsonl") && file !== "active.jsonl") {
      const parts = file.split(".");
      if (parts.length === 3) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) existingRolls.push(num);
      }
    }
  }
  const nextNum = (existingRolls.length > 0 ? Math.max(...existingRolls) : 0) + 1;
  const rolledName = `active.${nextNum.toString().padStart(3, '0')}.jsonl`;
  try {
    fs.renameSync(activeFile, path.join(sessionDir, rolledName));
  } catch (e) {
    console.error("Error rolling file:", e.message);
  }
}

export function appendMessages(sessionId, messages) {
  if (!messages || messages.length === 0) return;
  const sessionDir = getSessionDir(sessionId);
  const activeFile = getActiveFile(sessionDir);
  
  try {
    if (fs.existsSync(activeFile)) {
      const stats = fs.statSync(activeFile);
      if (stats.size >= config.roll_size_bytes) {
        _rollFile(sessionDir, activeFile);
      }
    }
  } catch (e) {
    // If stat fails, just keep writing to activeFile
  }
  
  const lines = messages.map(msg => JSON.stringify({ type: "message", message: msg }) + "\n").join("");
  fs.appendFileSync(activeFile, lines, "utf-8");
}

export function getSessionFiles(sessionId) {
  const sessionDir = getSessionDir(sessionId);
  const activeFile = getActiveFile(sessionDir);
  const rolledFiles = [];
  
  try {
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      for (const file of files) {
        if (file.startsWith("active.") && file.endsWith(".jsonl") && file !== "active.jsonl") {
          const parts = file.split(".");
          if (parts.length === 3) {
            const num = parseInt(parts[1], 10);
            if (!isNaN(num)) {
              rolledFiles.push({ num, path: path.join(sessionDir, file) });
            }
          }
        }
      }
    }
  } catch (e) {
    // If we can't read the dir, return what we can
  }
  
  rolledFiles.sort((a, b) => a.num - b.num);
  const allFiles = rolledFiles.map(r => r.path);
  
  try {
    if (fs.existsSync(activeFile)) {
      allFiles.push(activeFile);
    }
  } catch (e) {
    // Skip if can't check
  }
  
  return allFiles;
}

export function getStats() {
  let sessionCount = 0;
  let totalMessages = 0;
  
  try {
    if (fs.existsSync(config.data_dir)) {
      const sessions = fs.readdirSync(config.data_dir);
      for (const session of sessions) {
        const sessionDir = path.join(config.data_dir, session);
        try {
          if (!fs.statSync(sessionDir).isDirectory()) continue;
        } catch (e) {
          continue;
        }
        sessionCount++;
        try {
          const files = fs.readdirSync(sessionDir);
          for (const f of files) {
            if (f.endsWith(".jsonl")) {
              try {
                const content = fs.readFileSync(path.join(sessionDir, f), "utf-8");
                const lines = content.split("\n");
                totalMessages += lines.filter(l => l.trim().length > 0).length;
              } catch (e) {
                // Skip unreadable files
              }
            }
          }
        } catch (e) {
          // Skip unreadable session dir
        }
      }
    }
  } catch (e) {
    // data_dir doesn't exist or not accessible
  }
  
  return { session_count: sessionCount, total_messages_stored: totalMessages };
}
