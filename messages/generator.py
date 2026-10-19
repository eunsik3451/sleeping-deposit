"""메시지 생성 (CLAUDE.md 8장). 외부 API 호출 없음: 템플릿에 계산값을 채우고 validator로 검사한다."""
import os
from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd
import yaml

from engine.cash.suitability import RISK_GRADE_LABEL
from engine.fmt import man, md, money, pct
from engine.rules.idle_cash import EVENT_LABELS
from messages import validator

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

SAFE = {   # 기본 템플릿마저 실패했을 때 쓰는 문장 (숫자·상품명 없음)
    "push": {"title": "계좌 알림이 도착했어요", "body": "앱에서 내 계좌의 잠자는 예수금 깨우기를 확인해 보세요."},
    "kakao": {"title": "계좌 알림", "body": "[유진투자증권] 계좌 알림\n\n앱 > 잠자는 예수금 깨우기에서 내 계좌 내용을 확인해 보세요."},
    "monthly_report": {"title": "잠자는 예수금 깨우기", "body": "앱 > 잠자는 예수금 깨우기에서 이번 달 내용을 확인해 보세요."},
    "pb_queue": {"title": "[통화] 확인 필요", "body": "자동 스크립트를 만들지 못했습니다. 화면의 근거를 보고 통화해 주세요."},
}


def tone_for(customer, as_of) -> str:
    age = pd.Timestamp(as_of).year - int(customer["birth_year"])
    if age >= 60:
        return "plain"
    if age >= 40:
        return "standard"
    return "brief"


class MessageGenerator(ABC):
    @abstractmethod
    def generate(self, trigger, channel, msg_type, customer, finding=None, extra=None) -> tuple:
        """(title, body)"""


def _dedupe_period(body, values) -> str:
    """'45일째 그대로예요. 돈이 쉰 45일 동안 놓친…'처럼 같은 날수가 겹치면 뒤쪽을 '그동안'으로."""
    period = values.get("missed_period", "")
    if period == f"돈이 쉰 {values.get('days')}일 동안" and f"{values['days']}일째" in body.split(period)[0]:
        return body.replace(period, "그동안")
    return body


