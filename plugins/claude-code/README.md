# 🧠 NeverForget — Claude Code Plugin

Gives Claude Code infinite memory. Conversations persist across sessions automatically.

## What it does

- **SessionStart hook**: Auto-starts the NeverForget proxy when you open Claude Code
- **`/neverforget-status`**: Check proxy status and memory stats
- **`/neverforget-sessions`**: List and manage stored sessions

## Install

```bash
# Make sure neverforget is installed
npm i -g neverforget

# In Claude Code, install the plugin:
/install-plugin /path/to/neverforget/plugins/claude-code
```

Then set the base URL so Claude Code routes through NeverForget:

```bash
neverforget integrate claude-code
```

## How it works

1. When you start Claude Code, the SessionStart hook checks if NeverForget is running
2. If not, it starts the proxy automatically in the background
3. With `ANTHROPIC_BASE_URL` pointing to NeverForget, all API calls go through the proxy
4. NeverForget stores every message and stitches full history into each request
5. Your Claude Code sessions now have persistent memory
