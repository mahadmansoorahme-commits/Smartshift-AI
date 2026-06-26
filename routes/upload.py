"""
routes/upload.py
/upload  — CSV ingestion, validation, cleaning, and session storage.
"""

import hashlib
import math
import tempfile
from pathlib import Path

import pandas as pd
from flask import Blueprint, g, jsonify, request

from config import REQUIRED_COLS, TEMP_DIR
from core.auth import require_auth
from core.features import parse_day
from core.scheduler import parse_slot
from core.sessions import push_notification, rate_limit

upload_bp = Blueprint("upload", __name__)


@upload_bp.route("/upload", methods=["POST"])
@require_auth
@rate_limit(max_calls=20, window=60)
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file part in request."}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "No file selected."}), 400
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv files are accepted."}), 415

    try:
        df = pd.read_csv(file)
    except Exception as exc:
        return jsonify({"error": f"Could not parse CSV: {exc}"}), 422

    df.columns = [c.strip() for c in df.columns]

    missing = REQUIRED_COLS - set(df.columns)
    if missing:
        return jsonify({"error": f"Missing required columns: {', '.join(sorted(missing))}"}), 422

    for col in ("Customers", "Sales", "Workers"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Date", "Customers", "Sales", "Workers"])

    if df.empty:
        return jsonify({"error": "No valid rows remain after cleaning."}), 422

    try:
        df["Date"] = pd.to_datetime(df["Date"])
    except Exception:
        return jsonify({"error": "Could not parse Date column. Use YYYY-MM-DD."}), 422

    df["Day"] = df["Day"].apply(parse_day)
    df = df.dropna(subset=["Day"])
    df["Day"] = df["Day"].astype(int)

    if df.empty:
        return jsonify({"error": "No valid rows after Day parsing. Use Mon–Sun or 0–6."}), 422

    # ---- Time Slot processing -----------------------------------------------
    has_time_slot  = "Time Slot" in df.columns
    time_slot_info = []
    total_business_hours = 12.0

    if has_time_slot:
        df["Time Slot"] = df["Time Slot"].astype(str).str.strip()
        slot_agg = (
            df.groupby("Time Slot")
              .agg(
                  slot_avg_customers=("Customers", "mean"),
                  slot_avg_workers=("Workers", "mean"),
                  slot_count=("Customers", "count"),
              )
              .reset_index()
        )
        slot_total = float(slot_agg["slot_avg_customers"].sum())
        n_slots    = len(slot_agg)
        slot_agg["weight"] = (
            slot_agg["slot_avg_customers"] / slot_total if slot_total > 0 else 1.0 / n_slots
        )

        def _slot_key(s):
            parsed = parse_slot(s)
            return parsed[0] if parsed else float("inf")

        slot_agg = slot_agg.iloc[slot_agg["Time Slot"].map(_slot_key).argsort().values].reset_index(drop=True)
        time_slot_info = [
            {
                "slot":          row["Time Slot"],
                "avg_customers": round(float(row["slot_avg_customers"]), 2),
                "avg_workers":   math.ceil(float(row["slot_avg_workers"])),
                "weight":        round(float(row["weight"]), 4),
                "count":         int(row["slot_count"]),
            }
            for _, row in slot_agg.iterrows()
        ]
        spans = [parse_slot(s) for s in slot_agg["Time Slot"]]
        spans = [sp for sp in spans if sp is not None]
        if spans:
            total_business_hours = round(max(sp[1] for sp in spans) - min(sp[0] for sp in spans), 2)

    # ---- Delete previous temp CSV -------------------------------------------
    prev = g.session.get("csv_path")
    if prev and Path(prev).exists():
        try:
            Path(prev).unlink()
        except OSError:
            pass

    # ---- Persist to temp file -----------------------------------------------
    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=".csv", dir=TEMP_DIR, prefix=f"ss_{g.uid[:8]}_"
    )
    df.to_csv(tmp.name, index=False)
    tmp.close()

    etag = hashlib.md5(Path(tmp.name).read_bytes()).hexdigest()

    g.session.update({
        "csv_path":            tmp.name,
        "csv_etag":            etag,
        "model_etag":          None,
        "has_time_slot":       has_time_slot,
        "time_slot_info":      time_slot_info,
        "total_business_hours": total_business_hours,
        "forecast":            None,
        "schedule":            None,
        "cost_summary":        None,
    })

    date_min      = df["Date"].min().strftime("%Y-%m-%d")
    date_max      = df["Date"].max().strftime("%Y-%m-%d")
    avg_customers = round(float(df["Customers"].mean()), 1)
    avg_workers   = math.ceil(float(df["Workers"].mean()))
    row_count     = len(df)

    push_notification(g.session, f"CSV uploaded: {row_count} rows, {date_min} → {date_max}", "success")

    # ---- Preview (first 8 rows) ----------------------------------------------
    preview_cols = ["Date", "Day", "Customers", "Sales", "Workers"]
    if has_time_slot:
        preview_cols.append("Time Slot")

    def _fmt(x):
        if hasattr(x, "strftime"):
            return x.strftime("%Y-%m-%d")
        if isinstance(x, float):
            return round(x, 1)
        return str(x)

    preview_rows = df[preview_cols].head(8).apply(lambda col: col.map(_fmt)).values.tolist()

    return jsonify({
        "status":               "ok",
        "row_count":            row_count,
        "date_range":           f"{date_min} → {date_max}",
        "date_min":             date_min,
        "date_max":             date_max,
        "avg_customers":        avg_customers,
        "avg_workers":          avg_workers,
        "has_time_slot":        has_time_slot,
        "time_slot_info":       time_slot_info,
        "total_business_hours": total_business_hours,
        "csv_etag":             etag,
        "preview_cols":         preview_cols,
        "preview_rows":         preview_rows,
    })
