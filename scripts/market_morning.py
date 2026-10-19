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
    ap.add_argument("--offline", metavar="YYYY-MM-DD", help="시세를 새로 받지 않고 저장된 그날 시세로 보유 종목만 다시 계산 (고객 보유 데이터를 바꿨을 때). 기준일·지수·시장 요약은 그대로")
    args = ap.parse_args()
    if args.offline:
        return rebuild_offline(args.offline)
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
    # 미국 지수도 날짜 검사: 미국 종목이 마지막으로 거래된 날과 같은 날 값만 쓴다
    us_ref = closes[universe[universe.currency == "USD"].symbol].dropna(how="all").index[-1]
    for t, name in INDICES.items():
        s = raw[t].dropna()
        if len(s) and s.index[-1] != us_ref:
            print(f"  {name} {us_ref:%Y-%m-%d} 종가가 아직 없습니다 (마지막 {s.index[-1]:%Y-%m-%d}, 화면에 빠짐)")
            continue
        if len(s) >= 2:
            idx.append({"name": name, "close": round(float(s.iloc[-1]), 2), "chg_pct": float(s.iloc[-1] / s.iloc[-2] - 1),
                        "date": f"{s.index[-1]:%Y-%m-%d}"})

    movers = (pos.drop_duplicates("symbol")[["symbol", "name", "market", "chg_pct", "close", "prev_close", "trade_date", "spark"]]
              .sort_values("chg_pct", key=abs, ascending=False))
    out = {"ref_date": f"{ref:%Y-%m-%d}", "generated": f"{pd.Timestamp.now():%Y-%m-%d %H:%M}", "config": c,
           "indices": idx, "movers": movers.head(12).to_dict("records"), "alerts": alerts, "credit": credit,
           "positions_all": pos[["customer_id", "symbol", "name", "currency", "qty", "close", "chg_pct", "value_krw",
                                 "day_delta_krw", "pnl_krw", "credit_loan_krw", "trade_date"]].to_dict("records"),
           "holders": int(pos.customer_id.nunique()), "positions": int(len(pos)),
           "history": {sym: [[f"{d:%Y-%m-%d}", round(float(v), 2)] for d, v in closes[sym].dropna().items()]
                       for sym in sorted(set(pos.symbol))},
           "fx_history": [[f"{d:%Y-%m-%d}", round(float(v), 2)] for d, v in fx.items()]}
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
    notes.setdefault("_market", {"headline": "", "why": [], "kr": {"line": "", "up": [], "down": []},
                                  "us": {"line": "", "up": [], "down": []}, "chips": [], "sources": []})   # 오늘 시장 요약 (뉴스 확인 후 채움)
    for sym, (name, chg, d) in need.items():
        notes.setdefault(sym, {"name": name, "trade_date": d, "chg_pct": round(chg * 100, 2),
                               "reason": "", "sources": []})
    npath.write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")

    kinds = pd.Series([a["kind"] for a in alerts]).value_counts().to_dict() if alerts else {}
    print(f"기준일 {ref:%Y-%m-%d} · 보유 고객 {out['holders']}명 · 보유 {out['positions']}건 · 알림 {kinds}")
    print(f"  어제 시장 요약 → {'✓' if notes['_market'].get('headline') else '요약 필요'}")
    for sym, (name, chg, d) in need.items():
        mark = "✓" if notes[sym]["reason"] else "이유 필요"
        print(f"  {name}({sym}) {chg * 100:+.1f}% [{d}] → {mark}")
    print(f"저장: {path.relative_to(ROOT)} · 이유 메모: {npath.relative_to(ROOT)}")


def rebuild_offline(day):
    """저장된 시세(history·fx_history)로 보유 종목·알림·신용만 다시 계산. 새 보유 종목은 그날 파일에 시세가 있어야 한다."""
    cfg = load_config()
    path = MARKET / f"{day}.json"
    out = json.loads(path.read_text(encoding="utf-8"))
    universe = pd.read_csv(MARKET / "universe.csv", dtype=str)
    holdings = generate(cfg)["stock_holdings"]
    missing = sorted(set(holdings.symbol) - set(out["history"]))
    if missing:
        print(f"  저장된 시세가 없는 종목은 빠집니다: {', '.join(missing)}")
    closes = pd.DataFrame({s: pd.Series({pd.Timestamp(d): v for d, v in h}) for s, h in out["history"].items()}).sort_index()
    fx = pd.Series({pd.Timestamp(d): v for d, v in out["fx_history"]}).sort_index()
    ref = pd.Timestamp(out["ref_date"])
    pos = positions(holdings, closes, fx, universe, ref, cfg["market"]["base_lag_days"])
    alerts, credit = detect(pos, cfg), credit_book(pos, cfg)
    movers = (pos.drop_duplicates("symbol")[["symbol", "name", "market", "chg_pct", "close", "prev_close", "trade_date", "spark"]]
              .sort_values("chg_pct", key=abs, ascending=False))
    out.update({"movers": movers.head(12).to_dict("records"), "alerts": alerts, "credit": credit,
                "positions_all": pos[["customer_id", "symbol", "name", "currency", "qty", "close", "chg_pct", "value_krw",
                                      "day_delta_krw", "pnl_krw", "credit_loan_krw", "trade_date"]].to_dict("records"),
                "holders": int(pos.customer_id.nunique()), "positions": int(len(pos))})
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"{day} 보유 종목 다시 계산 · 보유 고객 {out['holders']}명 · 보유 {out['positions']}건 · 알림 {len(alerts)}건")


if __name__ == "__main__":
    main()
