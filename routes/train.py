"""
routes/train.py
/train  — Feature engineering, model selection, training, evaluation.
"""

from pathlib import Path

import pandas as pd
from flask import Blueprint, g, jsonify

from core.auth import require_auth
from core.persistence import SupabaseError, hydrate_csv, save_model
from core.sessions import push_notification, rate_limit
from core.trainer import csv_etag, train as _train

train_bp = Blueprint("train", __name__)


@train_bp.route("/train", methods=["POST"])
@require_auth
@rate_limit(max_calls=5, window=60)
def train():
    hydrate_csv(g.session, g.uid, g.token)
    csv_path = g.session.get("csv_path")
    if not csv_path or not Path(csv_path).exists():
        return jsonify({"error": "No uploaded data found. Please upload a CSV first."}), 400

    # ETag cache — skip retraining if data hasn't changed
    current_etag = csv_etag(csv_path)
    if g.session.get("model_etag") == current_etag:
        cached = g.session.get("train_result")
        if cached:
            return jsonify({**cached, "cached": True}), 200

    try:
        df = pd.read_csv(csv_path, parse_dates=["Date"])
    except Exception as exc:
        return jsonify({"error": f"Could not read data file: {exc}"}), 500

    try:
        result = _train(df, g.uid)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 422

    g.session["model_etag"]   = current_etag
    g.session["train_result"] = result
    g.session["model_type"]   = result["model_type"]
    g.session["model_path"]   = result["model_path"]

    if g.token:
        try:
            model_bytes = Path(result["model_path"]).read_bytes()
            save_model(g.uid, g.token, model_bytes, result)
        except SupabaseError as exc:
            return jsonify({"error": f"Model trained but could not be saved: {exc}"}), 502

    push_notification(
        g.session,
        f"Model trained — {result['model_type']}, {result['accuracy']}% accuracy on test set.",
        "success",
    )

    return jsonify(result)
