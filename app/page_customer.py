"""① 고객 앱 화면: 고객 본인이 앱에서 보는 화면 + 이 고객에게 나가는 알림 예시."""
import pandas as pd
import streamlit as st

from app import items as item_ui
from app import state, ui
from engine.cash.suitability import RISK_GRADE_LABEL
from engine.fmt import man, md, money, pct, won
from engine.models import RISK_PROFILES
from notify import report
from notify.policy import ad_title, has_consent

cfg = state.cfg()
A = state.as_of()
ctx = state.context()
res = state.result(ctx)
gen = state.generator()
products = state.products().set_index("product_id")

PERSONA_NOTES = {"P001": "매매대기 + 달러", "P002": "ELS 상환금", "P003": "장기방치 · 진단 만료", "P004": "예수금 자동 RP 이용 중"}


def age(c):
    return A.year - int(c["birth_year"])


# ── 고객 선택 ──
cust_df = ctx.customers
finding_amount = {}
for f in res.findings:
    finding_amount[f.customer_id] = finding_amount.get(f.customer_id, 0) + f.amount_krw
others = sorted(finding_amount, key=lambda c: -finding_amount[c])
order = list(state.PERSONAS) + [c for c in others if c not in state.PERSONAS] \
    + [c for c in res.found if c not in state.PERSONAS and c not in finding_amount] \
    + [c for c in cust_df.index if c not in state.PERSONAS and c not in finding_amount and c not in res.found]


def label(cid):
    c = ctx.customer(cid)
    tag = f" · 데모: {PERSONA_NOTES[cid]}" if cid in PERSONA_NOTES else (
        f" · 놓친 이자 {man(finding_amount[cid])}" if cid in finding_amount else "")
    return f"{cid} {c['name']} ({age(c)}세, {c['risk_profile']}){tag}"


ui.header("고객 앱 화면", A, "고객 본인이 앱에서 보는 '잠자는 예수금 깨우기'를 재현한 화면입니다. "
          "계좌·거래 데이터만으로 쉬고 있는 돈과 놓친 이자를 찾아 보여줍니다.")
st.info("이 화면의 버튼(재진단, 예수금 자동 RP 신청, 매수 화면 이동)은 **고객 본인이 앱에서 직접 누르는 상황**을 재현합니다. "
        "직원이 고객 대신 가입하거나 실행하는 기능은 없습니다.")
cid = st.selectbox("고객 선택 (데모 페르소나가 맨 위)", order, format_func=label, key="cid")
cust = ctx.customer(cid)
findings = res.for_customer(cid)
found = res.found.get(cid)

flash = st.session_state.pop("flash", None)
if flash:
    st.success(flash)

diag = pd.Timestamp(cust["risk_profile_date"])
valid = (A - diag).days <= cfg["suitability"]["risk_profile_valid_days"]
consent = [n for n, ch in (("앱 푸시", "push"), ("알림톡", "kakao")) if has_consent(cust, ch)]
st.markdown(
    ui.badge(f"{age(cust)}세") + ui.badge(cust["risk_profile"])
    + (ui.badge(f"진단 {diag:%Y-%m-%d} 유효", "ok") if valid else ui.badge(f"진단 {diag:%Y-%m-%d} 만료", "warn"))
    + (ui.badge("광고 동의: " + "·".join(consent)) if consent else ui.badge("광고 수신 동의 없음", "warn"))
    + (ui.badge("예수금 자동 RP 이용 중", "ok") if found else ""),
    unsafe_allow_html=True)

# ── 상단 숫자 ──
month_start = A.replace(day=1)
rep = report.customer_month(ctx, cid, cfg, month_start, A, findings)
item_total = sum(f.amount_krw for f in findings if f.rule != "R1")
m1, m2, m3, m4 = st.columns(4)
m1.metric(f"이번 달 못 받은 이자 ({month_start.month}/1–{A.month}/{A.day})", man(rep["missed"]),
          help="쉬는 돈이 RP에 있었다면 더 받았을 이자 (RP 금리 − 예탁금 이용료)")
