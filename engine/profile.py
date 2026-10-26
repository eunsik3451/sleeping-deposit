"""고객 분석: 보유 종목·거래 빈도·자산 구성·등록 투자성향으로 관심 분야와 투자 스타일을 정리한다.

PB는 이 결과로 고객에게 맞는 행사·상품을 안내하고, 고객 앱에는 '나의 투자 프로필'로 보여 준다.
계산은 규칙만 쓴다(문장이 숫자를 만들지 않음). 기준값은 config `profile:`.
"""
import pandas as pd

STABLE_PROFILES = ("안정형", "안정추구형")
TRADE_FLOWS = ("buy_settle", "sell_settle")


def build(cid, customer, positions, flows, balance, findings, universe, events, cfg, as_of):
    """고객 한 명의 분석 결과(dict). positions = 시장 데이터의 보유 종목 행(dict) 목록."""
    pc = cfg["profile"]
    uni = universe.set_index("symbol")
    stock = sum(p["value_krw"] for p in positions)
    krw = balance.get("KRW", {"cash": 0, "auto_rp": 0})
    usd = balance.get("USD")
    cash = krw["cash"] + krw.get("auto_rp", 0) + (usd["cash"] * usd["rate"] if usd else 0)
    total = stock + cash

    # 관심 분야: 업종별 평가금액 비중 (주식 대비)
    by_sector, names = {}, {}
    for p in positions:
        sec = uni.loc[p["symbol"], "sector"] if p["symbol"] in uni.index else "기타"
        by_sector[sec] = by_sector.get(sec, 0) + p["value_krw"]
        names.setdefault(sec, []).append(p["name"])
    sectors = sorted(((s, v / stock) for s, v in by_sector.items()), key=lambda x: -x[1]) if stock else []
    tier_share = lambda tiers: (sum(p["value_krw"] for p in positions if p["symbol"] in uni.index and uni.loc[p["symbol"], "tier"] in tiers) / stock) if stock else 0
    bluechip, volatile = tier_share(("우량",)), tier_share(("고변동", "레버리지"))
    overseas = (sum(p["value_krw"] for p in positions if p["currency"] == "USD") / stock) if stock else 0
    credit = any(p.get("credit_loan_krw", 0) > 0 for p in positions)

    # 거래 빈도: 최근 90일 중 매수·매도 결제가 있었던 날 수
    since = as_of - pd.Timedelta(days=pc["activity_days"] - 1)
    f = flows[(flows.date >= since) & flows.flow_type.isin(TRADE_FLOWS)]
    trade_days = int(f.date.nunique())
    activity = "활발" if trade_days >= pc["active_trade_days"] else "보통" if trade_days >= pc["some_trade_days"] else "적음"
    cash_ratio = cash / total if total else 0

    # 투자 스타일 한 마디
    if not positions:
        style = "예수금 위주" if cash >= pc["cash_heavy_krw"] else "보유 주식 없음"
    elif volatile >= pc["volatile_ratio"] or credit:
        style = "공격적 투자"
    elif bluechip >= pc["bluechip_ratio"] and activity == "적음":
        style = "우량주 장기 보유"
    elif bluechip >= pc["bluechip_ratio"]:
        style = "우량주 중심"
    elif activity == "활발":
        style = "활발한 매매"
    else:
        style = "균형형"

    tags = [f"{s} 관심" for s, w in sectors[:2] if w >= pc["sector_interest"]]
    if overseas >= pc["overseas_ratio"]:
        tags.append("해외주식")
    if style in ("우량주 장기 보유", "우량주 중심"):
        tags.append("우량주 중심")
    if volatile >= pc["volatile_ratio"]:
        tags.append("고변동 선호")
    if credit:
        tags.append("신용 사용")
    tags.append(f"거래 {activity}")
    if cash >= pc["cash_heavy_krw"] and cash_ratio >= pc["cash_ratio"]:
        tags.append("예수금 많음")
    rules = {f.rule for f in findings}
    if rules & {"R2", "R5"}:
        tags.append("절세 관심")
    if "R4" in rules:
        tags.append("만기 자금 예정")
    stable = customer["risk_profile"] in STABLE_PROFILES
    if stable and not positions or (stable and volatile < pc["volatile_ratio"]):
        tags.append("안정 추구")

    # 등록 성향과 실제 보유 비교 (PB만 봄)
    gap = None
    if stable and volatile >= pc["volatile_ratio"]:
        gap = f"등록 투자성향({customer['risk_profile']})보다 변동성 큰 종목 비중이 높아요({volatile * 100:.0f}%). 상품 안내 때 적합성을 꼭 확인하세요."
    elif stable and credit:
        gap = f"등록 투자성향({customer['risk_profile']})인데 신용으로 산 주식이 있어요. 상품 안내 때 적합성을 꼭 확인하세요."

    # 맞춤 안내: 행사(태그가 겹치는 것) + 상품 상담 방향
    keys = {t.replace(" 관심", "") for t in tags} | set(tags)
    matched = [e["id"] for e in events if keys & set(e["tags"])]
    offers = []
    if "예수금 많음" in tags or any(f.rule == "R1" for f in findings):
        offers.append({"t": "쉬는 예수금 → RP·CMA", "why": "예수금이 쉬고 있어요", "note": "위험등급 6(매우 낮은 위험), 예금자보호 대상 아님 안내"})
    for s, w in sectors[:1]:
        if w >= pc["sector_interest"]:
            offers.append({"t": f"{s} 관련 상품(펀드·ETF) 소개", "why": f"보유 주식의 {w * 100:.0f}%가 {s}",
                           "note": "등록 성향상 고위험 상품은 안내하지 않아요" if stable else "투자성향에 맞는 위험등급만"})
    if style in ("우량주 장기 보유", "예수금 위주") or stable:
        offers.append({"t": "채권·배당형 상품 상담", "why": "안정적으로 이자·배당을 받으려는 성향", "note": "원금 손실 가능성 함께 안내"})

    head = sectors[0][0] if sectors and sectors[0][1] >= pc["sector_interest"] else None
    summary = (f"{head}에 관심이 많은 " if head else "") + {
        "예수금 위주": "예수금 위주 고객", "보유 주식 없음": "주식 없이 예수금만 조금 있는 고객",
        "공격적 투자": "변동성 큰 종목도 담는 공격적 투자 고객" if volatile >= pc["volatile_ratio"] else "신용까지 쓰는 공격적 투자 고객", "우량주 장기 보유": "우량주를 오래 들고 가는 고객",
        "우량주 중심": "우량주 중심 고객", "활발한 매매": "매매가 잦은 고객", "균형형": "여러 업종에 나눠 담는 고객"}[style]

    return {
        "summary": summary, "style": style, "tags": tags, "gap": gap,
        "sectors": [{"name": s, "pct": round(w, 4), "stocks": names[s]} for s, w in sectors],
        "mix": {"stock": round(stock), "cash": round(cash), "cash_ratio": round(cash_ratio, 4)},
        "bluechip": round(bluechip, 4), "volatile": round(volatile, 4), "overseas": round(overseas, 4),
        "credit": credit, "trade_days": trade_days, "activity": activity,
        "events": matched, "offers": offers,
    }
