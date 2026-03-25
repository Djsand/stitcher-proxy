import argparse
import sys
import os
import json
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

CONFIG_SCHEMA = [
    # (key, label, type, description)
    ("port", "Proxy port", int, "Port the proxy listens on"),
    ("upstream_url", "Upstream URL", str, "LLM API endpoint (OpenAI, Anthropic, custom)"),
    ("api_key", "API key", "secret", "API key for upstream provider"),
    ("default_model", "Default model", str, "Model to use if client doesn't specify one"),
    ("max_tokens", "Max token budget", int, "Maximum tokens in stitched context window"),
    ("dedup_threshold", "Dedup threshold", float, "Similarity threshold for skipping duplicate messages (0.0–1.0)"),
    ("condense_threshold", "Condense threshold", float, "Similarity threshold for condensing older messages (0.0–1.0)"),
    ("chars_per_token", "Chars per token", int, "Character-to-token ratio for estimation"),
    ("roll_size_bytes", "File roll size", int, "JSONL file size before rolling to archive (bytes)"),
    ("data_dir", "Data directory", str, "Where session JSONL files are stored"),
]

def config_cmd(args):
    setup_config()
    config = get_config()
    
    if getattr(args, "config_cmd", None) == "set" and getattr(args, "key", None) and getattr(args, "value", None):
        key = args.key
        val = args.value
        if hasattr(config, key):
            schema_entry = next((s for s in CONFIG_SCHEMA if s[0] == key), None)
            if schema_entry:
                typ = schema_entry[2]
                if typ == int: val = int(val)
                elif typ == float: val = float(val)
            setattr(config, key, val)
            save_config()
            print(c(f"✅ {key} = {val}", "green"))
        else:
            print(c(f"❌ Unknown key: {key}", "red"))
            print(f"   Available: {', '.join(s[0] for s in CONFIG_SCHEMA)}")
    
    elif getattr(args, "config_cmd", None) == "edit":
        _interactive_config(config)
    
    else:
        print(c("⚙️  Stitcher Config", "cyan"))
        print(c(f"   File: {get_config_file_path()}", "yellow"))
        print()
        for key, label, typ, desc in CONFIG_SCHEMA:
            val = getattr(config, key, "")
            if typ == "secret" and val:
                display = val[:4] + "***" + val[-4:] if len(str(val)) > 8 else "***"
            else:
                display = val
            print(f"  {c(key, 'bold'):40s} {display}")
            print(f"  {'':40s} {c(desc, 'yellow')}")
        print()
        print(f"  Edit interactively: {c('stitcher-proxy config edit', 'green')}")
        print(f"  Set one value:      {c('stitcher-proxy config set <key> <value>', 'green')}")

def _interactive_config(config):
    print(c("⚙️  Stitcher Config — Interactive Editor", "cyan"))
    print(c("   Press Enter to keep current value. Type 'skip' to skip remaining.\n", "yellow"))
    
    changed = False
    for key, label, typ, desc in CONFIG_SCHEMA:
        current = getattr(config, key, "")
        
        if typ == "secret":
            display = "***" if current else "(not set)"
        else:
            display = current
        
        prompt = f"  {c(label, 'bold')} ({c(desc, 'yellow')})\n  Current: {c(str(display), 'cyan')}\n  > "
        
        try:
            raw = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        
        if raw.lower() == "skip":
            break
        if not raw:
            continue
        
        # Parse value
        if typ == int:
            try:
                raw = int(raw)
            except ValueError:
                print(c(f"  ❌ Expected integer, skipping", "red"))
                continue
        elif typ == float:
            try:
                raw = float(raw)
            except ValueError:
                print(c(f"  ❌ Expected number, skipping", "red"))
                continue
        
        setattr(config, key, raw)
        changed = True
        print(c(f"  ✅ {key} → {raw if typ != 'secret' else '***'}", "green"))
        print()
    
    if changed:
        save_config()
        print(c(f"\n✅ Config saved to {get_config_file_path()}", "green"))
    else:
        print(c("\n  No changes.", "yellow"))

def _add_to_shell_profile(line):
    """Add a line to the user's shell profile if not already present."""
    shell = os.environ.get("SHELL", "/bin/zsh")
    if "zsh" in shell:
        profile = Path.home() / ".zshrc"
    elif "bash" in shell:
        profile = Path.home() / ".bashrc"
    else:
        profile = Path.home() / ".profile"
    
    existing = profile.read_text() if profile.exists() else ""
    if line in existing:
        return profile, False  # Already there
    
    with open(profile, "a") as f:
        f.write(f"\n# Stitcher Proxy — infinite LLM memory\n{line}\n")
    return profile, True

