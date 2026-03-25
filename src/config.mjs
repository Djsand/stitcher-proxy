import fs from 'fs';
import path from 'path';
import os from 'os';

export const config = {
  port: 8081,
  upstream_url: "https://api.openai.com",
  anthropic_upstream_url: "https://api.anthropic.com",
  api_key: "",
  default_model: "",
  max_tokens: 128000,
  dedup_threshold: 0.60,
  condense_threshold: 0.35,
  chars_per_token: 4,
  data_dir: path.join(os.homedir(), ".stitcher", "sessions"),
  roll_size_bytes: 5 * 1024 * 1024
};

export function getConfigFilePath() {
  return path.join(os.homedir(), ".stitcher", "config.json");
}

export function saveConfig() {
  const p = getConfigFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const data = {
    port: config.port,
    upstream: config.upstream_url,
    anthropic_upstream: config.anthropic_upstream_url,
    api_key: config.api_key,
    default_model: config.default_model,
    max_tokens: config.max_tokens,
    dedup_threshold: config.dedup_threshold,
    condense_threshold: config.condense_threshold,
    chars_per_token: config.chars_per_token,
    data_dir: config.data_dir,
    roll_size_bytes: config.roll_size_bytes
  };
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export function loadConfigFile() {
  const p = getConfigFilePath();
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (data.port !== undefined) config.port = data.port;
      if (data.upstream !== undefined) config.upstream_url = data.upstream;
      if (data.anthropic_upstream !== undefined) config.anthropic_upstream_url = data.anthropic_upstream;
      if (data.api_key !== undefined) config.api_key = data.api_key;
      if (data.default_model !== undefined) config.default_model = data.default_model;
      if (data.max_tokens !== undefined) config.max_tokens = data.max_tokens;
      if (data.dedup_threshold !== undefined) config.dedup_threshold = Number(data.dedup_threshold);
      if (data.condense_threshold !== undefined) config.condense_threshold = Number(data.condense_threshold);
      if (data.chars_per_token !== undefined) config.chars_per_token = Number(data.chars_per_token);
      if (data.data_dir !== undefined) config.data_dir = path.resolve(data.data_dir.replace(/^~/, os.homedir()));
      if (data.roll_size_bytes !== undefined) config.roll_size_bytes = Number(data.roll_size_bytes);
    } catch (e) {
      // ignore
    }
  }
}

export function setupConfig(opts = {}) {
  loadConfigFile();
  
  if (process.env.STITCHER_PORT) config.port = parseInt(process.env.STITCHER_PORT, 10);
  if (process.env.STITCHER_UPSTREAM) config.upstream_url = process.env.STITCHER_UPSTREAM;
  if (process.env.STITCHER_ANTHROPIC_UPSTREAM) config.anthropic_upstream_url = process.env.STITCHER_ANTHROPIC_UPSTREAM;
  if (process.env.STITCHER_API_KEY) config.api_key = process.env.STITCHER_API_KEY;
  if (process.env.STITCHER_DEFAULT_MODEL) config.default_model = process.env.STITCHER_DEFAULT_MODEL;
  if (process.env.STITCHER_MAX_TOKENS) config.max_tokens = parseInt(process.env.STITCHER_MAX_TOKENS, 10);
  if (process.env.STITCHER_DATA_DIR) config.data_dir = path.resolve(process.env.STITCHER_DATA_DIR.replace(/^~/, os.homedir()));

  if (opts.port !== undefined) config.port = opts.port;
  if (opts.upstream !== undefined) config.upstream_url = opts.upstream;
  if (opts.max_tokens !== undefined) config.max_tokens = opts.max_tokens;
  if (opts.data_dir !== undefined) config.data_dir = path.resolve(opts.data_dir.replace(/^~/, os.homedir()));
  if (opts.api_key !== undefined) config.api_key = opts.api_key;
  if (opts.default_model !== undefined) config.default_model = opts.default_model;

  config.upstream_url = config.upstream_url.replace(/\/$/, "");
  fs.mkdirSync(config.data_dir, { recursive: true });
}
