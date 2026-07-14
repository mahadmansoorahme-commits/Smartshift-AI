"""
core/features.py
Feature engineering: 9 time-series features built from raw CSV data.
"""

import math
import numpy as np
import pandas as pd

from config import DAY_MAP, REQUIRED_COLS
from core.scheduler import parse_slot


def parse_day(val) -> int | None:
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


def build_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """
    Engineer 9 features from a cleaned DataFrame sorted by Date.

    Features:
        lag1, lag2, lag7          — lagged customer counts
        sales_lag1                — lagged sales
        rolling_mean_7            — 7-day rolling mean of lag1
        rolling_std_7             — 7-day rolling std  of lag1
        sin_day, cos_day          — cyclical day-of-week encoding
        sales_per_customer        — sales efficiency ratio

    Returns (enriched_df, feature_cols). Rows with NaN features are dropped.
    """
    d = df.sort_values("Date").copy()

    d["lag1"]       = d["Customers"].shift(1)
    d["lag2"]       = d["Customers"].shift(2)
    d["lag7"]       = d["Customers"].shift(7)
    d["sales_lag1"] = d["Sales"].shift(1)

    d["rolling_mean_7"] = d["lag1"].rolling(7, min_periods=1).mean()
    d["rolling_std_7"]  = d["lag1"].rolling(7, min_periods=1).std().fillna(0)

    d["sin_day"] = np.sin(d["Day"] * 2 * math.pi / 7)
    d["cos_day"] = np.cos(d["Day"] * 2 * math.pi / 7)

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


def rebuild_feature_row(
    history: list[float],
    sales_history: list[float],
    day_of_week: int,
) -> list[float]:
    """
    Build one 9-feature vector from rolling history buffers.
    Used by the forecasting engine for each future day.
    history[-1] is the most-recent customer count.
    """
    lag1 = history[-1]      if len(history) >= 1 else 0.0
    lag2 = history[-2]      if len(history) >= 2 else lag1
    lag7 = history[-7]      if len(history) >= 7 else lag1
    sl1  = sales_history[-1] if len(sales_history) >= 1 else 0.0
    win  = history[-7:]     if len(history) >= 7 else history

    roll_mean = float(np.mean(win)) if win else lag1
    roll_std  = float(np.std(win))  if len(win) > 1 else 0.0
    sin_d     = np.sin(day_of_week * 2 * math.pi / 7)
    cos_d     = np.cos(day_of_week * 2 * math.pi / 7)
    spc       = sl1 / lag1 if lag1 > 0 else 0.0

    return [lag1, lag2, lag7, sl1, roll_mean, roll_std, sin_d, cos_d, spc]


def compute_time_slot_info(df: pd.DataFrame) -> dict:
    """
    Aggregate per-Time-Slot stats (avg customers/workers, weight, business
    hours) from a cleaned DataFrame. This mirrors the inline logic in
    routes/upload.py's own Time Slot processing step exactly, but as a
    reusable function — used by core/persistence.py's hydrate_csv to rebuild
    has_time_slot/time_slot_info from a CSV re-downloaded from Supabase
    Storage on a container that never ran the original /upload request.

    routes/upload.py is intentionally left untouched and does not call this;
    it keeps its own inline computation.

    Returns {"has_time_slot", "time_slot_info", "total_business_hours"}.
    """
    has_time_slot = "Time Slot" in df.columns
    time_slot_info: list[dict] = []
    total_business_hours = 12.0

    if has_time_slot:
        d = df.copy()
        d["Time Slot"] = d["Time Slot"].astype(str).str.strip()
        d = d[~d["Time Slot"].str.lower().isin(["", "nan", "none", "nat"])]
        if d.empty:
            return {"has_time_slot": False, "time_slot_info": [], "total_business_hours": total_business_hours}

        slot_agg = (
            d.groupby("Time Slot")
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

    return {
        "has_time_slot":        has_time_slot,
        "time_slot_info":       time_slot_info,
        "total_business_hours": total_business_hours,
    }
