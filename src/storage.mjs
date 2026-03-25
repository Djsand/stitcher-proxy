import fs from 'fs';
import path from 'path';
import { config } from './config.mjs';

export function getSessionDir(sessionId) {
  const sessionDir = path.join(config.data_dir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

export function getActiveFile(sessionDir) {
  return path.join(sessionDir, "active.jsonl");
}

function _rollFile(sessionDir, activeFile) {
  const existingRolls = [];
  const files = fs.readdirSync(sessionDir);
  for (const file of files) {
    if (file.startsWith("active.") && file.endsWith(".jsonl") && file !== "active.jsonl") {
      const parts = file.split(".");
      if (parts.length === 3) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) existingRolls.push(num);
      }
    }
  }
  const nextNum = Math.max(...existingRolls, 0) + 1;
  const rolledName = `active.${nextNum.toString().padStart(3, '0')}.jsonl`;
  fs.renameSync(activeFile, path.join(sessionDir, rolledName));
}

export function appendMessages(sessionId, messages) {
  if (!messages || messages.length === 0) return;
  const sessionDir = getSessionDir(sessionId);
  const activeFile = getActiveFile(sessionDir);
  
  if (fs.existsSync(activeFile)) {
    const stats = fs.statSync(activeFile);
    if (stats.size >= config.roll_size_bytes) {
      _rollFile(sessionDir, activeFile);
    }
  }
  
  const lines = messages.map(msg => JSON.stringify({ type: "message", message: msg }) + "\n").join("");
  fs.appendFileSync(activeFile, lines, "utf-8");
}

export function getSessionFiles(sessionId) {
  const sessionDir = getSessionDir(sessionId);
  const activeFile = getActiveFile(sessionDir);
  const rolledFiles = [];
  
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
  rolledFiles.sort((a, b) => a.num - b.num);
  const allFiles = rolledFiles.map(r => r.path);
  if (fs.existsSync(activeFile)) {
    allFiles.push(activeFile);
  }
  return allFiles;
}

export function getStats() {
  let sessionCount = 0;
  let totalMessages = 0;
  
  if (fs.existsSync(config.data_dir)) {
    const sessions = fs.readdirSync(config.data_dir);
    for (const session of sessions) {
      const sessionDir = path.join(config.data_dir, session);
      if (fs.statSync(sessionDir).isDirectory()) {
        sessionCount++;
        const files = fs.readdirSync(sessionDir);
        for (const f of files) {
          if (f.endsWith(".jsonl")) {
            try {
              const content = fs.readFileSync(path.join(sessionDir, f), "utf-8");
              const lines = content.split("\n");
              totalMessages += lines.filter(l => l.trim().length > 0).length;
            } catch (e) {
              // ignore
            }
          }
        }
      }
    }
  }
  return { session_count: sessionCount, total_messages_stored: totalMessages };
}
