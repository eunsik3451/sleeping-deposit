"""항목 한눈에 한눈에: 무엇을 찾고, 무엇을 제안하고, 고객에게 어떻게 알리는지."""
import pandas as pd
import streamlit as st

from app import items as item_ui
from app import state, ui
from engine.fmt import man
from engine.models import RULE_LABELS

cfg = state.cfg()
A = state.as_of()
ctx = state.context()
res = state.result(ctx)
gen = state.generator()

ui.header("항목 한눈에", A, "고객이 따로 입력하지 않아도 계좌·거래 데이터로 찾을 수 있는 '놓친 돈' 항목입니다. "
          "항목마다 찾는 방법, 고객에게 제안하는 것, 알림이 나가는 시점과 실제 문구를 보여줍니다.")

# ── 요약 표 ──
rows = []
for it in item_ui.ITEMS:
    fs = [f for f in res.findings if f.subtype == it["key"]]
    is_r1 = it["rule"] == "R1"
    rows.append({
        "분야": it["group"], "항목": it["name"], "해당 고객": f"{len({f.customer_id for f in fs})}명",
        "놓치고 있는 돈 (합계)": (man(sum(f.annual_projection_krw if is_r1 else f.amount_krw for f in fs))
                               + (" / 1년" if is_r1 else " / 마감일 전")) if fs else "–",
        "고객에게 제안": it["offer"], "알림": it["when"],
    })
st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", column_config={
    "분야": st.column_config.TextColumn(width="small"), "해당 고객": st.column_config.TextColumn(width="small"),
    "고객에게 제안": st.column_config.TextColumn(width="large"), "알림": st.column_config.TextColumn(width="large")})
st.caption("예수금 항목은 '깨우면 1년에 더 받을 이자', 양도세·공개매수 항목은 '연내 마지막 매도일·청약 마감일 전까지 챙길 수 있는 금액'입니다. "
           "모든 실행(가입·청약·입금·매도)은 고객이 앱에서 직접 하고, PB는 안내만 합니다.")

# ── 항목별 상세 + 알림 예시 ──
st.subheader("항목별 상세와 알림 예시")
groups = list(dict.fromkeys(it["group"] for it in item_ui.ITEMS))
tabs = st.tabs(groups)
for tab, group in zip(tabs, groups):
    with tab:
        for it in [i for i in item_ui.ITEMS if i["group"] == group]:
            rule, subtype, ex_cid, ex_cur = it["example"]
            ex = next((f for f in res.findings if f.customer_id == ex_cid and f.subtype == subtype
                       and f.currency == ex_cur), None)
            with st.expander(f"{it['name']}  ·  {RULE_LABELS[rule]}", expanded=it is item_ui.ITEMS[0]):
                st.markdown(
                    f"- **놓치는 돈:** {it['missed']}\n- **찾는 방법:** {it['detect']}\n"
                    f"- **고객에게 제안:** {it['offer']}\n- **알림:** {it['when']}")
                if ex is None:
                    st.caption("현재 기준일에 예시 고객이 해당하지 않아요. (데모 상태를 바꿨다면 사이드바에서 되돌리기)")
                    continue
                cust = ctx.customer(ex_cid)
                st.markdown(f"**예시 고객 {ex_cid} {cust['name']}** ({A.year - int(cust['birth_year'])}세) · {ex.title} · "
                            f"{ex.amount_label} **약 {man(ex.amount_krw)}**")
                with st.expander("계산 근거"):
                    st.markdown("\n".join(f"- {e}" for e in ex.evidence))
                item_ui.show_previews(item_ui.previews_for(ex, cust, cfg), gen, cust, cfg, A)

# ── 다음 단계 · 다루지 않는 것 ──
st.subheader("다음 단계 후보")
st.dataframe(pd.DataFrame(item_ui.NEXT_ITEMS, columns=["항목", "필요한 데이터", "메모"]), hide_index=True, width="stretch")
st.subheader("일부러 다루지 않는 것")
st.dataframe(pd.DataFrame(item_ui.EXCLUDED, columns=["항목", "이유"]), hide_index=True, width="stretch")