def integrate_cmd(args):
    setup_config()
    config = get_config()
    target = getattr(args, "target", None)
    port = config.port
    base = f"http://localhost:{port}/v1"
    
    if target == "claude-code":
        print(c("🧵 Integrating with Claude Code...", "cyan"))
        line = f'export ANTHROPIC_BASE_URL={base}'
        profile, added = _add_to_shell_profile(line)
        if added:
            print(c(f"✅ Added to {profile}:", "green"))
            print(f"   {line}")
            print(f"\n   Run: {c('source ' + str(profile), 'yellow')} or open a new terminal.")
            print(f"   Then just run {c('claude', 'bold')} as normal — Stitcher handles the rest.")
        else:
            print(c(f"✅ Already configured in {profile}", "green"))
            print(f"   Just run {c('claude', 'bold')} — Stitcher is active.")
    
    elif target == "codex":
        print(c("🧵 Integrating with Codex CLI...", "cyan"))
        line = f'export OPENAI_BASE_URL={base}'
        profile, added = _add_to_shell_profile(line)
        if added:
            print(c(f"✅ Added to {profile}:", "green"))
            print(f"   {line}")
            print(f"\n   Run: {c('source ' + str(profile), 'yellow')} or open a new terminal.")
            print(f"   Then just run {c('codex', 'bold')} as normal.")
        else:
            print(c(f"✅ Already configured in {profile}", "green"))
    
    elif target == "cursor":
        print(c("🧵 Integrating with Cursor...", "cyan"))
        cursor_settings = Path.home() / ".cursor" / "settings.json"
        if cursor_settings.exists():
            import json as _json
            try:
                data = _json.loads(cursor_settings.read_text())
            except Exception:
                data = {}
        else:
            cursor_settings.parent.mkdir(parents=True, exist_ok=True)
            data = {}
        data["openai.baseUrl"] = base
        cursor_settings.write_text(json.dumps(data, indent=2))
        print(c(f"✅ Updated {cursor_settings}", "green"))
        print(f"   Set openai.baseUrl = {base}")
        print(f"   Restart Cursor to apply.")
    
    elif target == "openclaw":
        print(c("🧵 Integrating with OpenClaw...", "cyan"))
        openclaw_config = Path.home() / ".openclaw" / "openclaw.json"
        if openclaw_config.exists():
            import json as _json
            try:
                data = _json.loads(openclaw_config.read_text())
            except Exception:
                data = {}
            # Show what to add
            print(c("Add this to your openclaw.json models config:", "yellow"))
            print(f'   "baseUrl": "{base}"')
            print(f"\n   Or set env: {c(f'OPENAI_BASE_URL={base}', 'green')}")
        else:
            print(f"   Set env: {c(f'OPENAI_BASE_URL={base}', 'green')}")
            line = f'export OPENAI_BASE_URL={base}'
            profile, added = _add_to_shell_profile(line)
            if added:
                print(c(f"   Added to {profile}", "green"))
    
    elif target == "all":
        print(c("🧵 Integrating with everything...", "cyan"))
        # Add both env vars
        lines = [
            f'export ANTHROPIC_BASE_URL={base}',
            f'export OPENAI_BASE_URL={base}',
        ]
        shell = os.environ.get("SHELL", "/bin/zsh")
        if "zsh" in shell:
            profile = Path.home() / ".zshrc"
        elif "bash" in shell:
            profile = Path.home() / ".bashrc"
        else:
            profile = Path.home() / ".profile"
        
        existing = profile.read_text() if profile.exists() else ""
        added_lines = []
        for line in lines:
            if line not in existing:
                added_lines.append(line)
        
        if added_lines:
            with open(profile, "a") as f:
                f.write("\n# Stitcher Proxy — infinite LLM memory\n")
                for line in added_lines:
                    f.write(line + "\n")
            print(c(f"✅ Added to {profile}:", "green"))
            for line in added_lines:
                print(f"   {line}")
        else:
            print(c(f"✅ Already configured in {profile}", "green"))
        
        print(f"\n   Run: {c('source ' + str(profile), 'yellow')} or open a new terminal.")
        print(f"   Now {c('claude', 'bold')}, {c('codex', 'bold')}, and any OpenAI client will route through Stitcher.")
    
    else:
        print(c("🧵 Stitcher Integrations", "cyan"))
        print()
        print(f"  {c('stitcher-proxy integrate all', 'bold')}          — Auto-configure everything (recommended)")
        print(f"  {c('stitcher-proxy integrate claude-code', 'bold')}  — Claude Code")
        print(f"  {c('stitcher-proxy integrate codex', 'bold')}        — Codex CLI")
        print(f"  {c('stitcher-proxy integrate cursor', 'bold')}       — Cursor IDE")
        print(f"  {c('stitcher-proxy integrate openclaw', 'bold')}     — OpenClaw")
        print()
        print(f"  {c('integrate all', 'green')} adds env vars to your shell profile. One command, done.")

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
    parser_config_sub.add_parser("edit", help="Interactive config editor")
    
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