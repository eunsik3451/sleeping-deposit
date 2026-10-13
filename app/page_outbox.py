"""② 알림 미리보기: 하루 배치가 만든 발송함. 실제 발송 없음."""
import pandas as pd
import streamlit as st

from app import state, ui
from engine.adapter import save_table
from notify.outbox import DEMO_NIGHT_TIME, build_outbox

cfg = state.cfg()
A = state.as_of()
ui.header("알림 미리보기", A, "매일 배치가 '누구에게, 언제, 어떤 채널로, 어떤 문구로' 보낼지 정해 발송함에 쌓습니다. "
          "실제로 보내지는 않고 여기서 미리 봅니다.")

ob = state.outbox()

with st.expander("발송함 다시 만들기", expanded=False):
    lo, hi = state.data_range()
    c1, c2, c3 = st.columns([1, 1, 1])
    start = c1.date_input("시작일", A - pd.Timedelta(days=29), min_value=lo + pd.Timedelta(days=89), max_value=A)
    end = c2.date_input("종료일", A, min_value=lo + pd.Timedelta(days=89), max_value=hi)
    c3.write("")
    if c3.button("기간 배치 실행", type="primary", width="stretch"):
        ob = state.rebuild_outbox(start, end)
        st.rerun()
    st.caption(f"기간의 날마다 배치를 차례로 돌리고, 끝난 뒤 발송·열람·실행을 시뮬레이션합니다 (열람 약 60%, 실행 약 20%). "
               f"데모 가정: 첫날 배치만 {DEMO_NIGHT_TIME}에 돌아 야간 전송 제한이 보이게 했습니다. 나머지는 매일 "
               f"{cfg['notify']['default_send_time']}.")
    st.divider()
    d1, d2, d3 = st.columns([1, 1, 1])
    day = d1.date_input("하루만 실행할 날", A, min_value=lo + pd.Timedelta(days=89), max_value=hi, key="one_day")
    t = d2.time_input("실행 시각", pd.Timestamp("10:00").time(), step=1800)
    d3.write("")
    if d3.button("이 날 배치만 추가 실행", width="stretch"):
        merged, new = build_outbox(day, state.context(), cfg, ob, state.action_log(), state.generator(),
                                   run_time=t.strftime("%H:%M"))
        save_table(merged, "outbox")
        st.session_state["flash_outbox"] = f"{pd.Timestamp(day):%m/%d} {t:%H:%M} 배치: 새 알림 {len(new)}건"
        st.rerun()

msg = st.session_state.pop("flash_outbox", None)
if msg:
    st.success(msg)

if ob.empty:
    st.info("발송함이 비어 있어요. 위에서 배치를 실행하세요.")
    st.stop()

# ── 요약 ──
sent_states = {"sent_sim", "opened_sim", "executed_sim"}
k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("만든 알림", f"{len(ob):,}건")
k2.metric("발송(시뮬)", f"{ob.status.isin(sent_states).sum():,}건")
k3.metric("보류", f"{(ob.status == 'held').sum():,}건")
k4.metric("PB 통화로", f"{(ob.channel == 'pb_queue').sum():,}건")
k5.metric("광고성", f"{(ob.msg_type == 'ad').sum():,}건")

# ── 필터 ──
f1, f2 = st.columns([3, 2])
view = f1.segmented_control("보기", ["전체", "보류된 것만", "광고만", "PB 큐만", "야간 이동", "데모 고객"],
                            default="전체", label_visibility="collapsed")
search = f2.text_input("고객 검색", placeholder="고객번호 또는 이름", label_visibility="collapsed")

names = state.customers().set_index("customer_id")["name"]
df = ob.copy()
df["name"] = df.customer_id.map(names)
if view == "보류된 것만":
    df = df[df.status == "held"]
elif view == "광고만":
    df = df[df.msg_type == "ad"]
elif view == "PB 큐만":
    df = df[df.channel == "pb_queue"]
elif view == "야간 이동":
    df = df[df.hold_reason == "night"]
elif view == "데모 고객":
    df = df[df.customer_id.isin(state.PERSONAS)]
if search:
    df = df[df.customer_id.str.contains(search, case=False) | df.name.fillna("").str.contains(search)]
df = df.sort_values(["scheduled_at", "customer_id"], ascending=[False, True]).reset_index(drop=True)

table = pd.DataFrame({
    "예정 시각": df.scheduled_at, "고객": df.customer_id + " " + df.name.fillna(""),
    "알림": df.trigger.map(ui.TRIGGER_LABELS), "채널": df.channel.map(ui.CHANNEL_LABELS),
    "성격": df.msg_type.map(ui.MSG_TYPE_LABELS), "상태": df.status.map(ui.STATUS_LABELS),
    "보류 사유": df.hold_reason.map(ui.hold_label), "제목": df.title,
})

left, right = st.columns([3, 2])
with left:
    st.caption(f"{len(df):,}건 · 행을 누르면 오른쪽에 고객 휴대폰 화면이 나와요")
    sel = st.dataframe(table, hide_index=True, width="stretch", height=560,
                       on_select="rerun", selection_mode="single-row", key="outbox_table")
rows = sel.selection.rows if sel and sel.selection else []
with right:
    if not rows:
        st.info("왼쪽 표에서 알림을 하나 고르세요.")
    else:
        r = df.iloc[rows[0]]
        st.markdown(ui.badge(ui.TRIGGER_LABELS.get(r.trigger, r.trigger)) + ui.badge(ui.CHANNEL_LABELS[r.channel])
                    + ui.badge(ui.MSG_TYPE_LABELS[r.msg_type], "accent" if r.msg_type == "ad" else "")
                    + (ui.badge(ui.hold_label(r.hold_reason), "warn") if r.hold_reason else ""),
                    unsafe_allow_html=True)
        st.caption(f"{r.customer_id} {r['name']} · 예정 {r.scheduled_at} · 상태 {ui.STATUS_LABELS.get(r.status, r.status)}")
        if r.msg_type == "ad" and r.channel in ("push", "kakao"):
            ok = str(r.title).startswith(cfg["notify"]["ad_prefix"])
            st.markdown(ui.badge(f"제목 앞 {cfg['notify']['ad_prefix']} 표기 " + ("확인" if ok else "누락"),
                                 "ok" if ok else "warn"), unsafe_allow_html=True)
        ui.show_phone(r.channel, r.title, r.body, pd.Timestamp(r.scheduled_at), r.msg_type)
