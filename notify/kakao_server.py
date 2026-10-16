"""내 PC에서만 쓰는 카톡 발송 도우미.

켜 두고 이 PC 브라우저로 http://127.0.0.1:8766/ (또는 site/index.html 파일)을 열면 테스트 고객 페이지에 [카톡 보내기] 버튼이 나온다.
키·토큰은 .kakao/ 에만 있고 브라우저로 넘어가지 않는다. 127.0.0.1 에서만 듣고, 사이트 주소에서 온 요청만 받는다.

    python notify/kakao_server.py   → 브라우저에서 http://127.0.0.1:8766/ 열기 (끄려면 Ctrl+C)
    공개 주소(github.io)에서는 크롬이 내 PC로의 요청을 막아서 버튼이 안 나온다.
"""
import json
import mimetypes
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kakao_send as ks  # noqa: E402

PORT = 8766
SITE = (ks.ROOT / "site").resolve()
TEST_CIDS = ("T001", "T002")      # 테스트 고객(본인·팀원)만 보낼 수 있다
ALLOWED_ORIGIN = re.compile(r"^(https://eunsik3451\.github\.io|null|http://(localhost|127\.0\.0\.1)(:\d+)?)$")


def friends_map():
    return json.loads(ks.FRIENDS_FILE.read_text(encoding="utf-8")) if ks.FRIENDS_FILE.exists() else {}


def status():
    data, fm = ks.site_data(), friends_map()
    out = {}
    for cid in TEST_CIDS:
        pool = ks.kakao_pool(data, cid)
        out[cid] = {"friend": fm.get(cid, {}).get("name"),
                    "items": [{"label": p["label"], "title": p["title"], "ad": p["msg_type"] == "ad", "was": p.get("was")} for p in pool]}
    return {"ok": True, "cids": out}


def send(cfg, cid, label, to):
    if cid not in TEST_CIDS:
        return 403, {"ok": False, "error": "테스트 고객(T001·T002)에게만 보낼 수 있어요."}
    pool = [p for p in ks.kakao_pool(ks.site_data(), cid) if p["label"] == label]
    if not pool:
        return 404, {"ok": False, "error": f"{cid}에 '{label}' 알림이 없어요."}
    msg = ks.to_msg(cid, pool[0])
    text, _ = ks.message_text(msg)
    link = {"web_url": ks.app_url(cid), "mobile_web_url": ks.app_url(cid)}
    data = {"template_object": json.dumps({"object_type": "text", "text": text, "link": link, "button_title": "앱에서 확인하기"},
                                          ensure_ascii=False)}
    if to == "friend":
        fm = friends_map()
        if cid not in fm:
            return 400, {"ok": False, "error": f"{cid}에 연결된 카톡 친구가 없어요."}
        url = "https://kapi.kakao.com/v1/api/talk/friends/message/default/send"
        data["receiver_uuids"] = json.dumps([fm[cid]["uuid"]])
        where = f"{fm[cid]['name']}님"
    else:
        url, where = "https://kapi.kakao.com/v2/api/talk/memo/default/send", "나와의 채팅"
    r = requests.post(url, headers={"Authorization": f"Bearer {ks.access_token(cfg)}"}, data=data, timeout=10)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code == 200 and (body.get("result_code") == 0 or body.get("successful_receiver_uuids")):
        print(f"보냄 → {where} · {cid} · {label}")
        return 200, {"ok": True, "where": where}
    return 502, {"ok": False, "error": f"카카오 응답 {r.status_code}: {r.text[:200]}"}


class Handler(BaseHTTPRequestHandler):
    cfg = None

    def cors(self):
        origin = self.headers.get("Origin", "")
        if ALLOWED_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")   # 공개 사이트 → 내 PC 요청 허용 (크롬)
        return bool(ALLOWED_ORIGIN.match(origin))

    def reply(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path != "/ping":
            return self.static()
        try:
            self.reply(200, status())
        except SystemExit as e:
            self.reply(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        if self.path != "/send" or not ALLOWED_ORIGIN.match(self.headers.get("Origin", "")):   # 다른 사이트에서 온 요청은 거절
            return self.reply(403, {"ok": False, "error": "허용되지 않은 요청이에요."})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            self.reply(*send(self.cfg, req.get("cid"), req.get("label"), req.get("to")))
        except SystemExit as e:   # kakao_send 의 오류 메시지 (토큰 만료 등)
            self.reply(500, {"ok": False, "error": str(e)})

    def static(self):
        """사이트도 여기서 띄운다 (http://127.0.0.1:8766/). 공개 주소에서 내 PC로 요청하면 크롬이 막기 때문."""
        rel = unquote(self.path.split("?")[0].split("#")[0]).lstrip("/") or "index.html"
        path = (SITE / rel).resolve()
        if SITE not in path.parents or not path.is_file():
            return self.reply(404, {"ok": False})
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_):
        pass


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    Handler.cfg = ks.load_config()
    ks.access_token(Handler.cfg)   # 토큰이 없거나 만료면 여기서 알려 준다
    print(f"카톡 발송 도우미 켜짐 → 브라우저에서 http://127.0.0.1:{PORT}/#client/T001 열기 (조은식·김지혁 고객 페이지 '카톡 보내기'). 끄려면 Ctrl+C")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
