"""화면 공통: 스타일, 라벨, 휴대폰 미리보기, 면책 문구, 차트."""
import html

import altair as alt
import pandas as pd
import streamlit as st

from engine.fmt import man
from engine.models import SUBTYPE_LABELS

NAVY = "#1F3A68"
ACCENT = "#E8702A"          # 강조색 하나: 놓친 돈
SERIES = {"예수금": "#2a78d6", "쉬는 돈": "#eb6834", "자동 RP": "#1baf7a"}   # dataviz 기본 팔레트 1~3번
INK, MUTED, GRID = "#1B2433", "#5B6578", "#E3E7EE"

TRIGGER_LABELS = {"T_EVENT": "입금 다음 날 알림", "T_IDLE_FIRST": "처음 알림", "T_IDLE_UPDATE": "운용 안내(재알림)",
                  "T_REASSESS": "진단 만료 안내", "T_MONTHLY": "월간 리포트", "T_FOUND": "깨운 예수금 이자 알림",
                  "T_TAX": "해외주식 세금 안내", "T_TENDER": "공개매수 안내"}
CHANNEL_LABELS = {"push": "앱 푸시", "kakao": "알림톡", "pb_queue": "PB 통화", "monthly_report": "월간 리포트"}
STATUS_LABELS = {"queued": "발송 대기", "held": "보류", "previewed": "미리보기", "sent_sim": "발송(시뮬)",
                 "opened_sim": "열람(시뮬)", "executed_sim": "실행(시뮬)"}
HOLD_LABELS = {"": "", "no_consent": "광고 동의 없음 → PB 통화", "night": "야간 → 다음 날 오전",
               "frequency_cap": "빈도 제한", "snooze": "고객이 닫음 → 보류"}
MSG_TYPE_LABELS = {"info": "정보성", "ad": "광고성"}

DISCLAIMER = ("본 화면은 유진투자증권 계좌 정보를 기준으로 계산한 참고용 정보이며, 투자 자문이 아닙니다. "
              "놓친 이자와 예상 이자는 가정한 금리로 계산한 추정치이며 실제 수익과 다를 수 있습니다. "
              "상품 가입 전 상품설명서를 반드시 확인하시고, 필요 시 담당 PB와 상담하세요.")

