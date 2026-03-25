#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { setupConfig, config, getConfigFilePath, saveConfig } from '../src/config.mjs';
import { startServer } from '../src/server.mjs';

function c(text, color) {
  if (process.env.NO_COLOR) return text;
  const colors = {
    cyan: "\x1b[96m",
    green: "\x1b[92m",
    yellow: "\x1b[93m",
    red: "\x1b[91m",
    bold: "\x1b[1m",
    reset: "\x1b[0m"
  };
  return `${colors[color] || ""}${text}${colors.reset}`;
}

async function question(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans); }));
}

async function runWizard() {
  console.log(c("🧵 Stitcher Proxy — Setup", "cyan"));
  
  console.log(c("? Upstream provider:", "bold"));
  console.log("  1. OpenAI (api.openai.com)");
  console.log("  2. Anthropic (api.anthropic.com)");
  console.log("  3. Custom URL");
  
  const providerChoice = (await question("> ")).trim();
  let upstream, defaultModel, maxTokens;
  
  if (providerChoice === "1") {
    upstream = "https://api.openai.com";
    defaultModel = "gpt-4o";
    maxTokens = 128000;
  } else if (providerChoice === "2") {
    upstream = "https://api.anthropic.com";
    defaultModel = "claude-3-opus-20240229";
    maxTokens = 200000;
  } else {
    upstream = (await question("Enter Custom URL: ")).trim();
    defaultModel = "";
    maxTokens = 128000;
  }
  
  const apiKey = (await question(c(`? API key (stored locally in ${getConfigFilePath()}):\n> `, "bold"))).trim();
  
  const modelInput = (await question(c(`? Default model [${defaultModel}]:\n> `, "bold"))).trim();
  if (modelInput) defaultModel = modelInput;
  
  const tokensInput = (await question(c(`? Max token budget [${maxTokens}]:\n> `, "bold"))).trim();
  if (tokensInput) maxTokens = parseInt(tokensInput, 10);
  
  const portInput = (await question(c("? Proxy port [8081]:\n> ", "bold"))).trim();
  const port = portInput ? parseInt(portInput, 10) : 8081;
  
  console.log();
  console.log(c("📋 Summary", "cyan"));
  console.log(`  Upstream: ${upstream}`);
  console.log(`  API Key: ${apiKey ? '***' : 'None'}`);
  console.log(`  Model: ${defaultModel}`);
  console.log(`  Max Tokens: ${maxTokens}`);
  console.log(`  Port: ${port}`);
  
  const confirm = (await question(c("? Save this configuration? [y/N]: ", "bold"))).trim().toLowerCase();
  if (confirm === 'y' || confirm === 'yes') {
    setupConfig();
    config.upstream_url = upstream;
    config.api_key = apiKey;
    config.default_model = defaultModel;
    config.max_tokens = maxTokens;
    config.port = port;
    saveConfig();
    console.log(c(`✅ Config saved to ${getConfigFilePath()}`, "green"));
    console.log("Start the proxy with: neverforget start");
  } else {
    console.log(c("❌ Setup cancelled.", "red"));
  }
}

async function startProxy(opts) {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    await runWizard();
    if (!fs.existsSync(configPath)) return;
  }
  
  setupConfig({
    port: opts.port,
    upstream: opts.upstream,
    max_tokens: opts.maxTokens,
    data_dir: opts.dataDir
  });
  
  console.log(c(`🦞 Starting Stitcher Proxy on port ${config.port}`, "cyan"));
  console.log(c(`🔗 Upstream: ${config.upstream_url}`, "yellow"));
  console.log(c(`🧠 Max tokens: ${config.max_tokens}`, "green"));
  console.log(c(`💾 Data dir: ${config.data_dir}`, "cyan"));
  console.log("Ready to stitch contexts.");
  
  startServer();
}

function statusCmd() {
  setupConfig();
  let count = 0;
  if (fs.existsSync(config.data_dir)) {
    count = fs.readdirSync(config.data_dir).filter(f => fs.statSync(path.join(config.data_dir, f)).isDirectory()).length;
  }
  console.log(c("📊 Stitcher Proxy Status", "cyan"));
  console.log(`Port: ${config.port}`);
  console.log(`Upstream: ${config.upstream_url}`);
  console.log(`Default Model: ${config.default_model}`);
  console.log(`Max Tokens: ${config.max_tokens}`);
  console.log(`Total Sessions: ${count}`);
}

