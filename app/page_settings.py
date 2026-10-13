"""⑤ 설정: 기준값을 바꾸면 모든 화면이 즉시 다시 계산된다. config.yaml 파일은 바꾸지 않는다."""
import pandas as pd
import streamlit as st

from app import state, ui
from engine.config import CONFIG_PATH, load_config

base = load_config()
cfg = state.cfg()
A = state.as_of()
ui.header("설정", A, "여기서 바꾼 값은 이 브라우저 세션에만 적용됩니다 (config.yaml은 그대로). "
          "노란 표시는 회사 실제 값으로 확인이 필요한 항목입니다.")

# config.yaml에서 "# 확인 필요" / "준법 검토 필요" 주석이 달린 키
flagged = set()
for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
    if "확인 필요" in line or "준법 검토 필요" in line:
        key = line.split(":")[0].strip()
        if key:
            flagged.add(key)


def warn(key):
    if key in flagged:
        st.markdown(ui.badge("확인 필요", "warn"), unsafe_allow_html=True)


lo, hi = state.data_range()
c = cfg["cash"]
n = cfg["notify"]
with st.form("settings"):
    st.markdown("**기준일**")
    as_of = st.date_input("기준일", A, min_value=lo + pd.Timedelta(days=89), max_value=hi,
                          help="가상 데이터는 180일치. 90일 조회 구간이 들어가는 날부터 고를 수 있어요")

    st.markdown("**금리 (연 %)**")
    r1, r2, r3, r4 = st.columns(4)
    with r1:
        krw_rp = st.number_input("원화 RP 금리", value=c["krw_rp_rate"] * 100, step=0.1, format="%.2f")
        warn("krw_rp_rate")
    with r2:
        krw_dep = st.number_input("원화 예탁금 이용료율", value=c["krw_deposit_rate"] * 100, step=0.1, format="%.2f")
        warn("krw_deposit_rate")
    with r3:
        usd_rp = st.number_input("달러 RP 금리", value=c["usd_rp_rate"] * 100, step=0.1, format="%.2f")
        warn("usd_rp_rate")
    with r4:
        usd_dep = st.number_input("달러 예탁금 이용료율", value=c["usd_deposit_rate"] * 100, step=0.1, format="%.2f")
        warn("usd_deposit_rate")

    st.markdown("**쉬는 돈 기준**")
    s1, s2, s3, s4 = st.columns(4)
    min_idle = s1.number_input("최소 쉬는 돈 (원)", value=c["min_idle_amount_krw"], step=1_000_000, format="%d")
    min_days = s2.slider("최소 연속일", 1, 30, c["min_idle_days"])
    min_buffer = s3.number_input("최소 버퍼 (원)", value=c["min_buffer_krw"], step=500_000, format="%d")
    pb_th = s4.number_input("PB 연결 기준 (원)", value=c["pb_threshold_krw"], step=10_000_000, format="%d")

    st.markdown("**알림 정책**")
    a1, a2, a3, a4 = st.columns(4)
    per_week = a1.slider("고객당 주 최대 (푸시+알림톡)", 1, 7, n["max_per_week"])
    per_month = a2.slider("고객당 월 최대", 1, 12, n["max_per_month"])
    renotify = a3.slider("재알림 간격 (일)", 7, 60, n["renotify_days"])
    with a4:
        valid_days = st.number_input("투자성향 진단 유효기간 (일)", value=cfg["suitability"]["risk_profile_valid_days"],
                                     step=30)
        warn("risk_profile_valid_days")
    st.markdown(f"광고 표기 `{n['ad_prefix']}` · 야간 {n['night_start']}–{n['night_end']} · 기본 발송 {n['default_send_time']} "
                + ui.badge("준법 검토 필요", "warn"), unsafe_allow_html=True)

    b1, b2, _ = st.columns([1, 1, 3])
    apply = b1.form_submit_button("적용", type="primary", width="stretch")
    reset = b2.form_submit_button("기본값으로", width="stretch")

if apply:
    st.session_state["overrides"] = {
        "as_of_date": pd.Timestamp(as_of).date(),
        "cash": {"krw_rp_rate": round(krw_rp / 100, 6), "krw_deposit_rate": round(krw_dep / 100, 6),
                 "usd_rp_rate": round(usd_rp / 100, 6), "usd_deposit_rate": round(usd_dep / 100, 6),
                 "min_idle_amount_krw": int(min_idle), "min_idle_days": int(min_days),
                 "min_buffer_krw": int(min_buffer), "pb_threshold_krw": int(pb_th)},
        "notify": {"max_per_week": int(per_week), "max_per_month": int(per_month), "renotify_days": int(renotify)},
        "suitability": {"risk_profile_valid_days": int(valid_days)},
    }
    st.rerun()
if reset:
    st.session_state.pop("overrides", None)
    st.rerun()

if st.session_state.get("overrides"):
    res = state.result()
    st.success(f"적용됨 · 쉬는 돈이 있는 고객 {len({f.customer_id for f in res.findings})}명, 카드 {len(res.findings)}건. "
               "고객 앱 화면·PB 콜리스트·대시보드가 이 값으로 다시 계산됩니다. "
               "발송함은 '알림 미리보기 → 기간 배치 실행'을 눌러야 새 값으로 다시 만들어집니다.")
    changed = []
    for sec, vals in st.session_state["overrides"].items():
        if isinstance(vals, dict):
            changed += [f"{k}: {base[sec][k]} → {v}" for k, v in vals.items() if base[sec].get(k) != v]
        elif str(base[sec]) != str(vals):
            changed.append(f"{sec}: {base[sec]} → {vals}")
    if changed:
        st.caption("바뀐 값: " + " · ".join(changed))
