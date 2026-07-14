"""
core/persistence.py
Durable CSV + model storage in Supabase (Postgres + Storage).

On a stateless/serverless host (Vercel), local disk (TEMP_DIR / MODEL_DIR) is
only guaranteed to survive for the lifetime of a single invocation — /tmp is
wiped between cold starts, and a later request can land on a different
container entirely. A CSV uploaded (or a model trained) in one request would
otherwise be invisible to /train, /predict, etc. handled by a different
container.

  * save_upload / save_model
        Called right after /upload or /train produces a result. Uploads the
        bytes to Supabase Storage and records a metadata row (`uploads` /
        `models` table).
  * hydrate_csv / hydrate_model
        Called at the top of a route, before it checks for the state it
        needs. If the local file is missing (different container, cold
        start), it is pulled back out of Supabase Storage and written to a
        local temp file so the rest of the route can proceed exactly as if
        it had been there all along.

Anonymous (unauthenticated) sessions have no Supabase user id to scope rows
to, so every function here is a no-op (returns None) when no token is
supplied — anonymous usage keeps today's in-memory/local-disk-only
behaviour.

NOTE: this is intentionally scoped to CSV + model persistence for the
Upload -> Train -> Forecast chain. Forecast/schedule/cost-analysis result
persistence (i.e. surviving a logout or a totally separate later session)
is a separate, larger piece of work and is not part of this fix.
"""

import hashlib
import tempfile
from pathlib import Path

import pandas as pd

from config import MODEL_DIR, TEMP_DIR
from core.features import compute_time_slot_info
from db import client as db_client
from db.client import SupabaseError

# NOTE: always call through `db_client.<fn>` (not a `from ... import fn` local
# binding) so tests can monkeypatch db.client's attributes and have it take
# effect here.

CSV_BUCKET   = "user-uploads"
MODEL_BUCKET = "user-models"


def _csv_key(uid: str) -> str:
    return f"{uid}/current.csv"


def _model_key(uid: str) -> str:
    return f"{uid}/current.pkl"


def save_upload(uid: str, token: str, csv_bytes: bytes, meta: dict) -> str | None:
    """Persist the cleaned CSV to Storage and record an `uploads` row."""
    db_client.upload_object(CSV_BUCKET, _csv_key(uid), token, csv_bytes, content_type="text/csv")
    row = db_client.insert_row("uploads", token, {
        "user_id":    uid,
        "filename":   meta.get("filename"),
        "row_count":  meta.get("row_count"),
        "date_range": meta.get("date_range"),
        "csv_path":   _csv_key(uid),
    })
    return row.get("id") if row else None


def hydrate_csv(session_data: dict, uid: str, token: str | None) -> str | None:
    """Ensure session_data['csv_path'] points at an existing local file."""
    path = session_data.get("csv_path")
    if path and Path(path).exists():
        return path
    if not token:
        return None

    content = db_client.download_object(CSV_BUCKET, _csv_key(uid), token)
    if content is None:
        return None

    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=".csv", dir=TEMP_DIR, prefix=f"ss_{uid[:8]}_"
    )
    tmp.write(content)
    tmp.close()

    df   = pd.read_csv(tmp.name)
    info = compute_time_slot_info(df)

    session_data.update({
        "csv_path":  tmp.name,
        "csv_etag":  hashlib.md5(content).hexdigest(),
        **info,
    })
    return tmp.name


def save_model(uid: str, token: str, model_bytes: bytes, result: dict) -> str | None:
    """Persist the trained model bundle to Storage and record a `models` row."""
    db_client.upload_object(MODEL_BUCKET, _model_key(uid), token, model_bytes, content_type="application/octet-stream")
    row = db_client.insert_row("models", token, {
        "user_id":    uid,
        "model_type": result.get("model_type"),
        "accuracy":   result.get("accuracy"),
        "mae":        result.get("mae"),
        "rmse":       result.get("rmse"),
        "model_path": _model_key(uid),
    })
    return row.get("id") if row else None


def hydrate_model(session_data: dict, uid: str, token: str | None) -> str | None:
    """Ensure session_data['model_path'] points at an existing local file."""
    path = session_data.get("model_path")
    if path and Path(path).exists():
        return path
    if not token:
        return None

    row = db_client.latest_row("models", token, uid, order_col="trained_at")
    if not row:
        return None

    content = db_client.download_object(MODEL_BUCKET, _model_key(uid), token)
    if content is None:
        return None

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    local_path = MODEL_DIR / f"model_{uid[:8]}_restored.pkl"
    local_path.write_bytes(content)

    session_data.update({
        "model_path": str(local_path),
        "model_type": row.get("model_type"),
    })
    return str(local_path)


__all__ = ["SupabaseError", "save_upload", "hydrate_csv", "save_model", "hydrate_model"]
