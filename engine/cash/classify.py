"""유입 유형 분류 (CLAUDE.md 6.4). 위에서부터 먼저 맞는 것."""
import pandas as pd

from engine.cash.idle import AccountSeries


def find_event(acct: AccountSeries, cfg, as_of):
    """최근 event_window_days 안의 배당·ELS 상환·채권 만기 중, 이후 잔고 감소가 유입액의 50% 미만인 가장 최근 것."""
    c = cfg["cash"]
    e = acct.pos(as_of)
    lo = e - c["event_window_days"] + 1
    for p, ftype, amount in sorted(acct.events, key=lambda x: (-x[0], -x[2])):
        if not lo <= p <= e:
            continue
        decline = max(0.0, acct.cash[p] - acct.cash[e])
        if decline < amount * c["event_reinvest_ratio"]:
            return {"flow_type": ftype, "date": acct.dates[p], "amount": amount,
                    "days_since": e - p, "decline": decline}
    return None


def recent_buy_days(acct: AccountSeries, cfg, as_of) -> int:
    s = acct.window(as_of, cfg["cash"]["active_trader_window_days"])
    return int(acct.buy_day[s].sum())


def classify(acct: AccountSeries, cfg, as_of) -> tuple:
    """(subtype, info). subtype: fx_idle | event_inflow | active_trader | long_idle"""
    as_of = pd.Timestamp(as_of)
    if acct.currency != "KRW":
        return "fx_idle", {}
    event = find_event(acct, cfg, as_of)
    if event:
        return "event_inflow", {"event": event}
    buys = recent_buy_days(acct, cfg, as_of)
    if buys >= cfg["cash"]["active_trader_buy_days"]:
        return "active_trader", {"buy_days": buys}
    return "long_idle", {"buy_days": buys}
