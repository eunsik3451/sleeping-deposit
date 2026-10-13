"""화면 공통 상태: 데이터 로드, 설정 덮어쓰기, 데모 중 상태 변경(자동 RP 켜기·재진단·행동 기록)."""
import json

import pandas as pd
import streamlit as st

from engine.adapter import load_column_map, load_table, save_table
from engine.cash.idle import build_accounts
from engine.config import load_config
from engine.runner import EXTRA_TABLES, make_context, run
from messages.generator import TemplateGenerator
from notify.outbox import backfill, demo_run_time_for, empty_outbox, simulate_engagement

PERSONAS = ("P001", "P002", "P003", "P004")


# ── 설정 ──

def cfg() -> dict:
    return load_config(overrides=st.session_state.get("overrides"))


def as_of() -> pd.Timestamp:
    return pd.Timestamp(cfg()["as_of_date"])


# ── 데이터 ──

@st.cache_resource(show_spinner="가상 데이터를 읽는 중…")
def _static():
    """잔고·흐름·환율·상품은 데모 중 바뀌지 않으므로 한 번만 읽는다."""
    cmap = load_column_map()
    data = {name: load_table(name, None, cmap)
            for name in ("cash_balances_daily", "cash_flows", "fx_rates", "products", *EXTRA_TABLES)}
    accounts = build_accounts(data["cash_balances_daily"], data["cash_flows"], data["fx_rates"])
    return data, accounts


def customers() -> pd.DataFrame:
    return load_table("customers")


def action_log() -> pd.DataFrame:
    return load_table("action_log")


def products() -> pd.DataFrame:
    return _static()[0]["products"]


def context():
    data, accounts = _static()
    return make_context({**data, "customers": customers(), "action_log": action_log()}, accounts=accounts)


def result(ctx=None):
    return run(ctx or context(), cfg())


def generator() -> TemplateGenerator:
    return TemplateGenerator(cfg(), products())


def data_range() -> tuple:
    b = _static()[0]["cash_balances_daily"]["date"]
    return b.min(), b.max()


# ── 발송함 ──

def outbox() -> pd.DataFrame:
    ob = load_table("outbox")
    if ob.empty and not st.session_state.get("outbox_built"):
        ob = rebuild_outbox()
    if len(ob):
        ob["amount_krw"] = pd.to_numeric(ob["amount_krw"], errors="coerce").fillna(0).astype(int)
    return ob


def rebuild_outbox(start=None, end=None) -> pd.DataFrame:
    c = cfg()
    end = pd.Timestamp(end or c["as_of_date"])
    start = pd.Timestamp(start or end - pd.Timedelta(days=29))
    with st.spinner(f"{start:%m/%d}~{end:%m/%d} 하루 배치를 차례로 돌리는 중…"):
        ob = backfill(start, end, context(), c, empty_outbox(), action_log(), generator(),
                      run_time_for=demo_run_time_for(start))
        ob = simulate_engagement(ob, c["demo"]["seed"], end)
    save_table(ob, "outbox")
    st.session_state["outbox_built"] = True
    st.session_state["outbox_range"] = (start, end)
    return ob


# ── 데모 중 상태 변경 ──

def log_action(cid, finding_id, action, when=None):
    log = action_log()
    ts = f"{pd.Timestamp(when or as_of()):%Y-%m-%d} {pd.Timestamp.now():%H:%M}"
    row = pd.DataFrame([{"timestamp": ts, "customer_id": cid, "finding_id": finding_id or "", "action": action}])
    save_table(pd.concat([log, row], ignore_index=True), "action_log")


def turn_on_auto_rp(cid, keep_krw):
    c = customers()
    c.loc[c.customer_id == cid, "auto_rp_enabled"] = True
    c.loc[c.customer_id == cid, "auto_rp_keep_krw"] = int(keep_krw)
    save_table(c, "customers")
    log = action_log()
    row = pd.DataFrame([{"timestamp": f"{as_of():%Y-%m-%d} 09:00", "customer_id": cid,
                         "finding_id": f"R1-KRW-{cid}-{as_of():%Y%m%d}", "action": "auto_rp_on"}])
    save_table(pd.concat([log, row], ignore_index=True), "action_log")


def reassess(cid, profile):
    c = customers()
    c.loc[c.customer_id == cid, "risk_profile"] = profile
    c.loc[c.customer_id == cid, "risk_profile_date"] = as_of()
    save_table(c, "customers")


def reset_demo():
    """생성기를 다시 돌리지 않고 데모 고객 상태만 처음으로 되돌린다."""
    import sys
    from engine.config import ROOT
    sys.path.insert(0, str(ROOT / "scripts"))
    from generate_demo_data import generate
    fresh = generate(load_config())
    save_table(fresh["customers"], "customers")
    save_table(fresh["action_log"], "action_log")
    save_table(empty_outbox(), "outbox")
    st.session_state.pop("outbox_built", None)


def cfg_key() -> str:
    return json.dumps(cfg(), default=str, sort_keys=True, ensure_ascii=False)