function sessionsCmd(args) {
  setupConfig();
  if (args[0] === "purge" && args[1]) {
    const sessionDir = path.join(config.data_dir, args[1]);
    if (fs.existsSync(sessionDir) && fs.statSync(sessionDir).isDirectory()) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(c(`✅ Purged session: ${args[1]}`, "green"));
    } else {
      console.log(c(`❌ Session not found: ${args[1]}`, "red"));
    }
    return;
  }
  
  console.log(c("📂 Stitcher Sessions", "cyan"));
  if (!fs.existsSync(config.data_dir)) {
    console.log("No sessions found.");
    return;
  }
  
  const dirs = fs.readdirSync(config.data_dir);
  for (const d of dirs) {
    const dpath = path.join(config.data_dir, d);
    if (fs.statSync(dpath).isDirectory()) {
      let size = 0;
      let msgCount = 0;
      const files = fs.readdirSync(dpath);
      for (const f of files) {
        const fpath = path.join(dpath, f);
        size += fs.statSync(fpath).size;
        if (f.endsWith(".jsonl")) {
          try {
            const content = fs.readFileSync(fpath, 'utf-8');
            msgCount += content.split('\n').filter(l => l.trim().length > 0).length;
          } catch(e){}
        }
      }
      console.log(`- ${d} (${msgCount} msgs, ${(size/1024).toFixed(1)} KB)`);
    }
  }
}

const CONFIG_SCHEMA = [
  ["port", "Proxy port", "int", "Port the proxy listens on"],
  ["upstream_url", "Upstream URL", "str", "LLM API endpoint"],
  ["api_key", "API key", "secret", "API key for upstream provider"],
  ["default_model", "Default model", "str", "Model to use if unspecified"],
  ["max_tokens", "Max token budget", "int", "Maximum tokens in stitched context"],
  ["dedup_threshold", "Dedup threshold", "float", "Similarity threshold for duplicates"],
  ["condense_threshold", "Condense threshold", "float", "Similarity threshold for condensing"],
  ["chars_per_token", "Chars per token", "int", "Character-to-token ratio"],
  ["roll_size_bytes", "File roll size", "int", "JSONL file size before rolling"],
  ["data_dir", "Data directory", "str", "Where session JSONL files are stored"]
];

async function interactiveConfig() {
  console.log(c("⚙️  Stitcher Config — Interactive Editor", "cyan"));
  console.log(c("   Press Enter to keep current value. Type 'skip' to skip remaining.\n", "yellow"));
  
  let changed = false;
  for (const [key, label, typ, desc] of CONFIG_SCHEMA) {
    const current = config[key] || "";
    const display = typ === "secret" && current ? "***" : current;
    const promptText = `  ${c(label, 'bold')} (${c(desc, 'yellow')})\n  Current: ${c(String(display), 'cyan')}\n  > `;
    
    const raw = (await question(promptText)).trim();
    if (raw.toLowerCase() === "skip") break;
    if (!raw) continue;
    
    let val = raw;
    if (typ === "int") {
      val = parseInt(raw, 10);
      if (isNaN(val)) {
        console.log(c(`  ❌ Expected integer, skipping`, "red"));
        continue;
      }
    } else if (typ === "float") {
      val = parseFloat(raw);
      if (isNaN(val)) {
        console.log(c(`  ❌ Expected number, skipping`, "red"));
        continue;
      }
    }
    
    config[key] = val;
    changed = true;
    console.log(c(`  ✅ ${key} → ${typ === 'secret' ? '***' : val}\n`, "green"));
  }
  
  if (changed) {
    saveConfig();
    console.log(c(`✅ Config saved to ${getConfigFilePath()}`, "green"));
  } else {
    console.log(c("  No changes.", "yellow"));
  }
}

async function configCmd(args) {
  setupConfig();
  if (args[0] === "set" && args[1] && args[2]) {
    const key = args[1];
    let val = args[2];
    const schema = CONFIG_SCHEMA.find(s => s[0] === key);
    if (schema) {
      if (schema[2] === "int") val = parseInt(val, 10);
      else if (schema[2] === "float") val = parseFloat(val);
      config[key] = val;
      saveConfig();
      console.log(c(`✅ ${key} = ${val}`, "green"));
    } else {
      console.log(c(`❌ Unknown key: ${key}`, "red"));
    }
    return;
  }
  
  if (args[0] === "edit") {
    await interactiveConfig();
    return;
  }
  
  console.log(c("⚙️  Stitcher Config", "cyan"));
  console.log(c(`   File: ${getConfigFilePath()}\n`, "yellow"));
  for (const [key, label, typ, desc] of CONFIG_SCHEMA) {
    const val = config[key] || "";
    const display = (typ === "secret" && val) ? (val.length > 8 ? `${val.slice(0,4)}***${val.slice(-4)}` : "***") : val;
    console.log(`  ${c(key, 'bold').padEnd(40)} ${display}`);
    console.log(`  ${''.padEnd(29)} ${c(desc, 'yellow')}`);
  }
  console.log(`\n  Edit interactively: ${c('neverforget config edit', 'green')}`);
  console.log(`  Set one value:      ${c('neverforget config set <key> <value>', 'green')}`);
}

