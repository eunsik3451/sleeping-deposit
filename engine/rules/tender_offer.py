"""R3 공개매수 (CLAUDE.md 부록 A).

공개매수 기간 중 대상 종목을 보유하고 있고 현재가 < 공개매수가이면 (공개매수가 − 현재가) × 수량.
"""
import pandas as pd

from engine.cash.idle import floor_won
from engine.fmt import man, won
from engine.models import Action, Finding


def evaluate(holdings: pd.DataFrame, offers: pd.DataFrame, customer, cfg, as_of) -> list:
    as_of = pd.Timestamp(as_of)
    out = []
    if holdings is None or holdings.empty or offers is None or offers.empty:
        return out
    live = offers[(offers.start_date <= as_of) & (offers.end_date >= as_of)]
    for _, o in live.iterrows():
        for _, h in holdings[holdings.symbol == o.symbol].iterrows():
            qty, now, price = int(h.qty), float(h.current_price), float(o.offer_price)
            if qty <= 0 or now >= price:
                continue
            gap = floor_won((price - now) * qty)
            days_left = (o.end_date - as_of).days
            cid = customer["customer_id"]
            key = f"R3-{cid}-{o.offer_id}"
            out.append(Finding(
                finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R3", subtype="tender_offer",
                currency="KRW", title=f"{o['name']} 공개매수에 응하면 약 {man(gap)}을 더 받을 수 있어요",
                amount_krw=gap, amount_label="시장가보다 더 받는 금액", annual_projection_krw=0,
                deadline=f"{o.end_date:%Y-%m-%d}",
                evidence=[
                    f"{o['name']} {qty:,}주 보유, 현재가 {won(now)}, 공개매수가 {won(price)}",
                    f"차이 {won(gap)} = ({won(price)} − {won(now)}) × {qty:,}주",
                    f"청약 기간 {o.start_date:%Y-%m-%d} ~ {o.end_date:%Y-%m-%d} (D-{days_left})",
                    "청약이 목표 수량보다 많으면 일부만 매수(안분)될 수 있음",
                    "장외 양도라 양도소득세·증권거래세가 붙을 수 있음 (확인 필요)",
                ],
                recommendation=None,
                action=Action("tender_apply", "공개매수 청약하기"),
                pb_flag=gap >= cfg["tender_offer"]["pb_threshold_krw"],
                meta={"key": key, "stock": o["name"], "qty": qty, "now": now, "offer_price": price,
                      "start": o.start_date, "deadline": o.end_date, "days_left": days_left},
            ))
    return out
