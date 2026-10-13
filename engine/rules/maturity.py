"""R4 만기 안내: 펀드·ELS 만기(상환) 예정.

만기 notice_days 전부터 알려, 상환금이 들어온 뒤 예수금으로 잠자지 않게 미리 계획하도록 돕는다.
금액은 '상환금이 한 달 쉬면 못 받는 이자' = 예상 상환금 × spread × 30 / 365.
재투자를 권유하지 않는다. ELS 상환금은 조건을 충족할 때의 예정 금액이라 확정이 아니다.
"""
import pandas as pd

from engine.cash.idle import floor_won, spread
from engine.fmt import won
from engine.models import Action, Finding

IDLE_DAYS = 30


def evaluate(rows: pd.DataFrame, customer, cfg, as_of) -> list:
    as_of = pd.Timestamp(as_of)
    c = cfg["maturity"]
    out = []
    if rows is None or rows.empty:
        return out
    for _, r in rows.iterrows():
        days_left = (r.maturity_date - as_of).days
        if not 0 < days_left <= c["notice_days"]:
            continue
        expected = float(r.expected_amount_krw)
        missed = floor_won(expected * spread(cfg, "KRW") * IDLE_DAYS / 365)
        cid = customer["customer_id"]
        key = f"R4-{cid}-{r.holding_id}"
        sure = "예정 금액" if r.kind == "펀드" else "상환 조건을 충족하면 들어올 예정 금액 (확정 아님)"
        out.append(Finding(
            finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R4", subtype="maturity",
            currency="KRW", title=f"{r.product_name} 만기가 {days_left}일 남았어요",
            amount_krw=missed, amount_label="상환금이 한 달 쉬면 못 받는 이자", annual_projection_krw=0,
            deadline=f"{r.maturity_date:%Y-%m-%d}",
            evidence=[
                f"{r.kind} {r.product_name}, 만기일 {r.maturity_date:%Y-%m-%d} (D-{days_left})",
                f"상환금 {won(expected)}: {sure}",
                "상환금은 예수금으로 들어오며, 그대로 두면 예탁금 이용료만 붙음",
                f"한 달 그대로 두면 못 받는 이자 {won(missed)} = {won(expected)} × 금리 차이 × {IDLE_DAYS}일 / 365",
                "재투자를 권유하는 안내가 아니라 만기 일정을 미리 알려드리는 정보",
            ],
            recommendation=None,
            action=Action("maturity_plan", "만기 후 계획 정하기"),
            pb_flag=expected >= c["pb_threshold_krw"],
            meta={"key": key, "product_name": r.product_name, "kind": r.kind, "expected": expected,
                  "deadline": r.maturity_date, "days_left": days_left},
        ))
    return out
