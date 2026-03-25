# Stitcher Proxy 🦞

**LLMs have amnesia. Stitcher is the cure.**

Stitcher Proxy is a universal, infinite-memory proxy for any OpenAI-compatible LLM API.

## The Problem
LLMs forget what you told them 10 minutes ago. Their context windows are limited, and clients drop older messages when they hit token limits. Real conversations span days, weeks, or months, but APIs treat every request as an isolated event.

## The Solution
Stitcher is a transparent proxy that gives your LLM infinite memory. You send your new messages to Stitcher; Stitcher instantly pieces together the entire history from local JSONL storage, intelligently deduplicates it, fits it into a precise token budget, and forwards it to the upstream API. It "stitches" the context back together.

## Quick Start

```bash
pip install stitcher-proxy
stitcher-proxy init
stitcher-proxy start
```
*`init` runs an interactive setup wizard to configure your provider, API key, model, and token budget.*

## Works With

Stitcher acts as a transparent, infinite-memory drop-in for:

- **Claude Code**
- **OpenClaw**
- **Codex**
- **Cursor**
- **LangChain**
- **Vercel AI SDK**
- **Any OpenAI client**

## CLI Subcommands

Stitcher Proxy includes a full CLI suite for managing your proxy and sessions.

- `stitcher-proxy init` — Run the interactive setup wizard.
- `stitcher-proxy start` — Start the proxy.
- `stitcher-proxy status` — Show running status, session count, and config summary.
- `stitcher-proxy sessions` — List all sessions with message counts and storage sizes.
- `stitcher-proxy sessions purge <name>` — Delete a specific session's data.
- `stitcher-proxy config` — Print current configuration.
- `stitcher-proxy config set <key> <value>` — Update a config value.
- `stitcher-proxy integrate <target>` — Show integration guides (e.g., `claude-code`, `openclaw`, `codex`).

## Integration Guides

Stitcher provides built-in integration guides for popular tools. Run `stitcher-proxy integrate` to see all options.

- [Claude Code Integration](docs/integrations/claude-code.md) (`stitcher-proxy integrate claude-code`)
- [OpenClaw Integration](docs/integrations/openclaw.md) (`stitcher-proxy integrate openclaw`)
- [Codex Integration](docs/integrations/codex.md) (`stitcher-proxy integrate codex`)
- [Cursor Integration](docs/integrations/cursor.md)
- [Generic/OpenAI Compatible Integration](docs/integrations/generic.md)

### Global Environment Variable Support

The proxy works globally when set via standard base URL environment variables. Clients will seamlessly route their requests through Stitcher:

```bash
export OPENAI_BASE_URL=http://localhost:8081/v1
export ANTHROPIC_BASE_URL=http://localhost:8081/v1
```

## How It Works

```
[ Client ] ---POST /v1/chat/completions---> [ Stitcher Proxy ]
(Only sends                                       │
 new msg)                                         ▼
                                          Reads local JSONL
                                          Stitches history backwards
                                          Deduplicates repetitive text
                                          Enforces token budget (e.g. 128k)
                                                  │
                                                  ▼
[ Upstream API ] <------Full Context------- [ Stitcher Proxy ]
(OpenAI/Anthropic)
```

## Usage Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

# Just change the base_url. That's it.
client = OpenAI(
    base_url="http://localhost:8081/v1",
    api_key="your-real-api-key",  # Passed through to upstream
    default_headers={"X-Stitcher-Session": "my-app-user-123"}
)

# Use normally. Stitcher handles infinite memory transparently.
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What did we discuss yesterday?"}]
)
# ^ Even though you only sent 1 message, Stitcher injected
# the full conversation history behind the scenes.
```

### cURL

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "X-Stitcher-Session: terminal-session-99" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello again!"}]
  }'
```

## Configuration

Config loading priority: CLI flags > Environment Variables > `~/.stitcher/config.json` > Defaults.

| CLI Flag | Description | Default |
|----------|-------------|---------|
| `--port` | Port to run the proxy on | `8081` |
| `--upstream` | Upstream LLM API URL | `https://api.openai.com` |
| `--max-tokens` | Token budget for stitched context | `128000` |
| `--data-dir` | Directory for JSONL storage | `~/.stitcher/sessions` |

## API Endpoints

- **POST `/v1/chat/completions`**: The main OpenAI-compatible proxy endpoint. Supports both normal requests and SSE streaming (`stream: true`). Pass `X-Stitcher-Session` header to isolate memory, otherwise the session is derived from the first message.
- **GET `/v1/stitcher/stats`**: Returns session count and total messages.

## How It Works Under The Hood

Stitcher uses a backward-reading file algorithm. Every time you send a request or the proxy receives a response, it appends the message to an `active.jsonl` file in the session's directory. 
When the proxy builds the context window:
1. It reads the `active.jsonl` and any older rolled files (e.g. `active.001.jsonl`) backward, from newest to oldest.
2. It accumulates tokens until it hits your configured limit (e.g. 128k).
3. It deduplicates text: it identifies near-identical assistant outputs and condenses older duplicates to save tokens.
4. It reverses the collection to restore chronological order and swaps it into your request's `messages` array.

## License
MIT
