"""시장 이슈 알림: 고객 보유 종목의 큰 등락과 신용 담보 부족(반대매매 위험)을 찾는다.

숫자 계산은 여기서만 한다. 등락 이유(뉴스 요약)는 사람이 확인한 notes에서 따로 붙이고, 숫자를 바꾸지 않는다.
- 큰 등락: 기준일 종가가 전 거래일 종가 대비 |등락률| ≥ big_move_pct
- 담보 부족: 신용 보유 종목 평가금액 ÷ 신용 대출금 < 유지비율 → 부족 금액 = 대출금 × 유지비율 − 평가금액
보유 수량은 가상 데이터라 매입금액 ÷ 기준일 base_lag 거래일 전 종가로 정한다 (평균 매입가 = 그날 종가).
"""
import math

import pandas as pd


def positions(holdings: pd.DataFrame, closes: pd.DataFrame, fx: pd.Series, universe: pd.DataFrame, ref_date, base_lag) -> pd.DataFrame:
    """고객·종목별 수량·평균가·전일/기준일 종가·평가금액(원화)."""
    ref_date = pd.Timestamp(ref_date)
    hist = closes.loc[:ref_date].dropna(how="all")
    uni = universe.set_index("symbol")
    rows = []
    for h in holdings.itertuples():
        if h.symbol not in hist.columns:
            continue
        s = hist[h.symbol].dropna()
        if len(s) < base_lag + 2 or s.index[-1] != hist.index[-1]:
            continue                                     # 기준일에 거래가 없거나 이력이 짧으면 제외
        u = uni.loc[h.symbol]
        usd = u.currency == "USD"
        rate_base = float(fx.loc[:s.index[-1 - base_lag]].iloc[-1]) if usd else 1.0
        rate_now = float(fx.loc[:s.index[-1]].iloc[-1]) if usd else 1.0
        avg = float(s.iloc[-1 - base_lag])
        qty = math.floor(h.buy_amount_krw / (avg * rate_base))
        if qty <= 0:
            continue
        prev, now = float(s.iloc[-2]), float(s.iloc[-1])
        rows.append({
            "customer_id": h.customer_id, "symbol": h.symbol, "name": u["name"], "market": u.market, "currency": u.currency,
            "qty": qty, "avg_price": avg, "prev_close": prev, "close": now, "trade_date": f"{s.index[-1]:%Y-%m-%d}",
            "chg_pct": now / prev - 1, "value_krw": qty * now * rate_now, "day_delta_krw": qty * (now - prev) * rate_now,
            "pnl_krw": qty * (now * rate_now - avg * rate_base), "credit_loan_krw": float(h.credit_loan_krw or 0),
            "spark": [round(float(x), 2) for x in s.iloc[-20:]],
        })
    return pd.DataFrame(rows)


def detect(pos: pd.DataFrame, cfg) -> list:
    """연락할 건 목록. kind = big_move | margin_call | margin_watch."""
    c = cfg["market"]
    out = []
    for p in pos.itertuples():
        if abs(p.chg_pct) >= c["big_move_pct"] - 1e-9:      # 정확히 10%도 포함 (부동소수 오차)
            out.append({"kind": "big_move", **p._asdict()})
        if p.credit_loan_krw > 0:
            ratio = p.value_krw / p.credit_loan_krw
            need = max(0.0, p.credit_loan_krw * c["maintenance_ratio"] - p.value_krw)
            if ratio < c["maintenance_ratio"]:
                out.append({"kind": "margin_call", **p._asdict(), "ratio": ratio, "shortfall_krw": math.ceil(need)})
            elif ratio < c["watch_ratio"]:
                out.append({"kind": "margin_watch", **p._asdict(), "ratio": ratio, "shortfall_krw": 0})
    order = {"margin_call": 0, "big_move": 1, "margin_watch": 2}
    out.sort(key=lambda a: (order[a["kind"]], -abs(a["day_delta_krw"])))
    for a in out:
        a.pop("Index", None)
    return out
