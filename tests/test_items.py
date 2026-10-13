"""R2 해외주식 양도세, R3 공개매수 (CLAUDE.md 부록 A 예시값) + 알림. R4 연금저축은 유진 미취급이라 제외."""
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from engine.config import load_config  # noqa: E402
from engine.rules import overseas_tax, tender_offer  # noqa: E402
from engine.runner import make_context, run  # noqa: E402
from messages import validator  # noqa: E402
from messages.generator import TemplateGenerator  # noqa: E402
from notify.outbox import backfill, demo_run_time_for, empty_outbox  # noqa: E402
from notify.triggers import ITEM_TRIGGERS, item_due  # noqa: E402

M = 1_000_000
A = pd.Timestamp("2026-12-10")
CUST = {"customer_id": "T1", "name": "테스트", "income_band": "mid"}


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def tax_row(realized, loss=0, gain=0):
    return pd.Series({"realized_gain_krw": realized, "unrealized_loss_krw": loss, "unrealized_gain_krw": gain})


# ── R2 ──

@pytest.mark.parametrize("realized,loss,gain,expected,subtype", [
    (10 * M, 4 * M, 0, 880_000, "tax_loss_harvest"),      # 실현 1,000만·손실 400만
    (3 * M, 4 * M, 0, 110_000, "tax_loss_harvest"),       # 실현 300만·손실 400만
    (1 * M, 0, 5 * M, 330_000, "tax_deduction_fill"),     # 실현 100만·이익 500만
])
def test_r2_spec_examples(cfg, realized, loss, gain, expected, subtype):
    f = overseas_tax.evaluate(tax_row(realized, loss, gain), CUST, cfg, A)
    assert f.amount_krw == expected and f.subtype == subtype
    assert f.deadline == str(cfg["overseas_tax"]["last_sell_date"])


def test_r2_nothing_to_do(cfg):
    assert overseas_tax.evaluate(tax_row(10 * M, 0, 3 * M), CUST, cfg, A) is None   # 손실 종목 없음
    assert overseas_tax.evaluate(tax_row(1 * M, 2 * M, 0), CUST, cfg, A) is None    # 공제 안, 이익 종목 없음


def test_r2_after_last_sell_date(cfg):
    assert overseas_tax.evaluate(tax_row(10 * M, 4 * M), CUST, cfg, pd.Timestamp("2026-12-30")) is None


# ── R3 ──

def test_r3_spec_example(cfg):
    holdings = pd.DataFrame([{"customer_id": "T1", "symbol": "X", "name": "가상", "qty": 1000, "current_price": 21_000}])
    offers = pd.DataFrame([{"offer_id": "O1", "symbol": "X", "name": "가상", "offer_price": 25_000,
                            "start_date": A - pd.Timedelta(days=3), "end_date": A + pd.Timedelta(days=5)}])
    [f] = tender_offer.evaluate(holdings, offers, CUST, cfg, A)
    assert f.amount_krw == 4_000_000 and f.meta["days_left"] == 5
    assert tender_offer.evaluate(holdings, offers, CUST, cfg, A + pd.Timedelta(days=6)) == []   # 기간 끝
    holdings.loc[0, "current_price"] = 26_000
    assert tender_offer.evaluate(holdings, offers, CUST, cfg, A) == []                          # 현재가가 더 높음


# ── 데모 페르소나 + 알림 ──

@pytest.fixture(scope="module")
def demo(cfg):
    from generate_demo_data import generate
    data = generate(cfg)
    ctx = make_context(data)
    return data, ctx, run(ctx, cfg)


def item(result, cid, rule):
    return next(f for f in result.findings if f.customer_id == cid and f.rule == rule)


def test_demo_personas_have_items(demo):
    _, _, r = demo
    assert item(r, "P001", "R2").amount_krw == 880_000
    assert item(r, "P004", "R2").amount_krw == 330_000
    assert item(r, "P003", "R3").amount_krw == 4_000_000


def test_deadline_items_ranked_first(demo):
    _, _, r = demo
    assert r.findings[0].deadline is not None          # 기한 임박(D-7 이내)이 맨 앞


def test_item_messages_pass_validator(cfg, demo):
    data, ctx, r = demo
    gen = TemplateGenerator(cfg, data["products"])
    n = 0
    for f in r.findings:
        if f.rule == "R1":
            continue
        trig, mtype = ITEM_TRIGGERS[f.rule]
        for ch in ("push", "kakao", "pb_queue"):
            out = gen.generate_checked(trig, ch, mtype if ch != "pb_queue" else "info", ctx.customer(f.customer_id), f)
            assert out["used"] == "template", (f.finding_id, ch, out["problems"])
            if mtype == "info" and ch != "pb_queue":
                assert not validator.PERCENT_RE.search(out["body"])
            n += 1
    assert n > 50


def test_item_due_first_and_d7(cfg):
    f = overseas_tax.evaluate(tax_row(10 * M, 4 * M), CUST, cfg, A)
    never = {"last_date": None, "last_amount": None, "pending": False}
    assert item_due(never, f, A, cfg)
    sent_early = {**never, "last_date": pd.Timestamp("2026-12-01")}
    assert not item_due(sent_early, f, A, cfg)                               # D-19: 아직
    assert item_due(sent_early, f, pd.Timestamp("2026-12-22"), cfg)          # D-7: 한 번 더
    sent_d7 = {**never, "last_date": pd.Timestamp("2026-12-22")}
    assert not item_due(sent_d7, f, pd.Timestamp("2026-12-25"), cfg)         # D-7 알림 후 반복 없음


def test_demo_outbox_has_item_alerts(cfg, demo):
    data, ctx, _ = demo
    gen = TemplateGenerator(cfg, data["products"])
    start = A - pd.Timedelta(days=29)
    ob = backfill(start, A, ctx, cfg, empty_outbox(), data["action_log"], gen, run_time_for=demo_run_time_for(start))
    trig = set(ob.trigger)
    assert {"T_TAX", "T_TENDER"} <= trig
    assert "T_PENSION" not in trig
    p3 = ob[(ob.customer_id == "P003") & (ob.trigger == "T_TENDER")]
    assert set(p3.channel) == {"kakao", "pb_queue"}
