# `neverforget` Proxy Integration Research

This document details how to configure various AI tools to route their API requests through the `neverforget` transparent proxy running on `http://localhost:8081`.

---

## 🚨 CRITICAL FINDING: Anthropic vs. OpenAI Formats
The `neverforget` proxy is designed to intercept `/v1/chat/completions` (OpenAI format). However, **Claude Code natively uses Anthropic's `/v1/messages` format.** 

If you configure Claude Code to point to `localhost:8081`, it will send requests using the Anthropic API structure (which includes a top-level `system` field, different role mappings, and potentially multimodal blocks). **To support Claude Code, the `neverforget` proxy MUST implement a `/v1/messages` endpoint and handle Anthropic-formatted payloads.**

---

## Tool Integration Guides

### 1. Claude Code (Anthropic's CLI)
* **Mechanism:** Environment variable or config file.
* **API Format:** Anthropic `/v1/messages`
* **Instructions:**
  **Option A (Environment Variable):**
  ```bash
  export ANTHROPIC_BASE_URL="http://localhost:8081"
  claude
  ```
  **Option B (Persistent Config):** Edit `~/.claude/settings.json`:
  ```json
  {
    "env": {
      "ANTHROPIC_BASE_URL": "http://localhost:8081",
      "ANTHROPIC_API_KEY": "dummy-key-if-needed"
    }
  }
  ```
* **Gotchas:** Requires the proxy to support Anthropic's `/v1/messages` spec. Do not append `/v1` to the base URL unless your proxy specifically requires it to route correctly.

### 2. Codex CLI (OpenAI's CLI)
* **Mechanism:** Environment variable or `config.toml`.
* **API Format:** OpenAI `/v1/chat/completions`
* **Instructions:**
  **Option A (Environment Variable):**
  ```bash
  export OPENAI_BASE_URL="http://localhost:8081/v1"
  codex
  ```
  **Option B (Persistent Config):** Edit `~/.codex/config.toml`:
  ```toml
  openai_base_url = "http://localhost:8081/v1"
  ```
* **Gotchas:** Ensure the `/v1` suffix is present in the base URL.

### 3. Cursor IDE
* **Mechanism:** UI Settings.
* **API Format:** OpenAI `/v1/chat/completions` (mostly).
* **Instructions:**
  1. Open Cursor Settings -> Models.
  2. Locate **"Override OpenAI Base URL"**.
  3. Enter `http://localhost:8081/v1`.
  4. Provide a dummy API key in the OpenAI API Key field if prompted.
* **Gotchas:** This global override forces *all* OpenAI-compatible requests through the proxy. Cursor sometimes uses undocumented internal formatting depending on the feature ("Agent" mode vs "Ask" mode). If you see TLS or connection resets, you may need to disable HTTP/2 in Cursor's advanced settings, as local proxies sometimes lack proper HTTP/2 multiplexing support.

### 4. OpenClaw
* **Mechanism:** Standard environment variables. OpenClaw uses standard SDKs under the hood for model routing.
* **API Format:** Model-dependent.
* **Instructions:**
  To route OpenAI models through the proxy:
  ```bash
  export OPENAI_BASE_URL="http://localhost:8081/v1"
  openclaw
  ```
  To route Anthropic models through the proxy:
  ```bash
  export ANTHROPIC_BASE_URL="http://localhost:8081"
  openclaw
  ```
* **Gotchas:** OpenClaw maintains its own model router. If it connects to an Anthropic model, it will use the Anthropic SDK (and `/v1/messages` format). If it connects to an OpenAI model, it will use `/v1/chat/completions`.

### 5. Continue.dev (VS Code Extension)
* **Mechanism:** Config file (`~/.continue/config.yaml` or `config.json`).
* **API Format:** OpenAI `/v1/chat/completions`
* **Instructions:**
  Edit `~/.continue/config.yaml` and add a custom model entry:
  ```yaml
  models:
    - name: "neverforget Proxy"
      provider: openai
      model: "gpt-4" # or whatever model you want the proxy to forward to
      apiBase: "http://localhost:8081/v1"
      apiKey: "dummy-key"
      roles:
        - chat
        - autocomplete
        - edit
  ```
* **Gotchas:** You must restart Continue.dev or VS Code for the config to apply. By specifying `provider: openai`, you ensure Continue formats requests for `/v1/chat/completions`.

### 6. LangChain / LlamaIndex
* **Mechanism:** Class parameters or environment variables.
* **API Format:** OpenAI `/v1/chat/completions`
* **Instructions:**
  **Via Environment Variables:**
  ```bash
  export OPENAI_API_BASE="http://localhost:8081/v1"
  # Note: Some versions prefer OPENAI_BASE_URL
  export OPENAI_BASE_URL="http://localhost:8081/v1"
  ```
  **Via Python Code:**
  ```python
  # LangChain
  from langchain_openai import ChatOpenAI
  llm = ChatOpenAI(base_url="http://localhost:8081/v1", api_key="dummy")

  # LlamaIndex
  from llama_index.llms.openai import OpenAI
  llm = OpenAI(api_base="http://localhost:8081/v1", api_key="dummy")
  ```
* **Gotchas:** The trailing `/v1` is typically required.

### 7. Ollama
* **Mechanism:** Environment variables.
* **API Format:** Ollama is primarily an API *host*, not a client.
* **Instructions:**
  * **If you want Ollama to *pull models* through a proxy:**
    Set the `HTTPS_PROXY` environment variable before starting the Ollama server:
    ```bash
    export HTTPS_PROXY="http://localhost:8081"
    ollama serve
    ```
  * **If you want other tools to talk to Ollama *through* `neverforget`:**
    Set the tool's base URL to `http://localhost:8081/v1`, and configure `neverforget` to forward those requests to Ollama's local OpenAI-compatible endpoint at `http://localhost:11434/v1`.
* **Gotchas:** Ollama inference happens locally. It does not forward inference queries to upstream LLMs, so it doesn't have an `OPENAI_BASE_URL` equivalent for inference routing. `HTTPS_PROXY` is strictly for downloading model weights.

### 8. aider
* **Mechanism:** CLI flag or environment variable.
* **API Format:** OpenAI `/v1/chat/completions`
* **Instructions:**
  **Option A (Environment Variable):**
  ```bash
  export OPENAI_API_BASE="http://localhost:8081/v1"
  aider
  ```
  **Option B (CLI Flag):**
  ```bash
  aider --openai-api-base http://localhost:8081/v1
  ```
* **Gotchas:** Ensure the trailing `/v1` is included. You may also need to provide a dummy API key using `export OPENAI_API_KEY="dummy"`.