"""운용 방법 매칭과 금액 (CLAUDE.md 6.5)."""
import math

import pandas as pd

from engine.models import Recommendation

# 유형별로 제안할 수 있는 상품 종류. 매매대기형은 매수 시 자동 해지되는 자동 RP만,
# 외화는 외화 RP만 (환전 권유 금지). 약정식 RP는 장기방치형 + 금액 조건일 때만 (아래 필터).
ALLOWED_TYPES = {
    "long_idle": ("on_demand_rp", "term_rp", "cma"),
    "event_inflow": ("on_demand_rp", "cma"),
    "active_trader": ("auto_rp",),
    "fx_idle": ("usd_rp",),
}

KRW_STEP = 100_000
USD_STEP = 100


def suggest_amount(currency, idle_krw, rate_today) -> float:
    if currency == "KRW":
        return math.floor(idle_krw / KRW_STEP + 1e-9) * KRW_STEP
    return math.floor(idle_krw / rate_today / USD_STEP + 1e-9) * USD_STEP


def product_records(products: pd.DataFrame) -> list:
    """상품표 → dict 목록 (한 번만 변환해 DataFrame에 붙여 둔다)."""
    rec = products.attrs.get("_records")
    if rec is None or len(rec) != len(products):
        rec = products.to_dict("records")
        products.attrs["_records"] = rec
    return rec


def candidates(subtype, currency, amount, products: pd.DataFrame, cfg) -> list:
    term_ok = subtype == "long_idle" and amount >= cfg["cash"]["term_rp_min_krw"]
    p = [r for r in product_records(products)
         if r["currency"] == currency and r["product_type"] in ALLOWED_TYPES[subtype]
         and r["min_amount"] <= amount and (term_ok or r["product_type"] != "term_rp")]
    # 금리 높은 순, 같으면 수시(term_days 0) 우선
    return sorted(p, key=lambda r: (-r["annual_rate"], r["term_days"]))


def recommend(subtype, currency, idle_krw, rate_today, products, cfg) -> Recommendation:
    amount = suggest_amount(currency, idle_krw, rate_today)
    cands = [r["product_id"] for r in candidates(subtype, currency, amount, products, cfg)]
    alt = "auto_rp" if currency == "KRW" and subtype != "active_trader" else None
    return Recommendation(product_id=cands[0] if cands else None, suggest_amount=amount, alt=alt, candidates=cands)
