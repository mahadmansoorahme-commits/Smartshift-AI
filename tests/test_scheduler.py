"""Unit tests for core/scheduler.py — shift generation and insight badges."""
import os
os.environ.setdefault('FLASK_DEBUG', '1')

import pytest
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.scheduler import generate_shifts, insight_badge


class TestGenerateShifts:
    def test_returns_list(self):
        shifts = generate_shifts(workers_needed=3, shift_hours=8.0)
        assert isinstance(shifts, list)

    def test_worker_count_matches(self):
        for n in (1, 3, 5, 10):
            shifts = generate_shifts(workers_needed=n, shift_hours=8.0)
            assert len(shifts) == n

    def test_shift_fields_present(self):
        shifts = generate_shifts(workers_needed=2, shift_hours=8.0)
        required = {'worker_id', 'classification', 'start_time', 'end_time', 'total_hours', 'badge'}
        for s in shifts:
            assert required.issubset(s.keys()), f"Missing keys: {required - s.keys()}"

    def test_classification_valid(self):
        valid = {'Morning', 'Afternoon', 'Evening'}
        shifts = generate_shifts(workers_needed=6, shift_hours=8.0)
        for s in shifts:
            assert s['classification'] in valid

    def test_total_hours_matches_param(self):
        for h in (4.0, 6.0, 8.0, 10.0):
            shifts = generate_shifts(workers_needed=3, shift_hours=h)
            for s in shifts:
                assert s['total_hours'] == h

    def test_one_worker_minimum(self):
        shifts = generate_shifts(workers_needed=1, shift_hours=8.0)
        assert len(shifts) >= 1


class TestInsightBadge:
    def test_returns_dict_with_level_and_label(self):
        badge = insight_badge(shift_hours=8)
        assert 'level' in badge and 'label' in badge

    def test_short_shift_is_danger(self):
        badge = insight_badge(shift_hours=3)
        assert badge['level'] == 'danger'

    def test_long_shift_is_success(self):
        badge = insight_badge(shift_hours=8)
        assert badge['level'] == 'success'
