"""버퍼·idle 계산, 연속일, 과거 놓친 이자 (CLAUDE.md 6.1~6.3, 6.7)."""
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from engine.models import EVENT_FLOW_TYPES, OUTFLOW_TYPES

EPS = 1e-6   # 부동소수 오차로 143,013.999… 같은 값이 한 단계 내려가지 않게


def floor_won(x) -> int:
    return int(math.floor(x + EPS))


def spread(cfg, currency) -> float:
    c = cfg["cash"]
    if currency == "USD":
        return round(c["usd_rp_rate"] - c["usd_deposit_rate"], 10)
    return round(c["krw_rp_rate"] - c["krw_deposit_rate"], 10)


@dataclass
class AccountSeries:
    """고객·통화 하나의 일별 배열 (전체 이력, 하루도 빠짐없이). 금액은 해당 통화 단위."""
    customer_id: str
    currency: str
    dates: pd.DatetimeIndex
    cash: np.ndarray
    unsettled: np.ndarray
    margin: np.ndarray
    auto_rp: np.ndarray
    outflow: np.ndarray            # 하루 유출액 (buy_settle + withdrawal)
    buy_day: np.ndarray            # buy_settle 발생 여부
    rate: np.ndarray               # 원화 환산 환율 (KRW는 1)
    events: list = field(default_factory=list)   # [(pos, flow_type, amount)] 배당·ELS 상환·채권 만기

    def pos(self, date) -> int:
        p = (pd.Timestamp(date) - self.dates[0]).days
        if not 0 <= p < len(self.dates):
            raise ValueError(f"{self.customer_id}/{self.currency}: {date:%Y-%m-%d} 잔고 데이터 없음")
        return p

    def has(self, date) -> bool:
        return 0 <= (pd.Timestamp(date) - self.dates[0]).days < len(self.dates)

    def window(self, end, days) -> slice:
        e = self.pos(end)
        return slice(max(0, e - days + 1), e + 1)


def build_accounts(balances: pd.DataFrame, flows: pd.DataFrame, fx_rates: pd.DataFrame) -> dict:
    """표준 테이블 → {(customer_id, currency): AccountSeries}."""
    fx = fx_rates[fx_rates.currency == "USD"].set_index("date")["rate"].sort_index()
    fl = flows.copy()
    fl["amount"] = fl["amount"].astype(float)
    flow_groups = dict(tuple(fl.groupby(["customer_id", "currency"], sort=False)))

    accounts = {}
    for (cid, cur), g in balances.groupby(["customer_id", "currency"], sort=False):
        g = g.sort_values("date").set_index("date")
        idx = pd.date_range(g.index.min(), g.index.max(), freq="D")
        g = g.reindex(idx).ffill()
        n = len(idx)
        if cur == "KRW":
            rate = np.ones(n)
        else:
            if fx.empty:
                raise ValueError("USD 환율(fx_rates)이 없음")
            rate = fx.reindex(fx.index.union(idx)).ffill().bfill().reindex(idx).to_numpy()

        outflow, buy_day, events = np.zeros(n), np.zeros(n, dtype=bool), []
        f = flow_groups.get((cid, cur))
        if f is not None:
            pos = (f["date"] - idx[0]).dt.days.to_numpy()
            ok = (pos >= 0) & (pos < n)
            types, amounts = f["flow_type"].to_numpy(), f["amount"].to_numpy()
            is_out = np.isin(types, OUTFLOW_TYPES) & ok
            np.add.at(outflow, pos[is_out], amounts[is_out])
            buy_day[pos[(types == "buy_settle") & ok]] = True
            for p, t, a in zip(pos[ok], types[ok], amounts[ok]):
                if t in EVENT_FLOW_TYPES:
                    events.append((int(p), t, float(a)))

        accounts[(cid, cur)] = AccountSeries(
            customer_id=cid, currency=cur, dates=idx,
            cash=g["cash"].astype(float).to_numpy(),
            unsettled=g["unsettled_buy"].astype(float).to_numpy(),
            margin=g["margin_required"].astype(float).to_numpy(),
            auto_rp=g["auto_rp_balance"].astype(float).to_numpy(),
            outflow=outflow, buy_day=buy_day, rate=rate, events=events)
    return accounts


