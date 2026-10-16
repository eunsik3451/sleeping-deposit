"""카카오톡 메시지 API로 알림 보내기 (테스트용).

알림톡이 아니라 카카오 로그인 토큰으로 보내는 '나에게 보내기'.
키·토큰은 .kakao/ (git 제외)에 둔다. 버튼은 고객용 데모 화면(site/app.html?c=고객번호)으로 연결한다
— PB 업무 화면으로 보내지 않는다. 실서비스에서는 유진투자증권 앱의 해당 화면(딥링크).

    python notify/kakao_send.py login              # 로그인 주소 출력 → 브라우저로 열기
    python notify/kakao_send.py token "<주소창 URL>" # 돌아온 주소(또는 code)로 토큰 저장

    # 보낼 알림 고르기: --id 발송함 메시지 id, 또는 --cid 고객 --label 오늘 미리보기 이름 일부
    python notify/kakao_send.py send-me --cid T001 --label 이자   # 텍스트 (200자 넘으면 템플릿 kakao_short 짧은 버전)
    python notify/kakao_send.py send-me --id M20261005-T001-T_EVENT-kakao

    # (보조) 이미지 카드 — 카톡 말풍선에서 글자가 작아 읽기 어려워 기본으로 쓰지 않는다
    python notify/kakao_send.py card --cid T001 --label 이자 → publish.sh → send-me ... --card
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
KDIR = ROOT / ".kakao"
TOKEN_FILE = KDIR / "token_me.json"
SITE_URL = "https://eunsik3451.github.io/sleeping-deposit/"
REDIRECT_URI = SITE_URL + "kakao-callback.html"
CARD_DIR = ROOT / "site" / "kakao"
TEXT_LIMIT = 200  # 텍스트 메시지 본문 최대 글자 수
FONT = "C:/Windows/Fonts/malgun.ttf"
FONT_BOLD = "C:/Windows/Fonts/malgunbd.ttf"


def load_config():
    cfg = {}
    for line in (KDIR / "config.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    if not cfg.get("KAKAO_REST_API_KEY"):
        sys.exit(".kakao/config.env 에 KAKAO_REST_API_KEY 를 넣어주세요.")
    return cfg


def token_request(cfg, data):
    data = {"client_id": cfg["KAKAO_REST_API_KEY"], **data}
    if cfg.get("KAKAO_CLIENT_SECRET"):
        data["client_secret"] = cfg["KAKAO_CLIENT_SECRET"]
    r = requests.post("https://kauth.kakao.com/oauth/token", data=data, timeout=10)
    if r.status_code != 200:
        sys.exit(f"토큰 발급 실패 {r.status_code}: {r.text}")
    return r.json()


def save_token(tok, old=None):
    now = int(time.time())
    merged = dict(old or {})
    merged["access_token"] = tok["access_token"]
    merged["access_expires_at"] = now + int(tok["expires_in"])
    if tok.get("refresh_token"):  # 갱신 시엔 만료 1달 이내일 때만 새로 내려온다
        merged["refresh_token"] = tok["refresh_token"]
        merged["refresh_expires_at"] = now + int(tok["refresh_token_expires_in"])
    if tok.get("scope"):
        merged["scope"] = tok["scope"]
    TOKEN_FILE.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    return merged


def access_token(cfg):
    if not TOKEN_FILE.exists():
        sys.exit("토큰이 없어요. 먼저 login → token 순서로 진행하세요.")
    tok = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    if time.time() < tok["access_expires_at"] - 60:
        return tok["access_token"]
    if time.time() >= tok.get("refresh_expires_at", 0):
        sys.exit("리프레시 토큰도 만료됐어요. login 부터 다시 해주세요.")
    new = token_request(cfg, {"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
    return save_token(new, tok)["access_token"]


# ── 보낼 알림 고르기 ──
def site_data():
    s = (ROOT / "site" / "data.js").read_text(encoding="utf-8")
    return json.loads(s[s.index("{"):s.rindex("}") + 1])


def pick_message(args):
    """{cid, title, body, msg_type, ref} — 발송함 기록(--id) 또는 오늘 미리보기(--cid --label)."""
    data = site_data()
    if args.id:
        rows = [o for o in data["outbox"] if o["id"] == args.id and o["channel"] == "kakao"]
        if not rows:
            sys.exit(f"발송함에 카톡 메시지 {args.id} 가 없어요.")
        o = rows[0]
        return {"cid": o["cid"], "title": o["title"], "body": o["body"], "short": None, "msg_type": o["msg_type"], "ref": o["id"]}
    det = data["details"].get(args.cid)
    if not det:
        sys.exit(f"고객 {args.cid} 가 없어요.")
    rows = [p for p in det["previews"] if p["channel"] == "kakao" and (args.label or "") in p["label"]]
    if not rows:
        labels = [p["label"] for p in det["previews"] if p["channel"] == "kakao"]
        sys.exit(f"{args.cid} 의 카톡 미리보기에 '{args.label}' 가 없어요. 있는 것: {labels}")
    p = rows[0]
    return {"cid": args.cid, "title": p["title"], "body": p["body"], "short": p.get("short"), "msg_type": p["msg_type"],
            "ref": f"{args.cid} 오늘 미리보기 · {p['label']}"}


def app_url(cid):
    return f"{SITE_URL}app.html?c={cid}"


def message_text(msg):
    """보낼 글: 광고성은 "(광고) 제목" 줄을 맨 앞에. 200자를 넘으면 템플릿의 짧은 버전(kakao_short)."""
    def join(body):
        return f"{msg['title']}\n\n{body}" if msg["msg_type"] == "ad" else body
    full = join(msg["body"])
    if len(full) <= TEXT_LIMIT:
        return full, "전체"
    if msg.get("short"):
        return join(msg["short"]), "짧은 버전"
    if msg["msg_type"] == "ad":
        sys.exit(f"광고성 알림이 {len(full)}자인데 짧은 버전이 없어요. 자르면 고지 문구가 빠지니 템플릿에 kakao_short 를 추가하세요.")
    return fit_text(msg["body"]), "잘라냄"


def fit_text(body, limit=TEXT_LIMIT):
    """200자를 넘으면 문단 단위로 잘라 '자세히 보기'로 넘긴다."""
    if len(body) <= limit:
        return body
    tail = "\n\n(전체 내용은 아래 '자세히 보기')"
    out = ""
    for para in body.split("\n\n"):
        cand = f"{out}\n\n{para}" if out else para
        if len(cand) + len(tail) > limit:
            break
        out = cand
    return (out or body[: limit - len(tail)]) + tail


# ── 이미지 카드 (200자 넘는 알림을 사이트 미리보기와 같은 모양으로) ──
def card_name(msg):
    return f"{msg['cid']}-{hashlib.sha1((msg['title'] + msg['body']).encode()).hexdigest()[:10]}.png"


def wrap(draw, text, font, width):
    lines = []
    for raw in text.split("\n"):
        if not raw:
            lines.append("")
            continue
        cur = ""
        for word in raw.split(" "):
            cand = f"{cur} {word}" if cur else word
            if draw.textlength(cand, font=font) <= width:
                cur = cand
                continue
            if cur:
                lines.append(cur)
            cur = ""
            for ch in word:  # 한 단어가 한 줄보다 길면 글자 단위로
                if draw.textlength(cur + ch, font=font) > width:
                    lines.append(cur)
                    cur = ""
                cur += ch
        lines.append(cur)
    return lines


def render_card(msg, path):
    from PIL import Image, ImageDraw, ImageFont

    W, PAD, HEAD = 800, 48, 96
    f_head = ImageFont.truetype(FONT_BOLD, 30)
    f_title = ImageFont.truetype(FONT_BOLD, 36)
    f_body = ImageFont.truetype(FONT, 30)
    probe = ImageDraw.Draw(Image.new("RGB", (W, 10)))
    # (줄, 색) — 고지·수신거부 문단은 줄이 바뀌어도 회색
    lines = [(ln, "#6B7684" if raw.startswith(("※", "무료 수신거부")) else "#191919")
             for raw in msg["body"].split("\n") for ln in wrap(probe, raw, f_body, W - 2 * PAD)]
    LH, GAP = 48, 24  # 줄 간격, 빈 줄 높이
    body_h = sum(GAP if not ln else LH for ln, _ in lines)
    H = HEAD + PAD + 52 + 28 + body_h + PAD
    img = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, HEAD], fill="#FEE500")
    d.text((PAD, HEAD / 2), "알림톡 도착", font=f_head, fill="#191919", anchor="lm")
    y = HEAD + PAD
    d.text((PAD, y), msg["title"], font=f_title, fill="#191919")
    y += 52 + 28
    for ln, color in lines:
        if not ln:
            y += GAP
            continue
        d.text((PAD, y), ln, font=f_body, fill=color)
        y += LH
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return W, H


# ── 명령 ──
def cmd_login(cfg, _args):
    q = urlencode({
        "client_id": cfg["KAKAO_REST_API_KEY"],
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "talk_message",
    })
    print("아래 주소를 브라우저에서 열고 동의하세요. ('카카오톡 메시지 전송' 체크 필수)")
    print("페이지가 404로 보여도 괜찮아요 — 주소창 URL 전체를 복사해 token 명령에 넘기면 됩니다.\n")
    print(f"https://kauth.kakao.com/oauth/authorize?{q}")


def cmd_token(cfg, args):
    raw = args.code.strip()
    code = parse_qs(urlparse(raw).query).get("code", [None])[0] if raw.startswith("http") else raw
    if not code:
        sys.exit("주소에 code 가 없어요. 동의 화면에서 '동의하고 계속하기'를 눌렀는지 확인하세요.")
    tok = token_request(cfg, {"grant_type": "authorization_code", "redirect_uri": REDIRECT_URI, "code": code})
    KDIR.mkdir(exist_ok=True)
    saved = save_token(tok)
    print(f"토큰 저장 완료 ({TOKEN_FILE.relative_to(ROOT)}), 권한: {saved.get('scope', '?')}")


def cmd_card(_cfg, args):
    msg = pick_message(args)
    path = CARD_DIR / card_name(msg)
    w, h = render_card(msg, path)
    print(f"[{msg['ref']}] 이미지 카드 {w}x{h} → {path.relative_to(ROOT)}")
    print("사이트에 올린 뒤(publish.sh) send-me --card 로 보내세요.")


def cmd_send_me(cfg, args):
    msg = pick_message(args)
    link = {"web_url": app_url(msg["cid"]), "mobile_web_url": app_url(msg["cid"])}
    if args.card:
        name = card_name(msg)
        local = CARD_DIR / name
        if not local.exists():
            sys.exit(f"이미지 카드가 없어요. 먼저: card {'--id ' + args.id if args.id else f'--cid {args.cid} --label {args.label}'}")
        from PIL import Image
        w, h = Image.open(local).size
        url = f"{SITE_URL}kakao/{name}"
        if not args.dry_run and requests.head(url, timeout=10).status_code != 200:
            sys.exit(f"이미지가 아직 사이트에 없어요 ({url}). publish.sh 후 1~2분 뒤 다시 하세요.")
        template = {
            "object_type": "feed",
            "content": {"title": msg["title"], "description": "", "image_url": url,
                        "image_width": w, "image_height": h, "link": link},
            "buttons": [{"title": "앱에서 확인하기", "link": link}],
        }
        print(f"[{msg['ref']}] 이미지 카드 {w}x{h}\n{url}\n버튼 → {link['web_url']}\n")
    else:
        text, kind = message_text(msg)
        template = {"object_type": "text", "text": text, "link": link, "button_title": "앱에서 확인하기"}
        print(f"[{msg['ref']}] {kind} {len(text)}자\n{text}\n버튼 → {link['web_url']}\n")
    if args.dry_run:
        return
    r = requests.post(
        "https://kapi.kakao.com/v2/api/talk/memo/default/send",
        headers={"Authorization": f"Bearer {access_token(cfg)}"},
        data={"template_object": json.dumps(template, ensure_ascii=False)},
        timeout=10,
    )
    if r.status_code == 200 and r.json().get("result_code") == 0:
        print("보냈어요. 카카오톡 '나와의 채팅'을 확인하세요.")
    else:
        sys.exit(f"발송 실패 {r.status_code}: {r.text}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="카카오톡 메시지 API 테스트 발송")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    t = sub.add_parser("token")
    t.add_argument("code", help="리다이렉트된 주소창 URL 전체 또는 code 값")
    for name in ("card", "send-me"):
        s = sub.add_parser(name)
        s.add_argument("--id", help="발송함 메시지 id")
        s.add_argument("--cid", default="T001", help="고객번호 (--id 없을 때, 기본 T001)")
        s.add_argument("--label", default="", help="오늘 카톡 미리보기 이름 일부 (예: 이자, 입금, 연금)")
        if name == "send-me":
            s.add_argument("--card", action="store_true", help="이미지 카드로 보내기 (200자 넘는 알림)")
            s.add_argument("--dry-run", action="store_true", help="보내지 않고 내용만 출력")
    args = p.parse_args()
    cfg = load_config()
    {"login": cmd_login, "token": cmd_token, "card": cmd_card, "send-me": cmd_send_me}[args.cmd](cfg, args)


if __name__ == "__main__":
    main()
