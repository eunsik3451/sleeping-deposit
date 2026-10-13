"""PB 고객별 현황: 고객마다 예수금이 얼마나 쉬고 있고, 어떤 항목을 얼마나 놓치고 있는지."""
import pandas as pd
import streamlit as st

from app import items as item_ui
from app import state, ui
from engine.fmt import man

cfg = state.cfg()
A = state.as_of()
ctx = state.context()
res = state.result(ctx)
gen = state.generator()

ui.header("PB 고객별 현황", A, "담당 고객마다 쉬고 있는 예수금과 항목별로 놓치고 있는 금액을 한 표로 봅니다. "
          "고객을 고르면 근거와 고객에게 나가는 알림을 같이 볼 수 있어요.")

ov = item_ui.overview(ctx, res, cfg, A)
if ov.empty:
    st.info("잠자는 예수금이나 챙길 항목이 있는 고객이 없어요.")
    st.stop()

# ── 필터 ──
f1, f2, f3 = st.columns([1, 2, 2])
pb = f1.selectbox("담당 PB", ["전체"] + sorted(ov.pb_id.unique()))
COLS = {"쉬는 원화 예수금": "idle_krw", "쉬는 달러 예수금": "idle_usd_krw", "해외주식 양도세": "tax",
        "공개매수": "tender"}
pick = f2.multiselect("항목으로 거르기", list(COLS), placeholder="전체 항목")
search = f3.text_input("고객 검색", placeholder="고객번호 또는 이름")
view = ov if pb == "전체" else ov[ov.pb_id == pb]
for name in pick:
    view = view[view[COLS[name]] > 0]
if search:
    view = view[view.customer_id.str.contains(search, case=False) | view.name.str.contains(search)]
view = view.reset_index(drop=True)

k2, k3, k4, k5 = st.columns(4)
k2.metric("쉬는 예수금", man(view.idle_krw.sum() + view.idle_usd_krw.sum()))
k3.metric("이대로 1년 놓칠 이자", man(view.annual.sum()))
k4.metric("양도세 절세·공개매수 차익", man(view.tax.sum() + view.tender.sum()))
k5.metric("D-7 이내 마감", f"{int(((view.deadline - A).dt.days <= cfg['priority']['urgent_days']).sum())}명")

table = pd.DataFrame({
    "고객": view.customer_id + " " + view.name + " (" + view.age.astype(str) + "세)",
    "쉬는 원화 예수금": view.idle_krw.map(item_ui.money_or_dash),
    "쉬는 달러 예수금(원화)": view.idle_usd_krw.map(item_ui.money_or_dash),
    "지난 90일 놓친 이자": view.missed_90d.map(item_ui.money_or_dash),
    "1년 놓칠 이자": view.annual.map(item_ui.money_or_dash),
    "해외주식 양도세 절세": view.tax.map(item_ui.money_or_dash),
    "공개매수 차익": view.tender.map(item_ui.money_or_dash),
    "챙길 수 있는 돈 합계": view.total.map(man),
    "가장 급한 마감": [item_ui.d_day(d, A) for d in view.deadline],
    "상태": [" · ".join(x for x in (("" if a else "광고 미동의"), ("진단 만료" if re_ else "")) if x)
           for a, re_ in zip(view.ad_consent, view.reassess)],
    "담당": view.pb_id,
})
st.caption(f"고객 {len(view)}명 · 챙길 수 있는 돈 합계 = 1년 놓칠 이자 + 양도세 절세 + 공개매수 차익. 많은 순.")
sel = st.dataframe(table, hide_index=True, width="stretch", height=420,
                   on_select="rerun", selection_mode="single-row", key="overview_table")
picked = sel.selection.rows if sel and sel.selection else []

if not picked:
    st.info("표에서 고객을 고르면 항목별 근거와 고객에게 나가는 알림이 아래에 나와요.")
    st.stop()

r = view.iloc[picked[0]]
cid = r.customer_id
cust = ctx.customer(cid)
fs = res.for_customer(cid)
st.divider()
st.subheader(f"{cid} {cust['name']} ({r.age}세, {cust['risk_profile']}) · 담당 {cust['pb_id']}")
st.markdown((ui.badge("광고 수신 동의 없음 → 운용 안내는 PB 통화로", "warn") if not r.ad_consent else ui.badge("광고 수신 동의"))
            + (ui.badge("투자성향 진단 만료", "warn") if r.reassess else "")
            + (ui.badge("예수금 자동 RP 이용 중", "ok") if r.auto_rp else ""), unsafe_allow_html=True)

st.markdown("**놓치고 있는 항목**")
for f in fs:
    with st.container(border=True):
        c1, c2, c3 = st.columns([3, 1.2, 1.2])
        c1.markdown(ui.badge(ui.subtype_label(f.subtype)) + (ui.badge(f"마감 D-{f.meta['days_left']}", "warn")
                                                             if f.rule != "R1" else "")
                    + f"<br><b>{f.title}</b>", unsafe_allow_html=True)
        c2.metric(f.amount_label, f"약 {man(f.amount_krw)}")
        if f.rule == "R1":
            c3.metric("이대로 1년", f"약 {man(f.annual_projection_krw)}")
        else:
            c3.metric("마감", f.deadline)
        with st.expander("근거"):
            st.markdown("\n".join(f"- {e}" for e in f.evidence))

st.markdown("**이 고객에게 나가는 알림**")
st.caption("실제 트리거·광고 동의·나이별 말투 규칙대로 만든 문구입니다. 가입·실행은 고객이 앱에서 직접 합니다.")
item_ui.show_previews([p for f in fs for p in item_ui.previews_for(f, cust, cfg)], gen, cust, cfg, A)