@dataclass
class IdleResult:
    as_of: pd.Timestamp
    currency: str
    buffer_krw: int
    max_outflow_krw: int
    idle_today_krw: float
    cash_today: float              # 해당 통화 단위
    rate_today: float
    streak: int
    spread: float
    missed_lookback: int           # 지난 lookback 놓친 이자 (원)
    annual_projection: int         # 앞으로 1년 (원)
    lookback_days: int
    swept_days: int                # 놓친 이자에 들어간 날 수


def buffer_krw(acct: AccountSeries, cfg, as_of) -> tuple:
    """(버퍼, 조회 구간 하루 최대 유출액). 외화는 그날 환율로 원화 환산."""
    c = cfg["cash"]
    s = acct.window(as_of, c["lookback_days"])
    max_out = float((acct.outflow[s] * acct.rate[s]).max(initial=0.0))
    return max(c["min_buffer_krw"], max_out), max_out


def idle_krw(acct: AccountSeries, buffer, s: slice) -> np.ndarray:
    avail = (acct.cash[s] - acct.unsettled[s] - acct.margin[s]) * acct.rate[s]
    return np.maximum(0.0, avail - buffer)


def compute_idle(acct: AccountSeries, cfg, as_of) -> IdleResult:
    c = cfg["cash"]
    as_of = pd.Timestamp(as_of)
    buf, max_out = buffer_krw(acct, cfg, as_of)
    e = acct.pos(as_of)

    # 연속일은 이력 전체에서 거꾸로 센다 (조회 구간보다 길 수 있음)
    full = idle_krw(acct, buf, slice(0, e + 1))
    below = np.flatnonzero(full[::-1] < c["min_idle_amount_krw"])
    streak = int(below[0]) if below.size else e + 1

    lb = full[-min(c["lookback_days"], e + 1):]
    sp = spread(cfg, acct.currency)
    swept = lb >= c["min_sweep_krw"]
    return IdleResult(
        as_of=as_of, currency=acct.currency, buffer_krw=int(round(buf)), max_outflow_krw=int(round(max_out)),
        idle_today_krw=float(full[-1]), cash_today=float(acct.cash[e]), rate_today=float(acct.rate[e]),
        streak=streak, spread=sp,
        missed_lookback=floor_won(lb[swept].sum() * sp / 365),
        annual_projection=floor_won(full[-1] * sp),
        lookback_days=c["lookback_days"], swept_days=int(swept.sum()))


def idle_series(acct: AccountSeries, cfg, as_of, start=None) -> pd.Series:
    """as_of 기준 버퍼를 적용한 일별 idle (원). 추이 차트·월간 리포트용."""
    buf, _ = buffer_krw(acct, cfg, as_of)
    e = acct.pos(as_of)
    b = 0 if start is None else max(0, (pd.Timestamp(start) - acct.dates[0]).days)
    s = slice(b, e + 1)
    return pd.Series(idle_krw(acct, buf, s), index=acct.dates[s])


def missed_between(acct: AccountSeries, cfg, start, end) -> int:
    """기간 [start, end] 동안 놓친 이자 (R1과 같은 식, end 기준 버퍼)."""
    idle = idle_series(acct, cfg, end, start)
    swept = idle[idle >= cfg["cash"]["min_sweep_krw"]]
    return floor_won(swept.sum() * spread(cfg, acct.currency) / 365)


def found_money(acct: AccountSeries, keep_krw, on_date, cfg, as_of, start=None) -> dict:
    """자동 RP로 찾은 돈 (6.7). cash는 남겨둔 예수금, auto_rp는 운용된 금액이라 둘을 합쳐 계산."""
    as_of = pd.Timestamp(as_of)
    on_date = pd.Timestamp(on_date)
    begin = max(on_date, pd.Timestamp(start)) if start is not None else on_date
    begin = max(begin, acct.dates[0])
    rate = cfg["cash"]["krw_rp_rate"]
    e = acct.pos(as_of)
    if begin > as_of:
        return {"on_date": on_date, "days": 0, "found_krw": 0, "annual_krw": 0, "invested_krw": 0}
    s = slice(acct.pos(begin), e + 1)
    invested = np.maximum(0.0, acct.cash[s] + acct.auto_rp[s] - keep_krw)
    return {
        "on_date": on_date,
        "days": int(s.stop - s.start),
        "found_krw": floor_won(invested.sum() * rate / 365),
        "annual_krw": floor_won(invested[-1] * rate),
        "invested_krw": int(round(invested[-1])),
    }
