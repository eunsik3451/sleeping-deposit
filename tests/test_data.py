"""M1: config 로더, adapter(column_map), 가상 데이터·페르소나 고정값 검증."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from engine.adapter import SCHEMA, load_all, load_table, save_table  # noqa: E402
from engine.config import load_config  # noqa: E402
from engine.models import OUTFLOW_TYPES  # noqa: E402
from generate_demo_data import generate  # noqa: E402

M = 1_000_000


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture(scope="module")
def data(cfg):
    return generate(cfg)


@pytest.fixture(scope="module")
def as_of(cfg):
    return pd.Timestamp(cfg["as_of_date"])


def series(data, cid, currency, col="cash"):
    b = data["cash_balances_daily"]
    return b[(b.customer_id == cid) & (b.currency == currency)].set_index("date")[col]


# ── config ──

def test_config_loads_spec_values(cfg):
    pd.Timestamp(str(cfg["as_of_date"]))          # 기준일은 아침 점검이 실제 날짜로 바꾼다 (날짜 형식만 확인)
    assert cfg["cash"]["min_idle_amount_krw"] == 5_000_000
    assert cfg["suitability"]["risk_matrix"]["안정형"] == [6]


def test_config_overrides_merge_without_losing_siblings():
    cfg = load_config(overrides={"cash": {"min_idle_days": 3}})
    assert cfg["cash"]["min_idle_days"] == 3
    assert cfg["cash"]["lookback_days"] == 90


# ── adapter ──

def test_adapter_applies_column_map(tmp_path):
    raw = pd.DataFrame({"DT": ["2026-12-01"], "CUST_NO": ["X1"], "CRNCY": ["USD"], "RATE_VAL": [1400.5]})
    (tmp_path / "demo").mkdir()
    raw.to_csv(tmp_path / "demo" / "fx_rates.csv", index=False)
    cmap = {"fx_rates": {"date": "DT", "currency": "CRNCY", "rate": "RATE_VAL"}}
    df = load_table("fx_rates", tmp_path, cmap)
    assert list(df.columns) == SCHEMA["fx_rates"]["columns"]
    assert df.loc[0, "rate"] == 1400.5 and df["date"].dtype.kind == "M"


def test_adapter_reports_missing_columns(tmp_path):
    (tmp_path / "demo").mkdir()
    pd.DataFrame({"date": ["2026-12-01"], "rate": [1]}).to_csv(tmp_path / "demo" / "fx_rates.csv", index=False)
    with pytest.raises(ValueError, match="currency"):
        load_table("fx_rates", tmp_path, {})


def test_save_then_load_roundtrip(tmp_path, data):
    for name in SCHEMA:
        save_table(data[name], name, tmp_path, {})
    loaded = load_all(tmp_path, {})
    assert len(loaded["customers"]) == 300
    assert loaded["customers"]["auto_rp_enabled"].dtype == bool
    assert loaded["action_log"]["finding_id"].eq("").all()
    assert len(loaded["cash_balances_daily"]) == len(data["cash_balances_daily"])


# ── 가상 데이터 ──

def test_generation_is_deterministic(cfg, data):
    again = generate(cfg)
    for name in ("customers", "cash_balances_daily", "cash_flows", "fx_rates"):
        pd.testing.assert_frame_equal(data[name], again[name])


def test_different_seed_changes_generic_customers_only(cfg, data):
    other = generate(cfg, seed=7)
    c1, c2 = data["customers"], other["customers"]
    pd.testing.assert_frame_equal(c1[c1.customer_id.str.startswith("P")], c2[c2.customer_id.str.startswith("P")])
    assert not c1.equals(c2)


def test_shape_and_distribution(cfg, data, as_of):
    c = data["customers"]
    assert len(c) == cfg["demo"]["n_customers"] and c.customer_id.is_unique
    b = data["cash_balances_daily"]
    assert b.groupby(["customer_id", "currency"]).size().eq(cfg["demo"]["history_days"]).all()
    assert b["date"].max() == as_of

    seg = pd.Series(data["_segments"]).value_counts(normalize=True)
    assert 0.12 <= seg["long_idle"] <= 0.18
    assert 0.08 <= c.auto_rp_enabled.mean() <= 0.12
    expired = ((as_of - c.risk_profile_date).dt.days > cfg["suitability"]["risk_profile_valid_days"]).mean()
    assert 0.15 <= expired <= 0.30
    no_ad = (~c.consent_push_ad & ~c.consent_kakao_ad).mean()
    assert 0.22 <= no_ad <= 0.38


def test_balances_follow_flows(data):
    """잔고(예수금 + 자동 RP) 일별 변화 = 그날 흐름 합. 음수 잔고 없음."""
    b = data["cash_balances_daily"].copy()
    b["total"] = b["cash"].astype(float) + b["auto_rp_balance"].astype(float)
    assert (b["cash"].astype(float) >= 0).all()

    f = data["cash_flows"].copy()
    f["signed"] = np.where(f.flow_type.isin(OUTFLOW_TYPES), -1, 1) * f["amount"].astype(float)
    net = f.groupby(["customer_id", "currency", "date"])["signed"].sum()

    b = b.sort_values(["customer_id", "currency", "date"])
    b["delta"] = b.groupby(["customer_id", "currency"])["total"].diff()
    b = b.dropna(subset=["delta"]).set_index(["customer_id", "currency", "date"])
    expected = net.reindex(b.index, fill_value=0.0)
    assert np.allclose(b["delta"], expected, atol=0.01)


def test_products_match_config(cfg, data):
    p = data["products"].set_index("product_id")
    assert set(p.product_type) == {"auto_rp", "on_demand_rp", "term_rp", "cma", "usd_rp"}
    assert p.loc["AUTO_RP", "annual_rate"] == cfg["cash"]["krw_rp_rate"]
    assert p.loc["USD_RP", "annual_rate"] == cfg["cash"]["usd_rp_rate"]
    assert (p.risk_grade == 6).all()


# ── 페르소나 (CLAUDE.md 11장 표) ──

def test_p001_active_trader_and_usd(data, as_of):
    c = data["customers"].set_index("customer_id").loc["P001"]
    assert as_of.year - c.birth_year == 34 and c.risk_profile == "공격투자형"
    assert (series(data, "P001", "KRW") == 15 * M).all()
    f = data["cash_flows"]
    recent_buys = f[(f.customer_id == "P001") & (f.flow_type == "buy_settle")
                    & (f.date > as_of - pd.Timedelta(days=30))]
    assert recent_buys.date.nunique() == 6
    usd = series(data, "P001", "USD")
    assert (usd.iloc[-30:] == 8000).all() and usd.iloc[-31] == 0


def test_p002_els_redemption_12_days_ago(data, as_of):
    c = data["customers"].set_index("customer_id").loc["P002"]
    assert as_of.year - c.birth_year == 52 and c.risk_profile == "위험중립형" and c.consent_push_ad
    f = data["cash_flows"]
    els = f[(f.customer_id == "P002") & (f.flow_type == "els_redemption")]
    assert len(els) == 1 and els.iloc[0].amount == 30 * M
    assert els.iloc[0].date == as_of - pd.Timedelta(days=12)
    assert (series(data, "P002", "KRW").iloc[-13:] == 31.5 * M).all()


def test_p003_long_idle_expired_no_consent(cfg, data, as_of):
    c = data["customers"].set_index("customer_id").loc["P003"]
    assert as_of.year - c.birth_year == 67 and c.risk_profile == "안정형"
    assert (as_of - c.risk_profile_date).days > cfg["suitability"]["risk_profile_valid_days"]
    assert not (c.consent_push_ad or c.consent_kakao_ad or c.consent_night_ad)
    krw = series(data, "P003", "KRW")
    assert (krw.iloc[-90:] == 80 * M).all() and krw.iloc[-91] < 80 * M


def test_p004_auto_rp_since_60_days(data, as_of):
    c = data["customers"].set_index("customer_id").loc["P004"]
    assert c.auto_rp_enabled and c.risk_profile == "안정추구형" and c.auto_rp_keep_krw == 2 * M
    log = data["action_log"]
    on = log[(log.customer_id == "P004") & (log.action == "auto_rp_on")]
    assert on.iloc[0].timestamp.startswith((as_of - pd.Timedelta(days=60)).strftime("%Y-%m-%d"))
    auto = series(data, "P004", "KRW", "auto_rp_balance")
    assert (auto.iloc[-61:] == 23 * M).all() and auto.iloc[-62] == 0
