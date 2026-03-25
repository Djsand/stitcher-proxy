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
stitcher-proxy
```
*Starts the proxy on `http://localhost:8081` pointing to OpenAI.*

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
