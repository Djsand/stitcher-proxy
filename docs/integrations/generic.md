# Generic / OpenAI-Compatible Clients

Stitcher Proxy is fully compatible with the standard OpenAI API specification. Any tool that supports custom OpenAI endpoints will work with Stitcher.

## Environment Variables

The most common way to override the API base URL in SDKs (like LangChain, Vercel AI SDK, or the official OpenAI Python/Node packages) is by setting the `OPENAI_BASE_URL` environment variable:

```bash
export OPENAI_BASE_URL="http://localhost:8081/v1"
```

Stitcher also supports standard `Authorization: Bearer <token>` or `x-api-key: <token>` headers, which it will forward to the upstream provider if needed.
