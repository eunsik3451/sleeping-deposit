"""④ 회사 대시보드: 예수금 활용률, 유형별 놓친 이자, 알림 퍼널, 보류 사유."""
import pandas as pd
import streamlit as st

from app import state, ui
from engine.fmt import man

cfg = state.cfg()
A = state.as_of()
ctx = state.context()
res = state.result(ctx)
ui.header("회사 대시보드", A, "고객 전체로 보면 얼마나 많은 돈이 쉬고 있고, 알림이 실행까지 얼마나 이어지는지 봅니다.")

# ── 예수금 활용률 (원화 환산, 기준일) ──
cash = auto = 0.0
for acct in ctx.accounts.values():
    if acct.has(A):
        e = acct.pos(A)
        cash += acct.cash[e] * acct.rate[e]
        auto += acct.auto_rp[e] * acct.rate[e]
util = auto / (cash + auto) if cash + auto else 0
f = pd.DataFrame([{"subtype": ui.subtype_label(x.subtype), "missed": x.amount_krw, "annual": x.annual_projection_krw,
                   "idle": x.meta["idle_krw"], "cid": x.customer_id} for x in res.findings if x.rule == "R1"])
found_total = sum(v["found_krw"] for v in res.found.values())

k1, k2, k3, k4 = st.columns(4)
k1.metric("예수금 활용률", f"{util:.1%}", help="예수금 자동 RP 잔고 ÷ (예수금 + 자동 RP 잔고), 기준일 원화 환산")
k2.metric("쉬는 돈이 있는 고객", f"{f.cid.nunique() if len(f) else 0}명", help=f"전체 {len(ctx.customers)}명 중")
k3.metric("지난 90일 놓친 이자 (합계)", man(f.missed.sum() if len(f) else 0))
k4.metric("깨우면 1년에 더 받을 이자 (합계)", man(f.annual.sum() if len(f) else 0))
st.caption(f"쉬는 돈 합계 {man(f.idle.sum() if len(f) else 0)} · 예수금 자동 RP 이용 {len(res.found)}명이 깨운 뒤 받은 이자 {man(found_total)} "
           f"· 예수금 {man(cash)}, 자동 RP {man(auto)}")

st.subheader("유형별")
if len(f):
    g = f.groupby("subtype").agg(고객수=("cid", "nunique"), 놓친이자=("missed", "sum"), 연환산=("annual", "sum"),
                                 쉬는돈=("idle", "sum")).reset_index()
    c1, c2 = st.columns([3, 2])
    with c1:
        st.markdown("**깨우면 1년에 더 받을 이자**")
        st.altair_chart(ui.bar_chart(g, "subtype", "연환산", "1년 더 받을 이자"), width="stretch")
    with c2:
        st.dataframe(pd.DataFrame({"유형": g.subtype, "고객 수": g.고객수, "지난 90일 놓친 이자": g.놓친이자.map(man),
                                   "1년 더 받을 이자": g.연환산.map(man), "쉬는 돈": g.쉬는돈.map(man)}),
                     hide_index=True, width="stretch")

st.subheader("세금·공개매수 항목")
items = pd.DataFrame([{"항목": ui.subtype_label(x.subtype), "cid": x.customer_id, "amount": x.amount_krw}
                      for x in res.findings if x.rule != "R1"])
if len(items):
    g2 = items.groupby("항목").agg(고객수=("cid", "nunique"), 금액=("amount", "sum")).reset_index()
    c1, c2 = st.columns([3, 2])
    with c1:
        st.markdown("**양도세 절세·공개매수 차익 (마감일 전까지)**")
        st.altair_chart(ui.bar_chart(g2, "항목", "금액", "금액", color=ui.SERIES["자동 RP"]), width="stretch")
    with c2:
        st.dataframe(pd.DataFrame({"항목": g2.항목, "고객 수": g2.고객수, "금액 합계": g2.금액.map(man)}),
                     hide_index=True, width="stretch")
else:
    st.caption("기준일에 해당하는 고객이 없어요.")

st.subheader("알림 퍼널")
ob = state.outbox()
if ob.empty:
    st.info("발송함이 비어 있어요. 알림 미리보기 화면에서 배치를 실행하세요.")
    st.stop()
rng = st.session_state.get("outbox_range")
st.caption("발송함 기준 (시뮬레이션)" + (f" · {rng[0]:%m/%d}–{rng[1]:%m/%d}" if rng else ""))
sent = {"sent_sim", "opened_sim", "executed_sim"}
rows = []
for ch in ("push", "kakao", "monthly_report"):
    d = ob[ob.channel == ch]
    rows.append({"채널": ui.CHANNEL_LABELS[ch], "생성": len(d), "발송": int(d.status.isin(sent).sum()),
                 "열람": int(d.status.isin({"opened_sim", "executed_sim"}).sum()),
                 "실행": int((d.status == "executed_sim").sum())})
funnel = pd.DataFrame(rows)
total = funnel[["생성", "발송", "열람", "실행"]].sum()
c1, c2 = st.columns([3, 2])
with c1:
    st.markdown("**전체 채널**")
    stages = pd.DataFrame({"단계": [f"{i + 1}. {s}" for i, s in enumerate(total.index)], "건수": total.values})
    st.altair_chart(ui.bar_chart(stages, "단계", "건수", "건수", fmt=lambda x: f"{int(x):,}건", sort="ascending"),
                    width="stretch")
    if total["발송"]:
        st.caption(f"발송 대비 열람 {total['열람'] / total['발송']:.0%} · 실행 {total['실행'] / total['발송']:.0%}")
with c2:
    st.dataframe(funnel, hide_index=True, width="stretch")
    st.caption(f"PB 통화로 넘어간 건 {int((ob.channel == 'pb_queue').sum()):,}건은 퍼널에서 제외")

st.subheader("보류·변경 사유")
reasons = ob[ob.hold_reason.astype(str) != ""].hold_reason.astype(str).str.split(":").str[0]
if reasons.empty:
    st.caption("없음")
else:
    r = reasons.map(lambda x: ui.HOLD_LABELS.get(x, x)).value_counts().rename_axis("사유").reset_index(name="건수")
    st.altair_chart(ui.bar_chart(r, "사유", "건수", "건수", fmt=lambda x: f"{int(x):,}건",
                                 color=ui.SERIES["쉬는 돈"]), width="stretch")
    st.caption("광고 동의 없음은 PB 통화로 돌린 건, 야간은 다음 날 오전으로 미룬 건, 빈도 제한은 다음 주로 이월한 건입니다.")
