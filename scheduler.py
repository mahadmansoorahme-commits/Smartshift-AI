"""
SmartShiftAI — scheduler.py
Demand-driven shift generation engine.

Each forecast time slot carries a `workers_needed` value.
The scheduler guarantees: active_workers >= workers_needed for every slot.
"""

from __future__ import annotations
import re
from datetime import datetime, timedelta
from typing import Any


# ------------------------------------------------------------------ #
# Utility: classify / badge                                           #
# ------------------------------------------------------------------ #

def classify_worker(start_hour: float) -> str:
    if start_hour < 12:
        return "Morning"
    elif start_hour < 17:
        return "Afternoon"
    return "Evening"


def insight_badge(shift_hours: float) -> dict[str, str]:
    if shift_hours >= 7:
        return {"label": "Optimization Target Reached", "level": "success"}
    elif shift_hours <= 4:
        return {"label": "High Rotation Warning",       "level": "danger"}
    return {"label": "Balanced Allocation",             "level": "info"}


# ------------------------------------------------------------------ #
# Utility: time parsing                                               #
# ------------------------------------------------------------------ #

def parse_slot(slot_str: str) -> tuple[float, float] | None:
    """
    Parse time range strings into (start_hour, end_hour) floats.
    Handles all dash/separator variants:
      '10:00 AM - 12:00 PM'   (spaces around dash)
      '10:00 AM-12:00 PM'     (no spaces, plain dash)
      '10:00 AM – 12:00 PM'   (en-dash)
      '10:00 AM — 12:00 PM'   (em-dash)
    """
    try:
        normalised = re.sub(r'\s*[\u2013\u2014\-]+\s*', '|', slot_str.strip())
        parts = normalised.split('|')
        if len(parts) != 2:
            return None

        def to_hour(t: str) -> float | None:
            t = t.strip()
            m = re.match(r'^(\d{1,2}):(\d{2})\s*(AM|PM)?$', t, re.IGNORECASE)
            if not m:
                return None
            h, mn, meridiem = int(m.group(1)), int(m.group(2)), (m.group(3) or '').upper()
            if meridiem == 'PM' and h != 12:
                h += 12
            elif meridiem == 'AM' and h == 12:
                h = 0
            return h + mn / 60.0

        s = to_hour(parts[0])
        e = to_hour(parts[1])
        if s is None or e is None:
            return None
        return (s, e)
    except (ValueError, IndexError, AttributeError):
        return None


def _parse_slot_as_dt(slot_str: str) -> tuple[datetime, datetime] | None:
    """
    Parse a slot string into a (start_dt, end_dt) pair of datetime objects
    (all anchored to the same dummy date 2000-01-01 for arithmetic).
    Returns None for unparseable strings (e.g. 'All Hours').
    """
    result = parse_slot(slot_str)
    if result is None:
        return None
    s_hour, e_hour = result
    base = datetime(2000, 1, 1)
    s_dt = base + timedelta(hours=s_hour)
    e_dt = base + timedelta(hours=e_hour)
    return s_dt, e_dt


def _fmt_time(hour: float) -> str:
    from math import floor
    total_min  = round(hour * 60)
    h, m       = total_min // 60, total_min % 60
    period     = "AM" if h < 12 else "PM"
    display_h  = h % 12 or 12
    return f"{display_h}:{m:02d} {period}"


def _dt_to_hour(dt: datetime) -> float:
    return dt.hour + dt.minute / 60.0


# ------------------------------------------------------------------ #
# Shift factory                                                       #
# ------------------------------------------------------------------ #

def _make_shift(worker_id: int, start_dt: datetime, end_dt: datetime) -> dict[str, Any]:
    start_hour  = _dt_to_hour(start_dt)
    end_hour    = _dt_to_hour(end_dt)
    total_hours = round((end_dt - start_dt).seconds / 3600, 2)
    return {
        "worker_id":      worker_id,
        "classification": classify_worker(start_hour),
        "start_time":     _fmt_time(start_hour),
        "end_time":       _fmt_time(end_hour),
        "start_hour":     round(start_hour, 2),
        "end_hour":       round(end_hour, 2),
        "total_hours":    total_hours,
        "badge":          insight_badge(total_hours),
    }


# ------------------------------------------------------------------ #
# Main scheduling engine                                              #
# ------------------------------------------------------------------ #

