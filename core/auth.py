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

from config import SUPABASE_JWT_SECRET


def _extract_token() -> str | None:
    """Pull the bearer token out of the Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        return token or None
    return None


def verify_token(token: str) -> dict | None:
    """
    Verify a Supabase access token and return its claims, or None if invalid.
    """
    if not token or not SUPABASE_JWT_SECRET:
        return None
    try:
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_aud": True},
        )
    except jwt.PyJWTError:
        return None


def get_current_user() -> dict | None:
    """
    Return the current authenticated user as
        {"id": <uuid>, "email": <str>}
    or None when the request carries no valid token.
    """
    claims = verify_token(_extract_token() or "")
    if not claims:
        return None
    uid = claims.get("sub")
    if not uid:
        return None
    return {
        "id":    uid,
        "email": claims.get("email", ""),
        "role":  claims.get("role", "authenticated"),
    }


def require_auth(fn):
    """Decorator: reject the request with 401 when no valid token is present."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required."}), 401
        g.user = user
        g.uid  = user["id"]
        return fn(*args, **kwargs)
    return wrapper
