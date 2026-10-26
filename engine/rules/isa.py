"""R5 ISA(중개형) 비과세 안내.

10~12월 연말 점검: 유진 ISA 계좌가 있고 올해 납입 한도가 남은 고객에게, ISA로 투자하면 순이익 비과세 한도
(일반형 200만원·서민형 400만원)만큼 일반 계좌보다 세금을 덜 낸다는 것을 금액으로 알린다.
아낄 수 있는 세금(최대) = 비과세 한도 × 일반 계좌 이자·배당소득세율(15.4%). 남은 납입 한도는 다음 해로 이월된다.
기준값은 2026년 현행 조세특례제한법 기준(한도 확대 개정안은 국회 계류 중) — config `isa:`, 확인 필요.
"""
import pandas as pd

from engine.cash.idle import floor_won
from engine.fmt import man, pct, won
from engine.models import Action, Finding


def evaluate(row, customer, cfg, as_of):
    if row is None:
        return None
    c = cfg["isa"]
    as_of = pd.Timestamp(as_of)
    deadline = pd.Timestamp(c["deadline"])
    if as_of.month < c["start_month"] or as_of > deadline:
        return None
    limit, paid = float(c["annual_limit_krw"]), float(row["paid_ytd_krw"])
    remain = limit - paid
    if remain <= 0:
        return None
    low = str(customer.get("income_band", "")) == "low"
    tax_free = float(c["tax_free_low_income_krw"] if low else c["tax_free_krw"])
    saving = floor_won(tax_free * c["general_rate"])
    days_left = (deadline - as_of).days
    cid = customer["customer_id"]
    key = f"R5-{cid}"
    kind = "서민형" if low else "일반형"
    return Finding(
        finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R5", subtype="isa_tax_free", currency="KRW",
        title=f"ISA 비과세로 세금 약 {man(saving)}을 아낄 수 있어요",
        amount_krw=saving, amount_label="ISA 비과세로 아낄 수 있는 세금(최대)", annual_projection_krw=0,
        deadline=f"{deadline:%Y-%m-%d}",
        evidence=[
            f"올해 유진 ISA 납입 {won(paid)}, 연 납입 한도 {won(limit)} → 남은 한도 {won(remain)} (안 쓴 한도는 다음 해로 이월)",
            f"ISA({kind})는 순이익 {won(tax_free)}까지 비과세, 넘는 이익은 {pct(c['over_rate'])} 분리과세",
            f"아낄 수 있는 세금(최대) {won(saving)} = 비과세 한도 {won(tax_free)} × 일반 계좌 이자·배당소득세율 {pct(c['general_rate'])}",
            f"의무가입 기간 {c['min_years']}년. 중도 해지하면 비과세 혜택을 받지 못할 수 있음",
            "ISA에 담는 주식·펀드·ETF 등은 원금 손실이 날 수 있고 예금자보호 대상이 아님",
        ],
        recommendation=None,
        action=Action("isa_deposit", "ISA 입금하기"),
        pb_flag=False,
        meta={"key": key, "paid": paid, "limit": limit, "remain": remain, "tax_free": tax_free, "kind": kind,
              "over_rate": c["over_rate"], "general_rate": c["general_rate"], "min_years": c["min_years"],
              "low_income": low, "deadline": deadline, "days_left": days_left},
    )
