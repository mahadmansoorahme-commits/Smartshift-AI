"""
core/trainer.py
ML model selection, training, evaluation, and persistence.
"""

import hashlib
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error

from config import MODEL_DIR
from core.features import build_features


def csv_etag(csv_path: str) -> str:
    """Short hash of path + mtime — used as ETag for cache-busting."""
    p = Path(csv_path)
    raw = f"{csv_path}:{p.stat().st_mtime}"
    return hashlib.md5(raw.encode()).hexdigest()


def train(df: pd.DataFrame, uid: str) -> dict:
    """
    Train an adaptive ML model on df and persist it to MODEL_DIR.

    Selects GradientBoosting when train_size >= 60, Ridge otherwise.
    Returns a result dict ready to be JSON-serialised.
    """
    df_feat, feature_cols = build_features(df)

    if len(df_feat) < 10:
        raise ValueError(
            "Not enough rows after feature engineering (need ≥10). Upload more data."
        )

    split_idx = int(len(df_feat) * 0.8)
    train_df  = df_feat.iloc[:split_idx]
    test_df   = df_feat.iloc[split_idx:]

    X_train, y_train = train_df[feature_cols].values, train_df["Customers"].values
    X_test,  y_test  = test_df[feature_cols].values,  test_df["Customers"].values

    train_size = len(train_df)

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

    y_pred   = np.maximum(model.predict(X_test), 0)
    mae      = float(mean_absolute_error(y_test, y_pred))
    rmse     = float(np.sqrt(np.mean((y_test - y_pred) ** 2)))
    mean_act = float(np.mean(y_test)) if len(y_test) else 1.0
    accuracy = float(np.clip((1 - mae / max(mean_act, 1)) * 100, 0, 100))

    # Persist per-session model
    model_path = MODEL_DIR / f"model_{uid[:8]}.pkl"
    joblib.dump(
        {"model": model, "feature_cols": feature_cols, "model_type": model_type},
        model_path,
    )

    next_day_pred = float(max(0, model.predict(df_feat.iloc[[-1]][feature_cols].values)[0]))

    comparison_table = []
    sample = test_df.reset_index(drop=True)
    for i in range(min(20, len(sample))):
        actual    = float(sample.loc[i, "Customers"])
        predicted = float(max(0, y_pred[i]))
        err_pct   = round(abs(actual - predicted) / max(actual, 1) * 100, 1)
        comparison_table.append({
            "date":      sample.loc[i, "Date"].strftime("%Y-%m-%d"),
            "actual":    round(actual, 1),
            "predicted": round(predicted, 1),
            "error_pct": err_pct,
        })

    all_pred = np.maximum(model.predict(df_feat[feature_cols].values), 0)
    chart_series = {
        "labels":      [d.strftime("%Y-%m-%d") for d in df_feat["Date"]],
        "actual":      [round(float(v), 1) for v in df_feat["Customers"].values],
        "predicted":   [round(float(v), 1) for v in all_pred],
        "split_index": train_size,
    }

    return {
        "status":           "ok",
        "mae":              round(mae, 2),
        "rmse":             round(rmse, 2),
        "accuracy":         round(accuracy, 1),
        "model_type":       model_type,
        "train_size":       train_size,
        "test_size":        len(test_df),
        "next_day_pred":    round(next_day_pred, 1),
        "comparison_table": comparison_table,
        "chart_series":     chart_series,
        "model_path":       str(model_path),
    }


def load_model_bundle(model_path_str: str | None) -> tuple:
    """
    Load a persisted model bundle.
    Returns (model, feature_cols, model_type) or raises FileNotFoundError.
    """
    if model_path_str:
        model_path = Path(model_path_str)
    else:
        model_path = MODEL_DIR / "model.pkl"   # legacy fallback

    if not model_path.exists():
        raise FileNotFoundError("Model not trained yet.")

    bundle = joblib.load(model_path)
    return bundle["model"], bundle["feature_cols"], bundle["model_type"]
