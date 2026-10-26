"""전체 고객에 R1~R5를 돌리고, 자동 RP 고객의 '찾은 돈'을 계산한다."""
from dataclasses import dataclass, field

import pandas as pd

from engine.cash.idle import build_accounts, found_money
from engine.priority import sort_findings
from engine.adapter import SCHEMA
from engine.rules import idle_cash, isa, maturity, overseas_tax, rights_offer


@dataclass
class Context:
    """한 번 만들어두고 기준일만 바꿔 재사용하는 데이터 묶음."""
    accounts: dict                  # {(customer_id, currency): AccountSeries}
    customers: pd.DataFrame         # index = customer_id
    products: pd.DataFrame
    auto_on_dates: dict             # {customer_id: [Timestamp, ...]} action_log의 auto_rp_on
    extra: dict = field(default_factory=dict)       # R2~R5 테이블 {name: DataFrame}
    _records: dict = field(default_factory=dict)
    _by_cid: dict = field(default_factory=dict)

    def rows_of(self, table, cid) -> pd.DataFrame:
        """R2~R5 테이블에서 이 고객 행만 (고객별로 한 번만 묶어 둔다)."""
        if table not in self._by_cid:
            df = self.extra.get(table)
            self._by_cid[table] = {} if df is None or df.empty else dict(tuple(df.groupby("customer_id")))
        return self._by_cid[table].get(cid)

    def row_of(self, table, cid, year):
        df = self.rows_of(table, cid)
        if df is None:
            return None
        df = df[df.year.astype(int) == int(year)]
        return None if df.empty else df.iloc[0]

    def customer(self, cid) -> dict:
        if not self._records:
            self._records = self.customers.to_dict("index")
        return self._records[cid]

    def accounts_of(self, cid) -> list:
        return [a for (c, _), a in self.accounts.items() if c == cid]

    def auto_on_date(self, cid, as_of):
        """그날 자동 RP가 켜져 있으면 켠 날짜, 아니면 None."""
        if not bool(self.customer(cid)["auto_rp_enabled"]):
            return None
        dates = [d for d in self.auto_on_dates.get(cid, []) if d <= pd.Timestamp(as_of)]
        if dates:
            return max(dates)
        return None if self.auto_on_dates.get(cid) else pd.Timestamp.min   # 기록이 없으면 이미 켜져 있던 것으로 본다


def auto_on_dates_from_log(action_log: pd.DataFrame) -> dict:
    log = action_log[action_log.action == "auto_rp_on"]
    out = {}
    for cid, ts in zip(log.customer_id, log.timestamp):
        out.setdefault(cid, []).append(pd.Timestamp(str(ts)[:10]))
    return out


EXTRA_TABLES = ("overseas_tax_ytd", "isa_accounts", "holdings", "rights_offers", "maturities")


def make_context(data: dict, accounts=None) -> Context:
    return Context(
        accounts=accounts if accounts is not None else build_accounts(
            data["cash_balances_daily"], data["cash_flows"], data["fx_rates"]),
        customers=data["customers"].set_index("customer_id", drop=False),
        products=data["products"],
        auto_on_dates=auto_on_dates_from_log(data["action_log"]),
        extra={name: data.get(name, pd.DataFrame(columns=SCHEMA[name]["columns"])) for name in EXTRA_TABLES},
    )


@dataclass
class RunResult:
    as_of: pd.Timestamp
    findings: list = field(default_factory=list)   # 우선순위 순
    found: dict = field(default_factory=dict)      # {customer_id: found_money dict}

    def for_customer(self, cid) -> list:
        return [f for f in self.findings if f.customer_id == cid]


def found_for(ctx: Context, cid, cfg, as_of, start=None):
    on = ctx.auto_on_date(cid, as_of)
    acct = ctx.accounts.get((cid, "KRW"))
    if on is None or acct is None or not acct.has(as_of):
        return None
    keep = float(ctx.customer(cid)["auto_rp_keep_krw"])
    return found_money(acct, keep, max(on, acct.dates[0]), cfg, as_of, start)


def run(ctx: Context, cfg, as_of=None) -> RunResult:
    as_of = pd.Timestamp(as_of if as_of is not None else cfg["as_of_date"])
    result = RunResult(as_of=as_of)
    for (cid, _), acct in ctx.accounts.items():
        customer = ctx.customer(cid)
        auto_on = ctx.auto_on_date(cid, as_of) is not None
        f = idle_cash.evaluate(acct, customer, ctx.products, cfg, as_of, auto_on=auto_on)
        if f:
            result.findings.append(f)
    for cid in ctx.customers.index:
        customer = ctx.customer(cid)
        for f in (overseas_tax.evaluate(ctx.row_of("overseas_tax_ytd", cid, as_of.year), customer, cfg, as_of),
                  isa.evaluate(ctx.row_of("isa_accounts", cid, as_of.year), customer, cfg, as_of),
                  *rights_offer.evaluate(ctx.rows_of("holdings", cid), ctx.extra.get("rights_offers"),
                                         customer, cfg, as_of),
                  *maturity.evaluate(ctx.rows_of("maturities", cid), customer, cfg, as_of)):
            if f:
                result.findings.append(f)
        found = found_for(ctx, cid, cfg, as_of)
        if found:
            result.found[cid] = found
    result.findings = sort_findings(result.findings, cfg, as_of)
    return result
