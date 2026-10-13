"""발송함 (CLAUDE.md 7.4). 실제 발송 없음: outbox.csv에 쌓고 화면에서 미리보기만 한다."""
import numpy as np
import pandas as pd

from engine.adapter import SCHEMA
from engine.runner import run
from notify import policy, triggers
from notify.triggers import key_of

COLUMNS = SCHEMA["outbox"]["columns"]


def empty_outbox() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUMNS)


def _carry_over(history: pd.DataFrame, as_of) -> pd.DataFrame:
    """보류 기한이 지난 frequency_cap·snooze 건은 ':carried'로 표시해 다음 배치에서 다시 후보가 되게 한다."""
    if history.empty:
        return history
    h = history.copy()
    due = ((h.status == "held") & h.hold_reason.isin(["frequency_cap", "snooze"])
           & (pd.to_datetime(h.scheduled_at) <= pd.Timestamp(as_of) + pd.Timedelta(days=1)))
    h.loc[due, "hold_reason"] = h.loc[due, "hold_reason"] + ":carried"
    return h


def build_outbox(as_of, ctx, cfg, history, action_log, generator, run_time=None, result=None) -> tuple:
    """하루 배치: 트리거 수집 → 정책 적용 → 메시지 생성. (갱신된 history, 오늘 새로 만든 행)"""
    as_of = pd.Timestamp(as_of)
    history = _carry_over(history if history is not None else empty_outbox(), as_of)
    result = result or run(ctx, cfg, as_of)
    cands = triggers.collect(result, ctx, history, cfg)
    decisions = policy.apply(cands, ctx.customer, history, action_log, cfg, as_of, run_time)

    rows, seen = [], set(history.message_id) if len(history) else set()
    for d in decisions:
        c = d.candidate
        cust = ctx.customer(c.customer_id)
        title, body = generator.generate(c.trigger, d.channel, c.msg_type, cust, c.finding, c.extra, as_of)
        if c.msg_type == "ad" and d.channel in triggers.PUSH_CHANNELS:
            title = policy.ad_title(title, cfg)
        mid = f"M{as_of:%Y%m%d}-{c.customer_id}-{c.trigger}-{d.channel}"
        while mid in seen:
            mid += "+"
        seen.add(mid)
        rows.append({
            "message_id": mid, "customer_id": c.customer_id, "finding_id": c.finding_id, "trigger": c.trigger,
            "channel": d.channel, "msg_type": c.msg_type, "scheduled_at": d.scheduled_at.strftime("%Y-%m-%d %H:%M"),
            "title": title, "body": body, "status": d.status, "hold_reason": d.hold_reason,
            "amount_krw": int(c.amount_krw),
        })
    new = pd.DataFrame(rows, columns=COLUMNS)
    merged = pd.concat([history, new], ignore_index=True) if len(new) else history
    return merged, new


def backfill(start, end, ctx, cfg, history, action_log, generator, run_time_for=None) -> pd.DataFrame:
    """start~end 날마다 배치를 돌린 결과. run_time_for(day) → 'HH:MM' (기본 default_send_time)."""
    h = history if history is not None else empty_outbox()
    for day in pd.date_range(start, end, freq="D"):
        rt = run_time_for(day) if run_time_for else None
        h, _ = build_outbox(day, ctx, cfg, h, action_log, generator, rt)
    return h


def simulate_engagement(outbox: pd.DataFrame, seed, as_of) -> pd.DataFrame:
    """데모용: 예정 시각이 지난 push·kakao·리포트를 발송 처리하고 열람 약 60%, 실행 약 20%를 채운다."""
    out = outbox.copy()
    rng = np.random.default_rng(seed)
    cutoff = pd.Timestamp(as_of) + pd.Timedelta(days=1)
    mask = ((out.status == "queued") & out.channel.isin(["push", "kakao", "monthly_report"])
            & (pd.to_datetime(out.scheduled_at) < cutoff))
    u = rng.random(int(mask.sum()))
    out.loc[mask, "status"] = np.where(u < 0.2, "executed_sim", np.where(u < 0.6, "opened_sim", "sent_sim"))
    return out


def keys(outbox: pd.DataFrame) -> pd.Series:
    return outbox.finding_id.map(key_of)


DEMO_NIGHT_TIME = "22:30"


def demo_run_time_for(start):
    """데모 백필 실행 시각: 첫날만 22:30에 돌았다고 가정해 야간 전송 제한이 보이게 한다. 나머지는 default_send_time."""
    start = pd.Timestamp(start)
    return lambda day: DEMO_NIGHT_TIME if pd.Timestamp(day) == start else None
