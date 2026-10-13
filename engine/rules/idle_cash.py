"""R1 예수금 활용: idle·분류·추천·적합성을 묶어 Finding 하나를 만든다 (CLAUDE.md 6장)."""
import pandas as pd

from engine.cash.classify import classify
from engine.cash.idle import AccountSeries, compute_idle
from engine.cash.recommend import product_records, recommend
from engine.cash.suitability import gate
from engine.fmt import money, pct, usd, won
from engine.models import Action, Finding

EVENT_LABELS = {"els_redemption": "ELS 상환금", "bond_maturity": "채권 만기 상환금", "dividend": "배당금"}


def title_for(subtype, res, info, acct) -> str:
    if subtype == "event_inflow":
        ev = info["event"]
        return f"{EVENT_LABELS[ev['flow_type']]} {money(ev['amount'], 'KRW')}이 {ev['days_since']}일째 쉬고 있어요"
    if subtype == "active_trader":
        return "매수 대기 자금도 쉬는 동안 이자를 받을 수 있어요"
    if subtype == "fx_idle":
        return f"달러 예수금 {usd(res.cash_today)}이 {res.streak}일째 그대로예요"
    return f"예수금 {money(res.cash_today, 'KRW')}이 {res.streak}일째 그대로예요"


def action_for(gate_type, product_id, products) -> Action:
    if gate_type == "reassess":
        return Action("reassess", "투자성향 다시 진단하기")
    if gate_type == "pb_consult":
        return Action("pb_consult", "담당 PB와 상담하기")
    if product_id == "AUTO_RP":
        return Action("rp_buy", "예수금 자동 RP 신청")
    name = next(r["name"] for r in product_records(products) if r["product_id"] == product_id)
    return Action("rp_buy", f"{name} 시작하기")


def evidence_for(subtype, res, info, acct: AccountSeries, cfg) -> list:
    c = cfg["cash"]
    e = acct.pos(res.as_of)
    lines = []
    if acct.currency == "KRW":
        lines.append(f"기준일 {res.as_of:%Y-%m-%d} 예수금 {won(res.cash_today)}")
    else:
        lines.append(f"기준일 {res.as_of:%Y-%m-%d} 달러 예수금 {usd(res.cash_today)} × 환율 {res.rate_today:,.2f}원 "
                     f"= {won(res.cash_today * res.rate_today)}")
    held = (acct.unsettled[e] + acct.margin[e]) * acct.rate[e]
    if held > 0:
        lines.append(f"미결제 매수금·증거금 {won(held)} 제외")
    lines.append(f"버퍼 {won(res.buffer_krw)}: 최근 3개월 중 하루에 가장 많이 쓰신 금액만큼은 남겨두고 계산했어요 "
                 f"(최근 {res.lookback_days}일 하루 최대 출금·매수 {won(res.max_outflow_krw)}, 최소 {won(c['min_buffer_krw'])})")
    lines.append(f"쉬고 있는 돈 {won(res.idle_today_krw)}, {res.streak}일 연속 {won(c['min_idle_amount_krw'])} 이상")
    rp, dep = (c["krw_rp_rate"], c["krw_deposit_rate"]) if acct.currency == "KRW" else (c["usd_rp_rate"], c["usd_deposit_rate"])
    lines.append(f"지난 {res.lookback_days}일 놓친 이자 {won(res.missed_lookback)} = 쉬는 돈(하루 {won(c['min_sweep_krw'])} 이상인 "
                 f"{res.swept_days}일) × 금리 차이 {pct(res.spread)}(RP {pct(rp)} − 예탁금 이용료 {pct(dep)}) ÷ 365")
    lines.append(f"앞으로 1년 {won(res.annual_projection)} = 오늘 쉬는 돈 {won(res.idle_today_krw)} × {pct(res.spread)}")

    if subtype == "event_inflow":
        ev = info["event"]
        lines.append(f"{ev['date']:%Y-%m-%d} {EVENT_LABELS[ev['flow_type']]} {won(ev['amount'])} 입금, "
                     f"이후 잔고 감소 {won(ev['decline'])} (유입액의 {pct(c['event_reinvest_ratio'])} 미만) → 이벤트유입형")
    elif subtype == "active_trader":
        lines.append(f"최근 {c['active_trader_window_days']}일 중 {info['buy_days']}일 매수 결제 → 매수 대기 자금. "
                     f"매수할 때 자동으로 빠지는 예수금 자동 RP만 제안")
    elif subtype == "fx_idle":
        lines.append("달러 예수금 → 환전 없이 외화 RP로 운용 제안")
    else:
        lines.append(f"최근 {c['active_trader_window_days']}일 매수 결제 {info['buy_days']}일 → 장기방치형")
    return lines


def evaluate(acct: AccountSeries, customer, products: pd.DataFrame, cfg, as_of, auto_on=False):
    """R1 해당이면 Finding, 아니면 None. auto_on: 그날 자동 RP가 켜져 있는지 (원화 계좌에만 적용)."""
    c = cfg["cash"]
    as_of = pd.Timestamp(as_of)
    if not acct.has(as_of):
        return None
    if acct.currency == "KRW" and auto_on:
        return None
    res = compute_idle(acct, cfg, as_of)
    if res.streak < c["min_idle_days"]:
        return None

    subtype, info = classify(acct, cfg, as_of)
    rec = recommend(subtype, acct.currency, res.idle_today_krw, res.rate_today, products, cfg)
    g = gate(customer, rec.candidates, products, cfg, as_of)
    if g["allowed"]:
        rec.product_id = g["allowed"][0]
    action = action_for(g["type"], rec.product_id, products)

    event_amount = info.get("event", {}).get("amount", 0)
    pb_flag = (res.idle_today_krw >= c["pb_threshold_krw"] or g["type"] == "pb_consult"
               or (subtype == "event_inflow" and event_amount >= c["pb_event_threshold_krw"]))

    cid = customer["customer_id"]
    key = f"R1-{acct.currency}-{cid}"
    return Finding(
        finding_id=f"{key}-{as_of:%Y%m%d}",
        customer_id=cid,
        rule="R1",
        subtype=subtype,
        currency=acct.currency,
        title=title_for(subtype, res, info, acct),
        amount_krw=res.missed_lookback,
        amount_label=f"지난 {res.lookback_days}일 놓친 이자",
        annual_projection_krw=res.annual_projection,
        deadline=None,
        evidence=evidence_for(subtype, res, info, acct, cfg) + g["evidence"],
        recommendation=rec,
        action=action,
        pb_flag=bool(pb_flag),
        meta={"key": key, "idle_krw": res.idle_today_krw, "streak": res.streak, "buffer_krw": res.buffer_krw,
              "max_outflow_krw": res.max_outflow_krw, "cash_today": res.cash_today, "rate_today": res.rate_today,
              "spread": res.spread, "swept_days": res.swept_days, "event": info.get("event"),
              "buy_days": info.get("buy_days"), "profile_valid": g["type"] != "reassess"},
    )
