"""
db/client.py
Thin Supabase REST (PostgREST) + Storage client.

Every call is made with the CALLER's own Supabase access token (not the
service role key), so Postgres Row Level Security and Storage RLS policies
(see db/schema.sql, db/storage.sql) enforce per-user isolation exactly as
they would for a direct browser->Supabase call. This module never sees or
needs the service role key.
"""

import requests

from config import SUPABASE_ANON_KEY, SUPABASE_URL

REST_TIMEOUT = 10


class SupabaseError(RuntimeError):
    """Raised when a Supabase REST/Storage call fails unexpectedly."""


def _configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_ANON_KEY)


def _headers(token: str, extra: dict | None = None) -> dict:
    headers = {
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
    }
    if extra:
        headers.update(extra)
    return headers


def _rest_url(table: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{table}"


def _storage_url(bucket: str, path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"


def insert_row(table: str, token: str, row: dict) -> dict | None:
    """Insert one row and return the inserted (server-populated) row."""
    if not _configured():
        raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).")
    try:
        resp = requests.post(
            _rest_url(table),
            headers=_headers(token, {
                "Content-Type": "application/json",
                "Prefer":       "return=representation",
            }),
            json=row,
            timeout=REST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SupabaseError(f"Could not reach Supabase ({table} insert): {exc}") from exc

    if not resp.ok:
        raise SupabaseError(f"Supabase insert into {table} failed (HTTP {resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    return data[0] if data else None


def latest_row(table: str, token: str, user_id: str, order_col: str = "created_at") -> dict | None:
    """Return the most recent row for user_id, or None if the user has none yet."""
    if not _configured():
        raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).")
    try:
        resp = requests.get(
            _rest_url(table),
            headers=_headers(token),
            params={
                "user_id": f"eq.{user_id}",
                "order":   f"{order_col}.desc",
                "limit":   1,
            },
            timeout=REST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SupabaseError(f"Could not reach Supabase ({table} select): {exc}") from exc

    if not resp.ok:
        raise SupabaseError(f"Supabase select on {table} failed (HTTP {resp.status_code}): {resp.text[:300]}")

    rows = resp.json()
    return rows[0] if rows else None


def upload_object(bucket: str, path: str, token: str, content: bytes,
                   content_type: str = "application/octet-stream") -> None:
    """Upload (upsert) an object to Supabase Storage."""
    if not _configured():
        raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).")
    try:
        resp = requests.post(
            _storage_url(bucket, path),
            headers=_headers(token, {
                "Content-Type": content_type,
                "x-upsert":     "true",
            }),
            data=content,
            timeout=REST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SupabaseError(f"Could not reach Supabase Storage (upload {bucket}/{path}): {exc}") from exc

    if not resp.ok:
        raise SupabaseError(
            f"Supabase Storage upload to {bucket}/{path} failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )


def download_object(bucket: str, path: str, token: str) -> bytes | None:
    """Download an object's bytes, or None if it doesn't exist."""
    if not _configured():
        raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).")
    try:
        resp = requests.get(
            _storage_url(bucket, path),
            headers=_headers(token),
            timeout=REST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SupabaseError(f"Could not reach Supabase Storage (download {bucket}/{path}): {exc}") from exc

    if resp.status_code == 404:
        return None
    if not resp.ok:
        raise SupabaseError(
            f"Supabase Storage download of {bucket}/{path} failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )
    return resp.content


def delete_object(bucket: str, path: str, token: str) -> None:
    """Delete an object. No-op if it doesn't exist."""
    if not _configured():
        raise SupabaseError("Supabase is not configured (SUPABASE_URL/SUPABASE_ANON_KEY missing).")
    try:
        resp = requests.delete(
            _storage_url(bucket, path),
            headers=_headers(token),
            timeout=REST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise SupabaseError(f"Could not reach Supabase Storage (delete {bucket}/{path}): {exc}") from exc

    if not resp.ok and resp.status_code != 404:
        raise SupabaseError(
            f"Supabase Storage delete of {bucket}/{path} failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )
