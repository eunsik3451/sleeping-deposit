"""통화 녹음 → 녹취록 (PC에서 실행, 외부 전송 없음).

사용: python scripts/call_transcribe.py recordings/<파일> <고객번호> [--model medium]
결과: data/calls/<고객번호>/<날짜시각>/transcript.txt (+ meta.json)
그다음 Claude가 녹취록을 읽고 같은 폴더에 analysis.json을 쓰고, scripts/call_check.py로 숫자 검사 후 사이트에 올린다.
실제 고객 통화는 쓰지 않는다 (가상 상담 녹음만).
"""
import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("cid")
    ap.add_argument("--model", default="medium", help="tiny·base·small·medium·large-v3 (클수록 정확, 느림)")
    a = ap.parse_args()
    src = Path(a.audio)
    if not src.exists():
        src = ROOT / "recordings" / a.audio
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    segs, info = model.transcribe(str(src), language="ko", vad_filter=True, beam_size=5,
                                  condition_on_previous_text=False,
                                  initial_prompt="유진투자증권 PB 상담 통화. 예수금, RP, CMA, 예탁금 이용료, ELS, 펀드 만기, 유상증자 청약, 양도세, ISA, 연금저축, 신용, 반대매매.")
    lines = [f"[{s.start:6.1f}s] {s.text.strip()}" for s in segs]
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    out = ROOT / "data" / "calls" / a.cid / stamp
    out.mkdir(parents=True, exist_ok=True)
    (out / "transcript.txt").write_text("\n".join(lines), encoding="utf-8")
    (out / "meta.json").write_text(json.dumps({"cid": a.cid, "source": src.name, "seconds": round(info.duration, 1),
                                                "model": a.model, "transcribed_at": datetime.now().isoformat(timespec="minutes")},
                                               ensure_ascii=False, indent=1), encoding="utf-8")
    site_audio = ROOT / "site" / "calls"
    site_audio.mkdir(exist_ok=True)
    shutil.copy(src, site_audio / f"{a.cid}-{stamp}{src.suffix.lower()}")     # 화면에서 다시 들을 수 있게
    print(f"{info.duration:.0f}초 녹음 → {len(lines)}구간 · {out.relative_to(ROOT)}/transcript.txt")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
