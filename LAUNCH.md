# 🚀 Launch Plan — Stitcher Proxy

## 1. PyPI (gør `pip install` muligt for alle)
```bash
cd ~/Desktop/stitcher-proxy
source .venv/bin/activate
# Sæt din PyPI token:
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-xxxxxxx
twine upload dist/*
```
Så kan folk køre: `pip install stitcher-proxy && stitcher-proxy`

---

## 2. Hacker News — Show HN

**Title:** Show HN: Stitcher – A transparent proxy that gives any LLM infinite memory

**Body:**
Hey HN,

I built Stitcher, a transparent reverse proxy that sits between your app and any OpenAI-compatible LLM API (OpenAI, Anthropic, local models). It gives your LLM persistent, infinite memory — zero code changes required.

**The problem:** LLMs have no memory between API calls. Every request is stateless. If you're building a chatbot, agent, or coding assistant, you have to manage conversation history yourself — slicing arrays, counting tokens, building RAG pipelines. It's tedious and everyone reimplements it badly.

**The solution:** Stitcher is a local proxy. You point your OpenAI SDK at `localhost:8081` instead of `api.openai.com`. Stitcher intercepts every request, automatically stores messages to local JSONL files, and on every new request, stitches the full conversation history back together (reading backward through archived files, deduplicating near-identical messages, enforcing a token budget). Your LLM gets the maximum possible context every time, transparently.

**Key features:**
- Drop-in: just change `base_url`. Works with any OpenAI-compatible client (Python, Node, curl, LangChain, Vercel AI SDK)
- Streaming support (SSE passthrough)
- Session isolation via `X-Stitcher-Session` header
- Interactive CLI setup wizard
- Integration guides for Claude Code, Codex, Cursor, OpenClaw
- Smart dedup: near-identical assistant responses are condensed
- File rolling: sessions are archived when they get large

It's MIT licensed, ~600 lines of Python, zero heavy dependencies.

GitHub: https://github.com/Djsand/stitcher-proxy
Install: `pip install stitcher-proxy && stitcher-proxy init`

I'd love feedback on the approach. Is transparent proxying the right abstraction for LLM memory, or should it be a library?

---

## 3. Reddit

### r/programming
**Title:** I built a transparent proxy that gives any LLM infinite memory. Change one URL and your AI never forgets.
**Body:** [Same as HN, slightly shorter]

### r/MachineLearning
**Title:** [P] Stitcher: An infinite-context proxy for LLM APIs — transparent memory via local JSONL stitching
**Body:** [Technical version focusing on the algorithm]

### r/LocalLLaMA
**Title:** Stitcher Proxy — give your local LLM server infinite memory with one line change
**Body:** [Focus on local model support, privacy, no cloud dependency]

---

## 4. Twitter/X Thread

**Tweet 1:**
LLMs have amnesia. Every API call is stateless.

I built Stitcher — a transparent proxy that gives any LLM infinite memory.

Change one URL. That's it. Your AI remembers everything.

🧵👇

**Tweet 2:**
How it works:

Instead of calling api.openai.com, point your SDK at localhost:8081.

Stitcher intercepts every request, stores messages locally, and on every new call — stitches the FULL conversation history back together automatically.

Your LLM gets max context. Every time. Transparently.

**Tweet 3:**
Under the hood:
- Reads JSONL files backward (newest → oldest)
- Deduplicates near-identical messages
- Enforces your token budget (128k, 200k, whatever)
- Rolls files when they get large
- ~600 lines of Python. Zero bloat.

**Tweet 4:**
Works with everything:
✅ OpenAI SDK
✅ Anthropic SDK
✅ Claude Code
✅ Codex CLI
✅ Cursor
✅ LangChain
✅ Vercel AI SDK
✅ Local models (Ollama, vLLM)
✅ Raw curl

Just change base_url.

**Tweet 5:**
Try it now:

pip install stitcher-proxy
stitcher-proxy init

MIT licensed. No telemetry. Your data stays local.

GitHub: https://github.com/Djsand/stitcher-proxy

⭐ if this solves a problem for you.

---

## 5. Timing

Best times to post:
- **Hacker News:** Tuesday-Thursday, 8-10 AM EST (14-16 CET)
- **Reddit:** Tuesday-Thursday, 9-11 AM EST (15-17 CET)  
- **Twitter:** Weekdays, 9 AM or 5 PM EST

**Recommended:** Tomorrow (Thursday March 26) around 15:00 CET.
Post HN first, then Reddit 30 min later, then Twitter thread.
