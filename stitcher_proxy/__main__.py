import argparse
import sys
import os
import shutil
import uvicorn
from pathlib import Path
from .config import setup_config, get_config, get_config_file_path, save_config

# ANSI Colors
def c(text, color):
    if os.environ.get("NO_COLOR"): return text
    colors = {
        "cyan": "\033[96m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "bold": "\033[1m",
        "reset": "\033[0m"
    }
    return f"{colors.get(color, '')}{text}{colors['reset']}"

def run_wizard():
    print(c("🧵 Stitcher Proxy — Setup", "cyan"))
    
    print(c("? Upstream provider:", "bold"))
    print("  1. OpenAI (api.openai.com)")
    print("  2. Anthropic (api.anthropic.com)")
    print("  3. Custom URL")
    
    provider_choice = input("> ").strip()
    
    if provider_choice == "1":
        upstream = "https://api.openai.com"
        default_model = "gpt-4o"
        max_tokens = 128000
    elif provider_choice == "2":
        upstream = "https://api.anthropic.com"
        default_model = "claude-3-opus-20240229"
        max_tokens = 200000
    else:
        upstream = input("Enter Custom URL: ").strip()
        default_model = ""
        max_tokens = 128000
        
    api_key = input(c(f"? API key (stored locally in {get_config_file_path()}):", "bold") + "\n> ").strip()
    
    model_input = input(c(f"? Default model [{default_model}]:", "bold") + "\n> ").strip()
    if model_input:
        default_model = model_input
        
    tokens_input = input(c(f"? Max token budget [{max_tokens}]:", "bold") + "\n> ").strip()
    if tokens_input:
        max_tokens = int(tokens_input)
        
    port_input = input(c("? Proxy port [8081]:", "bold") + "\n> ").strip()
    port = int(port_input) if port_input else 8081
    
    print()
    print(c("📋 Summary", "cyan"))
    print(f"  Upstream: {upstream}")
    print(f"  API Key: {'***' if api_key else 'None'}")
    print(f"  Model: {default_model}")
    print(f"  Max Tokens: {max_tokens}")
    print(f"  Port: {port}")
    
    confirm = input(c("? Save this configuration? [y/N]: ", "bold")).strip().lower()
    if confirm in ['y', 'yes']:
        # Update config directly
        config = get_config()
        config.upstream_url = upstream
        config.api_key = api_key
        config.default_model = default_model
        config.max_tokens = max_tokens
        config.port = port
        
        save_config()
        print(c(f"✅ Config saved to {get_config_file_path()}", "green"))
        print("Start the proxy with: stitcher-proxy start")
    else:
        print(c("❌ Setup cancelled.", "red"))

def start_proxy(args):
    config_path = get_config_file_path()
    # Check if first run and no config exists
    if not config_path.exists():
        run_wizard()
        if not config_path.exists():
            return
        
    setup_config(
        port=getattr(args, 'port', None),
        upstream=getattr(args, 'upstream', None),
        max_tokens=getattr(args, 'max_tokens', None),
        data_dir=getattr(args, 'data_dir', None)
    )
    
    config = get_config()
    
    print(c(f"🦞 Starting Stitcher Proxy on port {config.port}", "cyan"))
    print(c(f"🔗 Upstream: {config.upstream_url}", "yellow"))
    print(c(f"🧠 Max tokens: {config.max_tokens}", "green"))
    print(c(f"💾 Data dir: {config.data_dir}", "cyan"))
    print("Ready to stitch contexts.")
    
    uvicorn.run("stitcher_proxy.server:app", host="0.0.0.0", port=config.port, log_level="info")

def status_cmd(args):
    setup_config()
    config = get_config()
    # Find sessions
    if config.data_dir.exists():
        sessions = [d for d in config.data_dir.iterdir() if d.is_dir()]
        count = len(sessions)
    else:
        count = 0
    print(c("📊 Stitcher Proxy Status", "cyan"))
    print(f"Port: {config.port}")
    print(f"Upstream: {config.upstream_url}")
    print(f"Default Model: {config.default_model}")
    print(f"Max Tokens: {config.max_tokens}")
    print(f"Total Sessions: {count}")

def sessions_cmd(args):
    setup_config()
    config = get_config()
    
    if getattr(args, "session_cmd", None) == "purge" and getattr(args, "name", None):
        session_dir = config.data_dir / args.name
        if session_dir.exists() and session_dir.is_dir():
            shutil.rmtree(session_dir)
            print(c(f"✅ Purged session: {args.name}", "green"))
        else:
            print(c(f"❌ Session not found: {args.name}", "red"))
        return
        
    print(c("📂 Stitcher Sessions", "cyan"))
    if not config.data_dir.exists():
        print("No sessions found.")
        return
        
    for d in config.data_dir.iterdir():
        if d.is_dir():
            size = sum(f.stat().st_size for f in d.glob('**/*') if f.is_file())
            msg_count = 0
            for f in d.glob('*.jsonl'):
                try:
                    with open(f, 'r', encoding='utf-8') as file:
                        msg_count += sum(1 for line in file if line.strip())
                except Exception:
                    pass
            print(f"- {d.name} ({msg_count} msgs, {size / 1024:.1f} KB)")

def config_cmd(args):
    setup_config()
    config = get_config()
    if getattr(args, "config_cmd", None) == "set" and getattr(args, "key", None) and getattr(args, "value", None):
        key = args.key
        val = args.value
        if hasattr(config, key):
            if key in ['port', 'max_tokens', 'roll_size_bytes']:
                setattr(config, key, int(val))
            else:
                setattr(config, key, val)
            save_config()
            print(c(f"✅ Updated {key} to {val}", "green"))
        else:
            print(c(f"❌ Invalid config key: {key}", "red"))
    else:
        print(c("⚙️  Current Config", "cyan"))
        for k, v in config.__dict__.items():
            if k == "api_key" and v:
                print(f"{k} = ***")
            else:
                print(f"{k} = {v}")

def integrate_cmd(args):
    target = getattr(args, "target", None)
    if target == "claude-code":
        print(c("🛠️  Claude Code Integration", "cyan"))
        print("Set the Anthropic base URL environment variable when running Claude Code:")
        print(c("  export ANTHROPIC_BASE_URL=http://localhost:8081/v1", "green"))
        print(c("  claude", "green"))
        print("Alternatively, add it to your shell profile (.zshrc / .bashrc).")
    elif target == "openclaw":
        print(c("🛠️  OpenClaw Integration", "cyan"))
        print("Configure OpenClaw to route through Stitcher. In OpenClaw's model config:")
        print(c("  \"base_url\": \"http://localhost:8081/v1\"", "green"))
    elif target == "codex":
        print(c("🛠️  Codex CLI Integration", "cyan"))
        print("Set the OpenAI base URL when using Codex:")
        print(c("  export OPENAI_BASE_URL=http://localhost:8081/v1", "green"))
        print(c("  codex ...", "green"))
    else:
        print(c("🛠️  Available Integrations", "cyan"))
        print("  stitcher-proxy integrate claude-code")
        print("  stitcher-proxy integrate openclaw")
        print("  stitcher-proxy integrate codex")

def main():
    parser = argparse.ArgumentParser(description="Stitcher Proxy - Universal, infinite-memory proxy for LLM APIs.")
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")
    
    # init
    parser_init = subparsers.add_parser("init", help="Run the interactive setup wizard")
    
    # start
    parser_start = subparsers.add_parser("start", help="Start the proxy")
    parser_start.add_argument("--port", type=int, default=None, help="Port to run the proxy on")
    parser_start.add_argument("--upstream", type=str, default=None, help="Upstream LLM API URL")
    parser_start.add_argument("--max-tokens", type=int, default=None, help="Maximum token budget")
    parser_start.add_argument("--data-dir", type=str, default=None, help="Directory to store session files")
    
    # Add top-level args for running `stitcher-proxy --port 8081` without `start`
    parser.add_argument("--port", type=int, default=None, help="Port to run the proxy on")
    parser.add_argument("--upstream", type=str, default=None, help="Upstream LLM API URL")
    parser.add_argument("--max-tokens", type=int, default=None, help="Maximum token budget")
    parser.add_argument("--data-dir", type=str, default=None, help="Directory to store session files")

    # status
    parser_status = subparsers.add_parser("status", help="Show running status and config summary")
    
    # sessions
    parser_sessions = subparsers.add_parser("sessions", help="Manage sessions")
    parser_sessions_sub = parser_sessions.add_subparsers(dest="session_cmd")
    parser_sessions_purge = parser_sessions_sub.add_parser("purge", help="Purge a session")
    parser_sessions_purge.add_argument("name", type=str, help="Session name to purge")
    
    # config
    parser_config = subparsers.add_parser("config", help="Manage config")
    parser_config_sub = parser_config.add_subparsers(dest="config_cmd")
    parser_config_set = parser_config_sub.add_parser("set", help="Set a config value")
    parser_config_set.add_argument("key", type=str, help="Config key")
    parser_config_set.add_argument("value", type=str, help="Config value")
    
    # integrate
    parser_integrate = subparsers.add_parser("integrate", help="Show integration guides")
    parser_integrate.add_argument("target", type=str, nargs="?", help="Integration target (claude-code, openclaw, codex)")
    
    args = parser.parse_args()
    
    if args.command == "init":
        run_wizard()
    elif args.command == "start":
        start_proxy(args)
    elif args.command == "status":
        status_cmd(args)
    elif args.command == "sessions":
        sessions_cmd(args)
    elif args.command == "config":
        config_cmd(args)
    elif args.command == "integrate":
        integrate_cmd(args)
    else:
        # Default behavior: start proxy if no command given
        start_proxy(args)

if __name__ == "__main__":
    main()