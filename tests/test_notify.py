"""M3 골든 테스트 N1~N9 (CLAUDE.md 11장) + 템플릿 전수 검사 + 데모 발송함 확인."""
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "scripts"))

from engine.config import load_config  # noqa: E402
from engine.runner import make_context, run  # noqa: E402
from fixtures.cases import A, CID, day, make_data  # noqa: E402
from messages import validator  # noqa: E402
from messages.generator import TemplateGenerator  # noqa: E402
from notify import policy, report  # noqa: E402
from notify.outbox import backfill, build_outbox, demo_run_time_for, empty_outbox  # noqa: E402
from notify.triggers import Candidate  # noqa: E402

M = 1_000_000
LOG_COLS = ["timestamp", "customer_id", "finding_id", "action"]


@pytest.fixture(scope="module")
def cfg():
    # 골든 값(CLAUDE.md 11장)은 고정 금리 2.5% / 0.5%로 계산돼 있다. 실제 금리 config와 분리
    return load_config(overrides={"cash": {"krw_rp_rate": 0.025, "krw_deposit_rate": 0.005,
                                           "usd_rp_rate": 0.035, "usd_deposit_rate": 0.005}})


def customer(**kw):
    c = {"customer_id": CID, "name": "테스트", "birth_year": 1975, "risk_profile": "위험중립형",
         "risk_profile_date": day(100), "auto_rp_enabled": False, "auto_rp_keep_krw": 0,
         "consent_push_ad": True, "consent_kakao_ad": True, "consent_night_ad": False}
    c.update(kw)
    return pd.DataFrame([c]).set_index("customer_id", drop=False)


def cand(key, channel="push", msg_type="ad", amount=100_000, rank=(True, True, 0)):
    return Candidate(CID, "T_IDLE_UPDATE", channel, msg_type, key, f"{key}-{A:%Y%m%d}", amount, rank=rank)


def c1_setup(cfg, **kw):
    data = make_data(cfg, cash=30 * M, **kw)
    ctx = make_context(data)
    return data, ctx, TemplateGenerator(cfg, data["products"])


def outbox_row(key, days_ago, amount, channel="kakao", status="sent_sim"):
    return pd.DataFrame([{"message_id": "old", "customer_id": CID, "finding_id": f"{key}-{day(days_ago):%Y%m%d}",
                          "trigger": "T_IDLE_UPDATE", "channel": channel, "msg_type": "ad",
                          "scheduled_at": f"{day(days_ago):%Y-%m-%d} 10:00", "title": "", "body": "",
                          "status": status, "hold_reason": "", "amount_krw": amount}])


# ── N1~N3: 정책 ──

def test_n1_weekly_cap_keeps_higher_priority(cfg):
    low = cand("R1-KRW-LOW", rank=(True, True, -10_000))
    high = cand("R1-USD-HIGH", rank=(True, False, -50_000))
    out = policy.apply([low, high], customer(), empty_outbox(), None, cfg, A)
    by_key = {d.candidate.key: d for d in out}
    assert by_key["R1-USD-HIGH"].status == "queued"
    assert by_key["R1-KRW-LOW"].status == "held" and by_key["R1-KRW-LOW"].hold_reason == "frequency_cap"


def test_n2_no_ad_consent_goes_to_pb_queue(cfg):
    cust = customer(consent_push_ad=False, consent_kakao_ad=False)
    out = policy.apply([cand("R1-KRW-X", "push"), cand("R1-KRW-Y", "kakao")], cust, empty_outbox(), None, cfg, A)
    assert {d.channel for d in out} == {"pb_queue"}
    assert all(d.hold_reason == "no_consent" for d in out)


def test_n3_night_ad_moves_to_next_morning_with_prefix(cfg):
    data, ctx, gen = c1_setup(cfg)
    _, new = build_outbox(A, ctx, cfg, empty_outbox(), data["action_log"], gen, run_time="22:30")
    ad = new[(new.msg_type == "ad") & new.channel.isin(["push", "kakao"])].iloc[0]
    assert ad.scheduled_at == f"{A + pd.Timedelta(days=1):%Y-%m-%d} 10:00"
    assert ad.hold_reason == "night"
    assert ad.title.startswith("(광고)")


def test_night_consent_keeps_time(cfg):
    out = policy.apply([cand("R1-KRW-X")], customer(consent_night_ad=True), empty_outbox(), None, cfg, A, "22:30")
    assert out[0].scheduled_at.strftime("%H:%M") == "22:30"


# ── N4, N8: 메시지 ──

def test_n4_info_templates_have_no_product_or_rate(cfg):
    sys.path.insert(0, str(ROOT / "scripts"))
    from generate_demo_data import generate
    data = generate(cfg)
    ctx = make_context(data)
    gen = TemplateGenerator(cfg, data["products"])
    result = run(ctx, cfg)
    checked = 0
    for f in [x for x in result.findings if x.rule == "R1"]:
        cust = ctx.customer(f.customer_id)
        for trig in ("T_IDLE_FIRST", "T_REASSESS"):
            for ch in ("push", "kakao"):
                out = gen.generate_checked(trig, ch, "info", cust, f)
                assert out["used"] == "template", (f.finding_id, trig, ch, out["problems"])
                text = out["title"] + out["body"]
                assert not any(w in text for w in ("가입", "추천", "RP", *data["products"]["name"]))
                assert not validator.PERCENT_RE.search(text)
                checked += 1
    ev = {"flow_type": "els_redemption", "date": A, "amount": 30 * M, "days_since": 1}
    month = {"month": A.replace(day=1), "missed_month": 47_671, "will_miss": 580_000, "found_month": 52_000,
             "found_total": 96_095, "found_on": day(60), "found_invested": 23 * M}
    for trig, ch, extra in (("T_EVENT", "push", {"event": ev}), ("T_EVENT", "kakao", {"event": ev}),
                            ("T_MONTHLY", "monthly_report", month), ("T_FOUND", "push", month),
                            ("T_FOUND", "kakao", month)):
        out = gen.generate_checked(trig, ch, "info", ctx.customer("P002"), None, extra)
        assert out["used"] == "template", (trig, ch, out["problems"])
        checked += 1
    assert checked > 100


