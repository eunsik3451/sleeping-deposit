"""CSV 로드·저장. 모든 테이블은 column_map.yaml을 거쳐 표준 컬럼으로 바뀐다."""
from pathlib import Path

import pandas as pd
import yaml

from engine.config import ROOT

DATA_DIR = ROOT / "data"
COLUMN_MAP_PATH = ROOT / "column_map.yaml"
ENCODING = "utf-8-sig"   # 엑셀에서 열어도 한글이 깨지지 않게

# 표준 스키마 (CLAUDE.md 5장). file은 DATA_DIR 기준 경로.
SCHEMA = {
    "customers": {
        "file": "demo/customers.csv",
        "columns": ["customer_id", "name", "birth_year", "risk_profile", "risk_profile_date",
                    "income_band", "pb_id", "auto_rp_enabled", "auto_rp_keep_krw",
                    "consent_push_ad", "consent_kakao_ad", "consent_night_ad"],
        "dates": ["risk_profile_date"],
        "bools": ["auto_rp_enabled", "consent_push_ad", "consent_kakao_ad", "consent_night_ad"],
    },
    "cash_balances_daily": {
        "file": "demo/cash_balances_daily.csv",
        "columns": ["date", "customer_id", "currency", "cash", "unsettled_buy",
                    "margin_required", "auto_rp_balance"],
        "dates": ["date"],
        "bools": [],
    },
    "cash_flows": {
        "file": "demo/cash_flows.csv",
        "columns": ["date", "customer_id", "currency", "flow_type", "amount"],
        "dates": ["date"],
        "bools": [],
    },
    "products": {
        "file": "demo/products.csv",
        "columns": ["product_id", "name", "product_type", "currency", "risk_grade",
                    "annual_rate", "term_days", "min_amount"],
        "dates": [],
        "bools": [],
    },
    "fx_rates": {
        "file": "demo/fx_rates.csv",
        "columns": ["date", "currency", "rate"],
        "dates": ["date"],
        "bools": [],
    },
    # 함께 챙길 항목 (R2 해외주식 양도세, R3 유상증자 권리, R4 펀드·ELS 만기, R5 연금저축)
    "overseas_tax_ytd": {
        "file": "demo/overseas_tax_ytd.csv",
        "columns": ["customer_id", "year", "realized_gain_krw", "unrealized_loss_krw", "unrealized_gain_krw"],
        "dates": [],
        "bools": [],
    },
    "pension_accounts": {
        "file": "demo/pension_accounts.csv",
        "columns": ["customer_id", "year", "paid_ytd_krw"],
        "dates": [],
        "bools": [],
    },
    "holdings": {
        "file": "demo/holdings.csv",
        "columns": ["customer_id", "symbol", "name", "qty", "current_price"],
        "dates": [],
        "bools": [],
    },
    "rights_offers": {
        "file": "demo/rights_offers.csv",
        "columns": ["offer_id", "symbol", "name", "issue_price", "ratio", "sub_start", "sub_end"],
        "dates": ["sub_start", "sub_end"],
        "bools": [],
    },
    "maturities": {
        "file": "demo/maturities.csv",
        "columns": ["customer_id", "holding_id", "product_name", "kind", "maturity_date", "expected_amount_krw"],
        "dates": ["maturity_date"],
        "bools": [],
    },
    "outbox": {
        "file": "outbox.csv",
        "columns": ["message_id", "customer_id", "finding_id", "trigger", "channel", "msg_type",
                    "scheduled_at", "title", "body", "status", "hold_reason", "amount_krw"],
        "dates": [],
        "bools": [],
    },
    "action_log": {
        "file": "action_log.csv",
        "columns": ["timestamp", "customer_id", "finding_id", "action"],
        "dates": [],
        "bools": [],
    },
}

_BOOL_TEXT = {"true": True, "false": False, "1": True, "0": False, "y": True, "n": False}


def load_column_map(path=None) -> dict:
    with open(path or COLUMN_MAP_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _to_bool(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series
    return series.astype(str).str.strip().str.lower().map(_BOOL_TEXT).fillna(False).astype(bool)


def _path(name, data_dir):
    return Path(data_dir or DATA_DIR) / SCHEMA[name]["file"]


def load_table(name, data_dir=None, column_map=None) -> pd.DataFrame:
    """원본 CSV → 표준 컬럼 DataFrame. 파일이 없으면 빈 표를 돌려준다 (outbox, action_log)."""
    spec = SCHEMA[name]
    path = _path(name, data_dir)
    if not path.exists():
        return pd.DataFrame(columns=spec["columns"])

    cmap = (column_map if column_map is not None else load_column_map()).get(name) or {}
    rename = {src: std for std, src in cmap.items() if src != std}
    df = pd.read_csv(path, encoding=ENCODING, dtype={"customer_id": str, "symbol": str}).rename(columns=rename)

    missing = [c for c in spec["columns"] if c not in df.columns]
    if missing:
        raise ValueError(f"{name}: 표준 컬럼 없음 {missing} — column_map.yaml 확인")
    df = df[spec["columns"]].copy()

    for col in spec["dates"]:
        df[col] = pd.to_datetime(df[col])
    for col in spec["bools"]:
        df[col] = _to_bool(df[col])
    if name in ("outbox", "action_log"):   # 상태 기록 테이블: 빈 칸은 빈 문자열로
        df = df.fillna("")
    return df


def load_all(data_dir=None, column_map=None) -> dict:
    cmap = column_map if column_map is not None else load_column_map()
    return {name: load_table(name, data_dir, cmap) for name in SCHEMA}


def save_table(df: pd.DataFrame, name, data_dir=None, column_map=None) -> Path:
    """표준 컬럼 DataFrame → 원본 컬럼명으로 되돌려 저장."""
    spec = SCHEMA[name]
    cmap = (column_map if column_map is not None else load_column_map()).get(name) or {}
    out = df[spec["columns"]].copy()
    for col in spec["dates"]:
        out[col] = pd.to_datetime(out[col]).dt.strftime("%Y-%m-%d")
    out = out.rename(columns={std: src for std, src in cmap.items() if src != std})

    path = _path(name, data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False, encoding=ENCODING)
    return path
