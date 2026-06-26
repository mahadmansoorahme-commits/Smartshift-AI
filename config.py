"""
SmartShiftAI — config.py
All application-level constants and Flask configuration in one place.
"""

import os
import secrets
import logging
import tempfile
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env (and .env.local) as early as possible,
# before any os.environ lookups below.
load_dotenv()
load_dotenv(".env.local", override=True)


# ---------------------------------------------------------------------------
# Secret key resolution
# ---------------------------------------------------------------------------
def _resolve_secret() -> str:
    secret = os.environ.get("SMARTSHIFT_SECRET")
    if not secret and not os.environ.get("FLASK_DEBUG"):
        raise RuntimeError(
            "SMARTSHIFT_SECRET environment variable is not set. "
            "Set it before starting the server."
        )
    if not secret:
        secret = secrets.token_hex(32)
        logging.warning(
            "SMARTSHIFT_SECRET not set — using ephemeral secret for debug session only. "
            "All cookies will be invalidated on restart."
        )
    return secret


# ---------------------------------------------------------------------------
# Flask config dict
# ---------------------------------------------------------------------------
class Config:
    SECRET_KEY              = _resolve_secret()
    WTF_CSRF_TIME_LIMIT     = 3600
    WTF_CSRF_HEADERS        = ["X-CSRFToken"]
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE   = not bool(os.environ.get("FLASK_DEBUG"))
    MAX_CONTENT_LENGTH      = 16 * 1024 * 1024   # 16 MB upload cap


# ---------------------------------------------------------------------------
# File-system paths
# ---------------------------------------------------------------------------
MODEL_DIR = Path(os.environ.get("MODEL_DIR", "model/_store"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(tempfile.gettempdir()) / "smartshift_csv"
TEMP_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Domain constants
# ---------------------------------------------------------------------------
REQUIRED_COLS           = {"Date", "Day", "Customers", "Sales", "Workers"}
DAY_MAP                 = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
DAY_NAMES               = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_SHORT               = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
WORKERS_PER_N_CUSTOMERS = 40   # 1 worker handles 40 customers
_MAX_SESSIONS           = 50   # LRU eviction threshold


# ---------------------------------------------------------------------------
# Supabase (authentication + database)
# ---------------------------------------------------------------------------
SUPABASE_URL              = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY         = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_JWT_SECRET       = os.environ.get("SUPABASE_JWT_SECRET", "")
# Optional — enables full account deletion (admin API). Keep this SECRET.
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


# ---------------------------------------------------------------------------
# Content-Security-Policy header value
# ---------------------------------------------------------------------------
# Allow the browser to talk to Supabase (auth + REST) from the frontend.
_connect_src = "'self'"
if SUPABASE_URL:
    # both https REST/auth calls and the realtime websocket origin
    _ws = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    _connect_src = f"'self' {SUPABASE_URL} {_ws}"

CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.jsdelivr.net; "
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    f"connect-src {_connect_src}; "
    "frame-ancestors 'none';"
)