def test_n8_wrong_number_falls_back_to_default(cfg):
    data, ctx, _ = c1_setup(cfg)
    f = run(ctx, cfg, A).findings[0]
    templates = {"T_TEST": {"push": {
        "default": {"title": "놓친 이자 약 {missed}", "body": "예수금 {cash}이 {days}일째 그대로예요."},
        "standard": {"title": "놓친 이자 약 99만원", "body": "예수금 {cash}이 {days}일째 그대로예요."},
    }}}
    gen = TemplateGenerator(cfg, data["products"], templates=templates)
    out = gen.generate_checked("T_TEST", "push", "info", ctx.customer(CID), f, as_of=A)
    assert out["used"] == "default"
    assert out["title"] == "놓친 이자 약 14만원"
    assert "99" in out["problems"][0]
    assert validator.check("놓친 이자 약 99만원", "", {"missed": "14만원"}, "info", "push")


def test_info_with_product_name_is_rejected(cfg):
    problems = validator.check("수시 RP 안내", "연 2.5% 드려요", {"rate": "2.5%"}, "info", "push", ("수시 RP",))
    assert any("금칙어" in p for p in problems) and any("%" in p for p in problems)


def test_push_length_limit(cfg):
    assert validator.check("가" * 21, "", {}, "ad", "push")


# ── N5~N7: 재알림·snooze ──

def _new_push(cfg, history, log=None):
    data, ctx, gen = c1_setup(cfg)
    log = log if log is not None else data["action_log"]
    _, new = build_outbox(A, ctx, cfg, history, log, gen)
    return new[new.channel.isin(["push", "kakao"])]


def test_n5_no_renotify_on_small_growth(cfg):
    annual = 580_000                                   # C1 고객의 앞으로 1년 놓칠 돈
    new = _new_push(cfg, outbox_row(f"R1-KRW-{CID}", 10, round(annual / 1.2)))
    assert new.empty


def test_n6_renotify_on_large_growth(cfg):
    new = _new_push(cfg, outbox_row(f"R1-KRW-{CID}", 10, round(annual_div := 580_000 / 1.6)))
    assert len(new) == 1 and annual_div < 580_000


def test_renotify_after_30_days(cfg):
    new = _new_push(cfg, outbox_row(f"R1-KRW-{CID}", 30, 580_000))
    assert len(new) == 1


def test_n7_dismissed_is_snoozed(cfg):
    log = pd.DataFrame([{"timestamp": f"{day(5):%Y-%m-%d} 12:00", "customer_id": CID,
                         "finding_id": f"R1-KRW-{CID}-{day(5):%Y%m%d}", "action": "dismissed"}], columns=LOG_COLS)
    new = _new_push(cfg, empty_outbox(), log)
    assert len(new) == 1 and new.iloc[0].status == "held" and new.iloc[0].hold_reason == "snooze"


# ── N9: 월간 리포트 ──

def test_n9_monthly_missed_30_days(cfg):
    data, ctx, _ = c1_setup(cfg)
    rep = report.customer_month(ctx, CID, cfg, day(29), A)
    assert rep["missed"] == 47_671


# ── 데모 발송함 (페르소나) ──

@pytest.fixture(scope="module")
def demo_outbox(cfg):
    from generate_demo_data import generate
    data = generate(cfg)
    ctx = make_context(data)
    gen = TemplateGenerator(cfg, data["products"])
    as_of = pd.Timestamp(cfg["as_of_date"])
    start = as_of - pd.Timedelta(days=29)
    ob = backfill(start, as_of, ctx, cfg, empty_outbox(), data["action_log"], gen, run_time_for=demo_run_time_for(start))
    return ob


def test_demo_p002_event_and_pb(demo_outbox):
    p = demo_outbox[demo_outbox.customer_id == "P002"]
    ev = p[p.trigger == "T_EVENT"]
    assert set(ev.channel) == {"kakao", "pb_queue"} and (ev.msg_type == "info").all()


def test_demo_p003_no_ad_only_pb(demo_outbox):
    p = demo_outbox[demo_outbox.customer_id == "P003"]
    assert not ((p.msg_type == "ad") & p.channel.isin(["push", "kakao"])).any()
    assert (p.channel == "pb_queue").any()


def test_demo_policies_visible(demo_outbox):
    reasons = set(demo_outbox.hold_reason.str.split(":").str[0])
    assert {"no_consent", "frequency_cap", "night"} <= reasons
    ads = demo_outbox[(demo_outbox.msg_type == "ad") & demo_outbox.channel.isin(["push", "kakao"])]
    assert ads.title.str.startswith("(광고)").all()


def test_demo_weekly_cap_respected(cfg, demo_outbox):
    sent = demo_outbox[demo_outbox.channel.isin(["push", "kakao"]) & (demo_outbox.status != "held")].copy()
    ts = pd.to_datetime(sent.scheduled_at)
    sent["wk"] = ts.dt.isocalendar().year.astype(str) + "-" + ts.dt.isocalendar().week.astype(str)
    assert sent.groupby(["customer_id", "wk"]).size().max() <= cfg["notify"]["max_per_week"]