CSS = """
<style>
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css');
html, body, .stApp, .stMarkdown, p, li, label, input, textarea, button p, h1, h2, h3, [data-testid="stMetricValue"],
[data-testid="stMetricLabel"], [data-testid="stCaptionContainer"], .phone, .phone *, .script { font-family: 'Pretendard Variable', Pretendard, -apple-system, 'Malgun Gothic', sans-serif; }
.block-container { padding-top: 2.2rem; padding-bottom: 6rem; max-width: 1180px; }
h1, h2, h3 { color: #1B2433; letter-spacing: -0.01em; }
.mm-asof { display:inline-block; font-size:0.82rem; color:#5B6578; background:#F1F4F9; border:1px solid #E3E7EE;
  border-radius:999px; padding:2px 10px; margin-bottom:0.6rem; }
.mm-badge { display:inline-block; font-size:0.75rem; font-weight:600; border-radius:6px; padding:2px 8px; margin-right:4px;
  background:#EEF2F8; color:#1F3A68; border:1px solid #D9E1EE; }
.mm-badge.warn { background:#FFF6E5; color:#8A5300; border-color:#F5DDB0; }
.mm-badge.accent { background:#FDF0E7; color:#A2470F; border-color:#F6D2BB; }
.mm-badge.ok { background:#EAF6F0; color:#13633F; border-color:#C6E6D5; }
.mm-card-title { font-size:1.25rem; font-weight:700; color:#1B2433; margin:0.2rem 0 0.4rem; }
.mm-big { font-size:1.9rem; font-weight:800; color:#E8702A; line-height:1.1; }
.mm-sub { color:#5B6578; font-size:0.86rem; }
.mm-product { border:1px solid #E3E7EE; border-radius:10px; padding:12px 14px; background:#FAFBFD; margin:6px 0 8px; }
.mm-product b { color:#1F3A68; }
.mm-disclaimer { position:fixed; left:0; right:0; bottom:0; z-index:1000100; background:#F4F6FA; border-top:1px solid #E3E7EE;
  color:#5B6578; font-size:0.74rem; line-height:1.4; padding:8px 24px; text-align:center; }
/* 휴대폰 미리보기 */
.phone { width:300px; border-radius:30px; background:#111; padding:10px; box-shadow:0 6px 22px rgba(16,24,40,.18); margin:4px auto 10px; }
.phone .screen { border-radius:22px; min-height:420px; padding:14px 12px; overflow:hidden;
  background:linear-gradient(160deg,#5D7FB5 0%,#2E4E85 55%,#1F3A68 100%); }
.phone .clock { color:#fff; text-align:center; font-size:2.6rem; font-weight:300; margin:6px 0 2px; }
.phone .date { color:#E6ECF7; text-align:center; font-size:0.8rem; margin-bottom:16px; }
.push { background:rgba(255,255,255,.93); border-radius:16px; padding:10px 12px; }
.push .app { display:flex; align-items:center; gap:6px; font-size:0.72rem; color:#5B6578; margin-bottom:4px; }
.push .icon { width:18px; height:18px; border-radius:5px; background:#1F3A68; color:#fff; font-size:0.6rem; font-weight:700;
  display:flex; align-items:center; justify-content:center; }
.push .t { font-weight:700; font-size:0.9rem; color:#111; }
.push .b { font-size:0.84rem; color:#222; line-height:1.4; }
.phone .screen.kakao { background:#B2C7DA; }
.kakao .head { display:flex; gap:8px; align-items:flex-start; }
.kakao .avatar { width:34px; height:34px; border-radius:12px; background:#1F3A68; color:#fff; font-size:0.62rem; font-weight:700;
  display:flex; align-items:center; justify-content:center; flex:none; }
.kakao .name { font-size:0.74rem; color:#333; margin-bottom:3px; }
.kakao .bubble { background:#fff; border-radius:4px 14px 14px 14px; overflow:hidden; width:226px; }
.kakao .bar { background:#FEE500; font-size:0.78rem; font-weight:700; padding:8px 10px; color:#191919; }
.kakao .msg { font-size:0.8rem; color:#191919; padding:10px; line-height:1.45; white-space:pre-wrap; }
.kakao .btn { border-top:1px solid #EEE; text-align:center; font-size:0.8rem; padding:8px; color:#191919; }
.report { background:#fff; border-radius:14px; padding:14px; }
.report .t { font-weight:700; color:#1F3A68; margin-bottom:6px; }
.report .msg { font-size:0.82rem; white-space:pre-wrap; line-height:1.5; color:#222; }
.script { border:1px solid #E3E7EE; border-left:4px solid #1F3A68; border-radius:8px; background:#FAFBFD; padding:12px 14px;
  white-space:pre-wrap; font-size:0.88rem; line-height:1.6; color:#1B2433; }
</style>
"""


def inject_css():
    st.markdown(CSS, unsafe_allow_html=True)


def header(title, as_of, subtitle=None):
    st.markdown(f'<span class="mm-asof">기준일 {as_of:%Y년 %m월 %d일}</span>', unsafe_allow_html=True)
    st.title(title)
    if subtitle:
        st.caption(subtitle)


def disclaimer():
    st.markdown(f'<div class="mm-disclaimer">{html.escape(DISCLAIMER)}</div>', unsafe_allow_html=True)


def badge(text, kind=""):
    return f'<span class="mm-badge {kind}">{html.escape(str(text))}</span>'


def subtype_label(subtype):
    return SUBTYPE_LABELS.get(subtype, subtype)


def hold_label(reason):
    reason = str(reason or "")
    base, _, carried = reason.partition(":")
    label = HOLD_LABELS.get(base, base)
    return f"{label} (다음 주 이월됨)" if carried else label


def _esc(text):
    return html.escape(str(text)).replace("\n", "<br>")


