"""시장 이슈: 큰 등락·신용 담보 부족 판정 (가짜 시세로 검산)."""
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.config import load_config  # noqa: E402
from engine.market import detect, positions  # noqa: E402

M = 1_000_000


@pytest.fixture(scope="module")
def cfg():
    return load_config(overrides={"market": {"base_lag_days": 3}})


def setup(prices, buy=10 * M, loan=0):
    days = pd.date_range("2026-10-01", periods=len(prices), freq="B")
    closes = pd.DataFrame({"X": prices}, index=days)
    uni = pd.DataFrame([{"symbol": "X", "ticker": "X", "name": "가상", "market": "KOSPI", "currency": "KRW"}])
    hold = pd.DataFrame([{"customer_id": "T1", "symbol": "X", "buy_amount_krw": buy, "credit_loan_krw": loan}])
    return hold, closes, pd.Series([1400.0], index=[days[0]]), uni, days[-1]


def test_big_move_10pct(cfg):
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 10_000, 10_000, 9_000])     # 하루 −10%
    pos = positions(hold, closes, fx, uni, ref, 3)
    assert pos.qty[0] == 1000 and pos.day_delta_krw[0] == -1 * M
    [a] = detect(pos, cfg)
    assert a["kind"] == "big_move" and a["chg_pct"] == pytest.approx(-0.10)


def test_small_move_ignored(cfg):
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 10_000, 10_000, 9_500])     # −5%
    assert detect(positions(hold, closes, fx, uni, ref, 3), cfg) == []


def test_margin_call_shortfall(cfg):
    # 매입 1,000만원(1,000주) 중 신용 600만원, 주가 7,500원 → 평가 750만원, 담보비율 125% < 140%
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 8_000, 8_000, 7_500], loan=6 * M)
    alerts = detect(positions(hold, closes, fx, uni, ref, 3), cfg)
    call = next(a for a in alerts if a["kind"] == "margin_call")
    assert call["ratio"] == pytest.approx(1.25)
    assert call["shortfall_krw"] == 900_000                                           # 600만 × 1.4 − 750만


def test_margin_watch_before_call(cfg):
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 9_000, 8_700, 8_700], loan=6 * M)   # 145%
    [a] = detect(positions(hold, closes, fx, uni, ref, 3), cfg)
    assert a["kind"] == "margin_watch"
