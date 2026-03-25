# OpenClaw Integration

Configure OpenClaw to route its model requests through Stitcher to maintain long-term memory across sessions.

## Usage

Edit your OpenClaw model configuration (`openclaw.json` or equivalent) and set the `base_url`:

```json
{
  "model": "anthropic/claude-3-opus-20240229",
  "base_url": "http://localhost:8081/v1",
  "api_key": "YOUR_API_KEY"
}
```

## Setup via CLI

You can also see this guide by running:

```bash
stitcher-proxy integrate openclaw
```
