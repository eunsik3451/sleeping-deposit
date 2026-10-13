"""잠자는 예수금 깨우기 데모. 실행: streamlit run app/main.py"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st  # noqa: E402

st.set_page_config(page_title="잠자는 예수금 깨우기", layout="wide", initial_sidebar_state="expanded")

# 가상 데이터는 git에 올리지 않는다. 처음 실행(클라우드 배포 포함)이면 시드로 만든다
if not (ROOT / "data" / "demo" / "customers.csv").exists():
    sys.path.insert(0, str(ROOT / "scripts"))
    from engine.adapter import save_table  # noqa: E402
    from engine.config import load_config  # noqa: E402
    from generate_demo_data import generate  # noqa: E402
    with st.spinner("가상 고객 데이터를 만드는 중…"):
        for _name, _df in generate(load_config()).items():
            if not _name.startswith("_"):
                save_table(_df, _name)

from app import state, ui  # noqa: E402
ui.inject_css()

pages = st.navigation([
    st.Page(str(ROOT / "app" / "page_customer.py"), title="고객 앱 화면", default=True),
    st.Page(str(ROOT / "app" / "page_items.py"), title="항목 한눈에"),
    st.Page(str(ROOT / "app" / "page_overview.py"), title="PB 고객별 현황"),
    st.Page(str(ROOT / "app" / "page_pb.py"), title="PB 콜리스트"),
    st.Page(str(ROOT / "app" / "page_outbox.py"), title="알림 미리보기"),
    st.Page(str(ROOT / "app" / "page_company.py"), title="회사 대시보드"),
    st.Page(str(ROOT / "app" / "page_settings.py"), title="설정"),
])

with st.sidebar:
    st.markdown("**잠자는 예수금 깨우기**  \n유진투자증권 AX 공모전 프로토타입")
    st.caption(f"기준일 {state.as_of():%Y-%m-%d} · 가상 고객 300명")
    if st.session_state.get("overrides"):
        st.markdown(ui.badge("설정값 변경 중", "warn"), unsafe_allow_html=True)
    with st.expander("90초 데모 순서"):
        st.markdown(
            "1. **고객 앱 화면 → P003**: 8,000만원 카드, 근거 보기\n"
            "2. 투자성향 다시 진단하기 → 예수금 자동 RP 신청 → 깨운 뒤 받은 이자\n"
            "3. **P001**: 매매대기는 예수금 자동 RP만, 달러는 외화 RP\n"
            "4. **항목 한눈에**: 예수금·세금·공개매수 항목과 알림 예시\n"
            "5. **PB 고객별 현황**: 고객마다 쉬는 예수금·항목별 금액, 고객 선택 → 알림\n"
            "6. **PB 콜리스트**: P002 검색 → 통화 스크립트\n"
            "7. **알림 미리보기**: 데모 고객 · PB 큐만 · 야간 이동 필터\n"
            "8. **회사 대시보드 · 설정**: 활용률 · 퍼널, 기준값 바꾸고 적용")
    st.divider()
    if st.button("데모 처음으로 되돌리기", help="자동 RP 신청·재진단·행동 기록·발송함을 처음 상태로", width="stretch"):
        state.reset_demo()
        st.rerun()

pages.run()
ui.disclaimer()
