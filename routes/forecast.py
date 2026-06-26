"""
routes/forecast.py
/predict (/forecast_range)  — Multi-step demand forecasting with spike detection.
"""

import math
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Blueprint, g, jsonify, request

from core.auth import require_auth
from core.features import rebuild_feature_row
from core.sessions import push_notification, rate_limit
from core.trainer import load_model_bundle

forecast_bp = Blueprint("forecast", __name__)


@forecast_bp.route("/predict",         methods=["POST"])
@forecast_bp.route("/forecast_range",  methods=["POST"])
@require_auth
@rate_limit(max_calls=20, window=60)
def predict():
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data. Please upload a CSV first."}), 400

    try:
        model, feature_cols, model_type = load_model_bundle(g.session.get("model_path"))
    except FileNotFoundError:
        return jsonify({"error": "No trained model found. Please train the model first."}), 400

    body            = request.get_json(silent=True) or {}
    target_date_str = body.get("date") or body.get("target_date")
    n_days          = 1   # locked to single-day forecast; frontend handles multi-day

    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data: {exc}"}), 500

    df = df.sort_values("Date").reset_index(drop=True)

    if target_date_str:
        try:
            start_date = pd.Timestamp(target_date_str)
        except Exception:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 422
    else:
        start_date = df["Date"].max() + pd.Timedelta(days=1)

    cust_history  = list(df["Customers"].values.astype(float))
    sales_history = list(df["Sales"].values.astype(float))

    lookback_14 = [
        {"date": r["Date"].strftime("%Y-%m-%d"), "customers": round(float(r["Customers"]), 1)}
        for _, r in df.tail(14).iterrows()
    ]

    # Demand spike detection (last actual vs 7-day mean)
    recent_7    = cust_history[-7:] if len(cust_history) >= 7 else cust_history
    roll_mean7  = float(np.mean(recent_7)) if recent_7 else 0.0
    last_actual = cust_history[-1] if cust_history else 0.0
    if roll_mean7 > 0 and last_actual > 1.3 * roll_mean7:
        push_notification(
            g.session,
            f"⚠ Demand spike detected: latest actual ({round(last_actual,1)}) "
            f"is {round(last_actual/roll_mean7*100-100,0):.0f}% above 7-day mean.",
            "warning",
        )

    df["DOW"] = df["Date"].dt.dayofweek
    dow_avgs   = df.groupby("DOW")["Customers"].mean().to_dict()

    # Forecast loop
    predictions  = []
    current_date = start_date
    for _ in range(n_days):
        dow   = current_date.dayofweek
        fvec  = rebuild_feature_row(cust_history, sales_history, dow)
        y_hat = float(max(0.0, model.predict(np.array([fvec]))[0]))

        predictions.append({
            "date":      current_date.strftime("%Y-%m-%d"),
            "day_name":  current_date.strftime("%A"),
            "predicted": round(y_hat, 1),
            "dow":       dow,
        })

        cust_history.append(y_hat)
        sales_history.append(
            y_hat * (sales_history[-1] / cust_history[-2])
            if len(cust_history) > 1 and cust_history[-2] > 0 else 12.0
        )
        current_date += pd.Timedelta(days=1)

    peak = max(predictions, key=lambda p: p["predicted"])

    # High-demand notification
    pred_avg = float(np.mean([p["predicted"] for p in predictions]))
    hist_avg = float(np.mean(list(dow_avgs.values()))) if dow_avgs else pred_avg
    if hist_avg > 0 and pred_avg > 1.25 * hist_avg:
        extra = math.ceil((pred_avg - hist_avg) / 40)
        push_notification(
            g.session,
            f"📈 HIGH demand forecast: predicted avg {round(pred_avg,1)} is "
            f"{round(pred_avg/hist_avg*100-100,0):.0f}% above historical avg. "
            f"Consider +{extra} extra worker(s).",
            "warning",
        )

    peak_forecast  = peak["predicted"]
    time_slot_info = g.session.get("time_slot_info", [])
    has_time_slot  = g.session.get("has_time_slot", False)

    if has_time_slot and time_slot_info:
        time_slots = [
            {
                "slot":                s["slot"],
                "predicted_customers": round(peak_forecast * s["weight"], 1),
                "workers_needed":      math.ceil(peak_forecast * s["weight"] / 40),
                "weight":              s["weight"],
            }
            for s in time_slot_info
        ]
    else:
        time_slots = [{
            "slot":                "All Hours",
            "predicted_customers": round(peak_forecast, 1),
            "workers_needed":      math.ceil(peak_forecast / 40),
            "weight":              1.0,
        }]

    forecast_label = (
        predictions[0]["date"] if n_days == 1
        else f"{predictions[0]['date']} → {predictions[-1]['date']}"
    )

    g.session.update({
        "forecast":        predictions,
        "peak_forecast":   peak_forecast,
        "time_slots":      time_slots,
        "forecast_label":  forecast_label,
    })

    return jsonify({
        "status":         "ok",
        "label":          forecast_label,
        "predictions":    predictions,
        "peak_day":       peak,
        "lookback_14":    lookback_14,
        "time_slots":     time_slots,
        "has_time_slot":  has_time_slot,
        "model_type":     model_type,
    })
