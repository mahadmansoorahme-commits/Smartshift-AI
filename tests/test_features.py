"""Unit tests for core/features.py — feature engineering."""
import os
os.environ.setdefault('FLASK_DEBUG', '1')

import pandas as pd
import pytest
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.features import parse_day, build_features, rebuild_feature_row


class TestParseDay:
    def test_integer_passthrough(self):
        assert parse_day(3) == 3

    def test_string_number(self):
        assert parse_day('2') == 2

    def test_day_name_full(self):
        assert parse_day('Monday') == 0
        assert parse_day('friday') == 4
        assert parse_day('SUNDAY') == 6

    def test_day_name_abbrev(self):
        assert parse_day('Mon') == 0
        assert parse_day('Sat') == 5

    def test_invalid_returns_none(self):
        assert parse_day('NotADay') is None


class TestBuildFeatures:
    def _make_df(self, n=30):
        dates = pd.date_range('2024-01-01', periods=n)
        return pd.DataFrame({
            'Date':      dates,
            'Day':       [d.dayofweek for d in dates],   # numeric 0–6
            'Customers': [50 + i % 20 for i in range(n)],
            'Sales':     [500.0 + i * 10 for i in range(n)],
            'Workers':   [2 + i % 3 for i in range(n)],
        })

    def test_returns_tuple(self):
        df = self._make_df()
        result = build_features(df)
        assert isinstance(result, tuple) and len(result) == 2

    def test_feature_cols_count(self):
        df = self._make_df()
        _, cols = build_features(df)
        assert len(cols) == 9

    def test_no_nulls_after_build(self):
        df = self._make_df(40)
        out_df, _ = build_features(df)
        assert out_df.isnull().sum().sum() == 0

    def test_required_feature_names(self):
        df = self._make_df(40)
        _, cols = build_features(df)
        for name in ('lag1', 'lag2', 'lag7', 'rolling_mean_7', 'sin_day', 'cos_day'):
            assert name in cols, f"Missing feature: {name}"


class TestRebuildFeatureRow:
    def test_returns_array_of_9(self):
        history       = [50, 55, 60, 58, 52, 48, 70, 65, 60, 55, 50, 48, 52, 58]
        sales_history = [500.0] * 14
        row = rebuild_feature_row(history, sales_history, day_of_week=2)
        assert len(row) == 9

    def test_sin_cos_bounded(self):
        history       = [50] * 14
        sales_history = [500.0] * 14
        row = rebuild_feature_row(history, sales_history, day_of_week=0)
        sin_val, cos_val = row[6], row[7]
        assert -1.0 <= sin_val <= 1.0
        assert -1.0 <= cos_val <= 1.0
