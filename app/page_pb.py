"""③ PB 콜리스트: 큰 금액·상담 필요·광고 미동의 고객. 우선순위 순."""
import pandas as pd
import streamlit as st

from app import state, ui
from engine.fmt import man
from notify.policy import has_consent
from notify.triggers import ITEM_TRIGGERS, key_of

cfg = state.cfg()
A = state.as_of()
ctx = state.context()
res = state.result(ctx)
gen = state.generator()
ui.header("PB 콜리스트", A, "판단이 필요한 상담과 큰 금액은 온라인으로 끝내지 않고 PB에게 보냅니다. "
          "광고 수신 동의가 없는 고객의 운용 안내도 여기로 옵니다.")

ob = state.outbox()
pbq = ob[ob.channel == "pb_queue"].sort_values("scheduled_at")
latest_script = pbq.assign(key=pbq.finding_id.map(key_of)).groupby("key").tail(1).set_index("key")
log = state.action_log()
done = log[log.action.isin(["pb_called", "executed", "dismissed"])]

rows = []
for rank, f in enumerate(res.findings):
    in_queue = f.meta["key"] in latest_script.index
    if not (f.pb_flag or in_queue):
        continue
    cust = ctx.customer(f.customer_id)
    reasons = []
    c = cfg["cash"]
    if f.rule == "R2" and f.pb_flag:
        reasons.append(f"절세액 {man(cfg['overseas_tax']['pb_threshold_krw'])} 이상")
    if f.rule == "R3" and f.pb_flag:
        reasons.append(f"공개매수 차익 {man(cfg['tender_offer']['pb_threshold_krw'])} 이상")
    if f.rule != "R1" and f.meta.get("days_left", 99) <= cfg["priority"]["urgent_days"]:
        reasons.append(f"마감 D-{f.meta['days_left']}")
    if f.rule == "R1" and f.meta["idle_krw"] >= c["pb_threshold_krw"]:
        reasons.append(f"쉬는 돈 {man(c['pb_threshold_krw'])} 이상")
    if f.subtype == "event_inflow" and (f.meta.get("event") or {}).get("amount", 0) >= c["pb_event_threshold_krw"]:
        reasons.append("큰 상환금 유입")
    if f.action.type == "pb_consult":
        reasons.append("맞는 상품 없음")
    if f.action.type == "reassess":
        reasons.append("진단 만료")
    if in_queue and latest_script.loc[f.meta["key"], "hold_reason"] == "no_consent":
        reasons.append("광고 미동의")
    no_consent = not (has_consent(cust, "push") or has_consent(cust, "kakao"))
    rows.append({"rank": rank, "finding": f, "cid": f.customer_id, "name": cust["name"],
                 "age": A.year - int(cust["birth_year"]), "subtype": ui.subtype_label(f.subtype),
                 "idle": f.meta.get("idle_krw", 0), "missed": f.amount_krw, "label": f.amount_label, "reasons": ", ".join(reasons) or "PB 큐",
                 "badge": "PB 연락만 가능" if no_consent else "", "pb": cust["pb_id"],
                 "last": done[done.customer_id == f.customer_id].action.iloc[-1] if (done.customer_id == f.customer_id).any() else ""})

if not rows:
    st.info("오늘은 콜리스트가 비어 있어요.")
    st.stop()

pbs = sorted({r["pb"] for r in rows})
f1, f2 = st.columns([1, 3])
pb = f1.selectbox("담당 PB", ["전체"] + pbs)
search = f2.text_input("고객 검색", placeholder="고객번호 또는 이름 (예: P002)")
view = [r for r in rows if (pb == "전체" or r["pb"] == pb)
        and (not search or search.lower() in r["cid"].lower() or search in r["name"])]
if not view:
    st.info("조건에 맞는 고객이 없어요.")
    st.stop()
k1, k2, k3 = st.columns(3)
k1.metric("통화 대상", f"{len(view)}명")
k2.metric("쉬는 돈 합계", man(sum(r["idle"] for r in view)))
k3.metric("PB 연락만 가능", f"{sum(1 for r in view if r['badge'])}명")

LAST = {"pb_called": "통화 완료", "executed": "고객이 앱에서 직접 가입함", "dismissed": "보류"}
table = pd.DataFrame({
    "순위": range(1, len(view) + 1),
    "고객": [f"{r['cid']} {r['name']} ({r['age']}세)" for r in view],
    "항목": [r["subtype"] for r in view], "쉬는 돈": [man(r["idle"]) if r["idle"] else "–" for r in view],
    "놓치는 금액": [f"{man(r['missed'])} ({r['label']})" for r in view], "연락 사유": [r["reasons"] for r in view],
    "배지": [r["badge"] for r in view], "처리": [LAST.get(r["last"], "") for r in view],
})
left, right = st.columns([3, 2])
with left:
    st.caption("우선순위: 기한 임박 → 이벤트 유입 → 금액 큰 순")
    sel = st.dataframe(table, hide_index=True, width="stretch", height=560,
                       on_select="rerun", selection_mode="single-row", key="pb_table")
picked = sel.selection.rows if sel and sel.selection else []
with right:
    if not picked:
        st.info("왼쪽에서 고객을 고르면 근거와 통화 스크립트가 나와요.")
    else:
        r = view[picked[0]]
        f = r["finding"]
        st.markdown(f"**{r['cid']} {r['name']}** ({r['age']}세)")
        st.markdown((ui.badge(r["badge"], "warn") if r["badge"] else "") + ui.badge(r["subtype"])
                    + ui.badge(r["reasons"], "accent"), unsafe_allow_html=True)
        st.markdown(f"**{f.title}**")
        st.markdown("**통화 스크립트** (오늘 기준 숫자)")
        trig = ITEM_TRIGGERS[f.rule][0] if f.rule in ITEM_TRIGGERS else "T_IDLE_UPDATE"
        title, body = gen.generate(trig, "pb_queue", "info", ctx.customer(r["cid"]), f, None, A)
        ui.show_phone("pb_queue", title, body)
        if f.meta["key"] in latest_script.index:
            s = latest_script.loc[f.meta["key"]]
            st.caption(f"콜리스트에 오른 날 {s.scheduled_at[:10]} · {ui.TRIGGER_LABELS.get(s.trigger, s.trigger)}"
                       + (" · 광고 동의 없음으로 넘어옴" if s.hold_reason == "no_consent" else ""))
        with st.expander("근거 (엔진 계산 내역)"):
            st.markdown("\n".join(f"- {e}" for e in f.evidence))
        st.caption("PB는 안내만 합니다. 가입·실행은 고객이 앱에서 본인 인증 후 직접 하고, 여기서는 통화 결과만 기록합니다.")
        b1, b2, b3 = st.columns(3)
        for col, (action, text) in zip((b1, b2, b3), LAST.items()):
            if col.button(text, key=f"{action}-{r['cid']}", width="stretch"):
                state.log_action(r["cid"], f.finding_id, action)
                st.toast(f"{r['name']} 고객: {text} 기록")
                st.rerun()
