import os
import json
import logging
from typing import List, Dict, Any, Tuple
from .config import get_config
from .storage import get_session_files

logger = logging.getLogger("stitcher.engine")

def _chars_per_token():
    return get_config().chars_per_token

def _text_similarity(a: str, b: str) -> float:
    """Quick similarity check — character trigram overlap. 0.0=different, 1.0=identical."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    a, b = a[:500], b[:500]  # Only compare beginnings — fast enough
    trigrams_a = set(a[i:i+3] for i in range(len(a) - 2))
    trigrams_b = set(b[i:i+3] for i in range(len(b) - 2))
    if not trigrams_a or not trigrams_b:
        return 0.0
    return len(trigrams_a & trigrams_b) / len(trigrams_a | trigrams_b)

def estimate_tokens(text: str) -> int:
    return len(text) // _chars_per_token()

def read_jsonl_messages(filepath: str) -> List[Dict[str, Any]]:
    """Read a .jsonl file and extract all messages in order."""
    messages = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("type") == "message" and record.get("message"):
                        msg = record["message"]
                        if msg.get("role") in ("system", "user", "assistant"):
                            # Deduplicate near-identical assistant messages
                            if msg["role"] == "assistant" and messages:
                                msg_text = msg.get("content", "")
                                if isinstance(msg_text, list):
                                    msg_text = " ".join(part.get("text", "") for part in msg_text if isinstance(part, dict) and part.get("type") == "text")
                                recent_assistant = [
                                    m for m in messages[-10:]
                                    if m.get("role") == "assistant"
                                ][-5:]
                                is_dup = False
                                for m in recent_assistant:
                                    old_text = m.get("content", "")
                                    if isinstance(old_text, list):
                                        old_text = " ".join(part.get("text", "") for part in old_text if isinstance(part, dict) and part.get("type") == "text")
                                    if _text_similarity(old_text, msg_text) > get_config().dedup_threshold:
                                        is_dup = True
                                        break
                                if is_dup:
                                    continue
                            messages.append(msg)
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.error(f"Error reading {filepath}: {e}")
    return messages

def get_stitched_context(session_id: str) -> Tuple[List[Dict[str, Any]], int]:
    """
    Build the full context window by stitching historical files + active file backwards.
    Returns (messages, total_tokens).
    """
    config = get_config()
    all_files = get_session_files(session_id)
    
    if not all_files:
        return [], 0

    selected_messages = []
    total_tokens = 0
    max_tokens = config.max_tokens

    # Read files from NEWEST to OLDEST, accumulating tokens until limit
    for filepath in reversed(all_files):
        file_messages = read_jsonl_messages(filepath)
        file_text = json.dumps(file_messages)
        file_tokens = estimate_tokens(file_text)

        if total_tokens + file_tokens > max_tokens:
            # File pushes over limit. Fit as many messages as possible (from end).
            for msg in reversed(file_messages):
                msg_tokens = estimate_tokens(json.dumps(msg))
                if total_tokens + msg_tokens > max_tokens:
                    break
                selected_messages.append(msg)
                total_tokens += msg_tokens
            break

        # Fit entire file
        selected_messages.extend(reversed(file_messages))
        total_tokens += file_tokens

    # Reverse back to chronological order
    selected_messages.reverse()
    
    # Run the condense repetitive check to shorten older identical messages
    selected_messages = _condense_repetitive(selected_messages)
    
    return selected_messages, total_tokens

def _condense_repetitive(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Replace earlier assistant messages that are thematically similar to later ones."""
    if len(messages) < 4:
        return messages

    assistant_indices = [
        i for i, m in enumerate(messages) if m.get("role") == "assistant"
    ]
    if len(assistant_indices) < 2:
        return messages

    condensed = set()
    for i in range(len(assistant_indices) - 1, 0, -1):
        idx_new = assistant_indices[i]
        new_text = messages[idx_new].get("content", "")
        if isinstance(new_text, list):
            new_text = " ".join(part.get("text", "") for part in new_text if isinstance(part, dict) and part.get("type") == "text")
            
        if not new_text or idx_new in condensed:
            continue
            
        for j in range(i - 1, max(i - 6, -1), -1):
            idx_old = assistant_indices[j]
            if idx_old in condensed:
                continue
            old_text = messages[idx_old].get("content", "")
            if isinstance(old_text, list):
                old_text = " ".join(part.get("text", "") for part in old_text if isinstance(part, dict) and part.get("type") == "text")
                
            if not old_text:
                continue
                
            sim = _text_similarity(new_text, old_text)
            if sim > get_config().condense_threshold:
                condensed.add(idx_old)

    if not condensed:
        return messages

    result = []
    for i, msg in enumerate(messages):
        if i in condensed:
            result.append({
                "role": msg["role"],
                "content": "[Prior response — similar content repeated below, skipped for context optimization]",
            })
        else:
            result.append(msg)
            
    return result
