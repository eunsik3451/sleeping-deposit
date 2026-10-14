"""어떤 사건이 알림 후보를 만드는가 (CLAUDE.md 7.1)."""
from dataclasses import dataclass, field

import pandas as pd

from engine.priority import sort_key
from notify import report

PUSH_CHANNELS = ("push", "kakao")


@dataclass
class Candidate:
    customer_id: str
    trigger: str
    channel: str
    msg_type: str
    key: str                  # 같은 건을 묶는 키 (재알림·snooze 판단). finding_id에서 날짜를 뺀 것
    finding_id: str
    amount_krw: int
    finding: object = None
    extra: dict = field(default_factory=dict)
    rank: tuple = ()


def key_of(finding_id: str) -> str:
    return str(finding_id).rsplit("-", 1)[0]


class HistoryIndex:
    """발송함 이력을 키별로 한 번만 묶어 둔다 (배치마다 수백 건을 조회하므로)."""

    def __init__(self, history: pd.DataFrame):
        self.by_key = {}
        if history is None or history.empty:
            return
        cols = zip(history.finding_id.map(key_of), history.channel, history.status,
                   history.hold_reason.astype(str), history.scheduled_at.astype(str), history.amount_krw)
        for k, ch, st, hold, at, amt in cols:
            self.by_key.setdefault(k, []).append((ch, st, hold, at, amt))

    def state(self, key, channels) -> dict:
        """이 키로 나간 마지막 알림과 보류 중인 알림이 있는지.
        광고 동의가 없어 pb_queue로 돌린 건(no_consent)은 push·kakao를 보낸 것으로 친다."""
        push = bool(set(channels) & set(PUSH_CHANNELS))
        rows = [r for r in self.by_key.get(key, ()) if r[0] in channels or (push and r[2] == "no_consent")]
        pending = any(st == "held" and not hold.endswith(":carried") for _, st, hold, _, _ in rows)
        sent = sorted((r for r in rows if r[1] != "held"), key=lambda r: r[3])
        if not sent:
            return {"last_date": None, "last_amount": None, "pending": pending}
        _, _, _, at, amt = sent[-1]
        return {"last_date": pd.Timestamp(at[:10]), "last_amount": float(amt or 0), "pending": pending}


def is_due(state, amount, as_of, cfg) -> bool:
    """재알림 조건 (7.3): 처음이거나, renotify_days 경과, 또는 금액이 renotify_growth 이상 증가."""
    n = cfg["notify"]
    if state["pending"]:
        return False
    if state["last_date"] is None:
        return True
    if (pd.Timestamp(as_of) - state["last_date"]).days >= n["renotify_days"]:
        return True
    last = state["last_amount"] or 0
    return last > 0 and amount >= last * (1 + n["renotify_growth"])


def from_findings(result, ctx, history, cfg) -> list:
    """R1 finding → T_IDLE_FIRST / T_IDLE_UPDATE / T_REASSESS.
    재알림 비교 금액은 '깨우면 1년에 더 받을 이자'(쉬는 돈 크기에 비례). 놓친 이자는 날마다 쌓여 비교 기준으로 맞지 않는다."""
    as_of = result.as_of
    idx = history if isinstance(history, HistoryIndex) else HistoryIndex(history)
    out = []
    for f in result.findings:
        if f.rule != "R1":
            continue
        cust = ctx.customer(f.customer_id)
        key = f.meta["key"]
        rank = sort_key(f, cfg, as_of)
        if f.action.type == "reassess":
            trig, mtype, ch = "T_REASSESS", "info", "push"
        elif f.meta["streak"] == cfg["cash"]["min_idle_days"]:
            trig, mtype, ch = "T_IDLE_FIRST", "info", "push"
        else:
            trig, mtype = "T_IDLE_UPDATE", "ad"
            ch = "kakao" if cust["consent_kakao_ad"] else "push"

        amount = f.annual_projection_krw
        if is_due(idx.state(key, PUSH_CHANNELS), amount, as_of, cfg):
            out.append(Candidate(f.customer_id, trig, ch, mtype, key, f.finding_id, amount, f, rank=rank))
        if f.pb_flag and is_due(idx.state(key, ("pb_queue",)), amount, as_of, cfg):
            out.append(Candidate(f.customer_id, trig, "pb_queue", "info", key, f.finding_id, amount, f, rank=rank))
    return out


# R2~R5: (트리거, 메시지 성격). R5 연금저축은 납입 유도라 광고성, 나머지는 정보성
ITEM_TRIGGERS = {"R2": ("T_TAX", "info"), "R3": ("T_RIGHTS", "info"), "R4": ("T_MATURITY", "info"),
                 "R5": ("T_PENSION", "ad")}