function addToShellProfile(line) {
  const shell = process.env.SHELL || "/bin/zsh";
  let profile;
  if (shell.includes("zsh")) profile = path.join(os.homedir(), ".zshrc");
  else if (shell.includes("bash")) profile = path.join(os.homedir(), ".bashrc");
  else profile = path.join(os.homedir(), ".profile");
  
  const existing = fs.existsSync(profile) ? fs.readFileSync(profile, "utf-8") : "";
  if (existing.includes(line)) return { profile, added: false };
  
  fs.appendFileSync(profile, `\n# Stitcher Proxy — infinite LLM memory\n${line}\n`);
  return { profile, added: true };
}

function integrateCmd(args) {
  setupConfig();
  const target = args[0];
  const port = config.port;
  const base = `http://localhost:${port}/v1`;
  
  if (target === "claude-code") {
    console.log(c("🧵 Integrating with Claude Code...", "cyan"));
    const line = `export ANTHROPIC_BASE_URL=${base}`;
    const { profile, added } = addToShellProfile(line);
    if (added) {
      console.log(c(`✅ Added to ${profile}:`, "green"));
      console.log(`   ${line}`);
      console.log(`\n   Run: ${c('source ' + profile, 'yellow')} or open a new terminal.`);
      console.log(`   Then just run ${c('claude', 'bold')} as normal.`);
    } else {
      console.log(c(`✅ Already configured in ${profile}`, "green"));
    }
  } else if (target === "all") {
    console.log(c("🧵 Integrating with everything...", "cyan"));
    const lines = [`export ANTHROPIC_BASE_URL=${base}`, `export OPENAI_BASE_URL=${base}`];
    let addedCount = 0;
    let profilePath;
    for (const line of lines) {
      const { profile, added } = addToShellProfile(line);
      profilePath = profile;
      if (added) {
        console.log(`   Added: ${line}`);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      console.log(c(`✅ Configured in ${profilePath}`, "green"));
      console.log(`\n   Run: ${c('source ' + profilePath, 'yellow')} or open a new terminal.`);
    } else {
      console.log(c(`✅ Already configured.`, "green"));
    }
  } else {
    console.log(c("🧵 Stitcher Integrations", "cyan"));
    console.log(`\n  ${c('neverforget integrate all', 'bold')}         — Auto-configure everything`);
    console.log(`  ${c('neverforget integrate claude-code', 'bold')} — Claude Code`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let command = "start";
  
  if (args.length > 0 && !args[0].startsWith("--")) {
    command = args[0];
    args.shift();
  }
  
  const opts = {};
  for(let i=0; i<args.length; i++) {
    if (args[i] === "--port") opts.port = parseInt(args[++i], 10);
    else if (args[i] === "--upstream") opts.upstream = args[++i];
    else if (args[i] === "--max-tokens") opts.maxTokens = parseInt(args[++i], 10);
    else if (args[i] === "--data-dir") opts.dataDir = args[++i];
    else if (args[i] === "--help" || args[i] === "-h") { command = "help"; }
  }
  
  if (command === "help") {
    console.log(`${c("🧵 neverforget", "cyan")} — Universal infinite-memory proxy for LLMs

${c("Usage:", "bold")}
  neverforget                        Start the proxy (default)
  neverforget init                   Interactive setup wizard
  neverforget start [--port N]       Start the proxy
  neverforget status                 Show config + session count
  neverforget sessions               List all sessions
  neverforget sessions purge <name>  Delete a session
  neverforget config                 Show all settings
  neverforget config edit            Interactive config editor
  neverforget config set <key> <val> Set a config value
  neverforget integrate [target]     Auto-configure tool integrations
  neverforget --help                 Show this help

${c("Options:", "bold")}
  --port <n>           Proxy port (default: 8081)
  --upstream <url>     Upstream LLM API URL
  --max-tokens <n>     Token budget for stitched context
  --data-dir <path>    Session storage directory

${c("Quick start:", "bold")}
  npx neverforget init    # Setup
  npx neverforget         # Run`);
  } else if (command === "init") {
    await runWizard();
  } else if (command === "start") {
    await startProxy(opts);
  } else if (command === "status") {
    statusCmd();
  } else if (command === "sessions") {
    sessionsCmd(args);
  } else if (command === "config") {
    await configCmd(args);
  } else if (command === "integrate") {
    integrateCmd(args);
  } else {
    await startProxy(opts);
  }
}

main().catch(err => {
  console.error(c("Fatal Error:", "red"), err);
  process.exit(1);
});
