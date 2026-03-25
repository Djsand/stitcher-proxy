# 🧠 NeverForget

**LLMs have amnesia. We built the cure.**

[![npm](https://img.shields.io/npm/v/neverforget?color=blue&style=flat-square)](https://www.npmjs.com/package/neverforget) [![license](https://img.shields.io/npm/l/neverforget?style=flat-square)](LICENSE) [![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)]() [![node](https://img.shields.io/node/v/neverforget?style=flat-square)]()

```bash
npm i -g neverforget
```

## The Problem

You're building an AI app, testing a prompt, or writing code with an agent, and suddenly it forgets the context from five minutes ago.
You're forced to manually paste history back in, build messy databases, or just sigh and start over.
We built this because we were tired of managing complex vector DBs just to keep a simple chat going.

## The Solution

NeverForget is a transparent local proxy that gives any LLM infinite memory with zero dependencies.
It intercepts your API calls, stitches your entire conversation history into the context window, and deduplicates the noise.
Your LLM gets maximum context every single time, without you having to change a single line of application logic.

## Demo

```text
$ npm i -g neverforget
$ neverforget init
🧠 NeverForget initialized.

$ neverforget start
🚀 Proxy running on http://localhost:8081

$ curl http://localhost:8081/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "X-NeverForget-Session: my-app" \
    -d '{"messages": [{"role": "user", "content": "What did I just say?"}]}'

{
  "choices": [{
    "message": {
      "content": "You told me to remember that your favorite color is blue."
    }
  }]
}
✨ It remembers!
```

## Quick Start

```bash
npm i -g neverforget
neverforget init
neverforget start
```

## How It Works

```text
┌─────────┐      POST /chat/completions       ┌───────────────┐
│         │ ────────────────────────────────▶ │  NeverForget  │
│  Your   │                                   │  1. Save      │
│  App    │      Response (unchanged)         │  2. Stitch    │
│         │ ◀───────────────────────────────  │  3. Forward   │
└─────────┘                                   └───────┬───────┘
                                                      │
                                                      ▼
                                              ┌───────────────┐
                                              │    OpenAI     │
                                              │  (Anthropic)  │
                                              └───────────────┘
```

You point your client at `localhost:8081` instead of the API.
When you send a request, NeverForget saves your new message locally.
It then stitches your entire past conversation history into the context window.
The enriched payload is forwarded to the real API, making the LLM artificially omniscient.
To your app, it looks like a standard LLM—but with a perfect memory.

## Usage Examples

### Python

```python
# The model remembers everything tied to "user-123"
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8081/v1", api_key="sk-...")
response = client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "What was my last question?"}], extra_headers={"X-NeverForget-Session": "user-123"})
print(response.choices[0].message.content)
```

### Node.js

```javascript
// Magic memory injection on every single request
import OpenAI from 'openai';
const openai = new OpenAI({ baseURL: 'http://localhost:8081/v1', apiKey: 'sk-...' });
const completion = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Continue where we left off.' }] }, { headers: { 'X-NeverForget-Session': 'session-xyz' } });
console.log(completion.choices[0].message.content);
```

### cURL

```bash
# Just hit the proxy and watch it recall your history
curl http://localhost:8081/v1/chat/completions -H "Authorization: Bearer sk-..." -H "X-NeverForget-Session: cli-test" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Who am I?"}]}'
```

## Works With

Claude Code · Codex · Cursor · LangChain · Vercel AI SDK · Ollama · vLLM · anything OpenAI-compatible

> **Pro tip:** Run `neverforget integrate all` to automatically configure your favorite CLI tools to use the proxy!

## CLI Reference

```text
neverforget                        Start the proxy on the default port
neverforget init                   Interactive setup wizard
neverforget start [--port N]       Start the proxy with options
neverforget status                 Show config and session count
neverforget sessions               List all tracked memory sessions
neverforget sessions purge <name>  Delete a specific session's memory
neverforget config                 Show all current settings
neverforget config edit            Open interactive config editor
neverforget config set <k> <v>     Quick set a configuration value
neverforget integrate [target]     Auto-configure integrations
```

## Configuration

Settings can be tuned via `neverforget config edit` or environment variables:

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `8081` | Local port for the proxy |
| `upstream_url` | `https://api.openai.com` | Target LLM API URL |
| `max_tokens` | `128000` | Token budget for injected history |
| `dedup_threshold` | `0.6` | Similarity cutoff for deduplication (0-1) |
| `condense_threshold` | `0.35` | Similarity cutoff for replacing with placeholders |
| `chars_per_token` | `4` | Ratio used to estimate token counts |
| `roll_size_bytes` | `5242880` | File roll threshold (5MB default) |

## Under The Hood

* **Reads backward** through your local JSONL archives (newest → oldest)
* **Deduplicates** repetitive assistant responses using trigram similarity
* **Budgets** your tokens dynamically, stopping when the `max_tokens` limit is reached
* **Condenses** older, similar messages into lightweight placeholders to save space
* **Reverses** the stitched array back into chronological order and forwards it upstream

## Contributing

Pull requests are welcome. Open an issue first if you're planning a massive rewrite. We like keeping it zero-dependency and fast.

## License

[MIT](LICENSE)
