"""금액·비율 표기. 엔진 evidence는 원 단위 그대로, 고객 문구는 만원 단위 반올림 (CLAUDE.md 8장)."""


def won(x) -> str:
    return f"{int(round(x)):,}원"


def man(x) -> str:
    """80,000,000 → '8,000만원', 158,000,000 → '1억 5,800만원', 143,013 → '14만원', 5,342 → '5,342원'."""
    x = int(round(x))
    if abs(x) < 10_000:
        return f"{x:,}원"
    m = round(x / 10_000)
    eok, rest = divmod(m, 10_000)
    if eok == 0:
        return f"{rest:,}만원"
    return f"{eok}억원" if rest == 0 else f"{eok}억 {rest:,}만원"


def usd(x) -> str:
    return f"${x:,.0f}" if float(x).is_integer() else f"${x:,.2f}"


def money(x, currency) -> str:
    return man(x) if currency == "KRW" else usd(x)


def pct(rate) -> str:
    """0.025 → '2.5%', 0.03 → '3%'."""
    s = f"{rate * 100:.2f}".rstrip("0").rstrip(".")
    return f"{s}%"


def md(date) -> str:
    """2026-11-28 → '11월 28일'."""
    return f"{date.month}월 {date.day}일"
