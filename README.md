# 🧵 Stitcher Proxy

**LLMs have amnesia. Stitcher is the cure.**

A transparent proxy that gives any LLM infinite memory. Zero dependencies. One command.

---

## Install

```bash
npm install -g stitcher-proxy
```

Or run without installing:

```bash
npx stitcher-proxy
```

Or one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/stitcher-proxy/main/install.sh | bash
```

## How It Works

You point your LLM client at Stitcher instead of OpenAI/Anthropic directly.
Stitcher intercepts every request, stitches in the full conversation history from local storage, and forwards it upstream. Your LLM gets maximum context every time. Transparently.

```
┌─────────┐     POST /v1/chat/completions      ┌──────────────────┐
│  Your    │ ─────────────────────────────────▶ │  Stitcher Proxy  │
│  App     │    (only new messages)             │                  │
└─────────┘                                     │  1. Save to JSONL│
     ▲                                          │  2. Stitch history│
     │                                          │  3. Dedup        │
     │         Response (unchanged)             │  4. Token budget │
     └─────────────────────────────────────── ◀ │  5. Forward      │
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │  OpenAI/Anthropic│
                                                │  (full context)  │
                                                └──────────────────┘
```

## Quick Start

```bash
# Setup (pick provider, set API key, configure token budget)
stitcher-proxy init

# Start the proxy
stitcher-proxy

# Auto-configure Claude Code, Codex, and all OpenAI clients
stitcher-proxy integrate all
```

## Usage

Change your `base_url`. That's it.

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8081/v1",
    api_key="your-real-key",
    default_headers={"X-Stitcher-Session": "user-123"}
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What did we talk about yesterday?"}]
)
# Stitcher injected the full history. The model remembers.
```

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "X-Stitcher-Session: my-session" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Continue where we left off."}]}'
```

## Works With

Claude Code · Codex · Cursor · OpenClaw · LangChain · Vercel AI SDK · Ollama · vLLM · any OpenAI-compatible client

```bash
stitcher-proxy integrate all          # Configure everything
stitcher-proxy integrate claude-code  # Just Claude Code
stitcher-proxy integrate codex        # Just Codex
```

## CLI Reference

```
stitcher-proxy                        Start the proxy
stitcher-proxy init                   Interactive setup wizard
stitcher-proxy start [--port N]       Start with options
stitcher-proxy status                 Config + session count
stitcher-proxy sessions               List sessions
stitcher-proxy sessions purge <name>  Delete a session
stitcher-proxy config                 Show all settings
stitcher-proxy config edit            Interactive config editor
stitcher-proxy config set <key> <val> Quick set a value
stitcher-proxy integrate [target]     Auto-configure integrations
```

## Configuration

All settings are tunable via `stitcher-proxy config edit`:

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `8081` | Proxy port |
| `upstream_url` | `https://api.openai.com` | Upstream LLM API |
| `max_tokens` | `128000` | Token budget for stitched context |
| `dedup_threshold` | `0.6` | Similarity cutoff for dedup (0-1) |
| `condense_threshold` | `0.35` | Similarity cutoff for condensing |
| `chars_per_token` | `4` | Token estimation ratio |
| `roll_size_bytes` | `5242880` | File roll threshold (5MB) |

Config priority: CLI flags → env vars → `~/.stitcher/config.json` → defaults

## Under The Hood

Stitcher stores every message as a line in JSONL files. When context is needed:

1. **Read backward** through archived files (newest → oldest)
2. **Deduplicate** near-identical assistant messages via trigram similarity
3. **Budget** — stop when token limit is reached
4. **Condense** — replace older similar messages with placeholders
5. **Reverse** — restore chronological order
6. **Forward** — send the full context to upstream

Sessions auto-roll to numbered archives when files exceed the configured size.

## License

MIT
