"""R3 권리 안내: 보유 종목 유상증자 청약.

청약 시작 notice_days 전부터 마감일까지, 보유 수량 × 배정 비율만큼 신주를 받을 수 있고
현재가 > 청약가이면 (현재가 − 청약가) × 배정 주식 수를 '현재가 기준 차이'로 보여준다.
청약을 권유하는 것이 아니라 고객이 가진 권리와 마감일을 알려주는 정보다.
"""
import math

import pandas as pd

from engine.cash.idle import floor_won
from engine.fmt import md, won
from engine.models import Action, Finding


def evaluate(holdings: pd.DataFrame, offers: pd.DataFrame, customer, cfg, as_of) -> list:
    as_of = pd.Timestamp(as_of)
    c = cfg["rights_offer"]
    out = []
    if holdings is None or holdings.empty or offers is None or offers.empty:
        return out
    notice = pd.Timedelta(days=c["notice_days"])
    live = offers[(offers.sub_start - notice <= as_of) & (offers.sub_end >= as_of)]
    for _, o in live.iterrows():
        for _, h in holdings[holdings.symbol == o.symbol].iterrows():
            qty, now, price = int(h.qty), float(h.current_price), float(o.issue_price)
            shares = math.floor(qty * float(o.ratio))
            if shares <= 0 or now <= price:
                continue
            gap = floor_won((now - price) * shares)
            days_left = (o.sub_end - as_of).days
            cid = customer["customer_id"]
            key = f"R3-{cid}-{o.offer_id}"
            out.append(Finding(
                finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R3", subtype="rights_offer",
                currency="KRW", title=f"{o['name']} 유상증자 청약이 {md(o.sub_end)}에 마감돼요",
                amount_krw=gap, amount_label="현재가 기준 청약가와의 차이", annual_projection_krw=0,
                deadline=f"{o.sub_end:%Y-%m-%d}",
                evidence=[
                    f"{o['name']} {qty:,}주 보유, 1주당 신주 {float(o.ratio):g}주 배정 → {shares:,}주 청약 가능",
                    f"청약가 {won(price)}, 현재가 {won(now)}",
                    f"현재가 기준 차이 {won(gap)} = ({won(now)} − {won(price)}) × {shares:,}주",
                    f"청약 기간 {o.sub_start:%Y-%m-%d} ~ {o.sub_end:%Y-%m-%d} (D-{days_left})",
                    "청약하지 않으면 신주를 받지 못하고, 주가가 바뀌면 차이도 달라짐. 청약 권유가 아닌 권리 안내",
                ],
                recommendation=None,
                action=Action("rights_check", "청약 내용 확인하기"),
                pb_flag=gap >= c["pb_threshold_krw"],
                meta={"key": key, "stock": o["name"], "qty": qty, "shares": shares, "now": now,
                      "issue_price": price, "start": o.sub_start, "deadline": o.sub_end, "days_left": days_left},
            ))
    return out
