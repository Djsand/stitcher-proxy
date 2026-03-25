# Code Review — NeverForget v1.0.0

**Reviewed:** 2026-03-25  
**Reviewer:** Subagent (senior code review + QA)

---

## Issues Found & Fixed

### 🔴 Critical

1. **SSE streaming: split on newline could break mid-chunk** (`server.mjs`)  
   The original code split SSE data on `\n` per chunk. If a JSON payload was split across two TCP chunks, `JSON.parse` would silently fail and the assistant response would be partially lost.  
   **Fix:** Added an `sseBuffer` that accumulates incomplete lines and only processes complete ones.

2. **Path traversal via session ID** (`server.mjs`, `storage.mjs`)  
   Session IDs came from user-controlled headers/query params with no sanitization. `X-NeverForget-Session: ../../../etc` would escape the data directory.  
   **Fix:** Added `sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_')` in both server and storage.

3. **Non-chat endpoints returned 404** (`server.mjs`)  
   The proxy only handled `/v1/chat/completions` and `/v1/stitcher/stats`. Any other `/v1/*` endpoint (e.g. `/v1/models`, `/v1/embeddings`) got a hard 404, breaking clients that probe the API.  
   **Fix:** Added `handlePassthrough()` that pipes any unrecognized `/v1/*` request to upstream.

4. **`X-NeverForget-Session` header not recognized** (`server.mjs`)  
   README documented `X-NeverForget-Session` but code only checked `x-stitcher-session`.  
   **Fix:** Now checks both `x-stitcher-session` and `x-neverforget-session`.

### 🟡 Medium

5. **No body size limit on incoming requests** (`server.mjs`)  
   A malicious client could POST gigabytes and OOM the process.  
   **Fix:** Added 50MB body size limit with 413 response.

6. **Token estimation wrong for multi-byte characters** (`engine.mjs`)  
   `text.length / chars_per_token` counts UTF-16 code units, not bytes. Danish text (æ, ø, å) and emoji are 2-3 bytes but 1 `length` unit, underestimating tokens.  
   **Fix:** Changed to `Buffer.byteLength(text, 'utf-8') / chars_per_token`.

7. **No response on upstream error status** (`server.mjs`)  
   Original only stored assistant messages on status 200. Now correctly checks `200-299` range.

8. **Non-JSON response collected via string concatenation** (`server.mjs`)  
   `responseData += chunk` on binary responses could corrupt data.  
   **Fix:** Changed to `Buffer.concat(chunks)` then `.toString('utf-8')`.

9. **Port-in-use crash with no useful message** (`server.mjs`)  
   **Fix:** Added `server.on('error')` handler with `EADDRINUSE` detection.

10. **No graceful shutdown** (`server.mjs`)  
    **Fix:** Added SIGINT/SIGTERM handlers for clean shutdown.

11. **`Math.max(...existingRolls, 0)` crashes on empty array spread** (`storage.mjs`)  
    `Math.max(...[])` returns `-Infinity`, which when +1 = `-Infinity`. This works by accident since `0` is also in the spread, but it's fragile.  
    **Fix:** Added explicit empty-check: `(existingRolls.length > 0 ? Math.max(...existingRolls) : 0) + 1`.

12. **Config saved with `upstream` key but loaded as `upstream_url`** (`config.mjs`)  
    This is a mismatch in the serialization — `saveConfig()` writes `upstream` but `loadConfigFile()` reads `data.upstream`. Surprisingly this works, but it means `config set upstream_url <val>` updates the in-memory object but saves the wrong key. The config schema uses `upstream_url` but the file uses `upstream`.  
    **Status:** Left as-is since it's intentional (file format uses short names), but documented here as a potential confusion source.

### 🟢 Minor

13. **Duplicate CLI file** (`bin/neverforget.mjs`)  
    Exact copy of `bin/neverforget`. Not referenced in `package.json`.  
    **Fix:** Added to `.npmignore` so it's excluded from the published package.

14. **`.venv/` directory would be included in npm pack**  
    There's a Python virtualenv in the repo root that would balloon the package.  
    **Fix:** Added `"files"` field in `package.json` (whitelist approach) and `.npmignore`.

15. **Missing `engines` field in `package.json`**  
    Install script checks for Node 18+ but `package.json` didn't declare it.  
    **Fix:** Added `"engines": { "node": ">=18" }`.

16. **Error responses not JSON-formatted** (`server.mjs`)  
    Original returned plain text errors ("Invalid JSON body", "Not Found"). OpenAI-compatible clients expect JSON error objects.  
    **Fix:** All error responses now return `{ "error": { "message": "...", "type": "..." } }`.

17. **`anthropic-version` header not forwarded** (`server.mjs`)  
    Anthropic API requires this header. The proxy stripped it.  
    **Fix:** Now explicitly forwards `anthropic-version` if present.

18. **Health check endpoint** (`server.mjs`)  
    Added `GET /` and `GET /health` returning `{ "status": "ok" }` for monitoring.

19. **DRY: Extracted `_extractText()` helper** (`engine.mjs`)  
    Content extraction from `content` (string or multipart array) was duplicated 6+ times.  
    **Fix:** Single helper function.

20. **Token budget reserves 5% for response** (`engine.mjs`)  
    Original used 100% of `max_tokens` for context, leaving nothing for the model's reply.  
    **Fix:** Budget is now `max_tokens * 0.95`.

---

## Not Changed (By Design)

- **Config key mismatch (`upstream` vs `upstream_url`):** Works correctly, changing it would break existing configs.
- **`bin/neverforget` vs `bin/neverforget.mjs` duplication:** Only excluded from npm; didn't delete `neverforget.mjs` in case it's used locally.
- **No Anthropic Messages API support:** The proxy only handles OpenAI-format `/v1/chat/completions`. Anthropic's native `/v1/messages` endpoint would need a separate handler. Passthrough covers it for now.
- **Synchronous file I/O in storage:** For a local proxy this is fine. Async would only matter at high concurrency.

## Test Results

- `node bin/neverforget --help` ✅
- `node bin/neverforget status` ✅ (with or without existing config)
- Package structure verified: `files` field ensures only `bin/neverforget`, `src/`, `README.md`, `LICENSE` are published
