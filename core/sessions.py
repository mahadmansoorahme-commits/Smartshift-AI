"""
core/sessions.py
Per-request session management, rate limiting, and notification helpers.
"""

import html
import secrets
import threading
import time
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone as _tz
from functools import wraps
from pathlib import Path

from flask import g, request, jsonify

# ---------------------------------------------------------------------------
# Session store  (in-memory, max 50 sessions, LRU eviction)
# ---------------------------------------------------------------------------
from config import _MAX_SESSIONS

_SESSION_STORE: OrderedDict = OrderedDict()
_SESSION_COOKIE = "ss_uid"


def get_or_create_session(forced_uid: str | None = None) -> tuple:
    """
    Return (uid, session_dict). Creates a new session when needed.

    When ``forced_uid`` is provided (a verified Supabase user id), the session
    is keyed by that user id so all of a logged-in user's data is isolated to
    their account. Otherwise it falls back to the anonymous ``ss_uid`` cookie.
    """
    uid = forced_uid or request.cookies.get(_SESSION_COOKIE)
    if uid and uid in _SESSION_STORE:
        _SESSION_STORE.move_to_end(uid)
        return uid, _SESSION_STORE[uid]

    if len(_SESSION_STORE) >= _MAX_SESSIONS:
        _evict_oldest()

    uid = uid or secrets.token_hex(32)
    _SESSION_STORE[uid] = {
        "created_at":   time.time(),
        "csv_path":     None,
        "csv_etag":     None,
        "model_etag":   None,
        "model_path":   None,
        "notifications": [],
        "forecast":     None,
        "schedule":     None,
        "cost_summary": None,
        "history":      None,
    }
    return uid, _SESSION_STORE[uid]


def set_session_cookie(response, uid: str) -> None:
    """Attach the session UID cookie to a response."""
    from flask import current_app
    response.set_cookie(
        _SESSION_COOKIE,
        uid,
        httponly=True,
        samesite="Lax",
        secure=current_app.config.get("SESSION_COOKIE_SECURE", False),
        max_age=86400 * 7,
    )


def delete_session(uid: str) -> None:
    """Remove a session and clean up its files."""
    if uid in _SESSION_STORE:
        _cleanup_session_files(_SESSION_STORE[uid])
        del _SESSION_STORE[uid]


def active_session_count() -> int:
    return len(_SESSION_STORE)


def _evict_oldest() -> None:
    if not _SESSION_STORE:
        return
    _, oldest_data = next(iter(_SESSION_STORE.items()))
    _cleanup_session_files(oldest_data)
    _SESSION_STORE.popitem(last=False)


def _cleanup_session_files(session_data: dict) -> None:
    for key in ("csv_path", "model_path"):
        path_str = session_data.get(key)
        if path_str:
            p = Path(path_str)
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
_rate_lock  = threading.Lock()
_rate_store: dict = defaultdict(list)


def rate_limit(max_calls: int, window: int = 60):
    """Decorator: allow max_calls per window-seconds per session UID."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            uid = getattr(g, "uid", request.remote_addr)
            now = time.time()
            with _rate_lock:
                calls = [t for t in _rate_store[uid] if now - t < window]
                if len(calls) >= max_calls:
                    return jsonify({"error": "Rate limit exceeded. Please wait before retrying."}), 429
                calls.append(now)
                _rate_store[uid] = calls
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Notification helpers
# ---------------------------------------------------------------------------
def push_notification(session_data: dict, message: str, level: str = "info") -> None:
    """Append an HTML-escaped notification to the session queue (max 50)."""
    session_data["notifications"].append({
        "id":            secrets.token_hex(8),
        "type":          level,
        "level":         level,
        "message":       html.escape(str(message)),
        "timestamp":     time.time(),
        "timestamp_utc": datetime.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    session_data["notifications"] = session_data["notifications"][-50:]
