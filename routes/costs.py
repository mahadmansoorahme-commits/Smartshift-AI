"""
routes/costs.py
/optimize_cost  — Labor cost optimisation and savings analysis.
"""

from flask import Blueprint, g, jsonify, request

from core.auth import require_auth
from core.sessions import push_notification, rate_limit

costs_bp = Blueprint("costs", __name__)


@costs_bp.route("/optimize_cost", methods=["POST"])
@require_auth
@rate_limit(max_calls=30, window=60)
def optimize_cost():
    schedule = g.session.get("schedule") or {}
    cost_sum = g.session.get("cost_summary") or {}

    if not schedule:
        return jsonify({"error": "No schedule found. Run /calculate first."}), 400

    body = request.get_json(silent=True) or {}
    predicted_workers = float(body.get("predicted_workers") or schedule.get("workers_needed") or 3)
    actual_workers    = float(body.get("actual_workers") or predicted_workers * 1.15)
    hourly_wage       = float(body.get("hourly_wage") or schedule.get("hourly_wage") or 15.0)
    shift_hours       = float(body.get("shift_hours") or schedule.get("shift_hours") or 8.0)

    predicted_workers = max(1, min(predicted_workers, 10_000))
    actual_workers    = max(1, min(actual_workers, 10_000))
    hourly_wage       = max(1, min(hourly_wage, 500.0))
    shift_hours       = max(1, min(shift_hours, 24.0))

    # Predicted cost is taken directly from the schedule (not recalculated)
    predicted_cost = float(schedule.get("total_labor_cost", 0.0))
    actual_cost    = round(actual_workers * shift_hours * hourly_wage, 2)
    savings        = round(actual_cost - predicted_cost, 2)
    savings_pct    = round((savings / actual_cost) * 100, 2) if actual_cost > 0 else 0.0
    direction      = "positive" if savings >= 0 else "negative"

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

    push_notification(
        g.session,
        f"💰 Cost analysis: predicted ${predicted_cost:,.2f} vs actual ${actual_cost:,.2f} "
        f"({'saves' if savings >= 0 else 'over-budget by'} ${abs(savings):,.2f}).",
        "success" if savings >= 0 else "warning",
    )

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
        "dow_avg_workers":   schedule.get("dow_avg_workers") or cost_sum.get("dow_avg_workers"),
    })
