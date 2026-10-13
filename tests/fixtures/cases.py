"""골든 테스트용 작은 데이터 만들기. k = 기준일 A로부터 며칠 전인지."""
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_demo_data import products as demo_products  # noqa: E402

A = pd.Timestamp("2026-06-30")
CID = "T001"


def day(k):
    return A - pd.Timedelta(days=k)


def make_data(cfg, cash, flows=(), currency="KRW", unsettled=None, fx=1400.0, days=90,
              customer=None, auto_on_k=None):
    """cash, unsettled: k → 금액 함수 또는 상수. flows: [(k, flow_type, amount)]."""
    as_fn = (lambda v: v if callable(v) else (lambda k: v))
    cash_fn, uns_fn = as_fn(cash), as_fn(unsettled or 0)
    ks = range(days - 1, -1, -1)
    balances = pd.DataFrame({
        "date": [day(k) for k in ks], "customer_id": CID, "currency": currency,
        "cash": [cash_fn(k) for k in ks], "unsettled_buy": [uns_fn(k) for k in ks],
        "margin_required": 0, "auto_rp_balance": 0,
    })
    flow_df = pd.DataFrame([{"date": day(k), "customer_id": CID, "currency": currency,
                             "flow_type": t, "amount": a} for k, t, a in flows],
                           columns=["date", "customer_id", "currency", "flow_type", "amount"])
    cust = {"customer_id": CID, "name": "테스트", "birth_year": 1975, "risk_profile": "위험중립형",
            "risk_profile_date": day(100), "income_band": "mid", "pb_id": "PB01",
            "auto_rp_enabled": False, "auto_rp_keep_krw": 0,
            "consent_push_ad": True, "consent_kakao_ad": True, "consent_night_ad": False}
    cust.update(customer or {})
    log = []
    if auto_on_k is not None:
        cust["auto_rp_enabled"] = True
        log.append({"timestamp": f"{day(auto_on_k):%Y-%m-%d} 09:00", "customer_id": CID,
                    "finding_id": "", "action": "auto_rp_on"})
    return {
        "customers": pd.DataFrame([cust]),
        "cash_balances_daily": balances,
        "cash_flows": flow_df,
        "products": demo_products(cfg),
        "fx_rates": pd.DataFrame({"date": [day(k) for k in ks], "currency": "USD", "rate": fx}),
        "action_log": pd.DataFrame(log, columns=["timestamp", "customer_id", "finding_id", "action"]),
    }
