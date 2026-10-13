"""엔진 공통 데이터 구조와 상수."""
from dataclasses import asdict, dataclass, field
from typing import Optional

OUTFLOW_TYPES = ("buy_settle", "withdrawal")
INFLOW_TYPES = ("sell_settle", "deposit", "dividend", "els_redemption", "bond_maturity", "interest")
EVENT_FLOW_TYPES = ("dividend", "els_redemption", "bond_maturity")

RISK_PROFILES = ("안정형", "안정추구형", "위험중립형", "적극투자형", "공격투자형")

SUBTYPE_LABELS = {
    "fx_idle": "외화방치형",
    "event_inflow": "이벤트유입형",
    "active_trader": "매매대기형",
    "long_idle": "장기방치형",
    "tax_loss_harvest": "해외주식 손실 상계",
    "tax_deduction_fill": "해외주식 공제 채우기",
    "rights_offer": "유상증자 청약",
    "maturity": "펀드·ELS 만기",
}

RULE_LABELS = {"R1": "예수금 활용", "R2": "해외주식 양도세", "R3": "권리 안내", "R4": "만기 안내"}

ACTION_TYPES = ("rp_buy", "reassess", "pb_consult")
CHANNELS = ("push", "kakao", "pb_queue", "monthly_report")
MSG_TYPES = ("info", "ad")
OUTBOX_STATUSES = ("queued", "held", "previewed", "sent_sim", "opened_sim", "executed_sim")
LOG_ACTIONS = ("viewed", "executed", "pb_called", "dismissed", "auto_rp_on")


@dataclass
class Recommendation:
    product_id: Optional[str]
    suggest_amount: float              # 원화는 원, 외화는 해당 통화
    alt: Optional[str] = None          # 보조 제안 (예: "auto_rp")
    candidates: list = field(default_factory=list)


@dataclass
class Action:
    type: str                          # rp_buy | reassess | pb_consult
    label: str


@dataclass
class Finding:
    finding_id: str
    customer_id: str
    rule: str
    subtype: str
    currency: str
    title: str
    amount_krw: int
    amount_label: str
    annual_projection_krw: int
    deadline: Optional[str]
    evidence: list
    recommendation: Optional[Recommendation]
    action: Optional[Action]
    pb_flag: bool
    meta: dict = field(default_factory=dict)   # 화면·알림용 보조값 (idle, streak, buffer 등)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Message:
    message_id: str
    customer_id: str
    finding_id: Optional[str]
    trigger: str
    channel: str
    msg_type: str
    scheduled_at: str                  # YYYY-MM-DD HH:MM
    title: str
    body: str
    status: str = "queued"
    hold_reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)
