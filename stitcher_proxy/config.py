import os
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Config:
    port: int = 8081
    upstream_url: str = "https://api.openai.com"
    max_tokens: int = 128000
    data_dir: Path = Path.home() / ".stitcher" / "sessions"
    roll_size_bytes: int = 5 * 1024 * 1024  # 5 MB

_config = Config()

def get_config() -> Config:
    return _config

def setup_config(port: int, upstream: str, max_tokens: int, data_dir: str):
    _config.port = port
    _config.upstream_url = upstream.rstrip("/")
    _config.max_tokens = max_tokens
    _config.data_dir = Path(data_dir).expanduser().resolve()
    
    # Ensure data directory exists
    _config.data_dir.mkdir(parents=True, exist_ok=True)
