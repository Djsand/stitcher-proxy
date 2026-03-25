---
name: neverforget
description: "Infinite memory proxy for LLMs. Manages the NeverForget proxy for persistent conversation memory across sessions. Use when asked about session memory, context persistence, or managing stored conversations."
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      bins: ["neverforget"]
    install:
      - id: npm
        kind: npm
        package: neverforget
        global: true
        bins: ["neverforget"]
        label: "Install NeverForget (npm)"
---

# NeverForget — Infinite LLM Memory

A transparent proxy that gives any LLM infinite memory by stitching conversation history from local JSONL storage.

## When to Use

- User asks about persistent memory or context across sessions
- User wants to check stored conversation history
- User wants to manage sessions (list, purge)
- User wants to configure the proxy (port, token budget, thresholds)

## Commands

### Check status
```bash
neverforget status
```

### Start the proxy
```bash
neverforget start
# Or in background:
neverforget start &
```

### List sessions
```bash
neverforget sessions
```

### Purge a session
```bash
neverforget sessions purge <session-name>
```

### Configure
```bash
neverforget setup          # Interactive
neverforget config         # Show current config
neverforget config set max_tokens 200000
```

### Integrate with tools
```bash
neverforget integrate all  # Auto-configure Claude Code, Codex, Cursor
```

## How It Works

NeverForget runs a local proxy on port 8081. LLM clients point their base URL at the proxy instead of directly at OpenAI/Anthropic. The proxy:

1. Intercepts every API request
2. Stores messages in local JSONL files per session
3. On each new request, stitches the full history backward from newest to oldest
4. Deduplicates near-identical messages
5. Enforces a configurable token budget
6. Forwards the enriched request to the real API
7. Stores the response

Supports both OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` formats.
