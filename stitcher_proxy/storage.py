import os
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Tuple
from .config import get_config

logger = logging.getLogger("stitcher.storage")

def get_session_dir(session_id: str) -> Path:
    config = get_config()
    session_dir = config.data_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir

def get_active_file(session_dir: Path) -> Path:
    return session_dir / "active.jsonl"

def append_messages(session_id: str, messages: List[Dict[str, Any]]):
    """Append messages to the active session file, rolling if necessary."""
    if not messages:
        return
        
    config = get_config()
    session_dir = get_session_dir(session_id)
    active_file = get_active_file(session_dir)
    
    # Check if we need to roll the file
    if active_file.exists() and active_file.stat().st_size >= config.roll_size_bytes:
        _roll_file(session_dir, active_file)
        
    with open(active_file, "a", encoding="utf-8") as f:
        for msg in messages:
            # We wrap the message in a record wrapper if needed, or just dump the message.
            # stitcher.py uses: {"type": "message", "message": msg}
            record = {"type": "message", "message": msg}
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

def _roll_file(session_dir: Path, active_file: Path):
    """Rename active.jsonl to active.001.jsonl, etc."""
    existing_rolls = []
    for f in session_dir.iterdir():
        if f.name.startswith("active.") and f.name.endswith(".jsonl") and f.name != "active.jsonl":
            try:
                num = int(f.name.split(".")[1])
                existing_rolls.append(num)
            except ValueError:
                pass
                
    next_num = max(existing_rolls + [0]) + 1
    rolled_name = f"active.{next_num:03d}.jsonl"
    active_file.rename(session_dir / rolled_name)
    logger.info(f"Rolled session file to {rolled_name}")

def get_session_files(session_id: str) -> List[Path]:
    """Return all session files ordered from oldest to newest."""
    session_dir = get_session_dir(session_id)
    active_file = get_active_file(session_dir)
    
    rolled_files = []
    if session_dir.exists():
        for f in session_dir.iterdir():
            if f.name.startswith("active.") and f.name.endswith(".jsonl") and f.name != "active.jsonl":
                try:
                    num = int(f.name.split(".")[1])
                    rolled_files.append((num, f))
                except ValueError:
                    pass
                    
    rolled_files.sort()
    all_files = [path for _, path in rolled_files]
    if active_file.exists():
        all_files.append(active_file)
        
    return all_files

def get_stats() -> Dict[str, Any]:
    """Return global statistics about the storage."""
    config = get_config()
    session_count = 0
    total_messages = 0
    
    if config.data_dir.exists():
        for session_dir in config.data_dir.iterdir():
            if session_dir.is_dir():
                session_count += 1
                # Quick count of lines
                for f in session_dir.iterdir():
                    if f.name.endswith(".jsonl"):
                        try:
                            with open(f, "r", encoding="utf-8") as file:
                                total_messages += sum(1 for line in file if line.strip())
                        except Exception:
                            pass
                            
    return {
        "session_count": session_count,
        "total_messages_stored": total_messages
    }
