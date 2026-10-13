"""항목 한눈에 목록, 고객별 현황 표, 알림 미리보기 (여러 화면에서 같이 쓴다)."""
import pandas as pd
import streamlit as st

from app import ui
from engine.fmt import man
from notify.policy import ad_title, has_consent
from notify.triggers import ITEM_TRIGGERS

# ── 항목 목록 ────────────────────────────────────────────────────────────────
# example: 데모에서 이 항목을 보여주는 고객 (rule, subtype, customer_id, currency)
ITEMS = [
    {"key": "long_idle", "rule": "R1", "group": "예수금",
     "name": "원화 예수금 방치", "missed": "예수금 이용료와 RP 금리의 차이 (연 2%p 가정)",
     "detect": "일별 예수금·출금·매수 결제. 하루 최대 사용액은 남기고 500만원 이상이 7일 넘게 쉼",
     "offer": "수시 RP · 약정식 RP(3,000만원 이상) · CMA(RP형) · 예수금 자동 RP",
     "when": "7일째 정보성 알림 → 30일마다 운용 안내(광고성)", "example": ("R1", "long_idle", "P003", "KRW")},
    {"key": "active_trader", "rule": "R1", "group": "예수금",
     "name": "매수 대기 자금", "missed": "매수 전까지 쉬는 돈의 RP 이자",
     "detect": "최근 30일 중 4일 이상 매수 결제 + 쉬는 돈 유지",
     "offer": "예수금 자동 RP만 (주식을 대신 사고팔지 않고 남는 예수금만 RP로, 매수할 때 자동으로 빠짐)",
     "when": "7일째 정보성 알림 → 30일마다 운용 안내(광고성)", "example": ("R1", "active_trader", "P001", "KRW")},
    {"key": "event_inflow", "rule": "R1", "group": "예수금",
     "name": "상환금·배당 유입 후 방치", "missed": "ELS·채권 상환금, 배당금이 쉬는 동안의 RP 이자",
     "detect": "최근 14일 내 상환·배당 입금, 이후 잔고 감소가 입금액의 절반 미만",
     "offer": "수시 RP · PB 재투자 상담 (3,000만원 이상은 PB 콜리스트)",
     "when": "입금 다음 날 알림톡(정보성) → 7일째 알림", "example": ("R1", "event_inflow", "P002", "KRW")},
    {"key": "fx_idle", "rule": "R1", "group": "예수금",
     "name": "달러 예수금 방치", "missed": "달러 예수금 이용료와 외화 RP 금리의 차이 (연 3%p 가정)",
     "detect": "달러 잔고를 그날 환율로 원화 환산해 같은 기준 적용",
     "offer": "외화 RP (환전 권유 안 함)",
     "when": "7일째 정보성 알림 → 30일마다 운용 안내(광고성)", "example": ("R1", "fx_idle", "P001", "USD")},
    {"key": "tax_loss_harvest", "rule": "R2", "group": "세금",
     "name": "해외주식 양도세 (손실 상계)", "missed": "평가손실을 올해 확정하지 않아 더 내는 양도세",
     "detect": "올해 유진 계좌 해외주식 실현이익 250만원 초과 + 평가손실 종목",
     "offer": "보유 종목 손익 확인, PB 절세 상담 (매도 권유 아님)",
     "when": "발견 즉시 + 마지막 매도일 D-7 (정보성)", "example": ("R2", "tax_loss_harvest", "P001", "KRW")},
    {"key": "tax_deduction_fill", "rule": "R2", "group": "세금",
     "name": "해외주식 기본공제 남음", "missed": "쓰지 않고 넘어가는 기본공제 250만원",
     "detect": "올해 실현이익 250만원 미만 + 평가이익 종목",
     "offer": "보유 종목 손익 확인, PB 절세 상담 (매도 권유 아님)",
     "when": "발견 즉시 + 마지막 매도일 D-7 (정보성)", "example": ("R2", "tax_deduction_fill", "P004", "KRW")},
    {"key": "tender_offer", "rule": "R3", "group": "기업 이벤트",
     "name": "공개매수 미응모", "missed": "공개매수가와 현재가 차이 × 보유 수량",
     "detect": "공개매수 기간 중 대상 종목 보유 + 현재가 < 공개매수가",
     "offer": "앱에서 공개매수 청약 (안분·세금 안내 포함)",
     "when": "발견 즉시 + 마감 D-7 (정보성)", "example": ("R3", "tender_offer", "P003", "KRW")},
]

