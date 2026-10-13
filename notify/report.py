"""월간 리포트 집계 (CLAUDE.md 7.5): 놓친 돈 / 놓칠 돈 / 찾은 돈 + 추이."""
import pandas as pd

from engine.cash.idle import idle_series, missed_between
from engine.runner import found_for


def customer_month(ctx, cid, cfg, start, end, findings=()) -> dict:
    """기간 [start, end]의 놓친 돈, 지금 해당 중인 finding의 1년 더 받을 이자, 기간 중 찾은 돈."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    missed = 0
    for acct in ctx.accounts_of(cid):
        if not acct.has(end):
            continue
        auto_on = ctx.auto_on_date(cid, end)
        if acct.currency == "KRW" and auto_on is not None:
            # 자동 RP를 켠 뒤는 놓친 돈이 아니라 찾은 돈. 켜기 전 날까지만 센다
            stop = min(end, auto_on - pd.Timedelta(days=1))
            if stop >= max(start, acct.dates[0]):
                missed += missed_between(acct, cfg, max(start, acct.dates[0]), stop)
        else:
            missed += missed_between(acct, cfg, max(start, acct.dates[0]), end)

    will_miss = sum(f.annual_projection_krw for f in findings)
    found_month = found_for(ctx, cid, cfg, end, start)
    found_total = found_for(ctx, cid, cfg, end)
    return {"missed": int(missed), "will_miss": int(will_miss),
            "found": int(found_month["found_krw"]) if found_month else 0,
            "found_total": found_total}


def customer_trend(ctx, cid, cfg, as_of, days=180) -> pd.DataFrame:
    """일별 예수금(원화 환산)과 쉬는 돈. 자동 RP 잔고는 따로."""
    as_of = pd.Timestamp(as_of)
    start = as_of - pd.Timedelta(days=days - 1)
    frames = []
    for acct in ctx.accounts_of(cid):
        if not acct.has(as_of):
            continue
        idle = idle_series(acct, cfg, as_of, start)
        s = slice(acct.pos(idle.index[0]), acct.pos(as_of) + 1)
        frames.append(pd.DataFrame({
            "date": idle.index,
            "cash_krw": acct.cash[s] * acct.rate[s],
            "idle_krw": idle.to_numpy(),
            "auto_rp_krw": acct.auto_rp[s] * acct.rate[s],
        }))
    if not frames:
        return pd.DataFrame(columns=["date", "cash_krw", "idle_krw", "auto_rp_krw"])
    return pd.concat(frames).groupby("date", as_index=False).sum()
