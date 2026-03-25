import argparse
import sys
import uvicorn
from .config import setup_config

def main():
    parser = argparse.ArgumentParser(description="Stitcher Proxy - Universal, infinite-memory proxy for LLM APIs.")
    parser.add_argument("--port", type=int, default=8081, help="Port to run the proxy on")
    parser.add_argument("--upstream", type=str, default="https://api.openai.com", help="Upstream LLM API URL")
    parser.add_argument("--max-tokens", type=int, default=128000, help="Maximum token budget for stitched context")
    parser.add_argument("--data-dir", type=str, default="~/.stitcher/sessions", help="Directory to store session JSONL files")
    
    args = parser.parse_args()
    
    setup_config(
        port=args.port,
        upstream=args.upstream,
        max_tokens=args.max_tokens,
        data_dir=args.data_dir
    )
    
    print(f"🦞 Starting Stitcher Proxy on port {args.port}")
    print(f"🔗 Upstream: {args.upstream}")
    print(f"🧠 Max tokens: {args.max_tokens}")
    print(f"💾 Data dir: {args.data_dir}")
    print(f"Ready to stitch contexts.")
    
    # We pass the app as an import string for uvicorn
    uvicorn.run("stitcher_proxy.server:app", host="0.0.0.0", port=args.port, log_level="info")

if __name__ == "__main__":
    main()
