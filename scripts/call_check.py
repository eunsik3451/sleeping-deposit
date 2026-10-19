"""AI 요약 검사: 요약·할 일에 나온 숫자(금액·금리·날짜)가 녹취록에 실제로 있는지 확인한다.

사용: python scripts/call_check.py data/calls/<고객번호>/<폴더>
녹취록에서 잘못 들린 말은 analysis.json의 transcript_fixes(heard → meant)로 고친 뒤 비교한다.
"""
import json
import re
import sys
from pathlib import Path

KN = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}


def numbers(text):
    t = text.replace(",", "")
    t = re.sub(r"(\d+)\s*천\s*만", lambda m: str(int(m.group(1)) * 1000) + "만", t)       # 5천만 → 5000만
    t = re.sub(r"([일이삼사오육칠팔구])천\s*만", lambda m: str(KN[m.group(1)] * 1000) + "만", t)
    return set(re.findall(r"\d+(?:\.\d+)?", t))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    d = Path(sys.argv[1])
    a = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    tx = (d / "transcript.txt").read_text(encoding="utf-8")
    tx = re.sub(r"\[\s*[\d.]+s\]", "", tx)
    for f in a.get("transcript_fixes", []):
        for heard in f["heard"].split(" / "):
            tx = tx.replace(heard, f["meant"])
    have = numbers(tx) | {"1"}
    parts = [a["headline"], a["summary"], *a.get("customer_context", []), *a["key"], *a["requests"], *a["promises"], *[t["text"] for t in a["todos"]]]
    # 고객에게 보내는 상담 정리: 날짜는 할 일 날짜(통화에서 정한 '다음 주 화요일' 등을 계산한 것)에서 와도 된다
    recap = a.get("customer_recap")
    if recap:
        parts += [recap["body"], *[n["t"] for n in recap.get("next", [])]]
        for d in [a.get("call_date")] + [t.get("due") for t in a["todos"]]:
            if d:
                y, mo, dd = d.split("-")
                have |= {str(int(mo)), str(int(dd))}
    bad = []
    for p in parts:
        missing = numbers(p) - have
        if missing:
            bad.append((p, sorted(missing)))
    dates = [t["due"] for t in a["todos"] if t.get("due")]
    print(f"숫자 검사: {len(parts)}문장 · 녹취록에 없는 숫자 {len(bad)}건")
    for p, m in bad:
        print(f"  ! {m} ← {p[:70]}")
    print("할 일 날짜:", ", ".join(dates))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
