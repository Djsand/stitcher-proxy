import os
import json
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Config:
    # Server
    port: int = 8081
    upstream_url: str = "https://api.openai.com"
    api_key: str = ""
    default_model: str = ""
    # Context engine
    max_tokens: int = 128000
    dedup_threshold: float = 0.60        # Similarity threshold for dedup (0.0-1.0)
    condense_threshold: float = 0.35     # Similarity threshold for condensing older messages
    chars_per_token: int = 4             # Rough char/token ratio for estimation
    # Storage
    data_dir: Path = Path.home() / ".stitcher" / "sessions"
    roll_size_bytes: int = 5 * 1024 * 1024  # 5 MB

_config = Config()

def get_config_file_path() -> Path:
    return Path.home() / ".stitcher" / "config.json"

def get_config() -> Config:
    return _config

def save_config():
    path = get_config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "port": _config.port,
            "upstream": _config.upstream_url,
            "api_key": _config.api_key,
            "default_model": _config.default_model,
            "max_tokens": _config.max_tokens,
            "dedup_threshold": _config.dedup_threshold,
            "condense_threshold": _config.condense_threshold,
            "chars_per_token": _config.chars_per_token,
            "data_dir": str(_config.data_dir),
            "roll_size_bytes": _config.roll_size_bytes,
        }, f, indent=2)

def load_config_file():
    path = get_config_file_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "port" in data: _config.port = data["port"]
                if "upstream" in data: _config.upstream_url = data["upstream"]
                if "api_key" in data: _config.api_key = data["api_key"]
                if "default_model" in data: _config.default_model = data["default_model"]
                if "max_tokens" in data: _config.max_tokens = data["max_tokens"]
                if "dedup_threshold" in data: _config.dedup_threshold = float(data["dedup_threshold"])
                if "condense_threshold" in data: _config.condense_threshold = float(data["condense_threshold"])
                if "chars_per_token" in data: _config.chars_per_token = int(data["chars_per_token"])
                if "data_dir" in data: _config.data_dir = Path(data["data_dir"]).expanduser().resolve()
                if "roll_size_bytes" in data: _config.roll_size_bytes = int(data["roll_size_bytes"])
        except Exception:
            pass

def setup_config(port: int = None, upstream: str = None, max_tokens: int = None, data_dir: str = None, api_key: str = None, default_model: str = None):
    # Load from config file first
    load_config_file()
    
    # Then env vars
    if "STITCHER_PORT" in os.environ:
        _config.port = int(os.environ["STITCHER_PORT"])
    if "STITCHER_UPSTREAM" in os.environ:
        _config.upstream_url = os.environ["STITCHER_UPSTREAM"]
    if "STITCHER_API_KEY" in os.environ:
        _config.api_key = os.environ["STITCHER_API_KEY"]
    if "STITCHER_DEFAULT_MODEL" in os.environ:
        _config.default_model = os.environ["STITCHER_DEFAULT_MODEL"]
    if "STITCHER_MAX_TOKENS" in os.environ:
        _config.max_tokens = int(os.environ["STITCHER_MAX_TOKENS"])
    if "STITCHER_DATA_DIR" in os.environ:
        _config.data_dir = Path(os.environ["STITCHER_DATA_DIR"]).expanduser().resolve()

    # Finally CLI args
    if port is not None:
        _config.port = port
    if upstream is not None:
        _config.upstream_url = upstream
    if max_tokens is not None:
        _config.max_tokens = max_tokens
    if data_dir is not None:
        _config.data_dir = Path(data_dir).expanduser().resolve()
    if api_key is not None:
        _config.api_key = api_key
    if default_model is not None:
        _config.default_model = default_model

    _config.upstream_url = _config.upstream_url.rstrip("/")
    _config.data_dir.mkdir(parents=True, exist_ok=True)
