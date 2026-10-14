"""시장 이슈 알림: 고객 보유 종목의 큰 등락과 신용 담보 위험(반대매매 전·후)을 찾는다.

숫자 계산은 여기서만 한다. 등락 이유(뉴스 요약)는 사람이 확인한 notes에서 따로 붙이고, 숫자를 바꾸지 않는다.
- 큰 등락: 기준일 종가가 전 거래일 종가 대비 |등락률| ≥ big_move_pct
- 신용 담보비율 = 신용 보유 종목 평가금액 ÷ 신용 대출금
  · 하락 여력 = 1 − 유지비율 ÷ 담보비율  (주가가 이만큼 더 내리면 유지비율에 닿음)
  · 반대매매 기준가 = 종가 × 유지비율 ÷ 담보비율
  · 단계: 위험(유지비율 미만) / 경고(하락 여력 < warn_drop) / 주의(< watch_drop) / 안전
  · 부족 금액 = 대출금 × 유지비율 − 평가금액, 안전 복귀 금액 = 대출금 × 유지비율 ÷ (1 − watch_drop) − 평가금액
  · 흔한 하락인가: 최근 lookback 거래일 중 하루 하락률이 하락 여력 이상이었던 날 수
보유 수량은 가상 데이터라 매입금액 ÷ 기준일 base_lag 거래일 전 종가로 정한다 (평균 매입가 = 그날 종가).
"""
import math

import pandas as pd

STAGES = ("margin_call", "margin_warn", "margin_watch", "margin_safe")


def positions(holdings: pd.DataFrame, closes: pd.DataFrame, fx: pd.Series, universe: pd.DataFrame, ref_date, base_lag,
              lookback=60) -> pd.DataFrame:
    """고객·종목별 수량·평균가·전일/기준일 종가·평가금액(원화). 신용 보유분은 담보비율 추이·일간 수익률도."""
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
        loan = float(h.credit_loan_krw or 0)
        row = {
            "customer_id": h.customer_id, "symbol": h.symbol, "name": u["name"], "market": u.market, "currency": u.currency,
            "qty": qty, "avg_price": avg, "prev_close": prev, "close": now, "trade_date": f"{s.index[-1]:%Y-%m-%d}",
            "chg_pct": now / prev - 1, "value_krw": qty * now * rate_now, "day_delta_krw": qty * (now - prev) * rate_now,
            "pnl_krw": qty * (now * rate_now - avg * rate_base), "credit_loan_krw": loan,
            "spark": [round(float(x), 2) for x in s.iloc[-20:]], "ratio_hist": [], "rets": [],
        }
        if loan > 0:     # 신용은 국내 종목만 (환율 없음)
            row["ratio_hist"] = [round(qty * float(x) / loan, 4) for x in s.iloc[-20:]]
            row["rets"] = [float(x) for x in s.pct_change().dropna().iloc[-lookback:]]
        rows.append(row)
    return pd.DataFrame(rows)


def credit_book(pos: pd.DataFrame, cfg) -> list:
    """신용 보유분 전체의 위험 단계 (안전 포함)."""
    c = cfg["market"]
    maint, warn, watch = c["maintenance_ratio"], c["warn_drop"], c["watch_drop"]
    out = []
    for p in pos[pos.credit_loan_krw > 0].itertuples():
        ratio = p.value_krw / p.credit_loan_krw
        room = 1 - maint / ratio
        if ratio < maint:
            stage = "margin_call"
        elif room < warn - 1e-12:
            stage = "margin_warn"
        elif room < watch - 1e-12:
            stage = "margin_watch"
        else:
            stage = "margin_safe"
        out.append({**p._asdict(), "kind": stage, "ratio": ratio, "room": room,
                    "trigger_price": p.close * maint / ratio,
                    "shortfall_krw": math.ceil(max(0.0, p.credit_loan_krw * maint - p.value_krw)),
                    "to_safe_krw": math.ceil(max(0.0, p.credit_loan_krw * maint / (1 - watch) - p.value_krw)),
                    "big_days": int(sum(1 for r in p.rets if room > 0 and r <= -room)), "lookback": len(p.rets)})
    for a in out:
        a.pop("Index", None)
        a.pop("rets", None)
    return out


def detect(pos: pd.DataFrame, cfg) -> list:
    """연락할 건 목록. kind = big_move | margin_call | margin_warn | margin_watch (안전은 제외)."""
    c = cfg["market"]
    out = []
    for p in pos.itertuples():
        if abs(p.chg_pct) >= c["big_move_pct"] - 1e-9:      # 정확히 10%도 포함 (부동소수 오차)
            a = {"kind": "big_move", **p._asdict()}
            a.pop("Index", None)
            a.pop("rets", None)
            out.append(a)
    out += [b for b in credit_book(pos, cfg) if b["kind"] != "margin_safe"]
    order = {"margin_call": 0, "margin_warn": 1, "big_move": 2, "margin_watch": 3}
    out.sort(key=lambda a: (order[a["kind"]], -abs(a["day_delta_krw"])))
    return out
