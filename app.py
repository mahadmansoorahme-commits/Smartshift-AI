"""
SmartShiftAI — app.py
Flask application shell with session management, CSRF protection, and security headers.
"""

import os
import secrets
import time
import html
import logging
import tempfile
import threading
from collections import OrderedDict, defaultdict
from functools import wraps
from pathlib import Path

import pandas as pd
import numpy as np

from flask import (
    Flask, render_template, request, jsonify,
    make_response, g, send_from_directory
)
from flask_wtf.csrf import CSRFProtect, generate_csrf

# ---------------------------------------------------------------------------
# Startup validation — hard crash if secret is missing in production
# ---------------------------------------------------------------------------
_SECRET = os.environ.get("SMARTSHIFT_SECRET")
if not _SECRET and not os.environ.get("FLASK_DEBUG"):
    raise RuntimeError(
        "SMARTSHIFT_SECRET environment variable is not set. "
        "Set it before starting the server."
    )

# In debug mode, fall back to a generated ephemeral secret with a warning
if not _SECRET:
    _SECRET = secrets.token_hex(32)
    logging.warning(
        "SMARTSHIFT_SECRET not set — using ephemeral secret for debug session only. "
        "All cookies will be invalidated on restart."
    )

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config.update(
    SECRET_KEY=_SECRET,
    WTF_CSRF_TIME_LIMIT=3600,          # 1-hour CSRF token validity
    WTF_CSRF_HEADERS=["X-CSRFToken"],  # Accept token in custom header
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=not bool(os.environ.get("FLASK_DEBUG")),
    MAX_CONTENT_LENGTH=16 * 1024 * 1024,  # 16 MB upload cap
)

csrf = CSRFProtect(app)

# ---------------------------------------------------------------------------
# Per-session state store — max 50 sessions, oldest-first eviction
# ---------------------------------------------------------------------------
_SESSION_STORE: OrderedDict[str, dict] = OrderedDict()
_MAX_SESSIONS = 50
_SESSION_COOKIE = "ss_uid"

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "model/_store"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Temp directory for session CSV files
TEMP_DIR = Path(tempfile.gettempdir()) / "smartshift_csv"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Simple in-memory rate limiter
# ---------------------------------------------------------------------------
_rate_lock   = threading.Lock()
_rate_store: dict[str, list[float]] = defaultdict(list)   # uid -> [timestamps]


def rate_limit(max_calls: int, window: int = 60):
    """Decorator: allow max_calls per window seconds per session UID."""
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


def _evict_oldest() -> None:
    """Remove the oldest session and clean up its temp files."""
    if not _SESSION_STORE:
        return
    _oldest_uid, oldest_data = next(iter(_SESSION_STORE.items()))
    _cleanup_session_files(oldest_data)
    _SESSION_STORE.popitem(last=False)


def _cleanup_session_files(session_data: dict) -> None:
    """Delete any temp CSV file and per-session model file associated with a session."""
    csv_path = session_data.get("csv_path")
    if csv_path and Path(csv_path).exists():
        try:
            Path(csv_path).unlink()
        except OSError as exc:
            app.logger.warning("Could not delete temp CSV %s: %s", csv_path, exc)
    # BUG-02 FIX: also clean up the per-session model file
    model_path = session_data.get("model_path")
    if model_path and Path(model_path).exists():
        try:
            Path(model_path).unlink()
        except OSError as exc:
            app.logger.warning("Could not delete model file %s: %s", model_path, exc)


def get_or_create_session() -> tuple[str, dict]:
    """
    Return (uid, session_dict) for the current request.
    Creates a new session (with eviction if at capacity) if the cookie is
    absent or references an unknown UID.
    """
    uid = request.cookies.get(_SESSION_COOKIE)
    if uid and uid in _SESSION_STORE:
        # Move to end to mark as recently used
        _SESSION_STORE.move_to_end(uid)
        return uid, _SESSION_STORE[uid]

    # New session — evict if at capacity
    if len(_SESSION_STORE) >= _MAX_SESSIONS:
        _evict_oldest()

    uid = secrets.token_hex(32)
    _SESSION_STORE[uid] = {
        "created_at": time.time(),
        "csv_path": None,
        "csv_etag": None,
        "model_etag": None,
        "model_path": None,   # BUG-02 FIX: per-session model path
        "notifications": [],
        "forecast": None,
        "schedule": None,
        "cost_summary": None,
        "history": None,
    }
    return uid, _SESSION_STORE[uid]


def set_session_cookie(response, uid: str) -> None:
    """Attach the session UID cookie to a response."""
    response.set_cookie(
        _SESSION_COOKIE,
        uid,
        httponly=True,
        samesite="Lax",
        secure=not bool(os.environ.get("FLASK_DEBUG")),
        max_age=86400 * 7,  # 1 week
    )


# ---------------------------------------------------------------------------
# Security headers — applied to every response
# ---------------------------------------------------------------------------
CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.jsdelivr.net; "
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none';"
)


@app.after_request
def apply_security_headers(response):
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "geolocation=(), microphone=(), camera=()"
    )
    response.headers["Content-Security-Policy"] = CSP
    return response


# ---------------------------------------------------------------------------
# Request lifecycle — resolve session before each request
# ---------------------------------------------------------------------------
@app.before_request
def load_session():
    uid, session_data = get_or_create_session()
    g.uid = uid
    g.session = session_data


@app.after_request
def persist_session_cookie(response):
    # Always refresh the cookie so max_age resets on activity
    set_session_cookie(response, g.uid)
    return response