m2.metric("깨우면 1년에 더 받을 이자", man(rep["will_miss"]))
m4.metric("함께 챙길 것 (양도세 절세·공개매수 차익)", man(item_total) if item_total else "0원",
          help="해외주식 양도세 절세, 공개매수 차익처럼 기한이 있는 항목의 합")
m3.metric("깨운 뒤 받은 이자 (자동 RP 신청 후)", man(found["found_krw"]) if found else "0원",
          help="예수금 자동 RP로 더 받은 이자 (시뮬레이션)")

trend = report.customer_trend(ctx, cid, cfg, A)
if len(trend):
    st.markdown("**최근 6개월 예수금과 쉬는 돈** (단위: 만원)")
    st.altair_chart(ui.trend_chart(trend, show_auto=bool(trend["auto_rp_krw"].sum() > 0)), width="stretch")
    st.caption("쉬는 돈 = 예수금 − 미결제 매수금 − 버퍼(최근 3개월 중 하루에 가장 많이 쓴 금액). 달러는 원화로 환산.")


# ── 모달 ──
@st.dialog("예수금 자동 RP 신청")
def auto_dialog(cid, buffer_krw):
    rate = products.loc["AUTO_RP", "annual_rate"]
    st.write("**주식이나 펀드를 대신 사고팔지 않아요.** 고객님이 정한 금액을 넘는 예수금만 RP에 넣어 두고, "
             "주식을 사거나 출금할 때 필요한 만큼 자동으로 빼요.")
    keep = st.number_input("남겨둘 금액 (원)", min_value=0, value=int(buffer_krw), step=100_000, format="%d")
    st.markdown(f"남겨둘 금액 **{man(keep)}** · 넘는 예수금만 RP로")
    st.caption(f"기본값은 최근 3개월 중 하루에 가장 많이 쓰신 금액({won(buffer_krw)})이에요.")
    with st.expander("상품설명서 요약 (데모)"):
        st.markdown(f"- 위험등급 6등급({RISK_GRADE_LABEL[6]})\n- 금리 연 {pct(rate)} (변동될 수 있음)\n"
                    "- 예금자보호법에 따라 보호되지 않음\n- 언제든 끌 수 있고, 끄면 다음 영업일부터 예수금으로 남음")
    ok1 = st.checkbox("상품설명서를 확인했어요")
    ok2 = st.checkbox("예수금 자동 RP 이용에 동의해요")
    if st.button("신청하기", type="primary", disabled=not (ok1 and ok2), width="stretch"):
        state.turn_on_auto_rp(cid, keep)
        st.session_state["flash"] = f"예수금 자동 RP를 신청했어요. {won(keep)}을 넘는 예수금만 RP에 넣고, 주식을 사거나 출금할 때 자동으로 빼요."
        st.rerun()


