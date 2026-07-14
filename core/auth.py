"""
core/auth.py
Supabase JWT verification for the Flask backend.

The frontend authenticates directly with Supabase (email/password, Google
OAuth, etc.) and receives a signed access token (JWT). It sends that token on
every API call as:  Authorization: Bearer <token>

This module verifies that token (HS256, signed with the project's JWT secret)
and extracts the Supabase user id (the `sub` claim).
"""

from functools import wraps

import jwt
from flask import g, jsonify, request

from config import (
    SUPABASE_ANON_KEY,
    SUPABASE_JWT_PUBLIC_KEY,
    SUPABASE_JWT_SECRET,
    SUPABASE_URL,
)

# Supabase can sign access tokens two ways:
#   * HS256  — the legacy symmetric "JWT secret" (SUPABASE_JWT_SECRET)
#   * ES256  — the newer asymmetric signing key (default for projects created in
#              2025+). The backend needs the PUBLIC key to verify these.
# We accept both so the app works regardless of which mode the project uses.
_ASYMMETRIC_ALGS = ("ES256", "RS256")

# Lazily-built JWKS client, used only when no public key is pinned in the env.
_jwks_client = None


def _extract_token() -> str | None:
    """Pull the bearer token out of the Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        return token or None
    return None


def _get_jwks_client():
    """Build (once) a JWKS client that fetches the project's public signing keys.

    Only used as a fallback when SUPABASE_JWT_PUBLIC_KEY is not set. Uses the
    certifi CA bundle so the HTTPS fetch works even when the OS trust store is
    misconfigured.
    """
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    if not SUPABASE_URL:
        return None
    try:
        import ssl

        import certifi
        from jwt import PyJWKClient

        ctx = ssl.create_default_context(cafile=certifi.where())
        _jwks_client = PyJWKClient(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            headers={"apikey": SUPABASE_ANON_KEY} if SUPABASE_ANON_KEY else None,
            ssl_context=ctx,
            cache_keys=True,
        )
    except Exception:
        _jwks_client = None
    return _jwks_client


def verify_token(token: str) -> dict | None:
    """
    Verify a Supabase access token and return its claims, or None if invalid.
    """
    if not token:
        return None

    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError:
        return None

    common = dict(audience="authenticated", options={"verify_aud": True})

    try:
        if alg == "HS256":
            if not SUPABASE_JWT_SECRET:
                return None
            return jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], **common)

        if alg in _ASYMMETRIC_ALGS:
            if SUPABASE_JWT_PUBLIC_KEY:
                key = SUPABASE_JWT_PUBLIC_KEY
            else:
                client = _get_jwks_client()
                if client is None:
                    return None
                key = client.get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=list(_ASYMMETRIC_ALGS), **common)
    except jwt.PyJWTError:
        return None
    except Exception:
        # e.g. JWKS fetch failure — treat as unauthenticated rather than 500.
        return None

    return None


def get_current_user_and_token() -> tuple[dict | None, str | None]:
    """
    Return (user, raw_access_token) for the current request, or (None, None)
    when the request carries no valid token.

    The raw token is needed (in addition to the decoded claims) so route code
    can forward it as-is to Supabase's REST/Storage APIs, letting Postgres
    and Storage Row Level Security enforce per-user isolation exactly as if
    the browser had called Supabase directly.
    """
    token  = _extract_token()
    claims = verify_token(token or "")
    if not claims:
        return None, None
    uid = claims.get("sub")
    if not uid:
        return None, None
    user = {
        "id":    uid,
        "email": claims.get("email", ""),
        "role":  claims.get("role", "authenticated"),
    }
    return user, token


def get_current_user() -> dict | None:
    """
    Return the current authenticated user as
        {"id": <uuid>, "email": <str>}
    or None when the request carries no valid token.
    """
    user, _ = get_current_user_and_token()
    return user


def require_auth(fn):
    """Decorator: reject the request with 401 when no valid token is present."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user, token = get_current_user_and_token()
        if not user:
            return jsonify({"error": "Authentication required."}), 401
        g.user  = user
        g.uid   = user["id"]
        g.token = token
        return fn(*args, **kwargs)
    return wrapper
