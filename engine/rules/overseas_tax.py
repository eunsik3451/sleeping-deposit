"""R2 해외주식 양도세 (CLAUDE.md 부록 A). 유진 계좌 손익만 기준.

- 실현이익 > 기본공제이고 평가손실 종목이 있으면: min(손실합, 실현이익 − 공제) × 세율 (손실 상계)
- 실현이익 < 기본공제이고 평가이익 종목이 있으면: min(공제 − 실현이익, 이익합) × 세율 (공제 채우기)
매도를 권유하는 것이 아니라 올해 세금에 영향을 주는 사실을 알려주는 정보다.
"""
import pandas as pd

from engine.cash.idle import floor_won
from engine.fmt import man, md, pct, won
from engine.models import Action, Finding


def evaluate(row, customer, cfg, as_of):
    if row is None:
        return None
    c = cfg["overseas_tax"]
    as_of = pd.Timestamp(as_of)
    last = pd.Timestamp(c["last_sell_date"])
    if as_of > last:
        return None
    ded, rate = c["basic_deduction_krw"], c["tax_rate"]
    realized = float(row["realized_gain_krw"])
    loss, gain = float(row["unrealized_loss_krw"]), float(row["unrealized_gain_krw"])

    if realized > ded and loss > 0:
        subtype, base = "tax_loss_harvest", min(loss, realized - ded)
        title_core = f"해외주식 세금 약 {man(floor_won(base * rate))}을 줄일 수 있어요"
        how = (f"평가손실 {won(loss)} 중 {won(base)}을 올해 실현하면 과세 대상 이익이 줄어듦 "
               f"(실현이익 {won(realized)} − 기본공제 {won(ded)} = {won(realized - ded)} 한도)")
    elif realized < ded and gain > 0:
        subtype, base = "tax_deduction_fill", min(ded - realized, gain)
        title_core = f"해외주식 기본공제 {man(ded - realized)}이 남아 있어요"
        how = (f"평가이익 {won(gain)} 중 {won(base)}을 올해 실현하면 공제 안에서 세금 없이 이익 확정 "
               f"(기본공제 {won(ded)} − 실현이익 {won(realized)} = {won(ded - realized)} 남음)")
    else:
        return None

    saving = floor_won(base * rate)
    if saving <= 0:
        return None
    days_left = (last - as_of).days
    cid = customer["customer_id"]
    key = f"R2-{cid}"
    return Finding(
        finding_id=f"{key}-{as_of:%Y%m%d}", customer_id=cid, rule="R2", subtype=subtype, currency="KRW",
        title=title_core, amount_krw=saving, amount_label="올해 줄일 수 있는 세금", annual_projection_krw=0,
        deadline=f"{last:%Y-%m-%d}",
        evidence=[
            f"올해 유진 계좌 해외주식 실현이익 {won(realized)}, 평가손실 {won(loss)}, 평가이익 {won(gain)}",
            how,
            f"줄어드는 세금 {won(saving)} = {won(base)} × 세율 {pct(rate)}",
            f"올해 결제되는 마지막 매도일 {last:%Y-%m-%d} (D-{days_left})",
            "다른 증권사 해외주식 손익은 반영하지 않음. 매도 권유가 아닌 세금 정보",
        ],
        recommendation=None,
        action=Action("tax_check", "보유 종목 손익 확인하기"),
        pb_flag=saving >= c["pb_threshold_krw"],
        meta={"key": key, "realized": realized, "loss": loss, "gain": gain, "base": base, "deduction": ded,
              "deduction_left": max(0.0, ded - realized), "days_left": days_left, "deadline": last},
    )
