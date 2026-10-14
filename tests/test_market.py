"""시장 이슈: 큰 등락·신용 담보 부족 판정 (가짜 시세로 검산)."""
import math
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.config import load_config  # noqa: E402
from engine.market import credit_book, detect, positions  # noqa: E402

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


@pytest.mark.parametrize("price,stage", [(8_700, "margin_warn"),    # 145%: 하락 여력 3.4%
                                         (9_500, "margin_watch"),   # 158%: 11.6%
                                         (11_000, "margin_safe")])  # 183%: 23.6%
def test_margin_stages(cfg, price, stage):
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 9_000, price, price], loan=6 * M)
    [b] = credit_book(positions(hold, closes, fx, uni, ref, 3), cfg)
    assert b["kind"] == stage
    assert b["trigger_price"] == pytest.approx(6 * M * 1.4 / 1000)              # 반대매매 기준가 8,400원
    assert b["room"] == pytest.approx(1 - 8_400 / price)
    assert (stage == "margin_safe") == (stage not in [a["kind"] for a in detect(positions(hold, closes, fx, uni, ref, 3), cfg)])


def test_margin_big_days_counts_past_drops(cfg):
    # 하락 여력 3.4%(8,700원)인데 최근에 하루 −10%(10,000→9,000)가 한 번 있었음
    hold, closes, fx, uni, ref = setup([10_000, 10_000, 9_000, 8_700, 8_700], loan=6 * M)
    [b] = credit_book(positions(hold, closes, fx, uni, ref, 3), cfg)
    assert b["big_days"] == 1 and b["to_safe_krw"] == math.ceil(6 * M * 1.4 / 0.8 - 8_700_000)