# ---------------------------------------------------------------------------
# CSRF token endpoint — frontend fetches this on load
# ---------------------------------------------------------------------------
@app.route("/csrf-token", methods=["GET"])
def csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


# ---------------------------------------------------------------------------
# Session reset
# ---------------------------------------------------------------------------
@app.route("/reset", methods=["POST"])
def reset_session():
    uid = g.uid
    if uid in _SESSION_STORE:
        sess = _SESSION_STORE[uid]
        # Delete temp CSV and per-session model file (handled by _cleanup_session_files)
        _cleanup_session_files(sess)
        # Clear notification queue explicitly
        sess["notifications"] = []
        del _SESSION_STORE[uid]
    # New session is created on next request via before_request
    return jsonify({"status": "reset", "uid_cleared": uid[:8] + "…"})


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "active_sessions": len(_SESSION_STORE),
        "max_sessions": _MAX_SESSIONS,
    })


# ---------------------------------------------------------------------------
# Main SPA entry point
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Notification helpers
# ---------------------------------------------------------------------------
def push_notification(session_data: dict, message: str, level: str = "info") -> None:
    """
    Append an HTML-escaped notification to the session queue.
    level / type: 'info' | 'warning' | 'success' | 'error'
    Stored fields: id, type, level, message, timestamp, timestamp_utc
    """
    from datetime import datetime, timezone as _tz
    session_data["notifications"].append({
        "id":            secrets.token_hex(8),
        "type":          level,
        "level":         level,
        "message":       html.escape(str(message)),
        "timestamp":     time.time(),
        "timestamp_utc": datetime.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    # Keep the most-recent 50 per session
    session_data["notifications"] = session_data["notifications"][-50:]


@app.route("/notifications", methods=["GET"])
def notifications():
    """
    Return the full notification queue sorted newest-first.
    Does NOT auto-clear — explicit clear via /clear_notifications.
    Frontend tracks its own seen-cursor.
    """
    notes = sorted(
        g.session.get("notifications", []),
        key=lambda n: n.get("timestamp", 0),
        reverse=True,
    )
    return jsonify({"notifications": notes, "count": len(notes)})


@app.route("/clear_notifications", methods=["POST"])
def clear_notifications():
    """Empty the notification queue for this session (CSRF-protected)."""
    g.session["notifications"] = []
    return jsonify({"status": "ok", "cleared": True})


# ---------------------------------------------------------------------------
# /upload — Phase 3
# ---------------------------------------------------------------------------
REQUIRED_COLS = {"Date", "Day", "Customers", "Sales", "Workers"}
DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _parse_day(val) -> int | None:
    """Convert day name (Mon/Monday/0–6) to integer 0–6."""
    if pd.isna(val):
        return None
    s = str(val).strip().lower()[:3]
    if s in DAY_MAP:
        return DAY_MAP[s]
    try:
        n = int(float(str(val)))
        return n if 0 <= n <= 6 else None
    except (ValueError, TypeError):
        return None


@app.route("/upload", methods=["POST"])
@rate_limit(max_calls=20, window=60)
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file part in request."}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "No file selected."}), 400

    fname = file.filename.lower()
    if not fname.endswith(".csv"):
        return jsonify({"error": "Only .csv files are accepted."}), 415

    # ---- Read CSV --------------------------------------------------------
    try:
        df = pd.read_csv(file)
    except Exception as exc:
        return jsonify({"error": f"Could not parse CSV: {exc}"}), 422

    # Strip whitespace from column names
    df.columns = [c.strip() for c in df.columns]

    # ---- Validate required columns ---------------------------------------
    missing = REQUIRED_COLS - set(df.columns)
    if missing:
        return jsonify({"error": f"Missing required columns: {', '.join(sorted(missing))}"}), 422

    # ---- Coerce numeric columns -----------------------------------------
    for col in ("Customers", "Sales", "Workers"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows with any missing values in required numeric + date cols
    df = df.dropna(subset=["Date", "Customers", "Sales", "Workers"])

    if df.empty:
        return jsonify({"error": "No valid rows remain after cleaning. Check your data."}), 422

    # ---- Parse dates -----------------------------------------------------
    try:
        df["Date"] = pd.to_datetime(df["Date"])
    except Exception:
        return jsonify({"error": "Could not parse the Date column. Use YYYY-MM-DD format."}), 422

    # ---- Parse Day column ------------------------------------------------
    df["Day"] = df["Day"].apply(_parse_day)
    df = df.dropna(subset=["Day"])
    df["Day"] = df["Day"].astype(int)

    if df.empty:
        return jsonify({"error": "No valid rows remain after Day parsing. Use Mon–Sun or 0–6."}), 422

    # ---- Time Slot processing --------------------------------------------
    has_time_slot = "Time Slot" in df.columns
    time_slot_info = []

    if has_time_slot:
        df["Time Slot"] = df["Time Slot"].astype(str).str.strip()
        # Compute per-slot aggregate
        slot_agg = (
            df.groupby("Time Slot")
              .agg(slot_avg_customers=("Customers", "mean"),
                   slot_avg_workers=("Workers", "mean"),
                   slot_count=("Customers", "count"))
              .reset_index()
        )
        # BUG-01 FIX: normalize weights so they sum to 1.0 per day.
        # Use sum of slot averages as denominator (not the overall row mean),
        # so each weight = slot_avg / sum(all_slot_avgs) and weights sum to 1.
        slot_total = float(slot_agg["slot_avg_customers"].sum())
        n_slots = len(slot_agg)
        slot_agg["weight"] = (
            slot_agg["slot_avg_customers"] / slot_total
            if slot_total > 0
            else 1.0 / n_slots
        )
        # Sort slots chronologically by parsed start hour
        from scheduler import parse_slot as _parse_slot
        def _slot_start_key(slot_str):
            parsed = _parse_slot(slot_str)
            return parsed[0] if parsed else float("inf")
        slot_agg = slot_agg.iloc[
            slot_agg["Time Slot"].map(_slot_start_key).argsort().values
        ].reset_index(drop=True)
        time_slot_info = [
            {
                "slot":              row["Time Slot"],
                "avg_customers":     round(float(row["slot_avg_customers"]), 2),
                "avg_workers":       math.ceil(float(row["slot_avg_workers"])),
                "weight":            round(float(row["weight"]), 4),
                "count":             int(row["slot_count"]),
            }
            for _, row in slot_agg.iterrows()
        ]

        # ---- Total business hours span (earliest start -> latest end) ----
        _spans = [_parse_slot(s) for s in slot_agg["Time Slot"]]
        _spans = [sp for sp in _spans if sp is not None]
        if _spans:
            _start = min(sp[0] for sp in _spans)
            _end   = max(sp[1] for sp in _spans)
            total_business_hours = round(_end - _start, 2)
        else:
            total_business_hours = 12.0
    else:
        total_business_hours = 12.0

    # ---- Delete previous temp CSV for this session ----------------------
    prev_path = g.session.get("csv_path")
    if prev_path and Path(prev_path).exists():
        try:
            Path(prev_path).unlink()
        except OSError:
            pass

    # ---- Save cleaned DataFrame -----------------------------------------
    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=".csv", dir=TEMP_DIR,
        prefix=f"ss_{g.uid[:8]}_"
    )
    df.to_csv(tmp.name, index=False)
    tmp.close()

    # ---- Store in session -----------------------------------------------
    # Compute a short hash of the file for ETag use in Phase 4
    import hashlib
    etag = hashlib.md5(Path(tmp.name).read_bytes()).hexdigest()

    g.session.update({
        "csv_path":      tmp.name,
        "csv_etag":      etag,
        "model_etag":    None,   # invalidate trained model on new upload
        "has_time_slot": has_time_slot,
        "time_slot_info": time_slot_info,
        "total_business_hours": total_business_hours,
        "forecast":      None,
        "schedule":      None,
        "cost_summary":  None,
    })

    # ---- Build summary stats --------------------------------------------
    date_min = df["Date"].min().strftime("%Y-%m-%d")
    date_max = df["Date"].max().strftime("%Y-%m-%d")
    avg_customers = round(float(df["Customers"].mean()), 1)
    avg_workers   = math.ceil(float(df["Workers"].mean()))
    row_count     = len(df)

    push_notification(g.session,
        f"CSV uploaded: {row_count} rows, {date_min} → {date_max}", "success")

    return jsonify({
        "status":          "ok",
        "row_count":       row_count,
        "date_range":      f"{date_min} → {date_max}",
        "date_min":        date_min,
        "date_max":        date_max,
        "avg_customers":   avg_customers,
        "avg_workers":     avg_workers,
        "has_time_slot":   has_time_slot,
        "time_slot_info":  time_slot_info,
        "total_business_hours": total_business_hours,
        "csv_etag":        etag,
    })


# ---------------------------------------------------------------------------
# /train — Phase 4
# ---------------------------------------------------------------------------
import hashlib
import math
import joblib
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Engineer 9 features from a cleaned DataFrame.
    Returns a new DataFrame with feature columns + target ('Customers').
    Rows with NaN features (head of series) are dropped.
    """
    d = df.sort_values("Date").copy()

    # Lag features
    d["lag1"]       = d["Customers"].shift(1)
    d["lag2"]       = d["Customers"].shift(2)
    d["lag7"]       = d["Customers"].shift(7)
    d["sales_lag1"] = d["Sales"].shift(1)

    # Rolling statistics on lag1
    d["rolling_mean_7"] = d["lag1"].rolling(7, min_periods=1).mean()
    d["rolling_std_7"]  = d["lag1"].rolling(7, min_periods=1).std().fillna(0)

    # Cyclical day encoding
    d["sin_day"] = np.sin(d["Day"] * 2 * math.pi / 7)
    d["cos_day"] = np.cos(d["Day"] * 2 * math.pi / 7)

    # Sales per customer (handle zero division)
    d["sales_per_customer"] = np.where(
        d["lag1"] > 0, d["sales_lag1"] / d["lag1"], 0.0
    )

    feature_cols = [
        "lag1", "lag2", "lag7", "sales_lag1",
        "rolling_mean_7", "rolling_std_7",
        "sin_day", "cos_day", "sales_per_customer",
    ]
    d = d.dropna(subset=feature_cols)
    return d, feature_cols


def _csv_etag(csv_path: str) -> str:
    """Hash path + mtime for ETag comparison."""
    p = Path(csv_path)
    raw = f"{csv_path}:{p.stat().st_mtime}"
    return hashlib.md5(raw.encode()).hexdigest()


@app.route("/train", methods=["POST"])
@rate_limit(max_calls=5, window=60)
def train():
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data found. Please upload a CSV first."}), 400

    # ---- ETag — return 304 if already trained on this exact file --------
    current_etag = _csv_etag(csv_path)
    if g.session.get("model_etag") == current_etag:
        # Re-return the cached result stored in session
        cached = g.session.get("train_result")
        if cached:
            return jsonify({**cached, "cached": True}), 200

    # ---- Load cleaned CSV -----------------------------------------------
    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data file: {exc}"}), 500

    # ---- Feature engineering --------------------------------------------
    df, feature_cols = _build_features(df)

    if len(df) < 10:
        return jsonify({"error": "Not enough rows after feature engineering (need ≥10). Upload more data."}), 422

    # ---- Chronological 80/20 split (NO shuffle) -------------------------
    split_idx  = int(len(df) * 0.8)
    train_df   = df.iloc[:split_idx]
    test_df    = df.iloc[split_idx:]

    X_train = train_df[feature_cols].values
    y_train = train_df["Customers"].values
    X_test  = test_df[feature_cols].values
    y_test  = test_df["Customers"].values

    train_size = len(train_df)
    test_size  = len(test_df)

    # ---- Adaptive model selection ---------------------------------------
    if train_size >= 60:
        model = GradientBoostingRegressor(
            n_estimators=300, max_depth=3,
            learning_rate=0.05, subsample=0.8,
            random_state=42,
        )
        model_type = "GradientBoosting"
    else:
        model = Ridge(alpha=0.5)
        model_type = "Ridge"

    model.fit(X_train, y_train)

    # ---- Evaluate -------------------------------------------------------
    y_pred_test = model.predict(X_test)
    y_pred_test = np.maximum(y_pred_test, 0)          # clamp negatives

    mae        = float(mean_absolute_error(y_test, y_pred_test))
    rmse       = float(np.sqrt(np.mean((y_test - y_pred_test) ** 2)))
    mean_actual = float(np.mean(y_test)) if len(y_test) else 1.0
    accuracy   = float(np.clip((1 - mae / max(mean_actual, 1)) * 100, 0, 100))

    # ---- Persist model (per-session file to avoid cross-session collisions) --
    model_filename = f"model_{g.uid[:8]}.pkl"
    model_path = MODEL_DIR / model_filename
    joblib.dump({"model": model, "feature_cols": feature_cols, "model_type": model_type}, model_path)
    g.session["model_path"] = str(model_path)   # BUG-02 FIX: store for load + cleanup

    # ---- Next-day prediction (last row of full dataset) -----------------
    last_row    = df.iloc[[-1]][feature_cols].values
    next_day_pred = float(max(0, model.predict(last_row)[0]))

    # ---- Comparison table (up to 20 test rows) --------------------------
    comparison_table = []
    sample_df = test_df.reset_index(drop=True)
    for i in range(min(20, len(sample_df))):
        actual    = float(sample_df.loc[i, "Customers"])
        predicted = float(max(0, y_pred_test[i]))
        err_pct   = round(abs(actual - predicted) / max(actual, 1) * 100, 1)
        comparison_table.append({
            "date":      sample_df.loc[i, "Date"].strftime("%Y-%m-%d"),
            "actual":    round(actual, 1),
            "predicted": round(predicted, 1),
            "error_pct": err_pct,
        })

    # ---- Chart series (full dataset: actual + predicted) ----------------
    all_pred  = np.maximum(model.predict(df[feature_cols].values), 0)
    chart_series = {
        "labels":    [d.strftime("%Y-%m-%d") for d in df["Date"]],
        "actual":    [round(float(v), 1) for v in df["Customers"].values],
        "predicted": [round(float(v), 1) for v in all_pred],
        "split_index": train_size,        # frontend can draw train/test divider
    }

    # ---- Store in session -----------------------------------------------
    result = {
        "status":          "ok",
        "mae":             round(mae, 2),
        "rmse":            round(rmse, 2),
        "accuracy":        round(accuracy, 1),
        "model_type":      model_type,
        "train_size":      train_size,
        "test_size":       test_size,
        "next_day_pred":   round(next_day_pred, 1),
        "comparison_table": comparison_table,
        "chart_series":    chart_series,
    }
    g.session["model_etag"]   = current_etag
    g.session["train_result"] = result
    g.session["model_type"]   = model_type

    push_notification(g.session,
        f"Model trained — {model_type}, {round(accuracy, 1)}% accuracy on test set.",
        "success")

    return jsonify(result)


# ---------------------------------------------------------------------------
# /predict (alias /forecast_range) — Phase 5
# ---------------------------------------------------------------------------
import math as _math

def _load_model_bundle():
    """Load per-session model; return (model, feature_cols, model_type) or raise."""
    # BUG-02 FIX: use per-session model path stored at train time
    model_path_str = g.session.get("model_path")
    if model_path_str:
        model_path = Path(model_path_str)
    else:
        # Legacy fallback for sessions trained before this fix
        model_path = MODEL_DIR / "model.pkl"
    if not model_path.exists():
        raise FileNotFoundError("Model not trained yet.")
    bundle = joblib.load(model_path)
    return bundle["model"], bundle["feature_cols"], bundle["model_type"]


def _rebuild_feature_row(history: list[float], sales_history: list[float],
                          day_of_week: int) -> list[float]:
    """
    Reconstruct one 9-feature vector from rolling history buffers.
    history[-1] is the most-recent customer count; same for sales_history.
    """
    lag1 = history[-1] if len(history) >= 1 else 0.0
    lag2 = history[-2] if len(history) >= 2 else lag1
    lag7 = history[-7] if len(history) >= 7 else lag1
    sl1  = sales_history[-1] if len(sales_history) >= 1 else 0.0
    win  = history[-7:] if len(history) >= 7 else history
    roll_mean = float(np.mean(win)) if win else lag1
    roll_std  = float(np.std(win))  if len(win) > 1 else 0.0
    sin_d = np.sin(day_of_week * 2 * _math.pi / 7)
    cos_d = np.cos(day_of_week * 2 * _math.pi / 7)
    spc   = sl1 / lag1 if lag1 > 0 else 0.0
    return [lag1, lag2, lag7, sl1, roll_mean, roll_std, sin_d, cos_d, spc]


@app.route("/predict", methods=["POST"])
@app.route("/forecast_range", methods=["POST"])
@rate_limit(max_calls=20, window=60)
def predict():
    # ---- Guard: need uploaded CSV + trained model -----------------------
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data. Please upload a CSV first."}), 400

    try:
        model, feature_cols, model_type = _load_model_bundle()
    except FileNotFoundError:
        return jsonify({"error": "No trained model found. Please train the model first."}), 400

    # ---- Parse request --------------------------------------------------
    body = request.get_json(silent=True) or {}
    target_date_str = body.get("date") or body.get("target_date")
    n_days          = 1  # locked to daily (1-day) forecast only

    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data: {exc}"}), 500

    df = df.sort_values("Date").reset_index(drop=True)

    # ---- Determine start date for forecast ------------------------------
    if target_date_str:
        try:
            start_date = pd.Timestamp(target_date_str)
        except Exception:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 422
    else:
        start_date = df["Date"].max() + pd.Timedelta(days=1)

    # ---- Build rolling history buffers from tail of DataFrame ----------
    cust_history  = list(df["Customers"].values.astype(float))
    sales_history = list(df["Sales"].values.astype(float))

    # ---- 14-day lookback for chart context ------------------------------
    lookback_rows = df.tail(14)
    lookback_14 = [
        {
            "date":      row["Date"].strftime("%Y-%m-%d"),
            "customers": round(float(row["Customers"]), 1),
        }
        for _, row in lookback_rows.iterrows()
    ]

    # ---- Rolling stats for spike detection (7-day) ----------------------
    recent_7 = cust_history[-7:] if len(cust_history) >= 7 else cust_history
    rolling_mean_7 = float(np.mean(recent_7)) if recent_7 else 0.0
    last_actual    = cust_history[-1] if cust_history else 0.0

    # Demand spike notification
    if rolling_mean_7 > 0 and last_actual > 1.3 * rolling_mean_7:
        push_notification(
            g.session,
            f"⚠ Demand spike detected: latest actual ({round(last_actual,1)}) "
            f"is {round(last_actual/rolling_mean_7*100-100,0):.0f}% above 7-day mean.",
            "warning",
        )

    # Day-of-week historical averages for HIGH demand check
    df["DOW"] = df["Date"].dt.dayofweek
    dow_avgs = df.groupby("DOW")["Customers"].mean().to_dict()

    # ---- Iterate forward: predict n_days --------------------------------
    predictions = []
    current_date = start_date

    for _ in range(n_days):
        dow    = current_date.dayofweek          # 0=Mon … 6=Sun
        fvec   = _rebuild_feature_row(cust_history, sales_history, dow)
        X      = np.array([fvec])
        y_pred = float(max(0.0, model.predict(X)[0]))

        predictions.append({
            "date":       current_date.strftime("%Y-%m-%d"),
            "day_name":   current_date.strftime("%A"),
            "predicted":  round(y_pred, 1),
            "dow":        dow,
        })

        # Advance buffers (use prediction as synthetic actual for next step)
        cust_history.append(y_pred)
        sales_history.append(y_pred * (sales_history[-1] / cust_history[-2]
                              if len(cust_history) > 1 and cust_history[-2] > 0 else 12.0))
        current_date += pd.Timedelta(days=1)

    # ---- Peak day -------------------------------------------------------
    peak = max(predictions, key=lambda p: p["predicted"])

    # ---- HIGH demand vs day-of-week history notification ----------------
    pred_avg    = float(np.mean([p["predicted"] for p in predictions]))
    hist_avg    = float(np.mean(list(dow_avgs.values()))) if dow_avgs else pred_avg
    if hist_avg > 0 and pred_avg > 1.25 * hist_avg:
        extra = _math.ceil((pred_avg - hist_avg) / 40)
        push_notification(
            g.session,
            f"📈 HIGH demand forecast: predicted avg {round(pred_avg,1)} is "
            f"{round(pred_avg/hist_avg*100-100,0):.0f}% above historical day-of-week avg. "
            f"Consider +{extra} extra worker(s).",
            "warning",
        )

    # ---- Time-slot distribution ----------------------------------------
    peak_forecast     = peak["predicted"]
    time_slot_info    = g.session.get("time_slot_info", [])
    has_time_slot     = g.session.get("has_time_slot", False)

    if has_time_slot and time_slot_info:
        # Use per-slot predicted customers (peak_forecast distributed by weight)
        # workers_needed per slot is the direct demand requirement for that slot —
        # this is the value the scheduling engine uses as its authoritative target.
        time_slots = [
            {
                "slot":                s["slot"],
                "predicted_customers": round(peak_forecast * s["weight"], 1),
                "workers_needed":      _math.ceil(peak_forecast * s["weight"] / 40),
                "weight":              s["weight"],
            }
            for s in time_slot_info
        ]
    else:
        time_slots = [{
            "slot":                "All Hours",
            "predicted_customers": round(peak_forecast, 1),
            "workers_needed":      _math.ceil(peak_forecast / 40),
            "weight":              1.0,
        }]

    # ---- Store forecast in session for Phase 6 -------------------------
    g.session["forecast"]        = predictions
    g.session["peak_forecast"]   = peak_forecast
    g.session["time_slots"]      = time_slots
    g.session["forecast_label"]  = (
        f"{predictions[0]['date']}" if n_days == 1
        else f"{predictions[0]['date']} → {predictions[-1]['date']}"
    )
    State_pipeline_label = f"{len(predictions)}-day forecast ready"
    g.session["pipeline_forecast"] = True

    return jsonify({
        "status":       "ok",
        "label":        g.session["forecast_label"],
        "predictions":  predictions,
        "peak_day":     peak,
        "lookback_14":  lookback_14,
        "time_slots":   time_slots,
        "has_time_slot": has_time_slot,
        "model_type":   model_type,
    })


from scheduler import generate_shifts as _generate_shifts


DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _dow_avg_workers(csv_path: str) -> list[dict]:
    """
    Average workers per day-of-week from the active CSV.
    W_day = Sum(Workers for Day) / Count(Rows for Day)
    Returns a list of 7 dicts (Mon..Sun), 0 if no rows exist for that day.
    """
    try:
        df = pd.read_csv(csv_path)
    except Exception:
        return [{"dow": i, "day_name": DAY_NAMES_FULL[i], "avg_workers": 0} for i in range(7)]

    if "Day" not in df.columns or "Workers" not in df.columns:
        return [{"dow": i, "day_name": DAY_NAMES_FULL[i], "avg_workers": 0} for i in range(7)]

    df["Workers"] = pd.to_numeric(df["Workers"], errors="coerce")
    grouped = df.groupby("Day")["Workers"].mean()

    return [
        {
            "dow":         i,
            "day_name":    DAY_NAMES_FULL[i],
            "avg_workers": math.ceil(float(grouped.get(i, 0.0))) if i in grouped.index else 0,
        }
        for i in range(7)
    ]


@app.route("/calculate", methods=["POST"])
@rate_limit(max_calls=30, window=60)
def calculate():
    # ---- Require a completed forecast in session ----------------------
    forecast = g.session.get("forecast")
    if not forecast:
        return jsonify({"error": "No forecast found. Run /predict first."}), 400

    # ---- Parse request body ------------------------------------------
    body           = request.get_json(silent=True) or {}
    predicted_customers = float(
        body.get("predicted_customers") or g.session.get("peak_forecast") or 40
    )
    hourly_wage    = float(body.get("hourly_wage",  15.0))
    shift_hours    = float(body.get("shift_hours",   8.0))

    # Clamp to sensible ranges
    predicted_customers = max(1.0, min(predicted_customers, 10_000))
    hourly_wage         = max(1.0,  min(hourly_wage, 500.0))
    shift_hours         = max(1.0,  min(shift_hours,  24.0))

    # ---- Time-slot context (demand-driven) ------------------------------
    # slot_data carries per-slot workers_needed — the sole source of truth
    # for the scheduling engine. The old ceil(customers/40) formula is removed.
    has_time_slot = g.session.get("has_time_slot", False)
    raw_slots     = g.session.get("time_slots")

    if raw_slots:
        slot_data = raw_slots
    else:
        # No forecast run yet — synthesise a single aggregate slot
        slot_data = [{
            "slot":          "09:00 AM - 05:00 PM",
            "workers_needed": math.ceil(predicted_customers / 40),
            "weight":        1.0,
        }]

    # Peak workers_needed across all slots (used for KPI summary + fallback)
    workers_needed = max(
        (int(s.get("workers_needed", 0)) for s in slot_data),
        default=math.ceil(predicted_customers / 40),
    )

    # ---- Generate shifts (demand-driven) ---------------------------------
    shifts = _generate_shifts(
        workers_needed=workers_needed,
        shift_hours=shift_hours,
        slot_data=slot_data,
    )

    if not shifts:
        return jsonify({"error": "Shift generation produced no results."}), 500

    # ---- Cost calculation --------------------------------------------
    total_shift_hours  = sum(s["total_hours"] for s in shifts)
    avg_shift_hours    = total_shift_hours / len(shifts)
    total_labor_cost   = round(total_shift_hours * hourly_wage, 2)
    cost_per_worker    = round(total_labor_cost / len(shifts), 2)

    # Badge reflects the *requested* shift_hours (not avg, which is skewed
    # by the fractional last worker in slot-anchored schedules)
    from scheduler import insight_badge
    primary_badge = insight_badge(shift_hours)

    # ---- Historical average workers per day-of-week ----------------------
    csv_path        = g.session.get("csv_path")
    dow_avg_workers = _dow_avg_workers(csv_path) if csv_path else \
        [{"dow": i, "day_name": DAY_NAMES_FULL[i], "avg_workers": 0} for i in range(7)]

    result = {
        "status":           "ok",
        "shifts":           shifts,
        "workers_needed":   len(shifts),
        "predicted_customers": round(predicted_customers, 1),
        "total_labor_cost": total_labor_cost,
        "cost_per_worker":  cost_per_worker,
        "total_shift_hours": round(total_shift_hours, 2),
        "avg_shift_hours":  round(avg_shift_hours, 2),
        "hourly_wage":      hourly_wage,
        "shift_hours":      shift_hours,
        "primary_badge":    primary_badge,
        "dow_avg_workers":  dow_avg_workers,
    }

    # ---- Persist in session for Phase 7 ------------------------------
    g.session["schedule"]     = result
    g.session["cost_summary"] = {
        "total_labor_cost": total_labor_cost,
        "cost_per_worker":  cost_per_worker,
        "workers_needed":   len(shifts),
        "hourly_wage":      hourly_wage,
        "dow_avg_workers":  dow_avg_workers,
    }
    g.session["pipeline_schedule"] = True

    push_notification(g.session,
        f"Schedule generated — {len(shifts)} workers, "
        f"${total_labor_cost:,.2f} estimated labor cost.",
        "success")

    return jsonify(result)

# ---------------------------------------------------------------------------
# /optimize_cost — Phase 7
# ---------------------------------------------------------------------------
@app.route("/optimize_cost", methods=["POST"])
@rate_limit(max_calls=30, window=60)
def optimize_cost():
    body = request.get_json(silent=True) or {}

    # Pull from body; fall back to session schedule if available
    schedule = g.session.get("schedule") or {}
    cost_sum  = g.session.get("cost_summary") or {}

    if not schedule:
        return jsonify({"error": "No schedule found. Run /calculate first."}), 400

    predicted_workers = float(body.get("predicted_workers")
                              or schedule.get("workers_needed") or 3)
    actual_workers    = float(body.get("actual_workers")
                              or cost_sum.get("actual_workers") or predicted_workers * 1.15)
    hourly_wage       = float(body.get("hourly_wage")
                              or schedule.get("hourly_wage") or cost_sum.get("hourly_wage") or 15.0)
    shift_hours       = float(body.get("shift_hours")
                              or schedule.get("shift_hours") or 8.0)

    # Clamp
    predicted_workers = max(1, min(predicted_workers, 10_000))
    actual_workers    = max(1, min(actual_workers,    10_000))
    hourly_wage       = max(1, min(hourly_wage,       500.0))
    shift_hours       = max(1, min(shift_hours,        24.0))

    # ---- Strict baseline -------------------------------------------------
    # Predicted Labor Cost is NOT recalculated here — it is taken verbatim
    # from the generated schedule's "Est. Labor Cost" (total_labor_cost).
    predicted_cost = float(schedule.get("total_labor_cost", 0.0))
    actual_cost    = round(actual_workers * shift_hours * hourly_wage, 2)
    savings        = round(actual_cost - predicted_cost, 2)
    savings_pct    = round((savings / actual_cost) * 100, 2) if actual_cost > 0 else 0.0
    direction      = "positive" if savings >= 0 else "negative"

    dow_avg_workers = schedule.get("dow_avg_workers") or cost_sum.get("dow_avg_workers")

    # Store in session for display persistence
    g.session["cost_optimization"] = {
        "predicted_workers": predicted_workers,
        "actual_workers":    actual_workers,
        "predicted_cost":    predicted_cost,
        "actual_cost":       actual_cost,
        "savings":           savings,
        "savings_pct":       savings_pct,
        "savings_direction": direction,
        "hourly_wage":       hourly_wage,
        "shift_hours":       shift_hours,
    }
    g.session["pipeline_cost"] = True

    push_notification(g.session,
        f"💰 Cost analysis: predicted ${predicted_cost:,.2f} vs actual ${actual_cost:,.2f} "
        f"({'saves' if savings >= 0 else 'over-budget by'} ${abs(savings):,.2f}).",
        "success" if savings >= 0 else "warning")

    return jsonify({
        "status":            "ok",
        "predicted_workers": predicted_workers,
        "actual_workers":    actual_workers,
        "predicted_cost":    predicted_cost,
        "actual_cost":       actual_cost,
        "savings":           savings,
        "savings_direction": direction,
        "savings_pct":       savings_pct,
        "hourly_wage":       hourly_wage,
        "shift_hours":       shift_hours,
        "dow_avg_workers":   dow_avg_workers,
    })


# ---------------------------------------------------------------------------
# /adjust_workers — Phase 7
# ---------------------------------------------------------------------------
@app.route("/adjust_workers", methods=["POST"])
@rate_limit(max_calls=60, window=60)
def adjust_workers():
    body = request.get_json(silent=True) or {}

    scheduled_workers = int(float(body.get("scheduled_workers") or 1))
    actual_customers  = float(body.get("actual_customers") or 0)

    scheduled_workers = max(1, min(scheduled_workers, 10_000))
    actual_customers  = max(0, min(actual_customers,  100_000))

    required = math.ceil(actual_customers / 40) if actual_customers > 0 else scheduled_workers
    extra    = required - scheduled_workers

    if extra > 0:
        status  = "high_demand"
        message = (f"Demand spike! Call {extra} extra worker"
                   f"{'s' if extra != 1 else ''} immediately.")
        push_notification(g.session,
            f"🚨 High demand alert: {actual_customers:.0f} customers requires "
            f"{required} workers — schedule {extra} more now.",
            "warning")
    elif extra < 0:
        status  = "over_staffed"
        message = (f"You can release {abs(extra)} worker"
                   f"{'s' if abs(extra) != 1 else ''}.")
    else:
        status  = "optimal"
        message = "Within planned workforce capacity."

    return jsonify({
        "status":               status,
        "scheduled_workers":    scheduled_workers,
        "required_workers":     required,
        "extra_workers_needed": extra,
        "actual_customers":     actual_customers,
        "message":              message,
    })


# ---------------------------------------------------------------------------
# /history — Phase 8
# ---------------------------------------------------------------------------
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_SHORT  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@app.route("/history", methods=["GET"])
@rate_limit(max_calls=30, window=60)
def history():
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data found. Please upload a CSV first."}), 400

    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data: {exc}"}), 500

    df = df.sort_values("Date").reset_index(drop=True)
    df["DOW"] = df["Date"].dt.dayofweek   # 0=Mon … 6=Sun

    # ── Summary ──────────────────────────────────────────────────────
    peak_idx      = int(df["Customers"].idxmax())
    peak_row      = df.iloc[peak_idx]
    summary = {
        "total_rows":    len(df),
        "date_range":    f"{df['Date'].min().strftime('%Y-%m-%d')} → {df['Date'].max().strftime('%Y-%m-%d')}",
        "avg_customers": round(float(df["Customers"].mean()), 1),
        "avg_workers":   math.ceil(float(df["Workers"].mean())),
        "peak_customers": int(peak_row["Customers"]),
        "peak_day":       peak_row["Date"].strftime("%Y-%m-%d"),
        "total_sales":    round(float(df["Sales"].sum()), 2),
    }

    # ── Day-of-week averages ─────────────────────────────────────────
    dow_agg = (
        df.groupby("DOW")
          .agg(avg_customers=("Customers", "mean"),
               avg_workers=("Workers", "mean"))
          .reset_index()
    )
    dow_averages = []
    for dow_i in range(7):
        row = dow_agg[dow_agg["DOW"] == dow_i]
        dow_averages.append({
            "dow":           dow_i,
            "day_name":      DAY_NAMES[dow_i],
            "day_short":     DAY_SHORT[dow_i],
            "avg_customers": round(float(row["avg_customers"].iloc[0]), 1) if len(row) else 0.0,
            "avg_workers":   math.ceil(float(row["avg_workers"].iloc[0]))   if len(row) else 0,
        })

    # ── Row data (capped at 500 rows for payload size) ────────────────
    has_ts = g.session.get("has_time_slot", False)
    rows   = []
    for _, r in df.head(500).iterrows():
        entry = {
            "date":      r["Date"].strftime("%Y-%m-%d"),
            "day":       DAY_SHORT[int(r["DOW"])],
            "customers": int(r["Customers"]),
            "workers":   int(r["Workers"]),
            "sales":     round(float(r["Sales"]), 2),
        }
        if has_ts and "Time Slot" in df.columns:
            entry["time_slot"] = str(r.get("Time Slot", ""))
        rows.append(entry)

    # ── Heatmap data ─────────────────────────────────────────────────
    # Rows = time slots (or "All Hours"), Cols = Mon–Sun
    heatmap_slots  = []
    heatmap_values = []   # list of {slot, dow, value}

    if has_ts and "Time Slot" in df.columns:
        slots = [s for s in df["Time Slot"].dropna().unique() if str(s) != "nan"]
        slots = sorted(slots)
        heatmap_slots = list(slots)

        for dow_i in range(7):
            day_df = df[df["DOW"] == dow_i]
            if day_df.empty:
                for slot in slots:
                    heatmap_values.append({"slot": slot, "dow": dow_i, "value": 0.0})
                continue

            day_avg  = float(day_df["Customers"].mean())
            slot_agg = (
                day_df.groupby("Time Slot")["Customers"]
                .mean()
                .to_dict()
            )
            slot_sum = sum(slot_agg.get(s, 0.0) for s in slots)
            for slot in slots:
                slot_avg = slot_agg.get(slot, 0.0)
                weight   = (slot_avg / slot_sum) if slot_sum > 0 else (1.0 / len(slots))
                value    = round(day_avg * weight, 1)
                heatmap_values.append({"slot": slot, "dow": dow_i, "value": value})
    else:
        heatmap_slots = ["All Hours"]
        for dow_i in range(7):
            day_df = df[df["DOW"] == dow_i]
            value  = round(float(day_df["Customers"].mean()), 1) if not day_df.empty else 0.0
            heatmap_values.append({"slot": "All Hours", "dow": dow_i, "value": value})

    return jsonify({
        "status":       "ok",
        "summary":      summary,
        "dow_averages": dow_averages,
        "rows":         rows,
        "heatmap": {
            "slots":  heatmap_slots,
            "values": heatmap_values,
        },
        "has_time_slot": has_ts,
    })


# ---------------------------------------------------------------------------
# /weekly_trend — Phase 8
# ---------------------------------------------------------------------------
@app.route("/weekly_trend", methods=["GET"])
@rate_limit(max_calls=30, window=60)
def weekly_trend():
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data found."}), 400

    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data: {exc}"}), 500

    df = df.sort_values("Date").reset_index(drop=True)
    df["ISO_Week"] = df["Date"].dt.to_period("W").apply(lambda p: str(p.start_time.date()))

    weekly = (
        df.groupby("ISO_Week")
          .agg(avg_customers=("Customers", "mean"),
               avg_workers=("Workers", "mean"),
               row_count=("Customers", "count"))
          .reset_index()
          .sort_values("ISO_Week")
    )

    weeks = [
        {
            "week_start":    row["ISO_Week"],
            "avg_customers": round(float(row["avg_customers"]), 1),
            "avg_workers":   math.ceil(float(row["avg_workers"])),
            "row_count":     int(row["row_count"]),
        }
        for _, row in weekly.iterrows()
    ]

    return jsonify({
        "status": "ok",
        "weeks":  weeks,
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    debug = bool(os.environ.get("FLASK_DEBUG", False))
    app.run(debug=debug, host="0.0.0.0", port=5000)
