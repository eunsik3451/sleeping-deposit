"""고객 분석(engine/profile.py): 보유 종목·거래 빈도로 관심 분야·스타일·맞춤 행사를 정한다."""
import pandas as pd

from engine import profile
from engine.config import load_config

A = pd.Timestamp("2026-10-16")
UNI = pd.DataFrame([
    {"symbol": "005930", "sector": "반도체", "tier": "우량"}, {"symbol": "000660", "sector": "반도체", "tier": "우량"},
    {"symbol": "NVDA", "sector": "반도체", "tier": "우량"}, {"symbol": "086520", "sector": "2차전지", "tier": "고변동"},
    {"symbol": "247540", "sector": "2차전지", "tier": "고변동"},
])
EVENTS = [{"id": "EV-SEMI", "tags": ["반도체"]}, {"id": "EV-BATT", "tags": ["2차전지"]}, {"id": "EV-SAFE", "tags": ["예수금 많음", "안정 추구"]}]
NO_FLOWS = pd.DataFrame(columns=["date", "customer_id", "currency", "flow_type", "amount"]).astype({"date": "datetime64[ns]"})


def pos(sym, krw, cur="KRW", loan=0):
    return {"symbol": sym, "name": sym, "currency": cur, "value_krw": krw, "credit_loan_krw": loan}


def test_semiconductor_bluechip_long_hold():
    cfg = load_config()
    p = profile.build("X", {"risk_profile": "위험중립형"}, [pos("005930", 21e6), pos("000660", 5e6), pos("NVDA", 4e6, "USD")],
                      NO_FLOWS, {"KRW": {"cash": 1e6, "auto_rp": 0}}, [], UNI, EVENTS, cfg, A)
    assert p["sectors"][0]["name"] == "반도체" and p["sectors"][0]["pct"] == 1.0
    assert p["style"] == "우량주 장기 보유" and "반도체 관심" in p["tags"] and "거래 적음" in p["tags"]
    assert "EV-SEMI" in p["events"] and p["gap"] is None


def test_stable_profile_with_volatile_stocks_flags_gap():
    cfg = load_config()
    flows = pd.DataFrame([{"date": A - pd.Timedelta(days=k), "customer_id": "Y", "currency": "KRW", "flow_type": "buy_settle", "amount": 1e6}
                          for k in range(0, 40, 4)])
    p = profile.build("Y", {"risk_profile": "안정형"}, [pos("086520", 8e6), pos("247540", 4e6)], flows,
                      {"KRW": {"cash": 2e6, "auto_rp": 0}}, [], UNI, EVENTS, cfg, A)
    assert p["style"] == "공격적 투자" and p["activity"] == "활발" and "고변동 선호" in p["tags"]
    assert p["gap"] and "안정형" in p["gap"]
    assert "EV-BATT" in p["events"] and "안정 추구" not in p["tags"]
    assert all("고위험 상품은 안내하지 않아요" in o["note"] for o in p["offers"] if "관련 상품" in o["t"])
