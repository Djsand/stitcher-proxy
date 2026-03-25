import os
import json
import logging
import asyncio
from typing import Any, Dict, AsyncGenerator
from fastapi import FastAPI, Request, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
import httpx
from .config import get_config
from .engine import get_stitched_context
from .storage import append_messages, get_stats

logger = logging.getLogger("stitcher.server")
app = FastAPI(title="Stitcher Proxy", description="Universal infinite-memory proxy for LLMs")

@app.get("/v1/stitcher/stats")
async def stats():
    return get_stats()

def _get_new_messages(existing: list, incoming: list) -> list:
    """Filter incoming messages to only those not already in the existing context."""
    if not existing:
        return incoming
        
    # We compare the last few messages to see where the incoming list overlaps
    # A simple approach: we assume incoming might be the full history or just the latest.
    # We find the longest suffix of 'existing' that matches a prefix of 'incoming'.
    
    # Or even simpler: just check each incoming message against the last 50 existing ones.
    # If it's a perfect match (role + content), it's not new.
    # Note: System messages are often prepended on every request.
    
    existing_fingerprints = set()
    for m in existing[-100:]:
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
        fingerprint = f"{m.get('role')}:{content}"
        existing_fingerprints.add(fingerprint)
        
    new_msgs = []
    for m in incoming:
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
        fingerprint = f"{m.get('role')}:{content}"
        
        if fingerprint not in existing_fingerprints:
            new_msgs.append(m)
            
    return new_msgs

@app.post("/v1/chat/completions")
async def chat_completions(request: Request, background_tasks: BackgroundTasks):
    config = get_config()
    
    session_id = request.headers.get("X-Stitcher-Session")
    if not session_id:
        # Check query string
        session_id = request.query_params.get("session")
        
    try:
        body = await request.json()
    except Exception:
        return Response("Invalid JSON body", status_code=400)
        
    incoming_messages = body.get("messages", [])
    if not incoming_messages:
        return Response("No messages provided", status_code=400)
        
    if not session_id:
        import hashlib
        first_content = str(incoming_messages[0].get("content", ""))
        session_id = hashlib.md5(first_content.encode()).hexdigest()[:12]
        
    # Fetch existing context to know what's new
    existing_messages, _ = get_stitched_context(session_id)
    
    new_incoming = _get_new_messages(existing_messages, incoming_messages)
    
    # Save the NEW messages from the request
    if new_incoming:
        append_messages(session_id, new_incoming)
    
    # Fetch the full stitched context (which now includes the new messages)
    stitched_messages, tokens = get_stitched_context(session_id)
    
    # Optional: If the client sent a system prompt, ensure it's at the top.
    # Often, stitched_messages has multiple system prompts now, but it's fine.
    
    # Replace the request's messages array with the full stitched context
    proxy_body = body.copy()
    proxy_body["messages"] = stitched_messages
    
    # Forward to the upstream API
    # Ensure URL is correctly formatted
    base_url = config.upstream_url.rstrip("/")
    if base_url.endswith("/v1"):
        upstream_url = base_url + "/chat/completions"
    else:
        upstream_url = base_url + "/v1/chat/completions"
        
    headers = {
        "Content-Type": "application/json",
    }
    if "Authorization" in request.headers:
        headers["Authorization"] = request.headers["Authorization"]
    elif "api-key" in request.headers:
        headers["api-key"] = request.headers["api-key"]
    elif "x-api-key" in request.headers:
        headers["x-api-key"] = request.headers["x-api-key"]
    
    is_stream = body.get("stream", False)
    
    if is_stream:
        # httpx async stream requires passing a request
        return StreamingResponse(
            _stream_proxy(upstream_url, headers, proxy_body, session_id),
            media_type="text/event-stream"
        )
    else:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(upstream_url, headers=headers, json=proxy_body)
            
            if resp.status_code == 200:
                resp_data = resp.json()
                choices = resp_data.get("choices", [])
                if choices:
                    assistant_msg = choices[0].get("message")
                    if assistant_msg:
                        # Append assistant message
                        append_messages(session_id, [assistant_msg])
                        
            # Return exact same response
            return Response(content=resp.content, status_code=resp.status_code, headers=dict(resp.headers))

async def _stream_proxy(url: str, headers: dict, body: dict, session_id: str) -> AsyncGenerator[bytes, None]:
    # Yield chunk by chunk, accumulate for storage
    async with httpx.AsyncClient(timeout=300.0) as client:
        # Send streaming request
        async with client.stream("POST", url, headers=headers, json=body) as response:
            full_assistant_content = ""
            assistant_role = "assistant"
            
            async for chunk in response.aiter_bytes():
                yield chunk
                
                try:
                    chunk_str = chunk.decode('utf-8')
                    # Parse SSE lines
                    for line in chunk_str.split('\n'):
                        line = line.strip()
                        if line.startswith("data: ") and line != "data: [DONE]":
                            data_str = line[len("data: "):].strip()
                            if data_str:
                                data = json.loads(data_str)
                                choices = data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    if "role" in delta:
                                        assistant_role = delta["role"]
                                    if "content" in delta and delta["content"]:
                                        full_assistant_content += delta["content"]
                except Exception:
                    pass
            
            # Streaming done, save the accumulated message
            if full_assistant_content:
                msg = {"role": assistant_role, "content": full_assistant_content}
                append_messages(session_id, [msg])