class TemplateGenerator(MessageGenerator):
    def __init__(self, cfg, products: pd.DataFrame, templates: dict = None, template_dir=TEMPLATE_DIR):
        self.cfg = cfg
        self.products = products.set_index("product_id")
        self.product_names = tuple(products["name"])
        self.templates = templates if templates is not None else self._load(template_dir)

    @staticmethod
    def _load(template_dir) -> dict:
        out = {}
        for path in Path(template_dir).glob("*.yaml"):
            with open(path, encoding="utf-8") as f:
                out[path.stem] = yaml.safe_load(f)
        return out

    # ── 값 채우기 ──
    def values(self, customer, finding=None, extra=None, as_of=None) -> dict:
        c = self.cfg["cash"]
        v = {"name": customer["name"], "lookback": c["lookback_days"]}
        if finding is not None and finding.rule != "R1":
            v.update(self._item_values(finding))
        elif finding is not None:
            m = finding.meta
            rec = finding.recommendation
            v.update({
                "title": finding.title,
                "cash": money(m["cash_today"], finding.currency),
                "idle": man(m["idle_krw"]),
                "missed": man(finding.amount_krw),
                "missed_period": m.get("missed_period", f"지난 {c['lookback_days']}일 동안"),
                "annual": man(finding.annual_projection_krw),
                "days": m["streak"],
                "buffer": man(m["buffer_krw"]),
                "diag_date": f"{pd.Timestamp(customer['risk_profile_date']):%Y년} {md(pd.Timestamp(customer['risk_profile_date']))}",
            })
            if rec is not None and rec.product_id:
                p = self.products.loc[rec.product_id]
                v.update({"product": p["name"], "rate": pct(p["annual_rate"]),
                          "risk": f"{int(p['risk_grade'])}등급({RISK_GRADE_LABEL[int(p['risk_grade'])]})",
                          "suggest": money(rec.suggest_amount, finding.currency)})
            if m.get("event"):
                v.update(self._event_values(m["event"]))
        if extra:
            if extra.get("move"):
                v.update(self._move_values(extra["move"]))
            if extra.get("event"):
                v.update(self._event_values(extra["event"]))
            for k in ("missed_month", "will_miss", "found_month", "found_total", "found_invested"):
                if k in extra:
                    v[k] = man(extra[k])
            if "month" in extra:
                v["month"] = f"{extra['month'].month}월"
            if "found_on" in extra:
                v["found_on"] = f"{extra['found_on']:%Y년} {md(extra['found_on'])}"
        return v

    @staticmethod
    def _item_values(f) -> dict:
        """R2~R5 값. 금액은 만원 단위, 가격은 원 단위."""
        m = f.meta
        v = {"title": f.title, "amount": man(f.amount_krw), "deadline": md(pd.Timestamp(f.deadline)),
             "days_left": m["days_left"]}
        if f.rule == "R2":
            v.update(realized=man(m["realized"]), loss=man(m["loss"]), gain=man(m["gain"]),
                     deduction=man(m["deduction"]), deduction_left=man(m["deduction_left"]), base=man(m["base"]))
        elif f.rule == "R3":
            v.update(stock=m["stock"], qty=f"{m['qty']:,}주", shares=f"{m['shares']:,}주",
                     now=f"{int(m['now']):,}원", issue_price=f"{int(m['issue_price']):,}원",
                     start=md(pd.Timestamp(m["start"])))
        elif f.rule == "R4":
            v.update(product_name=m["product_name"], kind=m["kind"], expected=man(m["expected"]))
        elif f.rule == "R5":
            v.update(paid=man(m["paid"]), limit=man(m["limit"]), remain=man(m["remain"]))
        return v

    @staticmethod
    def _move_values(a) -> dict:
        """보유 종목 큰 등락(T_MOVE): 시장 알림 한 건 → 종목·날짜·방향·종가·평가금액 변동."""
        price = (lambda x: f"{int(round(x)):,}원") if a.get("currency", "KRW") == "KRW" else (lambda x: f"${x:,.2f}")
        d = a["day_delta_krw"]
        return {"stock": a["name"], "move_date": md(pd.Timestamp(a["trade_date"])), "dir": "올랐어요" if a["chg_pct"] > 0 else "내렸어요",
                "close": price(a["close"]), "prev_close": price(a["prev_close"]), "value": man(a["value_krw"]),
                "delta": ("+" if d >= 0 else "−") + man(abs(d))}

    @staticmethod
    def _event_values(ev) -> dict:
        return {"event_label": EVENT_LABELS[ev["flow_type"]], "event_amount": man(ev["amount"]),
                "event_date": md(pd.Timestamp(ev["date"])), "event_days": ev["days_since"]}

    def _offer(self, finding, values) -> str:
        offers = self.templates.get("common", {}).get("offer", {})
        if finding is None:
            return ""
        key = finding.action.type
        if key == "rp_buy" and finding.subtype in offers:
            key = finding.subtype
        return offers.get(key, "").format_map(values)

    # ── 템플릿 고르기 ──
    def pick(self, trigger, channel, subtype=None, tone=None) -> tuple:
        """(고른 템플릿, 그 채널의 기본 템플릿)"""
        block = (self.templates.get(trigger) or {}).get(channel) \
            or (self.templates.get("common") or {}).get(channel) or {}
        default = block.get("default")
        chosen = (block.get("subtype") or {}).get(subtype) or block.get(tone) or default
        return chosen, default

    def generate_checked(self, trigger, channel, msg_type, customer, finding=None, extra=None, as_of=None) -> dict:
        as_of = as_of or self.cfg["as_of_date"]
        values = self.values(customer, finding, extra, as_of)
        if channel == "pb_queue":
            try:
                values["offer"] = self._offer(finding, values)
            except KeyError:
                values["offer"] = ""
        chosen, default = self.pick(trigger, channel, finding.subtype if finding else None, tone_for(customer, as_of))

        tried = []
        for label, tmpl in (("template", chosen), ("default", default)):
            if not tmpl or (label == "default" and tmpl is chosen and tried):
                continue
            try:
                title, body = tmpl["title"].format_map(values), tmpl["body"].format_map(values)
                body = _dedupe_period(body, values)
            except KeyError as e:
                tried.append(f"{label}: 값 없음 {e}")
                continue
            problems = validator.check(title, body, values, msg_type, channel, self.product_names)
            if not problems:
                return {"title": title, "body": body, "used": label, "problems": tried}
            tried.append(f"{label}: {'; '.join(problems)}")
        safe = SAFE.get(channel, SAFE["push"])
        return {"title": safe["title"], "body": safe["body"], "used": "safe", "problems": tried}

    def generate(self, trigger, channel, msg_type, customer, finding=None, extra=None, as_of=None) -> tuple:
        r = self.generate_checked(trigger, channel, msg_type, customer, finding, extra, as_of)
        return r["title"], r["body"]


class ClaudeGenerator(MessageGenerator):
    """외부 LLM 문장 생성 자리 (뼈대만). 지금은 API 키가 없어 항상 TemplateGenerator로 폴백한다.
    나중에 붙이더라도 숫자는 엔진 값만 쓰고, 결과는 같은 validator를 통과해야 한다."""

    def __init__(self, fallback: TemplateGenerator):
        self.fallback = fallback
        self.enabled = False and bool(os.environ.get("ANTHROPIC_API_KEY"))   # 미구현: 호출하지 않음

    def generate(self, trigger, channel, msg_type, customer, finding=None, extra=None, as_of=None) -> tuple:
        return self.fallback.generate(trigger, channel, msg_type, customer, finding, extra, as_of)
