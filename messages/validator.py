"""문장 검증 (CLAUDE.md 8장): 숫자 일치, 정보성 금칙어, 길이 제한."""
import re
from decimal import Decimal

NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
PERCENT_RE = re.compile(r"\d+(?:\.\d+)?\s*%")
ALWAYS_ALLOWED = {"1"}          # "1년" 같은 표현만 허용. 나머지 숫자는 전부 {값}에서 와야 한다
FORBIDDEN_INFO_WORDS = ("가입", "추천", "RP", "금리")
LIMITS = {"push": {"title": 20, "body": 60}, "kakao": {"body": 300}}


def _norm(tok: str) -> str:
    d = Decimal(tok.replace(",", ""))
    return format(d.normalize(), "f")


def numbers(text: str) -> set:
    return {_norm(t.rstrip(",")) for t in NUM_RE.findall(text or "")}


def check(title, body, values: dict, msg_type, channel, product_names=()) -> list:
    """위반 사항 목록. 비어 있으면 통과."""
    problems = []
    allowed = set(ALWAYS_ALLOWED)
    for v in values.values():
        allowed |= numbers(str(v))
    stray = numbers(f"{title}\n{body}") - allowed
    if stray:
        problems.append(f"계산값에 없는 숫자: {', '.join(sorted(stray))}")

    # 정보성: 고객에게 나가는 채널만 검사 (pb_queue 통화 스크립트는 고객에게 발송되지 않음)
    if msg_type == "info" and channel in ("push", "kakao", "monthly_report"):
        text = f"{title}\n{body}"
        words = [w for w in (*FORBIDDEN_INFO_WORDS, *product_names) if w and w in text]
        if words:
            problems.append(f"정보성 금칙어: {', '.join(words)}")
        if PERCENT_RE.search(text):
            problems.append("정보성 메시지에 금리(%) 표기")

    limit = LIMITS.get(channel, {})
    if "title" in limit and len(title) > limit["title"]:
        problems.append(f"제목 {len(title)}자 > {limit['title']}자")
    if "body" in limit and len(body) > limit["body"]:
        problems.append(f"본문 {len(body)}자 > {limit['body']}자")
    return problems
