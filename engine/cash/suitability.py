"""투자성향 유효성·위험등급 게이트 (CLAUDE.md 6.6)."""
import pandas as pd

from engine.cash.recommend import product_records

RISK_GRADE_LABEL = {1: "매우 높은 위험", 2: "높은 위험", 3: "다소 높은 위험",
                    4: "보통 위험", 5: "낮은 위험", 6: "매우 낮은 위험"}


def profile_valid(customer, cfg, as_of) -> bool:
    days = (pd.Timestamp(as_of) - pd.Timestamp(customer["risk_profile_date"])).days
    return days <= cfg["suitability"]["risk_profile_valid_days"]


def allowed_grades(customer, cfg) -> list:
    return cfg["suitability"]["risk_matrix"].get(customer["risk_profile"], [])


def gate(customer, product_ids: list, products: pd.DataFrame, cfg, as_of) -> dict:
    """{"type": rp_buy|reassess|pb_consult, "allowed": [...], "evidence": [...]}"""
    diag = pd.Timestamp(customer["risk_profile_date"]).strftime("%Y-%m-%d")
    valid_days = cfg["suitability"]["risk_profile_valid_days"]
    grades = allowed_grades(customer, cfg)
    by_id = {r["product_id"]: r for r in product_records(products)}
    allowed = [pid for pid in product_ids if int(by_id[pid]["risk_grade"]) in grades]

    if cfg["suitability"].get("check_profile_expiry", False) and not profile_valid(customer, cfg, as_of):
        return {"type": "reassess", "allowed": allowed,
                "evidence": [f"투자성향 진단일 {diag}, 유효기간({valid_days}일) 경과 → 다시 진단 후 실행 가능"]}
    if not allowed:
        return {"type": "pb_consult", "allowed": [],
                "evidence": [f"투자성향 {customer['risk_profile']}(진단일 {diag})에 맞는 운용 상품 없음 → PB 상담"]}
    grade = int(by_id[allowed[0]]["risk_grade"])
    when = f"(진단일 {diag}, 유효) " if cfg["suitability"].get("check_profile_expiry", False) else ""
    return {"type": "rp_buy", "allowed": allowed,
            "evidence": [f"투자성향 {customer['risk_profile']}{when}· "
                         f"상품 위험등급 {grade}등급({RISK_GRADE_LABEL[grade]}) 허용"]}
