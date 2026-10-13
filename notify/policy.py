"""동의·야간·빈도·중복·보류 (CLAUDE.md 7.2~7.3)."""
from dataclasses import dataclass

import pandas as pd

from notify.triggers import PUSH_CHANNELS, Candidate, key_of


@dataclass
class Decision:
    candidate: Candidate
    channel: str
    status: str               # queued | held
    hold_reason: str          # "" | no_consent | night | frequency_cap | snooze
    scheduled_at: pd.Timestamp


def _at(day, hhmm) -> pd.Timestamp:
    h, m = map(int, str(hhmm).split(":"))
    return pd.Timestamp(day).normalize() + pd.Timedelta(hours=h, minutes=m)


def is_night(ts, cfg) -> bool:
    n = cfg["notify"]
    t = ts.strftime("%H:%M")
    return t >= n["night_start"] or t < n["night_end"]


def next_daytime(ts, cfg) -> pd.Timestamp:
    """야간이면 다음 낮 시간(default_send_time)으로. 21:00 이후 → 다음 날, 08:00 이전 → 그날."""
    n = cfg["notify"]
    day = ts.normalize() + (pd.Timedelta(days=1) if ts.strftime("%H:%M") >= n["night_start"] else pd.Timedelta(0))
    return _at(day, n["default_send_time"])


def next_monday(ts, cfg) -> pd.Timestamp:
    days = 7 - ts.weekday()
    return _at(ts.normalize() + pd.Timedelta(days=days), cfg["notify"]["default_send_time"])


def ad_title(title, cfg) -> str:
    prefix = cfg["notify"]["ad_prefix"]
    return title if title.startswith(prefix) else f"{prefix} {title}"


def has_consent(customer, channel) -> bool:
    return bool(customer.get(f"consent_{channel}_ad", False))


def snoozed_until(action_log, key, as_of, cfg):
    """dismiss 후 snooze_days 동안 같은 건 보류. 보류 중이면 풀리는 날, 아니면 None."""
    if action_log is None or action_log.empty:
        return None
    log = action_log[(action_log.action == "dismissed") & (action_log.finding_id.map(key_of) == key)]
    if log.empty:
        return None
    last = pd.Timestamp(str(log.timestamp.max())[:10])
    until = last + pd.Timedelta(days=cfg["notify"]["snooze_days"])
    return until if pd.Timestamp(as_of) < until else None


def _counts(history: pd.DataFrame) -> dict:
    """{customer_id: (주별 건수 dict, 월별 건수 dict)} — push+kakao, 보류 제외."""
    out = {}
    if history is None or history.empty:
        return out
    h = history[history.channel.isin(PUSH_CHANNELS) & (history.status != "held")]
    for cid, ts in zip(h.customer_id, pd.to_datetime(h.scheduled_at)):
        week, month = out.setdefault(cid, ({}, {}))
        wk, mo = tuple(ts.isocalendar())[:2], (ts.year, ts.month)
        week[wk] = week.get(wk, 0) + 1
        month[mo] = month.get(mo, 0) + 1
    return out


def apply(cands, customers: pd.DataFrame, history, action_log, cfg, as_of, run_time=None) -> list:
    n = cfg["notify"]
    run_at = _at(as_of, run_time or n["default_send_time"])
    counts = _counts(history)
    pb_keys = set()
    decisions = []

    for cand in sorted(cands, key=lambda c: c.rank):
        cust = customers(cand.customer_id) if callable(customers) else customers.loc[cand.customer_id]
        ch, status, reason, when = cand.channel, "queued", "", run_at

        if ch in PUSH_CHANNELS:
            until = snoozed_until(action_log, cand.key, as_of, cfg)
            if until is not None:
                decisions.append(Decision(cand, ch, "held", "snooze", _at(until, n["default_send_time"])))
                continue
            if cand.msg_type == "ad" and not has_consent(cust, ch):
                ch, reason = "pb_queue", "no_consent"

        if ch == "pb_queue":
            if cand.key in pb_keys:
                continue
            pb_keys.add(cand.key)
            decisions.append(Decision(cand, ch, status, reason, when))
            continue
        if ch == "monthly_report":
            decisions.append(Decision(cand, ch, status, reason, when))
            continue

        if cand.msg_type == "ad" and is_night(when, cfg) and not cust["consent_night_ad"]:
            when, reason = next_daytime(when, cfg), "night"

        week, month = counts.setdefault(cand.customer_id, ({}, {}))
        wk, mo = tuple(when.isocalendar())[:2], (when.year, when.month)
        if week.get(wk, 0) >= n["max_per_week"] or month.get(mo, 0) >= n["max_per_month"]:
            decisions.append(Decision(cand, ch, "held", "frequency_cap", next_monday(when, cfg)))
            continue
        week[wk] = week.get(wk, 0) + 1
        month[mo] = month.get(mo, 0) + 1
        decisions.append(Decision(cand, ch, status, reason, when))
    return decisions