def item_due(state, f, as_of, cfg) -> bool:
    """기한이 있는 항목: 처음 발견했을 때 한 번, 기한 urgent_days 전에 한 번 더."""
    if state["pending"]:
        return False
    if state["last_date"] is None:
        return True
    urgent = cfg["priority"]["urgent_days"]
    deadline = pd.Timestamp(f.deadline)
    return (deadline - pd.Timestamp(as_of)).days <= urgent and state["last_date"] < deadline - pd.Timedelta(days=urgent)


def from_items(result, ctx, history, cfg) -> list:
    as_of = result.as_of
    idx = history if isinstance(history, HistoryIndex) else HistoryIndex(history)
    out = []
    for f in result.findings:
        if f.rule not in ITEM_TRIGGERS:
            continue
        trig, mtype = ITEM_TRIGGERS[f.rule]
        cust = ctx.customer(f.customer_id)
        ch = "kakao" if mtype == "info" or cust["consent_kakao_ad"] else "push"
        key, rank = f.meta["key"], sort_key(f, cfg, as_of)
        if item_due(idx.state(key, PUSH_CHANNELS), f, as_of, cfg):
            out.append(Candidate(f.customer_id, trig, ch, mtype, key, f.finding_id, f.amount_krw, f, rank=rank))
        if f.pb_flag and item_due(idx.state(key, ("pb_queue",)), f, as_of, cfg):
            out.append(Candidate(f.customer_id, trig, "pb_queue", "info", key, f.finding_id, f.amount_krw, f, rank=rank))
    return out


def from_events(result, ctx, cfg) -> list:
    """T_EVENT: 유입 다음 날, 그날까지 재투자(매수 결제) 없음."""
    c = cfg["cash"]
    as_of = result.as_of
    out = []
    for (cid, cur), acct in ctx.accounts.items():
        if cur != "KRW" or not acct.has(as_of):
            continue
        e = acct.pos(as_of)
        for p, ftype, amount in acct.events:
            if p != e - 1 or amount < c["min_idle_amount_krw"] or acct.buy_day[p:e + 1].any():
                continue
            ev = {"flow_type": ftype, "date": acct.dates[p], "amount": amount, "days_since": 1}
            fid = f"EV-{cid}-{acct.dates[p]:%Y%m%d}"
            rank = (True, False, -amount)
            out.append(Candidate(cid, "T_EVENT", "kakao", "info", key_of(fid), fid, int(amount),
                                 extra={"event": ev}, rank=rank))
            if amount >= c["pb_event_threshold_krw"]:
                out.append(Candidate(cid, "T_EVENT", "pb_queue", "info", key_of(fid), fid, int(amount),
                                     extra={"event": ev}, rank=rank))
    return out


def from_month_start(result, ctx, cfg) -> list:
    """매월 1일: T_MONTHLY(전 고객 리포트), T_FOUND(자동 RP 고객)."""
    as_of = result.as_of
    if as_of.day != 1:
        return []
    month_end = as_of - pd.Timedelta(days=1)
    month_start = month_end.replace(day=1)
    out = []
    for cid in ctx.customers.index:
        rep = report.customer_month(ctx, cid, cfg, month_start, month_end, result.for_customer(cid))
        if not (rep["missed"] or rep["will_miss"] or rep["found"]):
            continue
        extra = {"month": month_start, "missed_month": rep["missed"], "will_miss": rep["will_miss"],
                 "found_month": rep["found"]}
        out.append(Candidate(cid, "T_MONTHLY", "monthly_report", "info", f"MR-{cid}",
                             f"MR-{cid}-{month_start:%Y%m}", rep["missed"], extra=extra, rank=(True, True, -rep["missed"])))
        if rep["found"] > 0 and rep["found_total"]:
            total = rep["found_total"]
            extra_found = {**extra, "found_total": total["found_krw"], "found_on": total["on_date"],
                           "found_invested": total["invested_krw"]}
            out.append(Candidate(cid, "T_FOUND", "push", "info", f"FD-{cid}", f"FD-{cid}-{month_start:%Y%m}",
                                 rep["found"], extra=extra_found, rank=(True, True, 0)))
    return out


def collect(result, ctx, history, cfg) -> list:
    idx = HistoryIndex(history)
    return (from_events(result, ctx, cfg) + from_findings(result, ctx, idx, cfg)
            + from_items(result, ctx, idx, cfg) + from_month_start(result, ctx, cfg))
