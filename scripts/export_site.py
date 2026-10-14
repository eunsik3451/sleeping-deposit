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
from engine.fmt import man  # noqa: E402
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
PERSONAS = {"P001": "매매대기 + 달러 + 유상증자", "P002": "ELS 상환금 · 연금저축", "P003": "장기방치 · 진단 만료 · 펀드 만기",
            "P004": "예수금 자동 RP 이용 중"}
TRIGGER_LABELS = {"T_EVENT": "입금 다음 날 알림", "T_IDLE_FIRST": "처음 알림", "T_IDLE_UPDATE": "이자 안내(재알림)",
                  "T_REASSESS": "진단 만료 안내", "T_MONTHLY": "월간 리포트", "T_FOUND": "깨운 예수금 이자 알림",
                  "T_TAX": "해외주식 세금 안내", "T_RIGHTS": "유상증자 청약 안내", "T_MATURITY": "만기 안내",
                  "T_PENSION": "연금저축 세액공제 안내"}


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
        if mtype == "info":
            items += [(f"{name} (발견 즉시)", trig, "push", "info", f, None, None),
                      (f"{name} (알림톡)", trig, "kakao", "info", f, None, None)]
        elif has_consent(cust, "kakao") or has_consent(cust, "push"):
            items.append((name, trig, "kakao" if has_consent(cust, "kakao") else "push", "ad", f, None, None))
        else:
            items.append((name, trig, "pb_queue", "ad", f, None, "광고 수신 동의가 없어 PB 통화로 대체됩니다."))
        if f.pb_flag and not any(i[2] == "pb_queue" for i in items):
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
                items.append(("이자 안내 (재알림)", "T_IDLE_UPDATE", "kakao", "ad", f, None, None))
            elif has_consent(cust, "push"):
                items.append(("이자 안내 (재알림)", "T_IDLE_UPDATE", "push", "ad", f, None, None))
            else:
                items.append(("이자 안내 (재알림)", "T_IDLE_UPDATE", "pb_queue", "ad", f, None,
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


# ── 시장 이슈 (scripts/market_morning.py 결과 + 이유 메모) ──
FORBIDDEN_MARKET = ("매수하세요", "매도하세요", "사세요", "파세요", "오를 것", "반등할", "추천", "확실히", "보장")


def market_script(a, cust, note, cfg):
    """PB 통화 문구. 숫자는 계산값만, 이유는 확인된 메모만. 방향 단정·매매 권유 없음."""
    name, stock = cust["name"], a["name"]
    d = pd.Timestamp(a["trade_date"])
    when = f"{d.month}월 {d.day}일"
    reason = note.get("reason") or "움직인 이유는 아직 확인 중입니다. 확인되는 대로 다시 말씀드리겠습니다."
    sp = a.get("spark") or []
    chg20 = sp[-1] / sp[0] - 1 if len(sp) > 1 else 0.0
    rh = a.get("ratio_hist") or []
    why_margin = (f"최근 {len(sp)}거래일 동안 주가가 {abs(chg20) * 100:.1f}% {'내려' if chg20 < 0 else '올라'} "
                  f"담보비율이 {rh[0] * 100:.0f}%에서 {rh[-1] * 100:.0f}%로 바뀌었습니다." if rh else "")
    if a["kind"] != "big_move":
        reason = why_margin + (" " + note["reason"] if note.get("reason") and note.get("big_move") else "")
    maint = cfg["market"]["maintenance_ratio"]
    lines = [f"[인사] 안녕하세요, {name}님. 유진투자증권 담당 PB입니다. "]
    if a["kind"] == "big_move":
        up = a["chg_pct"] > 0
        lines[0] += f"보유하신 {stock} 관련해 알려드릴 내용이 있어 연락드렸습니다."
        lines += [f"[사실] {stock}이 {when} 종가 기준 {abs(a['chg_pct']) * 100:.1f}% {'올랐' if up else '내렸'}습니다. "
                  f"보유하신 {a['qty']:,}주 기준으로 평가금액이 하루 {man(abs(a['day_delta_krw']))} {'늘었' if up else '줄었'}고, 지금 평가금액은 {man(a['value_krw'])}입니다.",
                  f"[이유] {reason}",
                  "[확인] 이번 움직임과 관련해 보유 계획에 변화가 있으신지, 궁금하신 점이 있으신지 여쭤봐도 될까요?",
                  "[안내] 매매 여부는 고객님 판단이며 주문은 앱에서 직접 하실 수 있습니다. 앞으로의 주가 방향은 단정해서 말씀드릴 수 없다는 점 양해 부탁드립니다."]
    elif a["kind"] == "margin_call":
        lines[0] += f"신용으로 보유하신 {stock}의 담보가 부족해져 급히 연락드렸습니다."
        lines += [f"[사실] {when} 종가 기준 담보비율이 {a['ratio'] * 100:.0f}%로 유지비율 {maint * 100:.0f}%보다 낮아졌습니다. "
                  f"신용 대출금은 {man(a['credit_loan_krw'])}, 담보 평가금액은 {man(a['value_krw'])}입니다.",
                  f"[안내] 부족한 금액은 약 {man(a['shortfall_krw'])}이고, 주의 단계 밖으로 돌리려면 약 {man(a['to_safe_krw'])}이 필요합니다. 정해진 기한까지 현금을 넣거나 일부 상환하지 않으시면 보유 주식이 반대매매(강제 매도)될 수 있습니다.",
                  f"[이유] {reason}",
                  "[확인] 추가 납입이나 상환 계획이 있으신가요? 방법은 앱에서 직접 하실 수 있게 안내드리겠습니다."]
    else:
        price = f"${a['trigger_price']:,.2f}" if a["currency"] == "USD" else f"{a['trigger_price']:,.0f}원"
        lines[0] += f"신용으로 보유하신 {stock}의 담보비율이 낮아져 반대매매가 생기기 전에 미리 알려드리려고 연락드렸습니다."
        lines += [f"[사실] {when} 종가 기준 담보비율이 {a['ratio'] * 100:.0f}%로, 유지비율 {maint * 100:.0f}%까지 여유가 줄었습니다. "
                  f"주가가 약 {a['room'] * 100:.1f}% 더 내려 {price} 아래가 되면 담보가 부족해질 수 있습니다."
                  + (f" 최근 {a['lookback']}거래일 중 하루에 이만큼 내린 날이 {a['big_days']}일 있었습니다." if a["big_days"] else ""),
                  f"[안내] 주의 단계 밖으로 돌리려면 약 {man(a['to_safe_krw'])}을 더 넣거나 그만큼 신용을 줄이시면 됩니다.",
                  "[확인] 미리 담보를 보강하시거나 신용 비중을 줄이실 계획이 있으신지 여쭤봐도 될까요?",
                  "[안내] 결정은 고객님 판단이며, 진행은 앱에서 직접 하실 수 있습니다."]
    text = "\n".join(lines)
    ours = text.replace(reason, "")              # 인용한 뉴스 요약은 빼고 우리가 쓴 문장만 검사
    bad = [w for w in FORBIDDEN_MARKET if w in ours]
    assert not bad, (a["customer_id"], bad)
    return text


def market_section(cfg, ctx):
    files = sorted(p for p in (ROOT / "data" / "market").glob("20*.json"))
    if not files:
        return None
    m = json.loads(files[-1].read_text(encoding="utf-8"))
    npath = ROOT / "data" / "market" / "notes" / files[-1].name
    notes = json.loads(npath.read_text(encoding="utf-8")) if npath.exists() else {}
    alerts = []
    for a in m["alerts"]:
        c = ctx.customer(a["customer_id"])
        note = notes.get(a["symbol"], {}) if a["kind"] == "big_move" else {}
        alerts.append({k: a.get(k) for k in ("kind", "customer_id", "symbol", "name", "market", "currency", "qty", "close",
                                                  "prev_close", "chg_pct", "value_krw", "day_delta_krw", "pnl_krw",
                                                  "credit_loan_krw", "ratio", "shortfall_krw", "trade_date", "spark",
                                                  "room", "trigger_price", "to_safe_krw", "big_days", "lookback", "ratio_hist")}
                      | {"cname": c["name"], "age": int(pd.Timestamp(cfg["as_of_date"]).year - int(c["birth_year"])),
                         "reason": note.get("reason", ""), "sources": note.get("sources", []),
                         "chg20": (a["spark"][-1] / a["spark"][0] - 1) if a.get("spark") and len(a["spark"]) > 1 else None,
                         "script": market_script(a, c, note, cfg)})
    keep = ("customer_id", "symbol", "name", "kind", "ratio", "room", "trigger_price", "close", "credit_loan_krw", "value_krw",
            "shortfall_krw", "to_safe_krw", "big_days", "lookback", "ratio_hist", "trade_date")
    credit = [{k: b.get(k) for k in keep} for b in m.get("credit", [])]
    return {"credit": credit, "positions": m.get("positions_all", []), "ref_date": m["ref_date"], "generated": m["generated"], "indices": m["indices"], "movers": m["movers"],
            "alerts": alerts, "holders": m["holders"], "big_move_pct": cfg["market"]["big_move_pct"],
            "maintenance_ratio": cfg["market"]["maintenance_ratio"], "notes_checked": {k: v.get("checked_by", "") for k, v in notes.items()}}


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

        bal = {}
        for acct in ctx.accounts_of(cid):
            if acct.has(A):
                k = acct.pos(A)
                bal[acct.currency] = {"cash": float(acct.cash[k]), "auto_rp": float(acct.auto_rp[k]), "rate": float(acct.rate[k])}
        customers.append({
            "balance": bal,
            "id": cid, "name": c["name"], "age": A.year - int(c["birth_year"]), "risk": c["risk_profile"],
            "diag": f"{diag:%Y-%m-%d}", "diag_valid": (A - diag).days <= cfg["suitability"]["risk_profile_valid_days"],
            "consent_push": has_consent(c, "push"), "consent_kakao": has_consent(c, "kakao"), "pb": c["pb_id"],
            "auto": bool(found), "keep": int(c["auto_rp_keep_krw"]), "persona": PERSONAS.get(cid),
            "missed_month": rep["missed"], "will_miss": rep["will_miss"],
            "found": jsonable(found) if found else None,
            "items_total": sum(f.amount_krw for f in fs if f.rule != "R1"),
        })
        details[cid] = {
            "findings": [{**finding_dict(f), "script": pb_script(f, c, cfg, gen, A)["body"]} for f in fs],
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
        "market": market_section(cfg, ctx),
    }
    OUT.parent.mkdir(exist_ok=True)
    text = json.dumps(jsonable(site), ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.SITE_DATA={text};\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)} {OUT.stat().st_size / 1e6:.1f}MB · 고객 {len(customers)}명 · "
          f"발견 {len(res.findings)}건 · 발송함 {len(outbox)}건 · PB {len(pb)}건")


if __name__ == "__main__":
    main()
