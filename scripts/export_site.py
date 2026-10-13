"""웹사이트(site/)용 데이터 내보내기. 엔진을 그대로 돌려 결과를 site/data.js 하나로 저장한다.

사이트는 서버 없이 GitHub Pages에서 열리는 정적 페이지라, 계산은 전부 여기서 끝낸다.
실행: python scripts/export_site.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from engine.cash.suitability import RISK_GRADE_LABEL  # noqa: E402
from engine.config import load_config  # noqa: E402
from engine.models import SUBTYPE_LABELS  # noqa: E402
from engine.runner import make_context, run  # noqa: E402
from generate_demo_data import generate  # noqa: E402
from messages.generator import TemplateGenerator  # noqa: E402
from notify import report  # noqa: E402
from notify.outbox import backfill, demo_run_time_for, empty_outbox, simulate_engagement  # noqa: E402
from notify.policy import ad_title, has_consent  # noqa: E402
from notify.triggers import ITEM_TRIGGERS, key_of  # noqa: E402

OUT = ROOT / "site" / "data.js"
PERSONAS = {"P001": "매매대기 + 달러 + 유상증자", "P002": "ELS 상환금", "P003": "장기방치 · 진단 만료 · 펀드 만기",
            "P004": "예수금 자동 RP 이용 중"}
TRIGGER_LABELS = {"T_EVENT": "입금 다음 날 알림", "T_IDLE_FIRST": "처음 알림", "T_IDLE_UPDATE": "운용 안내(재알림)",
                  "T_REASSESS": "진단 만료 안내", "T_MONTHLY": "월간 리포트", "T_FOUND": "깨운 예수금 이자 알림",
                  "T_TAX": "해외주식 세금 안내", "T_RIGHTS": "유상증자 청약 안내", "T_MATURITY": "만기 안내"}


def jsonable(x):
    if isinstance(x, (pd.Timestamp,)):
        return None if x.year < 1900 else f"{x:%Y-%m-%d}"
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.floating):
        return float(x)
    if isinstance(x, np.bool_):
        return bool(x)
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    return x


def finding_dict(f):
    d = f.to_dict()
    d["subtype_label"] = SUBTYPE_LABELS.get(f.subtype, f.subtype)
    for k in ("cash_today", "idle_krw", "buffer_krw"):
        if k in d["meta"]:
            d["meta"][k] = float(d["meta"][k])
    return jsonable(d)


def previews(f, cust, cfg, gen, as_of):
    """고객에게 나가는 알림 예시 (실제 트리거·동의 규칙대로)."""
    items = []
    if f.rule != "R1":
        trig, mtype = ITEM_TRIGGERS[f.rule]
        name = TRIGGER_LABELS[trig]
        items += [(f"{name} (발견 즉시)", trig, "push", "info", f, None, None),
                  (f"{name} (알림톡)", trig, "kakao", "info", f, None, None)]
        if f.pb_flag:
            items.append(("PB 통화 스크립트", trig, "pb_queue", "info", f, None, "금액이 커서 PB 콜리스트에도 올라갑니다."))
    else:
        if f.subtype == "event_inflow" and f.meta.get("event"):
            items.append(("입금 다음 날", "T_EVENT", "kakao", "info", None, {"event": {**f.meta["event"], "days_since": 1}}, None))
        if f.action.type == "reassess":
            items += [("진단 만료 안내", "T_REASSESS", "push", "info", f, None, None),
                      ("진단 만료 안내 (알림톡)", "T_REASSESS", "kakao", "info", f, None, None)]
        else:
            items.append((f"처음 알림 ({cfg['cash']['min_idle_days']}일째 되는 날)", "T_IDLE_FIRST", "push", "info", f, None, None))
            if has_consent(cust, "kakao"):
                items.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "kakao", "ad", f, None, None))
            elif has_consent(cust, "push"):
                items.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "push", "ad", f, None, None))
            else:
                items.append(("운용 안내 (재알림)", "T_IDLE_UPDATE", "pb_queue", "ad", f, None,
                              "광고 수신 동의가 없어 앱 푸시·알림톡 대신 PB 통화로 대체됩니다."))
        if f.pb_flag and not any(i[2] == "pb_queue" for i in items):
            items.append(("PB 통화 스크립트", "T_IDLE_UPDATE", "pb_queue", "info", f, None,
                          "금액이 크거나 상담이 필요한 건이라 PB 콜리스트에도 올라갑니다."))
    return [render(i, cust, cfg, gen, as_of) for i in items]


def render(item, cust, cfg, gen, as_of):
    label, trig, ch, mtype, f, extra, note = item
    out = gen.generate_checked(trig, ch, mtype if ch != "pb_queue" else "info", cust, f, extra, as_of)
    title = ad_title(out["title"], cfg) if mtype == "ad" and ch in ("push", "kakao") else out["title"]
    return {"label": label, "trigger": trig, "channel": ch, "msg_type": mtype, "title": title, "body": out["body"],
            "note": note, "checked": out["used"] == "template"}


def pb_script(f, cust, cfg, gen, as_of):
    trig = ITEM_TRIGGERS[f.rule][0] if f.rule != "R1" else "T_IDLE_UPDATE"
    out = gen.generate_checked(trig, "pb_queue", "info", cust, f, None, as_of)
    return {"title": out["title"], "body": out["body"]}


def pb_reasons(f, cfg, hold_reason):
    c, out = cfg["cash"], []
    if f.rule == "R2" and f.pb_flag:
        out.append("절세액 50만원 이상")
    if f.rule == "R3" and f.pb_flag:
        out.append("청약 차이 100만원 이상")
    if f.rule == "R4" and f.pb_flag:
        out.append("상환금 3,000만원 이상")
    if f.rule != "R1" and f.meta.get("days_left", 99) <= cfg["priority"]["urgent_days"]:
        out.append(f"마감 D-{f.meta['days_left']}")
    if f.rule == "R1" and f.meta["idle_krw"] >= c["pb_threshold_krw"]:
        out.append("쉬는 돈 5,000만원 이상")
    if f.subtype == "event_inflow" and (f.meta.get("event") or {}).get("amount", 0) >= c["pb_event_threshold_krw"]:
        out.append("큰 상환금 유입")
    if f.action and f.action.type == "pb_consult":
        out.append("맞는 상품 없음")
    if f.action and f.action.type == "reassess":
        out.append("진단 만료")
    if hold_reason == "no_consent":
        out.append("광고 미동의")
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = load_config()
    A = pd.Timestamp(cfg["as_of_date"])
    data = generate(cfg)
    ctx = make_context(data)
    res = run(ctx, cfg)
    gen = TemplateGenerator(cfg, data["products"])
    products = data["products"].set_index("product_id")

    # 진단 만료 고객이 앱에서 재진단을 마친 뒤의 결과 (데모 버튼용)
    reassess_ids = {f.customer_id for f in res.findings if f.action and f.action.type == "reassess"}
    cust2 = data["customers"].copy()
    cust2.loc[cust2.customer_id.isin(reassess_ids), "risk_profile_date"] = A
    res2 = run(make_context({**data, "customers": cust2}, accounts=ctx.accounts), cfg)
    after_reassess = {f.finding_id: finding_dict(f) for f in res2.findings
                      if f.customer_id in reassess_ids and f.rule == "R1"}

    # 발송함: 최근 30일 하루 배치 + 참여 시뮬레이션
    start = A - pd.Timedelta(days=29)
    ob = backfill(start, A, ctx, cfg, empty_outbox(), data["action_log"], gen, run_time_for=demo_run_time_for(start))
    ob = simulate_engagement(ob, cfg["demo"]["seed"], A)
    pbq = ob[ob.channel == "pb_queue"].sort_values("scheduled_at")
    queued = pbq.assign(key=pbq.finding_id.map(key_of)).groupby("key").tail(1).set_index("key")

    month_start = A.replace(day=1)
    prev_end = month_start - pd.Timedelta(days=1)
    customers, details = [], {}
    for cid in ctx.customers.index:
        c = ctx.customer(cid)
        fs = res.for_customer(cid)
        found = res.found.get(cid)
        diag = pd.Timestamp(c["risk_profile_date"])
        rep = report.customer_month(ctx, cid, cfg, month_start, A, fs)
        trend = report.customer_trend(ctx, cid, cfg, A)
        prev = report.customer_month(ctx, cid, cfg, prev_end.replace(day=1), prev_end, fs)
        extra = {"month": prev_end.replace(day=1), "missed_month": prev["missed"], "will_miss": prev["will_miss"],
                 "found_month": prev["found"]}
        pv = [p for f in fs for p in previews(f, c, cfg, gen, A)]
        if found:
            fe = {**extra, "found_total": found["found_krw"],
                  "found_on": found["on_date"] if found["on_date"].year > 1900 else A, "found_invested": found["invested_krw"]}
            pv.append(render(("매월 1일 깨운 예수금 이자", "T_FOUND", "push", "info", None, fe, None), c, cfg, gen, A))
        pv.append(render(("매월 1일 월간 리포트", "T_MONTHLY", "monthly_report", "info", None, extra, None), c, cfg, gen, A))

        customers.append({
            "id": cid, "name": c["name"], "age": A.year - int(c["birth_year"]), "risk": c["risk_profile"],
            "diag": f"{diag:%Y-%m-%d}", "diag_valid": (A - diag).days <= cfg["suitability"]["risk_profile_valid_days"],
            "consent_push": has_consent(c, "push"), "consent_kakao": has_consent(c, "kakao"), "pb": c["pb_id"],
            "auto": bool(found), "keep": int(c["auto_rp_keep_krw"]), "persona": PERSONAS.get(cid),
            "missed_month": rep["missed"], "will_miss": rep["will_miss"],
            "found": jsonable(found) if found else None,
            "items_total": sum(f.amount_krw for f in fs if f.rule != "R1"),
        })
        details[cid] = {
            "findings": [finding_dict(f) for f in fs],
            "previews": pv,
            "trend": {"start": f"{trend.date.iloc[0]:%Y-%m-%d}" if len(trend) else None,
                      "cash": [round(x / 1e4) for x in trend.cash_krw], "idle": [round(x / 1e4) for x in trend.idle_krw],
                      "auto": [round(x / 1e4) for x in trend.auto_rp_krw]},
        }

    pb = []
    for rank, f in enumerate(res.findings):
        in_q = f.meta["key"] in queued.index
        if not (f.pb_flag or in_q):
            continue
        c = ctx.customer(f.customer_id)
        hold = queued.loc[f.meta["key"], "hold_reason"] if in_q else ""
        pb.append({"rank": rank, "cid": f.customer_id, "name": c["name"], "age": A.year - int(c["birth_year"]),
                   "pb": c["pb_id"], "finding_id": f.finding_id, "subtype": SUBTYPE_LABELS.get(f.subtype, f.subtype),
                   "title": f.title, "amount": f.amount_krw, "label": f.amount_label, "evidence": f.evidence,
                   "reasons": pb_reasons(f, cfg, hold) or ["PB 큐"], "deadline": f.deadline,
                   "contact_only": not (has_consent(c, "push") or has_consent(c, "kakao")),
                   "queued_on": queued.loc[f.meta["key"], "scheduled_at"][:10] if in_q else None,
                   "script": pb_script(f, c, cfg, gen, A)})

    cash = auto = 0.0
    for acct in ctx.accounts.values():
        if acct.has(A):
            e = acct.pos(A)
            cash += acct.cash[e] * acct.rate[e]
            auto += acct.auto_rp[e] * acct.rate[e]

    outbox = [{"id": r.message_id, "cid": r.customer_id, "trigger": r.trigger, "channel": r.channel,
               "msg_type": r.msg_type, "at": r.scheduled_at, "status": r.status, "hold": str(r.hold_reason or ""),
               "title": r.title, "body": r.body} for r in ob.itertuples()]

    site = {
        "as_of": f"{A:%Y-%m-%d}",
        "rates": {"rp": cfg["cash"]["krw_rp_rate"], "deposit": cfg["cash"]["krw_deposit_rate"]},
        "rules": {"min_idle": cfg["cash"]["min_idle_amount_krw"], "min_days": cfg["cash"]["min_idle_days"],
                  "lookback": cfg["cash"]["lookback_days"], "snooze": cfg["notify"]["snooze_days"]},
        "products": {pid: {"name": p["name"], "rate": float(p["annual_rate"]), "grade": int(p["risk_grade"]),
                           "grade_label": RISK_GRADE_LABEL[int(p["risk_grade"])], "type": p["product_type"]}
                     for pid, p in products.iterrows()},
        "customers": customers,
        "details": details,
        "after_reassess": after_reassess,
        "pb": pb,
        "outbox": outbox,
        "company": {"cash": cash, "auto": auto},
        "trigger_labels": TRIGGER_LABELS,
    }
    OUT.parent.mkdir(exist_ok=True)
    text = json.dumps(jsonable(site), ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.SITE_DATA={text};\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)} {OUT.stat().st_size / 1e6:.1f}MB · 고객 {len(customers)}명 · "
          f"발견 {len(res.findings)}건 · 발송함 {len(outbox)}건 · PB {len(pb)}건")


if __name__ == "__main__":
    main()
