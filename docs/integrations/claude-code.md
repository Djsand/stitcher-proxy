# Claude Code Integration

Stitcher acts as a drop-in replacement for Anthropic's API, giving Claude Code an infinite memory context window.

## Usage

Simply run Claude Code with the `ANTHROPIC_BASE_URL` environment variable pointing to your Stitcher proxy port:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8081/v1
claude
```

## Setup via CLI

You can also see this guide by running:

```bash
stitcher-proxy integrate claude-code
```