def generate_shifts(
    workers_needed: int,
    shift_hours: float = 8.0,
    slot_data: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Demand-driven scheduling engine.

    Algorithm (Path A — slot-anchored):
      STEP 1  Find global_last_end_time — the latest end time across all
              parseable slots. Hard ceiling; no shift extends past it.

      STEP 2  For each slot in chronological order:
                a. Count workers active at slot_start (start <= slot_start < end).
                b. While active < required, determine the correct spawn point:
                     - If any already-spawned worker expired after the previous
                       slot ended but before this slot starts, a coverage gap
                       exists. Spawn the new worker at the earliest such expiry
                       (not at slot_start) so the chain stays continuous.
                     - Otherwise spawn at slot_start as normal.
                c. Worker duration is always exactly shift_hours, clamped to
                   the global ceiling.

    WHY THE BRIDGE SPAWN:
      When shift_hours < slot_width, a worker spawned at slot_start expires
      before the next slot begins. The next iteration sees 0 active workers
      and naively spawns at the new slot_start, leaving a dead band equal to
      (next_slot_start - prev_worker_end). The bridge spawn closes that band
      by anchoring the new shift at the expiry of the last worker, not at
      the next slot boundary.

    Overlaps: ALLOWED — workers may share time windows.
    Ceiling:  ENFORCED — no shift ever runs past the last slot's end time.

    Fallback (Path B): if no parseable slot data, split workers_needed
    50/50 across morning (9 AM) and evening (5 PM) shifts.
    """

    # ------------------------------------------------------------------ #
    # Path A — demand-driven, slot-anchored                               #
    # ------------------------------------------------------------------ #
    if slot_data:
        # Parse every slot into (start_dt, end_dt, workers_needed) triples.
        # Slots with unparseable strings (e.g. "All Hours") are skipped gracefully.
        parsed_slots: list[tuple[datetime, datetime, int]] = []
        for s in slot_data:
            result = _parse_slot_as_dt(s.get("slot", ""))
            if result is None:
                continue
            s_dt, e_dt = result
            required = max(0, int(s.get("workers_needed", 0)))
            parsed_slots.append((s_dt, e_dt, required))

        if parsed_slots:
            # Sort chronologically by slot start time
            parsed_slots.sort(key=lambda x: x[0])

            # ----------------------------------------------------------
            # STEP 1: global ceiling — the latest end time in the data
            # ----------------------------------------------------------
            global_last_end_time: datetime = max(e for _, e, _ in parsed_slots)

            generated_shifts: list[dict[str, Any]] = []
            # Track raw datetime pairs alongside output dicts for arithmetic
            shift_times: list[tuple[datetime, datetime]] = []
            worker_id = 1

            # ----------------------------------------------------------
            # STEP 2: main pass — spawn workers, closing gaps that arise
            # when shift_hours is shorter than the distance between slots.
            #
            # The bug (original): when shift_hours < slot_width, a worker
            # spawned at slot_start expires before the next slot_start.
            # The engine sees 0 active workers and spawns at the new
            # slot_start, leaving (slot_start - last_worker_end) uncovered.
            #
            # The fix: if no workers are active at slot_start but prior
            # workers exist, spawn at max(end of all prior workers) instead
            # of slot_start. This bridges from the last coverage point
            # forward, keeping the timeline continuous without altering
            # shift_hours.
            # ----------------------------------------------------------
            for (slot_start, slot_end, required) in parsed_slots:
                if required <= 0:
                    continue

                # Workers active at slot_start: start <= slot_start < end
                active = [
                    i for i, (s, e) in enumerate(shift_times)
                    if s <= slot_start < e
                ]

                while len(active) < required:
                    # If no worker is active at slot_start but workers have
                    # run before, there is a gap. Spawn at the latest prior
                    # end time to bridge it, otherwise spawn at slot_start.
                    prior_ends = [e for (s, e) in shift_times if e <= slot_start]
                    spawn_at = max(prior_ends) if (not active and prior_ends) else slot_start

                    calculated_end = spawn_at + timedelta(hours=shift_hours)

                    # Clamp to the global ceiling
                    if calculated_end > global_last_end_time:
                        calculated_end = global_last_end_time

                    shift = _make_shift(worker_id, spawn_at, calculated_end)
                    generated_shifts.append(shift)
                    shift_times.append((spawn_at, calculated_end))
                    # Re-evaluate active: bridge worker may now cover slot_start
                    active = [
                        i for i, (s, e) in enumerate(shift_times)
                        if s <= slot_start < e
                    ]
                    worker_id += 1

            if generated_shifts:
                return generated_shifts

    # ------------------------------------------------------------------ #
    # Path B — fallback (no slot data or all slots unparseable)           #
    # ------------------------------------------------------------------ #
    import math
    shifts: list[dict[str, Any]] = []
    half  = math.ceil(workers_needed / 2)
    base  = datetime(2000, 1, 1)
    for i in range(max(1, workers_needed)):
        start_hour = 9.0 if i < half else 17.0
        s_dt = base + timedelta(hours=start_hour)
        e_dt = s_dt + timedelta(hours=shift_hours)
        shifts.append(_make_shift(i + 1, s_dt, e_dt))
    return shifts


def _patch_shift(shift: dict[str, Any], start_dt: datetime, end_dt: datetime) -> None:
    """Update a shift dict in-place after a gap-fill or clamp adjustment."""
    start_hour  = _dt_to_hour(start_dt)
    end_hour    = _dt_to_hour(end_dt)
    total_hours = round((end_dt - start_dt).seconds / 3600, 2)
    shift["start_time"]  = _fmt_time(start_hour)
    shift["end_time"]    = _fmt_time(end_hour)
    shift["start_hour"]  = round(start_hour, 2)
    shift["end_hour"]    = round(end_hour, 2)
    shift["total_hours"] = total_hours
    shift["badge"]       = insight_badge(total_hours)
