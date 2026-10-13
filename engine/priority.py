"""우선순위: 기한 임박 → 이벤트유입 → 금액 큰 순 (CLAUDE.md 7.3)."""
import pandas as pd


def sort_key(finding, cfg, as_of) -> tuple:
    urgent = False
    if finding.deadline:
        days_left = (pd.Timestamp(finding.deadline) - pd.Timestamp(as_of)).days
        urgent = days_left <= cfg["priority"]["urgent_days"]
    return (not urgent, finding.subtype != "event_inflow", -finding.amount_krw)


def sort_findings(findings, cfg, as_of) -> list:
    return sorted(findings, key=lambda f: sort_key(f, cfg, as_of))
