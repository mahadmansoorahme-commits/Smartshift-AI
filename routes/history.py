"""
routes/history.py
/history  — Historical analytics, heatmap, day-of-week breakdown.
/weekly_trend  — Weekly aggregated trend data.
"""

import math
from pathlib import Path

import pandas as pd
from flask import Blueprint, g, jsonify

from config import DAY_NAMES, DAY_SHORT
from core.auth import require_auth
from core.sessions import rate_limit

history_bp = Blueprint("history", __name__)


@history_bp.route("/history", methods=["GET", "POST"])
@require_auth
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
    df["DOW"] = df["Date"].dt.dayofweek

    peak_row = df.iloc[int(df["Customers"].idxmax())]
    summary  = {
        "total_rows":     len(df),
        "date_range":     f"{df['Date'].min().strftime('%Y-%m-%d')} → {df['Date'].max().strftime('%Y-%m-%d')}",
        "avg_customers":  round(float(df["Customers"].mean()), 1),
        "avg_workers":    math.ceil(float(df["Workers"].mean())),
        "peak_customers": int(peak_row["Customers"]),
        "peak_day":       peak_row["Date"].strftime("%Y-%m-%d"),
        "total_sales":    round(float(df["Sales"].sum()), 2),
    }

    dow_agg = (
        df.groupby("DOW")
          .agg(avg_customers=("Customers", "mean"), avg_workers=("Workers", "mean"))
          .reset_index()
    )
    dow_averages = []
    for i in range(7):
        row = dow_agg[dow_agg["DOW"] == i]
        dow_averages.append({
            "dow":           i,
            "day_name":      DAY_NAMES[i],
            "day_short":     DAY_SHORT[i],
            "avg_customers": round(float(row["avg_customers"].iloc[0]), 1) if len(row) else 0.0,
            "avg_workers":   math.ceil(float(row["avg_workers"].iloc[0]))   if len(row) else 0,
        })

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

    # Heatmap: rows = time slots, cols = Mon–Sun
    heatmap_slots  = []
    heatmap_values = []

    if has_ts and "Time Slot" in df.columns:
        slots = sorted(s for s in df["Time Slot"].dropna().unique() if str(s) != "nan")
        heatmap_slots = list(slots)
        for dow_i in range(7):
            day_df = df[df["DOW"] == dow_i]
            if day_df.empty:
                for slot in slots:
                    heatmap_values.append({"slot": slot, "dow": dow_i, "value": 0.0})
                continue
            day_avg  = float(day_df["Customers"].mean())
            slot_agg = day_df.groupby("Time Slot")["Customers"].mean().to_dict()
            slot_sum = sum(slot_agg.get(s, 0.0) for s in slots)
            for slot in slots:
                slot_avg = slot_agg.get(slot, 0.0)
                weight   = (slot_avg / slot_sum) if slot_sum > 0 else (1.0 / len(slots))
                heatmap_values.append({"slot": slot, "dow": dow_i, "value": round(day_avg * weight, 1)})
    else:
        heatmap_slots = ["All Hours"]
        for dow_i in range(7):
            day_df = df[df["DOW"] == dow_i]
            value  = round(float(day_df["Customers"].mean()), 1) if not day_df.empty else 0.0
            heatmap_values.append({"slot": "All Hours", "dow": dow_i, "value": value})

    # weekly_data field — used by dashboard mini chart
    weekly_data = [
        {"date": r["Date"].strftime("%Y-%m-%d"), "customers": int(r["Customers"])}
        for _, r in df.iterrows()
    ]

    return jsonify({
        "status":        "ok",
        "summary":       summary,
        "dow_averages":  dow_averages,
        "rows":          rows,
        "heatmap":       {"slots": heatmap_slots, "values": heatmap_values},
        "has_time_slot": has_ts,
        "weekly_data":   weekly_data,
    })


@history_bp.route("/weekly_trend", methods=["GET"])
@require_auth
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

    return jsonify({"status": "ok", "weeks": weeks})
