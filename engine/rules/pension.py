"""R5 연금저축 세액공제.

10~12월, 유진 연금저축 계좌가 있는 고객: (연 한도 − 올해 납입) × 공제율 (총급여 낮으면 16.5%).
IRP는 유진 미취급이라 합산 한도를 안내하지 않는다.
"""
import pandas as pd

from engine.cash.idle import floor_won
from engine.fmt import man, pct, won
from engine.models import Action, Finding


def evaluate(row, customer, cfg, as_of):
    if row is None:
        return None
    c = cfg["pension"]
    as_of = pd.Timestamp(as_of)
    deadline = pd.Timestamp(c["deadline"])
    if as_of.month < c["start_month"] or as_of > deadline:
        return None
    limit, paid = float(c["annual_limit_krw"]), float(row["paid_ytd_krw"])
    remain = limit - paid
    if remain <= 0:
        return None
    low = str(customer.get("income_band", "")) == "low"
    rate = c["credit_rate_low_income"] if low else c["credit_rate"]
    refund = floor_won(remain * rate)
    days_left = (deadline - as_of).days
    cid = customer["customer_id"]
    key = f"R5-{cid}"
    return Finding(
        finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R5", subtype="pension_credit", currency="KRW",
        title=f"연금저축 세액공제 약 {man(refund)}을 더 받을 수 있어요",
        amount_krw=refund, amount_label="더 받을 수 있는 세액공제", annual_projection_krw=0,
        deadline=f"{deadline:%Y-%m-%d}",
        evidence=[
            f"올해 유진 연금저축 납입 {won(paid)}, 세액공제 한도 {won(limit)} → 남은 한도 {won(remain)}",
            f"더 받을 수 있는 공제 {won(refund)} = {won(remain)} × 공제율 {pct(rate)}"
            + (" (총급여 낮은 구간)" if low else ""),
            f"{deadline:%Y-%m-%d}까지 납입분만 올해 공제 (D-{days_left})",
            "다른 금융사 연금저축 납입분은 반영하지 않음. IRP는 유진 미취급이라 안내하지 않음",
            "연금저축계좌는 펀드·ETF 등에 투자해 원금 손실이 날 수 있고 예금자보호 대상이 아님",
        ],
        recommendation=None,
        action=Action("pension_deposit", "연금저축 입금하기"),
        pb_flag=False,
        meta={"key": key, "paid": paid, "limit": limit, "remain": remain, "rate": rate, "low_income": low,
              "deadline": deadline, "days_left": days_left},
    )
