"""M2 골든 테스트 C1~C11 (CLAUDE.md 11장) + 데모 페르소나 확인."""
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from engine.config import load_config  # noqa: E402
from engine.runner import make_context, run  # noqa: E402
from fixtures.cases import A, CID, day, make_data  # noqa: E402

M = 1_000_000

GOLDEN = {"cash": {"krw_rp_rate": 0.025, "krw_deposit_rate": 0.005, "usd_rp_rate": 0.035,
                   "usd_deposit_rate": 0.005, "min_buffer_krw": 1_000_000, "min_idle_amount_krw": 5_000_000,
                   "min_idle_days": 7, "min_sweep_krw": 1_000_000, "lookback_days": 90}}


@pytest.fixture(scope="module")
def cfg():
    return load_config(overrides=GOLDEN)


def evaluate(cfg, **kw):
    data = make_data(cfg, **kw)
    result = run(make_context(data), cfg, A)
    assert len(result.findings) <= 1
    return (result.findings[0] if result.findings else None), result


def test_c1_flat_30m(cfg):
    f, _ = evaluate(cfg, cash=30 * M)
    assert f.meta["buffer_krw"] == 1 * M
    assert f.subtype == "long_idle"
    assert f.amount_krw == 143_013
    assert f.annual_projection_krw == 580_000


def test_c2_buffer_from_largest_outflow(cfg):
    f, _ = evaluate(cfg, cash=lambda k: 40 * M if k >= 40 else 30 * M, flows=[(39, "buy_settle", 10 * M)])
    assert f.meta["buffer_krw"] == 10 * M
    assert f.amount_krw == 126_027
    assert f.annual_projection_krw == 400_000
    assert f.subtype == "long_idle"


def test_c3_active_trader_gets_auto_rp_only(cfg):
    trades = []
    for k in (2, 5, 9, 15, 22):
        trades += [(k, "buy_settle", 2 * M), (k, "sell_settle", 2 * M)]
    f, _ = evaluate(cfg, cash=20 * M, flows=trades)
    assert f.meta["buffer_krw"] == 2 * M
    assert f.subtype == "active_trader"
    assert f.amount_krw == 88_767
    assert f.recommendation.candidates == ["AUTO_RP"]
    assert f.recommendation.product_id == "AUTO_RP"
    assert f.recommendation.alt is None


def test_c4_event_inflow(cfg):
    f, _ = evaluate(cfg, cash=lambda k: 1.5 * M if k >= 13 else 31.5 * M, flows=[(12, "els_redemption", 30 * M)])
    assert f.meta["buffer_krw"] == 1 * M
    assert f.meta["streak"] == 13
    assert f.meta["swept_days"] == 13          # 이전 idle 500,000원은 min_sweep 미만이라 제외
    assert f.subtype == "event_inflow"
    assert f.amount_krw == 21_726
    assert f.title == "ELS 상환금 3,000만원이 12일째 쉬고 있어요"


def test_c5_unsettled_buy_is_not_idle(cfg):
    f, _ = evaluate(cfg, cash=30 * M, unsettled=29 * M)
    assert f is None


def test_c6_streak_too_short(cfg):
    f, _ = evaluate(cfg, cash=lambda k: 7 * M if k <= 4 else 1 * M)
    assert f is None


def test_c7_usd_idle(cfg):
    f, _ = evaluate(cfg, cash=8000.0, currency="USD", fx=1400.0)
    assert f.meta["idle_krw"] == 10_200_000
    assert f.subtype == "fx_idle"
    assert f.amount_krw == 75_452
    assert f.recommendation.product_id == "USD_RP"
    assert f.recommendation.alt is None


def test_c8_expired_profile_reassess(cfg):
    f, _ = evaluate(cfg, cash=30 * M, customer={"risk_profile": "안정형", "risk_profile_date": day(400)})
    assert f is not None and f.amount_krw == 143_013     # 사실 정보는 그대로
    assert f.action.type == "reassess"
    assert any("유효기간" in e for e in f.evidence)


def test_c9_valid_profile_rp_buy(cfg):
    f, _ = evaluate(cfg, cash=30 * M, customer={"risk_profile": "안정형", "risk_profile_date": day(100)})
    assert f.action.type == "rp_buy"


def test_c10_auto_rp_customer_gets_found_money(cfg):
    f, result = evaluate(cfg, cash=30 * M, auto_on_k=30)
    assert f is None
    assert CID in result.found and result.found[CID]["found_krw"] > 0


def test_c11_suggestion_excludes_term_rp_below_minimum(cfg):
    f, _ = evaluate(cfg, cash=30 * M)
    rec = f.recommendation
    assert rec.suggest_amount == 29_000_000
    assert not {"RP_T30", "RP_T90"} & set(rec.candidates)
    assert rec.alt == "auto_rp"


def test_term_rp_offered_when_long_idle_and_large(cfg):
    f, _ = evaluate(cfg, cash=50 * M)
    assert f.recommendation.product_id == "RP_T90"        # 금리 높은 순


def test_no_allowed_product_goes_to_pb(cfg):
    strict = load_config(overrides={**GOLDEN, "suitability": {"risk_matrix": {"위험중립형": [1]}}})
    data = make_data(strict, cash=30 * M)
    f = run(make_context(data), strict, A).findings[0]
    assert f.action.type == "pb_consult" and f.pb_flag


# ── 데모 페르소나 (CLAUDE.md 11장 표) ──

@pytest.fixture(scope="module")
def demo():
    sys.path.insert(0, str(ROOT / "scripts"))
    from generate_demo_data import generate
    cfg = load_config()
    data = generate(cfg)
    return cfg, run(make_context(data), cfg)


def by_key(result, cid, cur):
    return next((f for f in result.findings if f.rule == "R1" and f.customer_id == cid and f.currency == cur), None)


def test_p001_active_trader_and_fx(demo):
    _, r = demo
    krw, usd = by_key(r, "P001", "KRW"), by_key(r, "P001", "USD")
    assert krw.subtype == "active_trader" and krw.recommendation.candidates == ["AUTO_RP"]
    assert usd.subtype == "fx_idle" and usd.recommendation.product_id == "USD_RP"
    assert usd.title == "달러 예수금 $8,000이 30일째 그대로예요"


def test_p002_event_inflow_pb(demo):
    _, r = demo
    f = by_key(r, "P002", "KRW")
    assert f.subtype == "event_inflow" and f.pb_flag and f.action.type == "rp_buy"
    assert f.title == "ELS 상환금 3,000만원이 12일째 쉬고 있어요"


def test_p003_long_idle_reassess(demo):
    _, r = demo
    f = by_key(r, "P003", "KRW")
    assert f.subtype == "long_idle" and f.action.type == "reassess" and f.pb_flag
    assert f.title == "예수금 8,000만원이 90일째 그대로예요"


def test_p004_found_money(demo):
    cfg, r = demo
    assert by_key(r, "P004", "KRW") is None
    found = r.found["P004"]
    assert found["days"] == 61
    assert found["found_krw"] == int(23 * M * cfg["cash"]["krw_rp_rate"] * 61 / 365)


def test_demo_has_every_subtype(demo):
    _, r = demo
    subtypes = pd.Series([f.subtype for f in r.findings if f.rule == "R1"]).value_counts()
    assert set(subtypes.index) == {"long_idle", "event_inflow", "active_trader", "fx_idle"}