NEXT_ITEMS = [
    ("ISA 비과세 한도 미활용", "ISA 계좌·납입 한도 데이터", "회사 ISA 취급 여부 확인 필요"),
    ("유상증자 청약 권리 미행사", "보유 종목 권리락·청약 일정", "신주인수권 매도 또는 청약 안내"),
    ("ELS·채권 상환 예정 사전 알림 (D-7)", "상품 만기·조기상환 일정", "상환금이 쉬기 전에 미리 안내"),
    ("배당금 입금 후 방치", "배당 입금 내역 (지금은 이벤트 유입에 일부 포함)", "소액 배당 묶음 안내"),
]

EXCLUDED = [
    ("환전 수수료 비교, 저보수 상품 전환", "회사 수익이 줄어드는 제안이라 다루지 않음 (설계 원칙 2)"),
    ("연금저축·IRP 세액공제, 발행어음, 개인투자용 국채", "유진투자증권 미취급"),
]


def item_key(f) -> str:
    return f.subtype


# ── 고객별 현황 ──────────────────────────────────────────────────────────────

def overview(ctx, res, cfg, as_of) -> pd.DataFrame:
    """고객 1명 = 1행. 쉬는 예수금과 항목별로 놓치고 있는 금액."""
    rows = {}
    for f in res.findings:
        r = rows.setdefault(f.customer_id, {
            "idle_krw": 0.0, "idle_usd_krw": 0.0, "missed_90d": 0, "annual": 0,
            "tax": 0, "tender": 0, "deadline": None, "items": [], "pb": False, "reassess": False})
        r["items"].append(ui.subtype_label(f.subtype))
        r["pb"] |= bool(f.pb_flag)
        if f.rule == "R1":
            r["idle_usd_krw" if f.currency == "USD" else "idle_krw"] += f.meta["idle_krw"]
            r["missed_90d"] += f.amount_krw
            r["annual"] += f.annual_projection_krw
            r["reassess"] |= f.action.type == "reassess"
        else:
            r[{"R2": "tax", "R3": "tender"}[f.rule]] += f.amount_krw
        if f.deadline:
            d = pd.Timestamp(f.deadline)
            r["deadline"] = d if r["deadline"] is None else min(r["deadline"], d)

    out = []
    for cid, r in rows.items():
        c = ctx.customer(cid)
        total = r["annual"] + r["tax"] + r["tender"]
        out.append({
            "customer_id": cid, "name": c["name"], "age": as_of.year - int(c["birth_year"]), "pb_id": c["pb_id"],
            "ad_consent": has_consent(c, "push") or has_consent(c, "kakao"), "reassess": r["reassess"],
            "idle_krw": r["idle_krw"], "idle_usd_krw": r["idle_usd_krw"], "missed_90d": r["missed_90d"],
            "annual": r["annual"], "tax": r["tax"], "tender": r["tender"],
            "total": total, "deadline": r["deadline"], "items": " · ".join(dict.fromkeys(r["items"])),
            "pb_flag": r["pb"], "auto_rp": cid in res.found,
        })
    df = pd.DataFrame(out).sort_values("total", ascending=False, ignore_index=True)
    df["deadline"] = pd.to_datetime(df["deadline"])
    return df


# ── 알림 미리보기 ────────────────────────────────────────────────────────────

