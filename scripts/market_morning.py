"""아침 시장 이슈 점검 (사용자가 요청할 때 실행).

1) 가상 고객 보유 종목(실제 상장 종목)의 시세를 받아 2) 하루 ±10% 등락과 신용 담보 부족을 찾고
3) data/market/<기준일>.json 에 저장, 4) 이유를 적을 notes 파일(data/market/notes/<기준일>.json)의 빈칸을 만든다.
이유(뉴스 요약·출처)는 notes에 사람이(또는 Claude가 웹 검색으로) 채운다. 그 뒤 export_site.py → publish.

실행: python scripts/market_morning.py [--date YYYY-MM-DD]
  --date 없으면 오늘 이전 마지막 거래일 기준 (장중 데이터는 쓰지 않는다)
"""
import argparse
import urllib.request
import re
import json
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from engine.config import load_config  # noqa: E402
from engine.market import credit_book, detect, positions  # noqa: E402
from generate_demo_data import generate  # noqa: E402

MARKET = ROOT / "data" / "market"
INDICES = {"^GSPC": "S&P 500", "^IXIC": "나스닥"}          # 미국 지수는 yfinance
KR_INDICES = {"KOSPI": "코스피", "KOSDAQ": "코스닥"}         # 국내 지수는 네이버 금융 (yfinance는 갱신이 늦음)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"


def naver_index(code, ref):
    """네이버 금융 일별 지수에서 기준일 종가·등락률. 기준일 값이 없으면 None (추정해서 채우지 않음)."""
    url = f"https://m.stock.naver.com/api/index/{code}/price?pageSize=10&page=1"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    rows = json.loads(urllib.request.urlopen(req, timeout=10).read().decode("utf-8"))
    for r in rows:
        if r["localTradedAt"] == f"{ref:%Y-%m-%d}":
            return {"close": float(r["closePrice"].replace(",", "")), "chg_pct": float(r["fluctuationsRatio"]) / 100,
                    "date": r["localTradedAt"], "source": "네이버 금융"}
    return None


def set_as_of(day):
    """서비스 기준일을 실제 날짜로 맞춘다 (화면 전체가 같은 날짜를 보게)."""
    path = ROOT / "config.yaml"
    text = path.read_text(encoding="utf-8")
    new = re.sub(r"^as_of_date: .*$", f"as_of_date: {day}", text, count=1, flags=re.M)
    path.write_text(new, encoding="utf-8")
    print(f"서비스 기준일 → {day}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="시세 기준일(이 날짜 종가까지 사용). 기본: 오늘 이전 마지막 거래일")
    ap.add_argument("--as-of", help="서비스 기준일(예수금·마감 D-day 계산). 기본: 오늘. config.yaml의 as_of_date를 이 날짜로 바꾼다")
    args = ap.parse_args()
    set_as_of(args.as_of or f"{pd.Timestamp.today():%Y-%m-%d}")
    cfg = load_config()
    c = cfg["market"]
    universe = pd.read_csv(MARKET / "universe.csv", dtype=str)
    holdings = generate(cfg)["stock_holdings"]

    tickers = list(universe.ticker) + list(INDICES) + ["KRW=X"]
    raw = yf.download(tickers, period="6mo", progress=False, auto_adjust=False)["Close"]
    raw.index = pd.to_datetime(raw.index).tz_localize(None).normalize()
    cutoff = pd.Timestamp(args.date) if args.date else pd.Timestamp.today().normalize() - pd.Timedelta(days=1)
    raw = raw.loc[:cutoff]
    closes = raw[list(universe.ticker)].rename(columns=dict(zip(universe.ticker, universe.symbol)))
    fx = raw["KRW=X"].dropna()

    # 기준일 = 국내 종목이 마지막으로 거래된 날 (해외는 그 날짜까지의 마지막 종가)
    ref = closes[universe[universe.currency == "KRW"].symbol].dropna(how="all").index[-1]
    pos = positions(holdings, closes, fx, universe, ref, c["base_lag_days"])
    if pos.empty:
        print("보유 종목 시세가 없습니다.")
        return
    # 해외 종목은 기준일까지의 마지막 거래일 기준이라 날짜가 다를 수 있다
    alerts = detect(pos, cfg)
    credit = credit_book(pos, cfg)

    idx = []
    for code, name in KR_INDICES.items():
        try:
            v = naver_index(code, ref)
        except Exception as e:                       # 네트워크 오류는 알리고 빈칸으로 둔다
            print(f"  {name} 지수를 받지 못했습니다: {e}")
            v = None
        if v:
            idx.append({"name": name, **v})
        else:
            print(f"  {name} {ref:%Y-%m-%d} 종가가 아직 없습니다 (화면에 빠짐)")
    for t, name in INDICES.items():
        s = raw[t].dropna()
        if len(s) >= 2:
            idx.append({"name": name, "close": round(float(s.iloc[-1]), 2), "chg_pct": float(s.iloc[-1] / s.iloc[-2] - 1),
                        "date": f"{s.index[-1]:%Y-%m-%d}"})

    movers = (pos.drop_duplicates("symbol")[["symbol", "name", "market", "chg_pct", "close", "prev_close", "trade_date", "spark"]]
              .sort_values("chg_pct", key=abs, ascending=False))
    out = {"ref_date": f"{ref:%Y-%m-%d}", "generated": f"{pd.Timestamp.now():%Y-%m-%d %H:%M}", "config": c,
           "indices": idx, "movers": movers.head(12).to_dict("records"), "alerts": alerts, "credit": credit,
           "positions_all": pos[["customer_id", "symbol", "name", "currency", "qty", "close", "chg_pct", "value_krw",
                                 "day_delta_krw", "pnl_krw", "credit_loan_krw", "trade_date"]].to_dict("records"),
           "holders": int(pos.customer_id.nunique()), "positions": int(len(pos))}
    MARKET.mkdir(parents=True, exist_ok=True)
    path = MARKET / f"{ref:%Y-%m-%d}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=float), encoding="utf-8")

    # 이유를 적을 빈칸 (이미 있으면 채운 내용은 지키고 새 종목만 추가)
    notes_dir = MARKET / "notes"
    notes_dir.mkdir(exist_ok=True)
    npath = notes_dir / f"{ref:%Y-%m-%d}.json"
    notes = json.loads(npath.read_text(encoding="utf-8")) if npath.exists() else {}
    need = {}
    for a in alerts:
        if a["kind"] == "big_move":
            need[a["symbol"]] = (a["name"], a["chg_pct"], a["trade_date"])
    for sym, (name, chg, d) in need.items():
        notes.setdefault(sym, {"name": name, "trade_date": d, "chg_pct": round(chg * 100, 2),
                               "reason": "", "sources": [], "checked_by": ""})
    npath.write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")

    kinds = pd.Series([a["kind"] for a in alerts]).value_counts().to_dict() if alerts else {}
    print(f"기준일 {ref:%Y-%m-%d} · 보유 고객 {out['holders']}명 · 보유 {out['positions']}건 · 알림 {kinds}")
    for sym, (name, chg, d) in need.items():
        mark = "✓" if notes[sym]["reason"] else "이유 필요"
        print(f"  {name}({sym}) {chg * 100:+.1f}% [{d}] → {mark}")
    print(f"저장: {path.relative_to(ROOT)} · 이유 메모: {npath.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
