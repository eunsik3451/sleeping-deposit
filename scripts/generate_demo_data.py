"""가상 데모 데이터 생성 (CLAUDE.md 11장).

실행: python scripts/generate_demo_data.py --seed 42
같은 시드면 항상 같은 데이터가 나온다. 페르소나 P001~P004는 시드와 무관한 고정값.
실제 고객 정보는 쓰지 않는다. 이름은 음절 조합으로 만든 가명.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.adapter import DATA_DIR, save_table  # noqa: E402
from engine.config import load_config  # noqa: E402
from engine.models import OUTFLOW_TYPES, RISK_PROFILES  # noqa: E402

M = 1_000_000
KRW_UNIT = 10_000

# 일반 고객(페르소나 제외) 유형 비율. 나머지는 R1 해당 없음(none).
SEGMENT_SHARE = {"long_idle": 0.15, "event_inflow": 0.05, "active_trader": 0.10,
                 "fx_idle": 0.05, "auto_rp": 0.10}
DIAG_EXPIRED_SHARE = 0.20
NO_AD_CONSENT_SHARE = 0.30

SURNAMES = list("김이박최정강조윤장임한오서신권황안송류홍")
GIVEN = list("민서지하도윤수현예준우연은영진성주아재경유나태희동혜정")


def krw(x) -> int:
    return int(round(x / KRW_UNIT) * KRW_UNIT)


# ── 계좌 한 개(고객·통화)의 흐름 ─────────────────────────────────────────────

class Account:
    """초기 잔고 + 흐름 목록. k는 as_of 기준 며칠 전인지 (0 = as_of 당일)."""

    def __init__(self, initial=0.0):
        self.initial = initial
        self.flows = []

    def add(self, k, flow_type, amount):
        if amount > 0:
            self.flows.append((int(k), flow_type, amount))
        return self


def render(cid, currency, acct, dates, auto_start_k=None, keep=0):
    """흐름을 일말 잔고로 펼친다. 자동 RP 사용 중이면 keep을 넘는 금액은 auto_rp_balance로."""
    n = len(dates)
    signed = np.zeros(n)
    buys = np.zeros(n)
    flow_rows = []
    for k, ftype, amount in acct.flows:
        i = n - 1 - k
        signed[i] += -amount if ftype in OUTFLOW_TYPES else amount
        if ftype == "buy_settle":
            buys[i] += amount
        flow_rows.append({"date": dates[i], "customer_id": cid, "currency": currency,
                          "flow_type": ftype, "amount": amount})

    total = acct.initial + np.cumsum(signed)
    if total.min() < -1e-6:
        raise ValueError(f"{cid}/{currency}: 잔고가 음수가 됨")

    # 결제일(T+2) 전 이틀 동안은 미결제 매수금으로 잡힌다
    unsettled = np.zeros(n)
    unsettled[:-1] += buys[1:]
    unsettled[:-2] += buys[2:]

    cash = total.copy()
    auto = np.zeros(n)
    if auto_start_k is not None:
        on = np.arange(n) >= n - 1 - auto_start_k
        cash[on] = np.minimum(total[on], keep)
        auto[on] = total[on] - cash[on]

    if currency == "KRW":
        cash, unsettled, auto = cash.round().astype(int), unsettled.round().astype(int), auto.round().astype(int)
    else:
        cash, unsettled, auto = cash.round(2), unsettled.round(2), auto.round(2)

    bal = pd.DataFrame({"date": dates, "customer_id": cid, "currency": currency, "cash": cash,
                        "unsettled_buy": unsettled, "margin_required": 0, "auto_rp_balance": auto})
    return bal, flow_rows


# ── 일반 고객 유형별 흐름 ─────────────────────────────────────────────────────

def seg_long_idle(rng, n, dates):
    target = krw(np.clip(rng.lognormal(np.log(40 * M), 0.7), 10 * M, 200 * M))
    init = krw(rng.uniform(0.3 * M, 3 * M))
    since = int(rng.integers(10, n - 1))
    acct = Account(init)
    if rng.random() < 0.5:
        acct.add(rng.integers(since + 1, n), "withdrawal", krw(init * rng.uniform(0.1, 0.4)))
    acct.add(since, rng.choice(["deposit", "sell_settle"], p=[0.6, 0.4]), target - init)
    return [("KRW", acct, None, 0)]


def seg_event(rng, n, dates):
    init = krw(rng.uniform(0.5 * M, 4 * M))
    etype = rng.choice(["els_redemption", "bond_maturity", "dividend"], p=[0.55, 0.30, 0.15])
    lo, hi = {"els_redemption": (10, 80), "bond_maturity": (5, 50), "dividend": (5.5, 15)}[etype]
    amount = krw(rng.uniform(lo * M, hi * M))
    k_event = int(rng.integers(7, 14))
    acct = Account(init).add(k_event, etype, amount)
    if amount >= 20 * M and rng.random() < 0.3:   # 일부만 재투자 (50% 미만)
        acct.add(rng.integers(1, k_event), "buy_settle", krw(amount * rng.uniform(0.1, 0.4)))
    return [("KRW", acct, None, 0)]


def _trade_day(acct, k, b, rng):
    buy = krw(rng.uniform(1 * M, min(5 * M, b * 0.3)))
    sell = krw(buy * rng.uniform(0.85, 1.15))
    acct.add(k, "buy_settle", buy).add(k, "sell_settle", sell)
    return b - buy + sell


def seg_active(rng, n, dates):
    init = krw(rng.uniform(12 * M, 40 * M))
    acct = Account(init)
    weekday = [k for k in range(30) if dates[n - 1 - k].weekday() < 5]
    recent = set(rng.choice(weekday, size=int(rng.integers(4, 11)), replace=False).tolist())
    b = init
    for k in range(n - 1, -1, -1):
        if dates[n - 1 - k].weekday() >= 5:
            continue
        if k in recent or (k >= 30 and rng.random() < 0.12):
            b = _trade_day(acct, k, b, rng)
    return [("KRW", acct, None, 0)]


def seg_fx(rng, n, dates):
    krw_acct = Account(krw(rng.uniform(0.3 * M, 3 * M)))
    since = int(rng.integers(10, n - 1))
    usd = Account(0).add(since, rng.choice(["sell_settle", "deposit"]), float(round(rng.uniform(4500, 50000))))
    if rng.random() < 0.3:
        usd.add(rng.integers(0, since), "dividend", round(float(rng.uniform(20, 200)), 2))
    return [("KRW", krw_acct, None, 0), ("USD", usd, None, 0)]


def seg_auto(rng, n, dates):
    acct = Account(krw(rng.uniform(5 * M, 80 * M)))
    if rng.random() < 0.4:
        acct.add(rng.integers(0, n), "deposit", krw(rng.uniform(1 * M, 10 * M)))
    keep = int(rng.choice([1, 2, 3, 5]) * M)
    return [("KRW", acct, int(rng.integers(20, 171)), keep)]


def seg_none(rng, n, dates):
    r = rng.random()
    if r < 0.70:   # 잔고가 작고 자주 쓰는 고객
        cap = 4.4 * M
        b = krw(rng.uniform(0.1 * M, 3 * M))
        acct = Account(b)
        for k in range(n - 1, -1, -1):
            if dates[n - 1 - k].weekday() >= 5 or rng.random() > 0.1:
                continue
            op = rng.choice(["deposit", "withdrawal", "buy_settle", "sell_settle"])
            if op in OUTFLOW_TYPES:
                amount = krw(b * rng.uniform(0.1, 0.7))
                b -= amount
            else:
                amount = krw((cap - b) * rng.uniform(0.1, 0.8))
                b += amount
            acct.add(k, op, amount)
    elif r < 0.85:  # 최근에 입금해서 아직 7일이 안 된 고객
        acct = Account(krw(rng.uniform(0.2 * M, 2 * M)))
        acct.add(rng.integers(0, 6), "deposit", krw(rng.uniform(6 * M, 20 * M)))
    else:           # 쌓아둔 돈으로 최근에 매수한 고객
        init = krw(rng.uniform(10 * M, 30 * M))
        acct = Account(init).add(rng.integers(0, 6), "buy_settle", init - krw(rng.uniform(0.3 * M, 3 * M)))
    return [("KRW", acct, None, 0)]


SEGMENTS = {"long_idle": seg_long_idle, "event_inflow": seg_event, "active_trader": seg_active,
            "fx_idle": seg_fx, "auto_rp": seg_auto, "none": seg_none}
AGE_RANGE = {"long_idle": (45, 82), "event_inflow": (40, 75), "active_trader": (25, 55),
             "fx_idle": (28, 60), "auto_rp": (30, 70), "none": (22, 80)}


# ── 데모 페르소나 (고정값, CLAUDE.md 11장 표) ────────────────────────────────

def personas(as_of):
    def ago(days):
        return as_of - pd.Timedelta(days=days)

    def cust(cid, name, age, risk, diag, push, kakao, night, auto=False, keep=0):
        return {"customer_id": cid, "name": name, "birth_year": as_of.year - age, "risk_profile": risk,
                "risk_profile_date": diag, "income_band": "mid", "pb_id": "PB01",
                "auto_rp_enabled": auto, "auto_rp_keep_krw": keep,
                "consent_push_ad": push, "consent_kakao_ad": kakao, "consent_night_ad": night}

    # P001: 원화 1,500만원, 최근 30일 중 6일 매매(같은 날 매수·매도 결제) / 달러 $8,000이 30일째
    p001_krw = Account(15 * M)
    for k, amount in [(1, 2.0), (3, 3.0), (8, 1.5), (14, 2.5), (21, 2.0), (28, 3.0), (45, 2.0), (70, 2.0), (100, 1.5)]:
        p001_krw.add(k, "buy_settle", amount * M).add(k, "sell_settle", amount * M)
    p001_usd = Account(0).add(29, "sell_settle", 8000.0)

    # P002: 12일 전 ELS 상환금 3,000만원 입금 후 그대로
    p002 = Account(2 * M).add(60, "withdrawal", 0.5 * M).add(12, "els_redemption", 30 * M)

    # P003: 원화 8,000만원이 90일째 그대로, 진단 13개월 전, 광고 동의 없음
    p003 = Account(1 * M).add(89, "deposit", 79 * M)

    # P004: 60일 전 예수금 자동 RP 신청 (2,000,000원 남겨둠)
    p004 = Account(25 * M)

    return [
        (cust("P001", "정하준", 34, "공격투자형", ago(100), True, True, False),
         [("KRW", p001_krw, None, 0), ("USD", p001_usd, None, 0)], "active_trader+fx_idle"),
        (cust("P002", "박서연", 52, "위험중립형", ago(200), True, True, False),
         [("KRW", p002, None, 0)], "event_inflow"),
        (cust("P003", "김영자", 67, "안정형", pd.Timestamp("2025-11-02"), False, False, False),
         [("KRW", p003, None, 0)], "long_idle"),
        (cust("P004", "윤재민", 45, "안정추구형", ago(150), True, False, False, auto=True, keep=2 * M),
         [("KRW", p004, 60, 2 * M)], "auto_rp"),
    ]


# ── 전체 생성 ────────────────────────────────────────────────────────────────

def products(cfg):
    c = cfg["cash"]
    rp = c["krw_rp_rate"]
    # 금리는 config와 맞춘 가상값. 약정식 가산·CMA 차감폭도 데모용 가정 (확인 필요)
    rows = [
        ("AUTO_RP", "예수금 자동 RP", "auto_rp", "KRW", 6, rp, 0, 0),
        ("RP_ON", "수시 RP", "on_demand_rp", "KRW", 6, rp, 0, 1 * M),
        ("RP_T30", "약정식 RP 30일", "term_rp", "KRW", 6, round(rp + 0.002, 4), 30, 10 * M),
        ("RP_T90", "약정식 RP 90일", "term_rp", "KRW", 6, round(rp + 0.004, 4), 90, 10 * M),
        ("CMA_RP", "CMA(RP형)", "cma", "KRW", 6, round(rp - 0.001, 4), 0, 0),
        ("USD_RP", "외화 RP(달러)", "usd_rp", "USD", 6, c["usd_rp_rate"], 0, 1000),
    ]
    cols = ["product_id", "name", "product_type", "currency", "risk_grade", "annual_rate", "term_days", "min_amount"]
    return pd.DataFrame(rows, columns=cols)


# ── 부록 A 항목 데이터 (R2 해외주식 양도세, R3 공개매수) ──────────
# 기존 잔고 데이터가 바뀌지 않도록 별도 난수(seed + 1)를 쓴다.

DEMO_TENDER = {"offer_id": "TO1", "symbol": "999990", "name": "가상소재", "offer_price": 25_000, "market_price": 21_000}


def extra_tables(customers: pd.DataFrame, segments: dict, as_of, seed) -> dict:
    rng = np.random.default_rng(seed)
    year = as_of.year
    tax, hold = [], []

    # 페르소나: 스펙 부록 A의 예시값 그대로
    tax.append({"customer_id": "P001", "year": year, "realized_gain_krw": 10 * M,
                "unrealized_loss_krw": 4 * M, "unrealized_gain_krw": 0})            # → 880,000원
    tax.append({"customer_id": "P004", "year": year, "realized_gain_krw": 1 * M,
                "unrealized_loss_krw": 0, "unrealized_gain_krw": 5 * M})            # → 330,000원
    hold.append({"customer_id": "P003", "symbol": DEMO_TENDER["symbol"], "name": DEMO_TENDER["name"],
                 "qty": 1000, "current_price": DEMO_TENDER["market_price"]})        # → 4,000,000원

    for _, c in customers.iterrows():
        cid = c.customer_id
        if cid.startswith("P"):
            continue
        seg = segments[cid]
        if rng.random() < (0.30 if seg in ("fx_idle", "active_trader") else 0.06):
            tax.append({"customer_id": cid, "year": year,
                        "realized_gain_krw": krw(rng.uniform(-3 * M, 15 * M)),
                        "unrealized_loss_krw": krw(rng.uniform(0, 8 * M)) if rng.random() < 0.6 else 0,
                        "unrealized_gain_krw": krw(rng.uniform(0, 10 * M)) if rng.random() < 0.6 else 0})
        if rng.random() < 0.03:
            hold.append({"customer_id": cid, "symbol": DEMO_TENDER["symbol"], "name": DEMO_TENDER["name"],
                         "qty": int(rng.integers(5, 200)) * 10, "current_price": DEMO_TENDER["market_price"]})

    offers = pd.DataFrame([{"offer_id": DEMO_TENDER["offer_id"], "symbol": DEMO_TENDER["symbol"],
                            "name": DEMO_TENDER["name"], "offer_price": DEMO_TENDER["offer_price"],
                            "start_date": as_of - pd.Timedelta(days=9), "end_date": as_of + pd.Timedelta(days=7)}])
    return {"overseas_tax_ytd": pd.DataFrame(tax), "holdings": pd.DataFrame(hold), "tender_offers": offers}


def generate(cfg, seed=None) -> dict:
    demo = cfg["demo"]
    rng = np.random.default_rng(demo["seed"] if seed is None else seed)
    as_of = pd.Timestamp(cfg["as_of_date"])
    n = demo["history_days"]
    dates = pd.date_range(end=as_of, periods=n, freq="D")

    entries = personas(as_of)

    n_generic = demo["n_customers"] - len(entries)
    seg_list = []
    for seg, share in SEGMENT_SHARE.items():
        seg_list += [seg] * int(round(n_generic * share))
    seg_list += ["none"] * (n_generic - len(seg_list))
    rng.shuffle(seg_list)

    for idx, seg in enumerate(seg_list, start=1):
        age = int(rng.integers(*AGE_RANGE[seg]))
        expired = rng.random() < DIAG_EXPIRED_SHARE
        diag = as_of - pd.Timedelta(days=int(rng.integers(366, 721) if expired else rng.integers(5, 361)))
        no_ad = rng.random() < NO_AD_CONSENT_SHARE
        accounts = SEGMENTS[seg](rng, n, dates)
        auto_keep = accounts[0][3] if seg == "auto_rp" else 0
        cust = {
            "customer_id": f"C{idx:04d}",
            "name": rng.choice(SURNAMES) + "".join(rng.choice(GIVEN, size=2)),
            "birth_year": as_of.year - age,
            "risk_profile": rng.choice(RISK_PROFILES, p=[0.15, 0.20, 0.30, 0.20, 0.15]),
            "risk_profile_date": diag,
            "income_band": rng.choice(["low", "mid", "high"], p=[0.3, 0.5, 0.2]),
            "pb_id": f"PB{int(rng.integers(1, 11)):02d}",
            "auto_rp_enabled": seg == "auto_rp",
            "auto_rp_keep_krw": auto_keep,
            "consent_push_ad": not no_ad,
            "consent_kakao_ad": (not no_ad) and rng.random() < 0.7,
            "consent_night_ad": (not no_ad) and rng.random() < 0.15,
        }
        entries.append((cust, accounts, seg))

    customers, balances, flows, log, segments = [], [], [], [], {}
    for cust, accounts, seg in entries:
        cid = cust["customer_id"]
        customers.append(cust)
        segments[cid] = seg
        for currency, acct, auto_start_k, keep in accounts:
            bal, frows = render(cid, currency, acct, dates, auto_start_k, keep)
            balances.append(bal)
            flows += frows
            if auto_start_k is not None:
                on = (as_of - pd.Timedelta(days=auto_start_k)).strftime("%Y-%m-%d")
                log.append({"timestamp": f"{on} 09:00", "customer_id": cid, "finding_id": "", "action": "auto_rp_on"})

    # 원/달러 환율: 1,400원 근처 랜덤워크 (가상)
    fx = 1400 * np.exp(np.cumsum(rng.normal(0, 0.004, n)) - rng.normal(0, 0.004))
    fx_rates = pd.DataFrame({"date": dates, "currency": "USD", "rate": fx.round(2)})

    flow_df = pd.DataFrame(flows, columns=["date", "customer_id", "currency", "flow_type", "amount"])
    krw_rows = flow_df["currency"] == "KRW"
    flow_df["amount"] = flow_df["amount"].astype(object)
    flow_df.loc[krw_rows, "amount"] = flow_df.loc[krw_rows, "amount"].astype(float).round().astype(int)

    customers_df = pd.DataFrame(customers)
    return {
        **extra_tables(customers_df, segments, as_of, (demo["seed"] if seed is None else seed) + 1),
        "customers": customers_df,
        "cash_balances_daily": pd.concat(balances, ignore_index=True)
                                 .sort_values(["customer_id", "currency", "date"], ignore_index=True),
        "cash_flows": flow_df.sort_values(["customer_id", "currency", "date", "flow_type"], ignore_index=True),
        "products": products(cfg),
        "fx_rates": fx_rates,
        "action_log": pd.DataFrame(log, columns=["timestamp", "customer_id", "finding_id", "action"]),
        "outbox": pd.DataFrame(columns=["message_id", "customer_id", "finding_id", "trigger", "channel",
                                        "msg_type", "scheduled_at", "title", "body", "status", "hold_reason",
                                        "amount_krw"]),
        "_segments": segments,   # 테스트용 정답 라벨 (파일로 저장하지 않음)
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="놓친 돈 리포트 가상 데이터 생성")
    parser.add_argument("--seed", type=int, default=None, help="기본값은 config.yaml의 demo.seed")
    parser.add_argument("--data-dir", default=None, help=f"기본값 {DATA_DIR}")
    args = parser.parse_args()

    cfg = load_config()
    data = generate(cfg, args.seed)
    for name, df in data.items():
        if not name.startswith("_"):
            path = save_table(df, name, args.data_dir)
            print(f"{name:22s} {len(df):>7,}행  → {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")

    counts = pd.Series(data["_segments"]).value_counts()
    print("\n유형별 고객 수:", ", ".join(f"{k} {v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