def previews_for(f, cust, cfg) -> list:
    """(라벨, 트리거, 채널, 성격, finding, extra, 메모) 목록 — 실제 트리거·동의 규칙대로."""
    out = []
    if f.rule != "R1":
        trig, mtype = ITEM_TRIGGERS[f.rule]
        name = ui.TRIGGER_LABELS.get(trig, trig)
        if mtype == "info":
            out.append((f"{name} (발견 즉시)", trig, "push", "info", f, None, None))
            out.append((f"{name} (알림톡)", trig, "kakao", "info", f, None, None))
        elif has_consent(cust, "kakao") or has_consent(cust, "push"):
            ch = "kakao" if has_consent(cust, "kakao") else "push"
            out.append((name, trig, ch, "ad", f, None, None))
        else:
            out.append((name, trig, "pb_queue", "ad", f, None, "광고 수신 동의가 없어 PB 통화로 대체됩니다."))
        if f.pb_flag and not any(p[2] == "pb_queue" for p in out):
            out.append(("PB 통화 스크립트", trig, "pb_queue", "info", f, None,
                        "금액이 커서 PB 콜리스트에도 올라갑니다."))
        return out

    if f.subtype == "event_inflow" and f.meta.get("event"):
        ev = {**f.meta["event"], "days_since": 1}
        out.append(("입금 다음 날", "T_EVENT", "kakao", "info", None, {"event": ev}, None))
    if f.action.type == "reassess":
        out.append(("진단 만료 안내", "T_REASSESS", "push", "info", f, None, None))
        out.append(("진단 만료 안내", "T_REASSESS", "kakao", "info", f, None, None))
    else:
        out.append((f"처음 알림 ({cfg['cash']['min_idle_days']}일째 되는 날)", "T_IDLE_FIRST", "push", "info", f, None, None))
        if has_consent(cust, "kakao"):
            out.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "kakao", "ad", f, None, None))
        elif has_consent(cust, "push"):
            out.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "push", "ad", f, None, None))
        else:
            out.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "pb_queue", "ad", f, None,
                        "광고 수신 동의가 없어 앱 푸시·알림톡 대신 PB 통화로 대체됩니다."))
    if f.pb_flag and not any(p[2] == "pb_queue" for p in out):
        out.append(("PB 통화 스크립트", "T_IDLE_UPDATE", "pb_queue", "info", f, None,
                    "금액이 크거나 상담이 필요한 건이라 PB 콜리스트에도 올라갑니다."))
    return out


def render_preview(item, gen, cust, cfg, as_of):
    title_lbl, trig, ch, mtype, f, extra, note = item
    out = gen.generate_checked(trig, ch, mtype if ch != "pb_queue" else "info", cust, f, extra, as_of)
    title = ad_title(out["title"], cfg) if mtype == "ad" and ch in ("push", "kakao") else out["title"]
    st.markdown(f"**{title_lbl}**  \n" + ui.badge(ui.CHANNEL_LABELS[ch])
                + ui.badge(ui.MSG_TYPE_LABELS[mtype], "accent" if mtype == "ad" else ""), unsafe_allow_html=True)
    if note:
        st.caption(note)
    ui.show_phone(ch, title, out["body"], as_of + pd.Timedelta(hours=10), mtype)
    if out["used"] == "template":
        st.caption("검증 통과")
    else:
        st.caption(f"검증에 걸려 {'기본 문구' if out['used'] == 'default' else '안전 문구'}로 교체: {out['problems'][0]}")


def show_previews(items, gen, cust, cfg, as_of, per_row=3):
    phones = [i for i in items if i[2] != "pb_queue"]
    scripts = [i for i in items if i[2] == "pb_queue"]
    for row in range(0, len(phones), per_row):
        cols = st.columns(per_row)
        for col, item in zip(cols, phones[row:row + per_row]):
            with col:
                render_preview(item, gen, cust, cfg, as_of)
    for item in scripts:
        render_preview(item, gen, cust, cfg, as_of)


def d_day(deadline, as_of) -> str:
    if deadline is None or pd.isna(deadline):
        return ""
    return f"D-{(pd.Timestamp(deadline) - as_of).days}"


def money_or_dash(x) -> str:
    return man(x) if x else "–"