def phone(channel, title, body, when=None, msg_type="info"):
    """고객 휴대폰에 보이는 모습. pb_queue는 통화 스크립트 상자."""
    when = pd.Timestamp(when) if when is not None else None
    clock = f"{when:%H:%M}" if when is not None else "10:00"
    date = f"{when.month}월 {when.day}일 {'월화수목금토일'[when.weekday()]}요일" if when is not None else ""
    if channel == "pb_queue":
        return f'<div class="script"><b>{_esc(title)}</b><br><br>{_esc(body)}</div>'
    if channel == "kakao":
        return f"""<div class="phone"><div class="screen kakao"><div class="kakao"><div class="head">
          <div class="avatar">유진</div><div><div class="name">유진투자증권</div>
          <div class="bubble"><div class="bar">{_esc(title)}</div><div class="msg">{html.escape(str(body))}</div>
          <div class="btn">앱에서 보기</div></div></div></div></div></div></div>"""
    if channel == "monthly_report":
        return f"""<div class="phone"><div class="screen"><div class="clock">{clock}</div><div class="date">{date}</div>
          <div class="report"><div class="t">{_esc(title)}</div><div class="msg">{html.escape(str(body))}</div></div></div></div>"""
    return f"""<div class="phone"><div class="screen"><div class="clock">{clock}</div><div class="date">{date}</div>
      <div class="push"><div class="app"><div class="icon">유진</div>유진투자증권 · 지금</div>
      <div class="t">{_esc(title)}</div><div class="b">{_esc(body)}</div></div></div></div>"""


def show_phone(channel, title, body, when=None, msg_type="info"):
    st.markdown(phone(channel, title, body, when, msg_type), unsafe_allow_html=True)


def man_label(x):
    return man(x)


def trend_chart(df: pd.DataFrame, show_auto=False):
    """예수금·쉬는 돈 일별 추이 (같은 단위 → 축 하나). 만원 단위, 크로스헤어 툴팁."""
    cols = {"cash_krw": "예수금", "idle_krw": "쉬는 돈"}
    if show_auto:
        cols["auto_rp_krw"] = "자동 RP"
    long = (df.rename(columns=cols)[["date", *cols.values()]]
            .melt("date", var_name="구분", value_name="금액"))
    long["만원"] = long["금액"] / 10_000
    domain = list(cols.values())
    color = alt.Color("구분:N", scale=alt.Scale(domain=domain, range=[SERIES[k] for k in domain]),
                      legend=alt.Legend(orient="top", title=None, labelColor=INK, symbolStrokeWidth=3))
    base = alt.Chart(long).encode(x=alt.X("date:T", title=None, axis=alt.Axis(format="%m/%d", labelColor=MUTED,
                                                                              grid=False, tickColor=GRID, domainColor=GRID)))
    lines = base.mark_line(strokeWidth=2, interpolate="step-after").encode(
        y=alt.Y("만원:Q", title=None, axis=alt.Axis(labelColor=MUTED, gridColor=GRID,
                                                    domain=False, tickCount=5, format=",.0f")),
        color=color)
    hover = alt.selection_point(fields=["date"], nearest=True, on="pointerover", empty=False, clear="pointerout")
    wide = df.rename(columns=cols).assign(**{f"{k}_t": df[c].map(man) for c, k in cols.items()})
    rule = alt.Chart(wide).mark_rule(color=MUTED, strokeWidth=1).encode(
        x="date:T", opacity=alt.condition(hover, alt.value(0.6), alt.value(0)),
        tooltip=[alt.Tooltip("date:T", title="날짜", format="%Y-%m-%d")]
                + [alt.Tooltip(f"{k}_t:N", title=k) for k in cols.values()],
    ).add_params(hover)
    points = base.mark_point(size=60, filled=True, stroke="white", strokeWidth=2).encode(
        y="만원:Q", color=color, opacity=alt.condition(hover, alt.value(1), alt.value(0))
    ).transform_filter(hover)
    return (lines + rule + points).properties(height=240).configure_view(stroke=None)


def bar_chart(df, cat, val, val_title, fmt=man, color=SERIES["예수금"], height=None, sort="-x"):
    """단일 계열 가로 막대 (값 라벨 직접 표시, 4px 둥근 끝). sort="ascending"이면 범주 이름 순."""
    d = df.assign(_label=df[val].map(fmt))
    base = alt.Chart(d).encode(y=alt.Y(f"{cat}:N", sort=sort, title=None, axis=alt.Axis(labelColor=INK, domain=False,
                                                                                        ticks=False, labelLimit=220)))
    bars = base.mark_bar(color=color, cornerRadiusEnd=4, height=18).encode(
        x=alt.X(f"{val}:Q", title=None, axis=None),
        tooltip=[alt.Tooltip(f"{cat}:N", title="구분"), alt.Tooltip("_label:N", title=val_title)])
    text = base.mark_text(align="left", dx=6, color=INK, fontSize=12).encode(x=f"{val}:Q", text="_label:N")
    return (bars + text).properties(height=height or 34 * len(d) + 10).configure_view(stroke=None)