@st.dialog("투자성향 다시 진단하기")
def reassess_dialog(cid):
    st.caption("데모용 간이 진단입니다. 실서비스는 회사 투자성향 진단 절차를 그대로 따릅니다.")
    q1 = st.radio("투자해 본 상품", ["예적금만", "RP·채권 정도", "주식·펀드", "파생상품까지"], index=0)
    q2 = st.radio("원금 손실은 어디까지 괜찮으세요?",
                  ["손실은 싫어요", "조금은 괜찮아요", "어느 정도 감수해요", "크게 감수할 수 있어요"], index=0)
    q3 = st.radio("투자하실 기간", ["1년 미만", "1~3년", "3년 이상"], index=0)
    score = (["예적금만", "RP·채권 정도", "주식·펀드", "파생상품까지"].index(q1)
             + ["손실은 싫어요", "조금은 괜찮아요", "어느 정도 감수해요", "크게 감수할 수 있어요"].index(q2)
             + ["1년 미만", "1~3년", "3년 이상"].index(q3))
    profile = RISK_PROFILES[min(4, score // 2)]
    st.info(f"진단 결과: **{profile}**")
    if st.button("진단 완료", type="primary", width="stretch"):
        state.reassess(cid, profile)
        st.session_state["flash"] = f"투자성향을 {profile}으로 다시 진단했어요. 이제 운용 방법을 바로 시작할 수 있어요."
        st.rerun()


@st.dialog("데모: 매수 화면으로 이동")
def buy_dialog(cid, finding_id, product_name, amount_text):
    st.write(f"실서비스에서는 고객 앱의 **{product_name}** 매수 화면으로 이동하고, 금액 **{amount_text}**이 미리 채워집니다. "
             "고객이 본인 인증 후 직접 주문합니다.")
    st.caption("프로토타입이라 실제 주문은 연동하지 않습니다. 실행 기록만 남깁니다.")
    if st.button("고객이 직접 가입한 것으로 기록 (데모)", type="primary", width="stretch"):
        state.log_action(cid, finding_id, "executed")
        st.session_state["flash"] = f"{product_name} 실행을 기록했어요 (데모)."
        st.rerun()


# ── R1 카드 ──
def product_card(f):
    rec = f.recommendation
    p = products.loc[rec.product_id]
    grade = int(p["risk_grade"])
    others = [products.loc[x, "name"] for x in rec.candidates if x != rec.product_id]
    st.markdown(
        f'<div class="mm-product"><b>{p["name"]}</b> · 연 {pct(p["annual_rate"])} · '
        f'{grade}등급({RISK_GRADE_LABEL[grade]})<br>'
        f'<span class="mm-sub">맡길 수 있는 금액 {money(rec.suggest_amount, f.currency)}'
        f'{" · 다른 선택: " + ", ".join(others) if others else ""}</span></div>',
        unsafe_allow_html=True)


def finding_card(f):
    m = f.meta
    with st.container(border=True):
        st.markdown(ui.badge(ui.subtype_label(f.subtype)) + ui.badge("달러" if f.currency == "USD" else "원화")
                    + (ui.badge("PB 연결 대상", "accent") if f.pb_flag else ""), unsafe_allow_html=True)
        st.markdown(f'<div class="mm-card-title">{f.title}</div>', unsafe_allow_html=True)
        c1, c2, c3 = st.columns(3)
        c1.markdown(f'<div class="mm-sub">{f.amount_label}</div><div class="mm-big">약 {man(f.amount_krw)}</div>',
                    unsafe_allow_html=True)
        c2.markdown(f'<div class="mm-sub">이대로 1년 두면</div><div class="mm-big" style="color:#1B2433">'
                    f'약 {man(f.annual_projection_krw)}</div>', unsafe_allow_html=True)
        c3.markdown(f'<div class="mm-sub">지금 쉬고 있는 돈</div><div class="mm-big" style="color:#1B2433">'
                    f'{man(m["idle_krw"])}</div>', unsafe_allow_html=True)
        with st.expander("근거 보기"):
            st.markdown("\n".join(f"- {e}" for e in f.evidence))

        key = f.finding_id
        is_auto = f.recommendation.product_id == "AUTO_RP"
        krw = f.currency == "KRW"
        if f.action.type == "reassess":
            st.warning("투자성향 진단 유효기간이 지나 지금은 바로 시작할 수 없어요. 진단을 다시 받으면 운용 방법이 열려요.")
            b1, b2, b3 = st.columns([1.2, 1.2, 1])
            if b1.button("투자성향 다시 진단하기", key=f"re-{key}", type="primary", width="stretch"):
                reassess_dialog(cid)
            if krw:
                b2.button("예수금 자동 RP 신청", key=f"auto-{key}", disabled=True, width="stretch",
                          help="투자성향 진단 후 이용할 수 있어요")
        elif f.action.type == "pb_consult":
            b1, b2, b3 = st.columns([1.2, 1.2, 1])
            if b1.button("담당 PB와 상담하기", key=f"pb-{key}", type="primary", width="stretch"):
                state.log_action(cid, key, "pb_called")
                st.toast("담당 PB에게 상담 요청을 보냈어요 (데모)")
        elif is_auto:
            st.markdown('<div class="mm-product"><b>예수금 자동 RP</b> · 연 '
                        f'{pct(products.loc["AUTO_RP", "annual_rate"])} · 6등급({RISK_GRADE_LABEL[6]})<br>'
                        '<span class="mm-sub">주식을 대신 사고팔지 않고, 매수할 때 자동으로 빠져서 매매에 지장이 없어요. '
                        '매수 대기 자금이라 약정식 RP는 권하지 않아요.</span></div>', unsafe_allow_html=True)
            b1, b2, b3 = st.columns([1.2, 1.2, 1])
            if b1.button("예수금 자동 RP 신청", key=f"auto-{key}", type="primary", width="stretch"):
                auto_dialog(cid, m["buffer_krw"])
        else:
            product_card(f)
            checked = st.checkbox("상품설명서를 확인했어요", key=f"doc-{key}")
            b1, b2, b3 = st.columns([1.2, 1.2, 1])
            name = products.loc[f.recommendation.product_id, "name"]
            if b1.button("데모: 매수 화면으로 이동", key=f"buy-{key}", type="primary", disabled=not checked,
                         width="stretch"):
                buy_dialog(cid, key, name, money(f.recommendation.suggest_amount, f.currency))
            if krw and b2.button("예수금 자동 RP 신청", key=f"auto-{key}", width="stretch"):
                auto_dialog(cid, m["buffer_krw"])
        if f.subtype == "event_inflow" and b3.button("PB와 재투자 상담", key=f"pbev-{key}", width="stretch"):
            state.log_action(cid, key, "pb_called")
            st.toast("담당 PB에게 재투자 상담 요청을 보냈어요 (데모)")
        if st.button("괜찮아요, 지금은 그대로 둘게요", key=f"dis-{key}", type="tertiary"):
            state.log_action(cid, key, "dismissed")
            st.toast(f"{cfg['notify']['snooze_days']}일 동안 이 알림을 보내지 않아요")


def found_card(found):
    keep = int(cust["auto_rp_keep_krw"])
    on = found["on_date"]
    with st.container(border=True):
        st.markdown(ui.badge("예수금 자동 RP 이용 중", "ok"), unsafe_allow_html=True)
        st.markdown('<div class="mm-card-title">예수금을 깨운 뒤 받은 이자</div>', unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        c1.markdown(f'<div class="mm-sub">받은 이자 ({found["days"]}일)</div>'
                    f'<div class="mm-big" style="color:#13633F">{won(found["found_krw"])}</div>', unsafe_allow_html=True)
        c2.metric("지금 운용 중", man(found["invested_krw"]))
        c3.metric("남겨둔 금액", man(keep))
        c4.metric("이대로 1년이면", f"약 {man(found['annual_krw'])}")
        on_text = f"{on:%Y-%m-%d}에 켬" if on.year > 1900 else "켠 날 기록 없음"
        st.caption(f"{on_text} · 남겨둘 금액을 넘는 돈에 RP 금리 연 {pct(cfg['cash']['krw_rp_rate'])}를 적용한 시뮬레이션")


@st.dialog("앱에서 직접 진행 (데모)")
def item_dialog(cid, f):
    m = f.meta
    if f.rule == "R2":
        st.write("고객 앱의 **해외주식 손익 화면**으로 이동합니다. 종목별 평가손익과 올해 실현손익이 함께 보입니다.")
        st.markdown(f"- 올해 실현이익 {won(m['realized'])}\n- 평가손실 {won(m['loss'])} · 평가이익 {won(m['gain'])}\n"
                    f"- 계산상 줄일 수 있는 세금 약 {man(f.amount_krw)} (마지막 매도일 {f.deadline})")
        st.caption("매도 여부는 고객이 판단합니다. 주문은 고객이 본인 인증 후 직접 합니다.")
    elif f.rule == "R3":
        st.write(f"고객 앱의 **공개매수 청약 화면**으로 이동합니다. {m['stock']} {m['qty']:,}주가 미리 채워집니다.")
        st.caption("청약이 많으면 일부만 매수될 수 있고 세금이 붙을 수 있다는 안내를 확인한 뒤 고객이 직접 청약합니다.")
    if st.button("고객이 직접 진행한 것으로 기록 (데모)", type="primary", width="stretch"):
        state.log_action(cid, f.finding_id, "executed")
        st.session_state["flash"] = f"{f.action.label}: 고객 직접 진행으로 기록했어요 (데모)."
        st.rerun()


def item_card(f):
    """R2·R3: 기한이 있는 항목 카드."""
    with st.container(border=True):
        days = f.meta["days_left"]
        st.markdown(ui.badge(ui.subtype_label(f.subtype)) + ui.badge(f"마감 {f.deadline} · D-{days}",
                                                                      "warn" if days <= cfg["priority"]["urgent_days"] else "")
                    + (ui.badge("PB 연결 대상", "accent") if f.pb_flag else ""), unsafe_allow_html=True)
        st.markdown(f'<div class="mm-card-title">{f.title}</div>', unsafe_allow_html=True)
        st.markdown(f'<div class="mm-sub">{f.amount_label}</div><div class="mm-big">약 {man(f.amount_krw)}</div>',
                    unsafe_allow_html=True)
        with st.expander("근거 보기"):
            st.markdown("\n".join(f"- {e}" for e in f.evidence))
        b1, b2, _ = st.columns([1.2, 1.2, 1])
        if b1.button(f.action.label, key=f"act-{f.finding_id}", type="primary", width="stretch"):
            item_dialog(cid, f)
        if b2.button("PB와 상담하기", key=f"pbi-{f.finding_id}", width="stretch"):
            state.log_action(cid, f.finding_id, "pb_called")
            st.toast("담당 PB에게 상담 요청을 보냈어요 (데모)")
        if st.button("괜찮아요, 지금은 넘어갈게요", key=f"disi-{f.finding_id}", type="tertiary"):
            state.log_action(cid, f.finding_id, "dismissed")
            st.toast(f"{cfg['notify']['snooze_days']}일 동안 이 알림을 보내지 않아요")


st.subheader("지금 확인할 것")
if found:
    found_card(found)
for f in findings:
    (finding_card if f.rule == "R1" else item_card)(f)
if not findings and not found:
    st.success("지금은 쉬고 있는 돈이 없어요. 예수금이 잘 쓰이고 있어요.")


# ── 이 고객에게 나가는 안내 ──
st.divider()
st.subheader("이 고객에게 나가는 안내 (예시)")
st.caption("실제로 보내지 않습니다. 엔진이 계산한 숫자를 템플릿에 채워 만들고, 검증기(숫자 일치·정보성 금칙어·글자 수)를 "
           "통과한 문장만 씁니다. 말투는 나이에 맞춰 바뀝니다 (60대 이상 쉬운 말, 40·50대 표준, 20·30대 숫자 먼저).")

items = [p for f in findings for p in item_ui.previews_for(f, cust, cfg)]
prev_end = month_start - pd.Timedelta(days=1)
prev_rep = report.customer_month(ctx, cid, cfg, prev_end.replace(day=1), prev_end, findings)
month_extra = {"month": prev_end.replace(day=1), "missed_month": prev_rep["missed"], "will_miss": prev_rep["will_miss"],
               "found_month": prev_rep["found"]}
if found:
    month_extra.update(found_total=found["found_krw"], found_on=found["on_date"] if found["on_date"].year > 1900 else A,
                       found_invested=found["invested_krw"])
    items.append(("매월 1일 깨운 예수금 이자", "T_FOUND", "push", "info", None, month_extra, None))
items.append(("매월 1일 월간 리포트", "T_MONTHLY", "monthly_report", "info", None, month_extra, None))

item_ui.show_previews(items, gen, cust, cfg, A)

with st.expander("이 고객의 발송함 기록 (알림 미리보기 화면과 같은 데이터)"):
    ob = state.outbox()
    mine = ob[ob.customer_id == cid].sort_values("scheduled_at", ascending=False)
    if mine.empty:
        st.caption("기록 없음")
    else:
        st.dataframe(pd.DataFrame({
            "예정 시각": mine.scheduled_at, "알림": mine.trigger.map(ui.TRIGGER_LABELS),
            "채널": mine.channel.map(ui.CHANNEL_LABELS), "성격": mine.msg_type.map(ui.MSG_TYPE_LABELS),
            "상태": mine.status.map(ui.STATUS_LABELS), "보류 사유": mine.hold_reason.map(ui.hold_label),
            "제목": mine.title}), hide_index=True, width="stretch")
