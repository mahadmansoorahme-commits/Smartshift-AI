"""
routes/schedule.py
/calculate  — Shift generation and scheduling.
/adjust_workers  — Real-time staffing adjustment.
"""

import math
from pathlib import Path

import pandas as pd
from flask import Blueprint, g, jsonify, request

from config import DAY_NAMES
from core.auth import require_auth
from core.scheduler import generate_shifts, insight_badge
from core.sessions import push_notification, rate_limit

schedule_bp = Blueprint("schedule", __name__)


def _dow_avg_workers(csv_path: str) -> list[dict]:
    """Average workers per day-of-week from the session's CSV."""
    try:
        df = pd.read_csv(csv_path)
    except Exception:
        return [{"dow": i, "day_name": DAY_NAMES[i], "avg_workers": 0} for i in range(7)]

    if "Day" not in df.columns or "Workers" not in df.columns:
        return [{"dow": i, "day_name": DAY_NAMES[i], "avg_workers": 0} for i in range(7)]

    df["Workers"] = pd.to_numeric(df["Workers"], errors="coerce")
    grouped = df.groupby("Day")["Workers"].mean()
    return [
        {
            "dow":         i,
            "day_name":    DAY_NAMES[i],
            "avg_workers": math.ceil(float(grouped.get(i, 0.0))) if i in grouped.index else 0,
        }
        for i in range(7)
    ]


@schedule_bp.route("/calculate", methods=["POST"])
@require_auth
@rate_limit(max_calls=30, window=60)
def calculate():
    forecast = g.session.get("forecast")
    if not forecast:
        return jsonify({"error": "No forecast found. Run /predict first."}), 400

    body = request.get_json(silent=True) or {}
    predicted_customers = float(
        body.get("predicted_customers") or g.session.get("peak_forecast") or 40
    )
    hourly_wage = float(body.get("hourly_wage", 15.0))
    shift_hours = float(body.get("shift_hours", 8.0))

    predicted_customers = max(1.0, min(predicted_customers, 10_000))
    hourly_wage         = max(1.0, min(hourly_wage, 500.0))
    shift_hours         = max(1.0, min(shift_hours, 24.0))

    raw_slots = g.session.get("time_slots")
    slot_data = raw_slots or [{
        "slot":          "09:00 AM - 05:00 PM",
        "workers_needed": math.ceil(predicted_customers / 40),
        "weight":        1.0,
    }]

    workers_needed = max(
        (int(s.get("workers_needed", 0)) for s in slot_data),
        default=math.ceil(predicted_customers / 40),
    )

    shifts = generate_shifts(
        workers_needed=workers_needed,
        shift_hours=shift_hours,
        slot_data=slot_data,
    )
    if not shifts:
        return jsonify({"error": "Shift generation produced no results."}), 500

    total_shift_hours = sum(s["total_hours"] for s in shifts)
    total_labor_cost  = round(total_shift_hours * hourly_wage, 2)
    cost_per_worker   = round(total_labor_cost / len(shifts), 2)
    avg_shift_hours   = total_shift_hours / len(shifts)
    primary_badge     = insight_badge(shift_hours)

    csv_path        = g.session.get("csv_path")
    dow_avg_workers = _dow_avg_workers(csv_path) if csv_path else \
        [{"dow": i, "day_name": DAY_NAMES[i], "avg_workers": 0} for i in range(7)]

    result = {
        "status":              "ok",
        "shifts":              shifts,
        "workers_needed":      len(shifts),
        "predicted_customers": round(predicted_customers, 1),
        "total_labor_cost":    total_labor_cost,
        "cost_per_worker":     cost_per_worker,
        "total_shift_hours":   round(total_shift_hours, 2),
        "avg_shift_hours":     round(avg_shift_hours, 2),
        "hourly_wage":         hourly_wage,
        "shift_hours":         shift_hours,
        "primary_badge":       primary_badge,
        "dow_avg_workers":     dow_avg_workers,
    }

    g.session["schedule"]     = result
    g.session["cost_summary"] = {
        "total_labor_cost": total_labor_cost,
        "cost_per_worker":  cost_per_worker,
        "workers_needed":   len(shifts),
        "hourly_wage":      hourly_wage,
        "dow_avg_workers":  dow_avg_workers,
    }

    push_notification(
        g.session,
        f"Schedule generated — {len(shifts)} workers, ${total_labor_cost:,.2f} estimated labor cost.",
        "success",
    )
    return jsonify(result)


@schedule_bp.route("/adjust_workers", methods=["POST"])
@require_auth
@rate_limit(max_calls=60, window=60)
def adjust_workers():
    body = request.get_json(silent=True) or {}
    scheduled_workers = int(float(body.get("scheduled_workers") or 1))
    actual_customers  = float(body.get("actual_customers") or 0)

    scheduled_workers = max(1, min(scheduled_workers, 10_000))
    actual_customers  = max(0, min(actual_customers, 100_000))

    required = math.ceil(actual_customers / 40) if actual_customers > 0 else scheduled_workers
    extra    = required - scheduled_workers

    if extra > 0:
        status  = "high_demand"
        message = f"Demand spike! Call {extra} extra worker{'s' if extra != 1 else ''} immediately."
        push_notification(
            g.session,
            f"🚨 High demand alert: {actual_customers:.0f} customers requires "
            f"{required} workers — schedule {extra} more now.",
            "warning",
        )
    elif extra < 0:
        status  = "over_staffed"
        message = f"You can release {abs(extra)} worker{'s' if abs(extra) != 1 else ''}."
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
