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
# Default to a tempfile-based path (mirrors TEMP_DIR below) so the fallback
# works out of the box on read-only-filesystem hosts like Vercel, where only
# /tmp is writable. Set MODEL_DIR explicitly to use a persistent volume.
MODEL_DIR = Path(os.environ.get("MODEL_DIR") or (Path(tempfile.gettempdir()) / "smartshift_models"))
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
# Legacy HS256 shared secret. Still used by projects on the old symmetric key.
SUPABASE_JWT_SECRET       = os.environ.get("SUPABASE_JWT_SECRET", "")
# New Supabase projects sign user access tokens with an ASYMMETRIC key (ES256).
# The backend needs the PUBLIC half to verify them. This is PUBLIC information —
# Supabase serves it openly at /auth/v1/.well-known/jwks.json — so it is safe to
# commit. Pinning it here means every developer verifies tokens offline (no .env
# entry, no network round-trip to the JWKS endpoint). If the project ever rotates
# its signing key, set SUPABASE_JWT_PUBLIC_KEY in .env to override this default,
# or update the PEM below. `\n` escapes in the env value are expanded to newlines
# so the whole PEM can live on one .env line.
_DEFAULT_JWT_PUBLIC_KEY = (
    "-----BEGIN PUBLIC KEY-----\n"
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGUysMY/2RYOuT+q/ahhmM8TagyGd\n"
    "QVTKDsoXDwYE0k8B1UXU7jKaAVgHgGL41Q986bqsgYfIaPS9KeuR5IG1lw==\n"
    "-----END PUBLIC KEY-----"
)
SUPABASE_JWT_PUBLIC_KEY   = (
    os.environ.get("SUPABASE_JWT_PUBLIC_KEY", "").replace("\\n", "\n").strip()
    or _DEFAULT_JWT_PUBLIC_KEY
)
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
