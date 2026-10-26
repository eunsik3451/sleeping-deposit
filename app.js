/* 잠자는 예수금 깨우기 — 정적 웹 데모.
   계산은 전부 파이썬 엔진(scripts/export_site.py)이 끝낸 결과(data.js)를 쓴다.
   데모 버튼(자동 RP 신청·RP 맡기기·PB 처리)은 보는 사람 브라우저에만 저장된다. */
(function () {
  const D = window.SITE_DATA;
  const $app = document.getElementById("app");
  const AS_OF = new Date(D.as_of + "T00:00:00");
  const CUST = Object.fromEntries(D.customers.map(c => [c.id, c]));
  const PERSONAS = ["P001", "P002", "P003", "P004"];

  // ── 표기 ──
  const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const won = x => `${Math.round(x).toLocaleString("ko-KR")}원`;
  function man(x) {
    x = Math.round(x);
    if (Math.abs(x) < 10000) return `${x.toLocaleString("ko-KR")}원`;
    const m = Math.round(x / 10000), eok = Math.floor(m / 10000), rest = m % 10000;
    if (!eok) return `${rest.toLocaleString("ko-KR")}만원`;
    return rest ? `${eok}억 ${rest.toLocaleString("ko-KR")}만원` : `${eok}억원`;
  }
  const pct = r => `${parseFloat((r * 100).toFixed(2))}%`;
  const usd = x => `$${Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const money = (x, cur) => cur === "USD" ? usd(x) : man(x);
  const dash = x => x ? man(x) : "–";
  const badge = (t, k = "") => `<span class="badge ${k}">${esc(t)}</span>`;
  const daysLeft = d => Math.round((new Date(d + "T00:00:00") - AS_OF) / 864e5);
  const CH = { push: "앱 푸시", kakao: "카카오톡", pb_queue: "PB 통화", monthly_report: "월간 리포트" };
  // 카카오 정책: 알림톡은 정보성 전용, 광고성은 브랜드 메시지(옛 친구톡)로 보낸다
  const chName = r => r.channel === "kakao" ? (r.msg_type === "ad" ? "브랜드 메시지" : "알림톡") : CH[r.channel];
  const MT = { info: "정보성", ad: "광고성" };
  const ST = { queued: "발송 대기", held: "보류", sent_sim: "발송(시뮬)", opened_sim: "열람(시뮬)", executed_sim: "실행(시뮬)" };
  const HOLD = { "": "", no_consent: "광고 동의 없음 → PB 통화", night: "야간 → 다음 날 오전", frequency_cap: "빈도 제한", snooze: "고객이 닫음 → 보류" };
  const holdLabel = h => { const [k, c] = String(h || "").split(":"); return (HOLD[k] ?? k) + (c ? " (이월)" : ""); };
  const TRIG = D.trigger_labels;
  const RP = D.rates.rp;
  const PROTECT = "예금자보호법에 따라 보호되지 않는 상품입니다 (예금보험공사 보호 대상 아님). 금리는 바뀔 수 있습니다.";
  const protectLine = `<div class="protect">${PROTECT}</div>`;

  // ── 보는 사람별 데모 상태 (브라우저 저장, 실패해도 동작) ──
  const KEY = "sleeping-deposit-demo-v1";
  let S = { reassessed: {}, auto: {}, pb: {}, log: [] };
  try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* 저장소 없음 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } };

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  // ── 내 PC에서만: 카톡 발송 도우미(notify/kakao_server.py)가 켜져 있으면 테스트 고객 페이지에 보내기 버튼 ──
  // 키·토큰은 PC 밖으로 나가지 않는다. 도우미가 꺼져 있거나 다른 사람 PC면 버튼이 안 보인다.
  const KLOCAL = "http://127.0.0.1:8766";
  let kakaoLocal = null;
  function kakaoPing() {
    fetch(KLOCAL + "/ping").then(r => r.json()).then(j => {
      if (!j.ok) return;
      kakaoLocal = j;
      const m = location.hash.match(/^#client\/(T\d+)/);
      if (m && kakaoLocal.cids[m[1]]) pageClientTabs(m[1]);
    }).catch(() => {});
  }
  function kakaoPanel(cid) {
    const k = kakaoLocal && kakaoLocal.cids[cid];
    if (!k) return "";
    const WAS = { push: "원래 앱 푸시", monthly_report: "원래 앱 리포트" };
    return `<section class="panel kpanel"><div class="bhead"><h2>카톡으로 보내기</h2><span class="pill-tag">내 PC에서만</span></div>
      <p class="sub small">이 고객에게 가는 알림을 카카오톡으로 보내요. 앱 푸시로 가던 알림도 카톡 문구로 보내요.${k.friend ? "" : " 고객에게 보내려면 카톡 친구 연결이 필요해요."}</p>
      <ul class="klist">${k.items.map((it, i) => `<li><span><b>${esc(it.title)}</b><small>${esc(it.label)}${it.was && WAS[it.was] ? " · " + WAS[it.was] : ""} · ${it.ad ? "광고성" : "정보성"}</small></span>
        <span class="kbtns"><button class="ghost sm" data-ksend="${i}|me">나에게</button>${k.friend ? `<button class="cta sm" data-ksend="${i}|friend">${esc(k.friend)}님에게</button>` : ""}</span></li>`).join("")}</ul></section>`;
  }
  function bindKakao(cid) {
    $app.querySelectorAll("[data-ksend]").forEach(b => (b.onclick = () => {
      const [i, to] = b.dataset.ksend.split("|"), it = kakaoLocal.cids[cid].items[+i];
      if (to === "friend" && !confirm(`${kakaoLocal.cids[cid].friend}님 카카오톡으로 '${it.title}'을 보낼까요?`)) return;
      b.disabled = true;
      fetch(KLOCAL + "/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cid, label: it.label, to }) })
        .then(r => r.json()).then(j => toast(j.ok ? `보냈어요 · ${j.where}` : j.error))
        .catch(() => toast("카톡 발송 도우미가 꺼져 있어요"))
        .finally(() => (b.disabled = false));
    }));
  }
  function modal(html, onMount) {
    const m = document.getElementById("modal");
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    m.onclick = e => { if (e.target === m || e.target.dataset.close !== undefined) closeModal(); };
    onMount && onMount(m.querySelector(".dialog"));
  }
  const closeModal = () => { const m = document.getElementById("modal"); m.hidden = true; m.innerHTML = ""; };
  document.addEventListener("keydown", e => e.key === "Escape" && closeModal());

  // ── 고객별 현재 상태 (데모 변경 반영) ──
  function findingsOf(cid) {
    const fs = D.details[cid].findings;
    return S.auto[cid] !== undefined ? fs.filter(f => !(f.rule === "R1" && f.currency === "KRW")) : fs;
  }
  function foundOf(cid) {
    const c = CUST[cid];
    if (c.found) return c.found;
    if (S.auto[cid] === undefined) return null;
    const keep = S.auto[cid];
    const krw = D.details[cid].findings.find(f => f.rule === "R1" && f.currency === "KRW");
    const invested = Math.max(0, (krw ? krw.meta.cash_today : 0) - keep);
    return { found_krw: Math.floor(invested * RP / 365), invested_krw: invested, annual_krw: Math.floor(invested * RP),
      days: 1, on_date: D.as_of, keep, demo: true };
  }

  // ── 차트 ──
  function lineChart(tr) {
    const series = [["예수금", tr.cash, "var(--s-cash)"], ["쉬는 돈", tr.idle, "var(--s-idle)"]];
    if (tr.auto.some(v => v > 0)) series.push(["자동 RP", tr.auto, "var(--s-auto)"]);
    const n = tr.cash.length, W = 760, H = 220, L = 52, R = 10, T = 10, B = 26;
    const max = Math.max(1, ...series.flatMap(s => s[1]));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const x = i => L + (W - L - R) * (n > 1 ? i / (n - 1) : 0), y = v => T + (H - T - B) * (1 - v / top);
    let g = "";
    for (let v = 0; v <= top + 1e-9; v += step)
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#E3E7EE"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5B6578">${v.toLocaleString("ko-KR")}</text>`;
    const start = new Date(tr.start + "T00:00:00");
    for (let i = 0; i < n; i++) {
      const d = new Date(start.getTime() + i * 864e5);
      if (d.getDate() === 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#5B6578">${d.getMonth() + 1}월</text><line x1="${x(i)}" x2="${x(i)}" y1="${H - B}" y2="${H - B + 4}" stroke="#C9D0DB"/>`;
    }
    const lines = series.map(([, v, c]) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${v.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ")}"/>`).join("");
    return `<div class="chart"><div class="legend">${series.map(([k, , c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}<span>단위: 만원</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 6개월 예수금과 쉬는 돈">${g}${lines}</svg></div>`;
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
  }
  function bars(rows, fmt, color = "var(--s-cash)") {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="bars">${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><div class="bar" style="width:${(v / max * 100).toFixed(1)}%;background:${color}"></div><span class="val">${fmt(v)}</span></div>`).join("")}</div>`;
  }

  // ── 휴대폰 미리보기 ──
  function phone(p) {
    if (p.channel === "pb_queue") return `<div class="script">${esc(p.body)}</div>`;
    const d = new Date(AS_OF.getTime());
    const dateText = `${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
    if (p.channel === "push")
      return `<div class="phone"><div class="screen"><div class="clock">10:00</div><div class="pdate">${dateText}</div>
        <div class="push"><div class="app"><span class="icon">유진</span>유진투자증권 · 지금</div><b>${esc(p.title)}</b><p>${esc(p.body)}</p></div></div></div>`;
    if (p.channel === "kakao")
      return `<div class="phone"><div class="screen kakao"><div class="kk-head"><span class="icon">유진</span>유진투자증권</div>
        <div class="kk"><div class="kk-top">${p.msg_type === "ad" ? "브랜드 메시지" : "알림톡 도착"}</div><p>${esc(p.body)}</p></div></div></div>`;
    return `<div class="phone"><div class="screen report"><div class="kk-head"><span class="icon">유진</span>앱 > 월간 리포트</div>
      <div class="rep"><b>${esc(p.title)}</b><p>${esc(p.body)}</p></div></div></div>`;
  }
  function previewBlock(p) {
    return `<div><div class="pv-label">${esc(p.label)}</div>${badge(chName(p))}${badge(MT[p.msg_type], p.msg_type === "ad" ? "accent" : "")}
      ${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ""}${phone(p)}
      <div class="muted small" style="text-align:center">${p.checked ? "검증 통과 (숫자 일치·금칙어·글자 수)" : "기본 문구로 교체됨"}</div></div>`;
  }

  // ── 항목 공통 표기 (고객 앱·PB 화면 같이 씀) ──
  const SHORT = { R1: "1년 RP 이자", R2: "양도세 절세", R3: "청약 차이", R4: "만기 상환 예정", R5: "ISA 비과세" };
  // 화면에 보이는 금액: 만기는 상환 예정 금액, 나머지는 더 받을 수 있는 돈
  const amtText = f => f.rule === "R4" ? man(f.meta.expected) : `+${man(amountOf(f))}`;
  const amtNote = f => f.rule === "R4" ? `그대로 두면 한 달에 약 ${man(f.amount_krw)} 이자를 못 받아요` : "";
  const EVLBL = { els_redemption: "ELS 상환금", bond_maturity: "채권 상환금", dividend: "배당금" };
  const amountOf = f => f.rule === "R1" ? f.annual_projection_krw : f.amount_krw;
  function headline(f) {
    const m = f.meta, dl = f.deadline ? daysLeft(f.deadline) : null;
    switch (f.subtype) {
      case "long_idle": return `예수금 ${man(m.idle_krw)} ${m.streak}일째 쉼`;
      case "active_trader": return `매수 대기 자금 ${man(m.idle_krw)} 쉼`;
      case "event_inflow": return m.event ? `${EVLBL[m.event.flow_type] || "입금액"} ${man(m.event.amount)} ${m.event.days_since}일째 쉼` : `상환금 ${man(m.idle_krw)} 쉼`;
      case "fx_idle": return `달러 ${usd(m.cash_today)} ${m.streak}일째 쉼`;
      case "tax_loss_harvest": return `해외주식 손실 정리하면 절세 · D-${dl}`;
      case "tax_deduction_fill": return `해외주식 공제 ${man(m.deduction_left)} 남음 · D-${dl}`;
      case "rights_offer": return `${m.stock} 유상증자 청약 마감 D-${dl}`;
      case "maturity": return `${m.product_name} 만기 D-${dl}`;
      case "isa_tax_free": return `ISA 올해 한도 ${man(m.remain)} 남음`;
      default: return f.title;
    }
  }

  // ════════════════ ① 고객 앱 화면 ════════════════
  // 휴대폰 안에는 고객이 실제로 보는 앱만, 설명·데모 도구는 휴대폰 밖 발표자 패널에.
  let cx = { cid: null, scene: "lock", sheet: null, step: 0, ans: [] };
  const ITEM_ICON = { R2: "세", R3: "청", R4: "만", R5: "ISA" };

  function customerOrder() {
    const amt = {};
    D.customers.forEach(c => { amt[c.id] = D.details[c.id].findings.reduce((s, f) => s + amountOf(f), 0); });
    const rest = D.customers.map(c => c.id).filter(id => !PERSONAS.includes(id));
    rest.sort((a, b) => (amt[b] - amt[a]) || ((CUST[b].found ? 1 : 0) - (CUST[a].found ? 1 : 0)) || a.localeCompare(b));
    return { ids: [...PERSONAS, ...rest], amt };
  }

  function pageCustomer(cid, start) {
    cid = CUST[cid] ? cid : "P003";
    if (cx.cid !== cid) cx = { cid, scene: firstPush(cid) && start !== "home" ? "lock" : "home", sheet: null, step: 0, ans: [] };
    const { ids, amt } = customerOrder();
    const c = CUST[cid], det = D.details[cid];
    const opts = ids.map(id => {
      const x = CUST[id];
      const tag = x.persona ? ` · ${x.persona}` : amt[id] ? ` · ${man(amt[id])}` : "";
      return `<option value="${id}" ${id === cid ? "selected" : ""}>${id} ${esc(x.name)} (${x.age}세)${esc(tag)}</option>`;
    }).join("");
    const pv = det.previews;

    $app.innerHTML = `<div class="stage">
      <div class="device"><div class="device-screen" id="phone">${phoneScreen(cid)}</div></div>
      <aside class="presenter">
        <a class="crumb" href="#client/${cid}">‹ ${esc(c.name)}님 고객 페이지</a>
        <h1>고객 앱 화면 미리보기</h1>
        <p class="lead">고객 본인이 앱에서 보는 화면입니다. 버튼은 고객이 직접 누르는 상황이고, 직원이 대신 가입하는 기능은 없습니다.</p>
        <label class="plabel" for="cid">고객 선택</label>
        <select class="select" id="cid">${opts}</select>
        <div class="pfacts">${badge(c.age + "세")}${badge(c.risk)}${c.consent_push || c.consent_kakao ? badge("광고 수신 동의") : badge("광고 미동의", "warn")}</div>
        <div class="pbtns"><button class="btn" id="replay">알림부터 다시 보기</button><button class="btn link" id="reset">데모 처음으로</button></div>
        <div class="guide"><b>시연 순서</b><ol>${guideFor(cid).map(g => `<li>${g}</li>`).join("")}</ol></div>
        <details class="pv-wrap"><summary>이 고객에게 나가는 알림 ${pv.length}건 (실제로 보내지 않음)</summary>
          <p class="muted small">엔진이 계산한 숫자를 템플릿에 채우고 검증기(숫자 일치·금칙어·예금자보호 고지·글자 수)를 통과한 문장만 씁니다.</p>
          <div class="phones">${pv.filter(p => p.channel !== "pb_queue").map(previewBlock).join("")}</div>
          ${pv.filter(p => p.channel === "pb_queue").map(p => `<div class="pv-label" style="margin-top:12px">${esc(p.label)}</div>${phone(p)}`).join("")}
        </details>
        <details class="pv-wrap"><summary>계산 근거 (심사위원용)</summary>
          ${findingsOf(cid).map(f => `<p class="small"><b>${esc(f.title)}</b></p><ul class="small muted">${f.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`).join("") || `<p class="muted small">해당 없음</p>`}
        </details>
      </aside></div>`;

    $app.querySelector("#cid").onchange = e => (location.hash = `#customer/${e.target.value}`);
    $app.querySelector("#replay").onclick = () => { cx.scene = firstPush(cid) ? "lock" : "home"; cx.sheet = null; drawPhone(); };
    $app.querySelector("#reset").onclick = () => { S = { reassessed: {}, auto: {}, pb: {}, log: S.log, calls: S.calls, done: S.done }; save(); cx.cid = null; toast("데모 상태를 처음으로 되돌렸어요"); render(); };
    bindPhone();
  }

  function guideFor(cid) {
    const fs = findingsOf(cid), r1 = fs.find(f => f.rule === "R1" && f.currency === "KRW");
    const g = [];
    if (firstPush(cid)) g.push("잠금화면 알림을 눌러 앱 열기");
    if (r1) g.push(r1.recommendation.product_id === "AUTO_RP" ? "매매가 잦아 예수금 자동 RP만 안내 (매수할 때 자동으로 빠짐)" : "하단 버튼으로 RP 맡기기 또는 예수금 자동 RP 신청");
    if (fs.some(f => f.currency === "USD")) g.push("달러는 환전 없이 외화 RP로");
    if (fs.some(f => f.rule !== "R1")) g.push("'함께 챙길 것'에서 세금·청약·만기·ISA 항목 눌러 보기");
    if (foundOf(cid)) g.push("예수금 자동 RP 이용 중: 깨운 뒤 받은 이자 확인");
    if (MK && MK.credit.some(b => b.customer_id === cid)) g.push("'신용으로 산 주식'에서 반대매매까지 남은 하락 폭 확인 (반대매매 전에 미리 알 수 있음)");
    g.push("'근거 보기'로 계산 방법 확인");
    return g;
  }

  function firstPush(cid) {
    const pv = D.details[cid].previews;
    return pv.find(p => p.channel === "push") || pv.find(p => p.channel === "kakao");
  }

  // ── 휴대폰 화면 ──
  function drawPhone() { document.getElementById("phone").innerHTML = phoneScreen(cx.cid); bindPhone(); }

  function statusBar(dark) {
    return `<div class="sbar ${dark ? "dark" : ""}"><b>10:00</b><span>5G ▮</span></div>`;
  }

  function phoneScreen(cid) {
    if (cx.scene === "lock") {
      const p = firstPush(cid);
      const d = AS_OF;
      return `<div class="lock">${statusBar(true)}
        <div class="lk-date">${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일</div><div class="lk-time">10:00</div>
        <button class="lk-noti" data-go="home"><div class="lk-app"><span class="icon">유진</span>${p.channel === "kakao" ? "카카오톡 · 유진투자증권" : "유진투자증권"}<em>지금</em></div>
          <b>${esc(p.title)}</b><p>${esc(p.channel === "kakao" ? p.body.split("\n").filter(Boolean).slice(1, 3).join(" ") : p.body)}</p></button>
        <div class="lk-hint">알림을 눌러 앱 열기</div></div>`;
    }
    return `<div class="app">${statusBar()}<div class="app-nav"><span>‹</span><b>잠자는 예수금 깨우기</b><span></span></div>
      <div class="app-scroll">${homeBody(cid)}</div>${homeCta(cid)}${cx.sheet ? sheetHtml(cid) : ""}<div class="ph-toast" id="phtoast" hidden></div></div>`;
  }

  function mainR1(cid) { return findingsOf(cid).find(f => f.rule === "R1" && f.currency === "KRW") || findingsOf(cid).find(f => f.rule === "R1"); }

  function homeBody(cid) {
    const c = CUST[cid], fs = findingsOf(cid), found = foundOf(cid), r1 = mainR1(cid);
    const items = fs.filter(f => f.rule !== "R1"), idles = fs.filter(f => f.rule === "R1");
    let hero;
    if (found) {
      hero = `<div class="hero"><p class="h-sub">${esc(c.name)}님의 예수금이 깨어 있어요</p>
        <p class="h-label">깨운 뒤 받은 이자 (${found.days}일)</p><p class="h-big ok">+${won(found.found_krw)}</p>
        <p class="h-meta">지금 RP에 ${man(found.invested_krw)} · 이대로 1년이면 약 ${man(found.annual_krw)}</p></div>`;
    } else if (r1) {
      hero = `<div class="hero"><p class="h-sub">${esc(c.name)}님,<br><b>${esc(r1.title)}</b></p>
        <p class="h-label">깨우면 1년에</p><p class="h-big">+${man(idles.reduce((s, f) => s + f.annual_projection_krw, 0))}</p>
        <button class="h-meta link" data-sheet="why:${esc(r1.finding_id)}">${idles.length === 1 ? esc(idles[0].amount_label.replace("놓친", "못 받은")) : "지난 90일 못 받은 이자"} ${man(idles.reduce((s, f) => s + f.amount_krw, 0))} · 근거 보기 ›</button>
</div>`;
    } else if (items.length) {
      hero = `<div class="hero"><p class="h-sub">${esc(c.name)}님, 기한 안에 챙길 것이</p><p class="h-big ink">${items.length}가지 있어요</p></div>`;
    } else if (MK && MK.credit.some(b => b.customer_id === cid && b.kind !== "margin_safe")) {
      hero = `<div class="hero"><p class="h-sub">${esc(c.name)}님,</p><p class="h-big ink">신용으로 산 주식을<br>확인해 주세요</p></div>`;
    } else {
      hero = `<div class="hero"><p class="h-sub">${esc(c.name)}님의 예수금이</p><p class="h-big ink">잘 쓰이고 있어요</p></div>`;
    }
    const tr = D.details[cid].trend;
    const chart = tr.start ? `<div class="a-card"><div class="a-title">최근 6개월 예수금</div>${miniChart(tr)}</div>` : "";
    const idleRows = idles.length > 1 || (idles.length && found) ? `<div class="a-card"><div class="a-title">쉬고 있는 돈</div>${idles.map(f => `
      <button class="a-row" data-sheet="why:${esc(f.finding_id)}"><span class="a-ico">${f.currency === "USD" ? "$" : "₩"}</span>
        <span class="a-txt"><b>${esc(headline(f))}</b><small>깨우면 1년에 +${man(f.annual_projection_krw)}</small></span><span class="a-go">›</span></button>`).join("")}</div>` : "";
    const itemRows = items.length ? `<div class="a-card"><div class="a-title">함께 챙길 것</div>${items.map(f => {
      const dl = daysLeft(f.deadline);
      return `<button class="a-row" data-sheet="item:${esc(f.finding_id)}"><span class="a-ico">${ITEM_ICON[f.rule]}</span>
        <span class="a-txt"><b>${esc(f.subtype_label)}</b><small>${esc(SHORT[f.rule])} · 마감 ${f.deadline.slice(5).replace("-", "/")}</small></span>
        <span class="a-amt"><b>+${man(f.amount_krw)}</b><small class="${dl <= 7 ? "due" : ""}">D-${dl}</small></span></button>`; }).join("")}</div>` : "";
    return `${hero}${appCreditCard(cid)}${appStockCard(cid)}${appProfileCard(cid)}${chart}${idleRows}${itemRows}
      <p class="a-fine">참고용 정보이며 투자 자문이 아닙니다. 이자는 가정한 금리로 계산한 추정치로 실제와 다를 수 있습니다. 가입 전 상품설명서를 확인하세요. 고객·종목·상품명은 가상입니다.</p>`;
  }

  function homeCta(cid) {
    const r1 = mainR1(cid);
    if (foundOf(cid) || !r1) return "";
    if (r1.action.type === "pb_consult") return `<div class="cta-bar"><button class="a-cta" data-act="pb">담당 PB와 상담하기</button></div>`;
    if (r1.currency === "USD") return `<div class="cta-bar"><button class="a-cta" data-sheet="buy:${esc(r1.finding_id)}">외화 RP에 맡기기</button></div>`;
    if (r1.recommendation.product_id === "AUTO_RP") return `<div class="cta-bar"><button class="a-cta" data-sheet="auto:${esc(r1.finding_id)}">예수금 자동 RP로 깨우기</button></div>`;
    const p = D.products[r1.recommendation.product_id];
    return `<div class="cta-bar two"><button class="a-cta sub" data-sheet="auto:${esc(r1.finding_id)}">자동 RP</button>
      <button class="a-cta" data-sheet="buy:${esc(r1.finding_id)}">${esc(p.name)}에 맡기기</button></div>`;
  }

  function miniChart(tr) {
    const n = tr.cash.length, W = 320, H = 110, P = 6;
    const max = Math.max(1, ...tr.cash, ...tr.auto.map((v, i) => v + tr.cash[i]));
    const x = i => P + (W - 2 * P) * (n > 1 ? i / (n - 1) : 0), y = v => H - 18 - (H - 28) * (v / max);
    const line = (v, col, w) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" points="${v.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ")}"/>`;
    const area = `<polygon fill="rgba(240,68,82,.12)" points="${tr.idle.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ")} ${x(n - 1)},${y(0)} ${x(0)},${y(0)}"/>`;
    const start = new Date(tr.start + "T00:00:00");
    let lbl = "";
    for (let i = 0; i < n; i++) { const d = new Date(start.getTime() + i * 864e5); if (d.getDate() === 1) lbl += `<text x="${x(i)}" y="${H - 3}" font-size="10" fill="#8B95A1" text-anchor="middle">${d.getMonth() + 1}월</text>`; }
    const hasAuto = tr.auto.some(v => v > 0);
    return `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img" aria-label="최근 6개월 예수금과 쉬는 돈">${area}${line(tr.cash, "#3182F6", 2)}${line(tr.idle, "#F04452", 1.5)}${hasAuto ? line(tr.auto, "#00B493", 1.5) : ""}${lbl}</svg>
      <div class="mini-lg"><span><i style="background:#3182F6"></i>예수금</span><span><i style="background:#F04452"></i>쉬는 돈</span>${hasAuto ? `<span><i style="background:#00B493"></i>자동 RP</span>` : ""}</div>`;
  }

  // ── 바텀 시트 ──
  const PROTECT_SHORT = "RP·CMA(RP형)는 예금자보호법에 따라 보호되지 않아요. 금리는 바뀔 수 있어요.";
  function sheetHtml(cid) {
    const [kind, fid] = cx.sheet.split(":");
    const f = fid && findingsOf(cid).find(x => x.finding_id === fid);
    let body = "";
    if (kind === "why") {
      body = `<h3>${esc(f.title)}</h3><p class="s-sub">이렇게 계산했어요</p>
        <ul class="s-list">${f.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>
        <p class="s-note">최근 3개월 중 하루에 가장 많이 쓰신 금액은 남겨두고 계산했어요.</p>
        <button class="a-cta" data-close>확인</button>`;
    } else if (kind === "auto") {
      const keep = Math.round(f.meta.buffer_krw), p = D.products.AUTO_RP;
      body = `<h3>예수금 자동 RP</h3>
        <p class="s-lead">정한 금액을 넘는 예수금만 RP에 넣어 두고,<br>주식을 사거나 출금할 때 자동으로 빼요.</p>
        <div class="s-box"><b>주식이나 펀드를 대신 사고팔지 않아요</b></div>
        <label class="s-field"><span>남겨둘 금액</span><input type="number" id="keep" min="0" step="100000" value="${keep}"><em id="keepman">${man(keep)}</em></label>
        <p class="s-note">기본값은 최근 3개월 중 하루에 가장 많이 쓰신 금액이에요.</p>
        <div class="s-kv"><span>금리</span><b>연 ${pct(p.rate)} (세전, 변동)</b></div>
        <div class="s-kv"><span>위험등급</span><b>${p.grade}등급 ${p.grade_label}</b></div>
        <div class="s-protect">${PROTECT_SHORT}</div>
        <label class="s-check"><input type="checkbox" id="c1"> 상품설명서를 확인했어요</label>
        <label class="s-check"><input type="checkbox" id="c2"> 예수금 자동 RP 이용에 동의해요</label>
        <button class="a-cta" id="go" disabled>신청하기</button>`;
    } else if (kind === "buy") {
      const rec = f.recommendation, p = D.products[rec.product_id];
      body = `<h3>${esc(p.name)}</h3>
        <div class="s-kv"><span>맡길 금액</span><b>${money(rec.suggest_amount, f.currency)}</b></div>
        <div class="s-kv"><span>금리</span><b>연 ${pct(p.rate)} (세전)</b></div>
        <div class="s-kv"><span>위험등급</span><b>${p.grade}등급 ${p.grade_label}</b></div>
        <div class="s-kv"><span>1년 예상 이자</span><b>약 ${man(f.annual_projection_krw)}</b></div>
        <div class="s-protect">${f.currency === "USD" ? "외화 RP는 예금자보호법에 따라 보호되지 않아요. 환전하지 않고 달러 그대로 맡겨요." : PROTECT_SHORT}</div>
        <label class="s-check"><input type="checkbox" id="c1"> 상품설명서를 확인했어요</label>
        <button class="a-cta" id="go" disabled>본인 인증 후 주문하기</button>
        <p class="s-note center">데모라 실제 주문은 하지 않아요</p>`;
    } else if (kind === "item") {
      body = itemSheet(f);
    } else if (kind === "move") {
      const sym = cx.sheet.slice(5), p = MK.positions.find(x => x.customer_id === cid && x.symbol === sym);
      const note = (MK.stock_notes || {})[sym], prev = p.close / (1 + p.chg_pct), krwP = p.currency === "KRW";
      const price = x => krwP ? won(Math.round(x)) : `$${x.toFixed(2)}`;
      body = `<p class="s-sub">보유 종목 안내 · ${p.trade_date.slice(5).replace("-", "/")} 종가</p><h3>${esc(p.name)} 주가가 하루 동안 크게 ${p.chg_pct < 0 ? "내렸어요" : "올랐어요"}</h3>
        <p class="s-big ${p.chg_pct < 0 ? "dn" : "up"}">${pctTxt(p.chg_pct)}</p>
        <div class="s-kv"><span>종가 (전날)</span><b>${price(p.close)} (${price(prev)})</b></div>
        <div class="s-kv"><span>보유 수량</span><b>${p.qty.toLocaleString("ko-KR")}주</b></div>
        <div class="s-kv"><span>평가금액</span><b>${man(p.value_krw)}</b></div>
        <div class="s-kv"><span>하루 변동</span><b class="${p.day_delta_krw < 0 ? "dn" : "up"}">${p.day_delta_krw < 0 ? "−" : "+"}${man(Math.abs(p.day_delta_krw))}</b></div>
        <div class="s-kv"><span>산 뒤 손익</span><b class="${p.pnl_krw < 0 ? "dn" : "up"}">${p.pnl_krw < 0 ? "−" : "+"}${man(Math.abs(p.pnl_krw))}</b></div>
        ${note && note.reason ? `<div class="s-box soft"><b>왜 움직였나요</b><br>${esc(note.reason)}</div>` : ""}
        <p class="s-note">사고팔기를 권하는 안내가 아니에요. 투자 판단은 직접 해 주세요.</p>
        <button class="a-cta sub" data-act="pb">담당 PB에게 물어보기</button>
        <button class="a-cta" data-close>확인</button>`;
    } else if (kind === "report") {
      const p = D.details[cid].previews.find(x => x.trigger === "T_MONTHLY");
      const rows = p.body.split("\n").filter(l => l.startsWith("■")).map(l => l.slice(1).trim().split(/:\s*/));
      body = `<p class="s-sub">매월 1일 리포트</p><h3>${esc(p.title)}</h3>
        ${rows.map(([k, v]) => `<div class="s-kv"><span>${esc(k)}</span><b>${esc(v || "")}</b></div>`).join("")}
        <p class="s-note">예수금 자동 RP나 RP로 깨우면 다음 달부터 '깨운 뒤 받은 이자'에 쌓여요.</p>
        <button class="a-cta" data-close>확인</button>`;
    } else if (kind === "done") {
      body = `<div class="s-done"><div class="s-check-ico">✓</div><h3>${esc(fid)}</h3></div><button class="a-cta" data-close>확인</button>`;
    }
    return `<div class="sheet-dim" data-close></div><div class="sheet"><div class="grab"></div>${body}</div>`;
  }


  function itemSheet(f) {
    const m = f.meta, dl = daysLeft(f.deadline);
    const rows = ({   // 해당 항목 줄만 만든다 (다른 항목 값이 없어서 오류 나지 않게)
      R2: () => [["올해 실현이익", won(m.realized)], ["평가손실 / 평가이익", `${won(m.loss)} / ${won(m.gain)}`], ["올해 마지막 매도일", `${f.deadline} (D-${dl})`]],
      R3: () => [["보유 → 청약 가능", `${m.qty.toLocaleString("ko-KR")}주 → ${m.shares.toLocaleString("ko-KR")}주`], ["청약가 / 현재가", `${won(m.issue_price)} / ${won(m.now)}`], ["청약 기간", `${m.start} ~ ${f.deadline}`]],
      R4: () => [["만기일", `${f.deadline} (D-${dl})`], ["상환 예정 금액", man(m.expected)], ["한 달 그대로 두면", `약 ${man(f.amount_krw)} 못 받음`]],
      R5: () => [["올해 납입 / 한도", `${man(m.paid)} / ${man(m.limit)}`], ["남은 한도", `${man(m.remain)} (다음 해로 이월)`], ["비과세", `순이익 ${man(m.tax_free)}까지 (${m.kind}) · 넘는 이익 ${pct(m.over_rate)}`], ["의무가입", `${m.min_years}년`]],
    })[f.rule]();
    const note = { R2: "매도를 권하는 안내가 아니에요. 다른 증권사 손익은 빠져 있어요.",
      R3: "청약 여부는 직접 판단해 주세요. 주가가 바뀌면 차이도 달라져요.",
      R4: "다시 투자할지는 직접 정하세요. 정하기 전까지는 예수금 자동 RP로 이자를 받을 수 있어요.",
      R5: "ISA에 담는 주식·펀드·ETF는 원금 손실이 날 수 있고 예금자보호 대상이 아니에요. 의무가입 기간 전에 해지하면 비과세를 못 받을 수 있어요." }[f.rule];
    const go = { R2: "보유 종목 손익 보기", R3: "청약하러 가기", R4: "만기 후 계획 정하기", R5: "ISA 입금하기" }[f.rule];
    return `<p class="s-sub">${esc(f.subtype_label)} · D-${dl}</p><h3>${esc(f.title)}</h3>
      <p class="h-label">${esc(f.amount_label)}</p><p class="s-big">+${man(f.amount_krw)}</p>
      ${rows.map(([k, v]) => `<div class="s-kv"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}
      <div class="${f.rule === "R5" ? "s-protect" : "s-box soft"}">${note}</div>
      <button class="a-cta" data-done="${go} 화면으로 이동해요 (데모)">${go}</button>
      <button class="a-cta sub" data-act="pb">담당 PB에게 물어보기</button>`;
  }

  function phToast(msg) {
    const t = document.getElementById("phtoast"); if (!t) return toast(msg);
    t.textContent = msg; t.hidden = false; clearTimeout(phToast._t); phToast._t = setTimeout(() => (t.hidden = true), 2400);
  }

  function bindPhone() {
    const root = document.getElementById("phone"), cid = cx.cid;
    root.querySelectorAll("[data-go]").forEach(b => (b.onclick = () => { cx.scene = b.dataset.go; drawPhone(); }));
    root.querySelectorAll("[data-sheet]").forEach(b => (b.onclick = () => { cx.sheet = b.dataset.sheet; cx.step = 0; cx.ans = []; drawPhone(); }));
    root.querySelectorAll("[data-close]").forEach(b => (b.onclick = () => { cx.sheet = null; drawPhone(); }));
    root.querySelectorAll("[data-act=pb]").forEach(b => (b.onclick = () => { cx.sheet = "done:담당 PB에게 상담을 요청했어요"; drawPhone(); }));
    root.querySelectorAll("[data-done]").forEach(b => (b.onclick = () => { cx.sheet = "done:" + b.dataset.done; drawPhone(); }));
    const go = root.querySelector("#go");
    if (go) {
      const checks = [...root.querySelectorAll(".sheet input[type=checkbox]")];
      checks.forEach(ch => (ch.onchange = () => (go.disabled = !checks.every(x => x.checked))));
      const keep = root.querySelector("#keep");
      if (keep) keep.oninput = () => (root.querySelector("#keepman").textContent = man(+keep.value || 0));
      go.onclick = () => {
        if (keep) { S.auto[cid] = Math.max(0, +keep.value || 0); save(); cx.sheet = `done:예수금 자동 RP를 신청했어요`; render(); }
        else { cx.sheet = "done:주문 화면으로 이동해요 (데모)"; drawPhone(); }
      };
    }
  }

  // ════════════════ ② 항목 한눈에 ════════════════
  const ITEMS = [
    ["예수금", "원화 예수금 방치", `예탁금 이용료(${pct(D.rates.deposit)})와 챔피언CMA(RP형)(${pct(RP)})의 차이`, "하루 최대 사용액은 남기고 500만원 이상이 7일 넘게 쉼", "수시 RP · 약정식 RP(3,000만원 이상) · 챔피언CMA(RP형) · 예수금 자동 RP", "7일째 정보성 → 30일마다 이용 안내(광고성)", "P003"],
    ["예수금", "매수 대기 자금", "매수 전까지 쉬는 돈의 RP 이자", "최근 30일 중 4일 이상 매수 결제 + 쉬는 돈 유지", "예수금 자동 RP만 (매수할 때 자동으로 빠짐, 주식을 대신 사고팔지 않음)", "7일째 정보성 → 30일마다 이용 안내(광고성)", "P001"],
    ["예수금", "상환금·배당 유입 후 방치", "ELS·채권 상환금, 배당금이 쉬는 동안의 RP 이자", "최근 14일 내 상환·배당 입금, 이후 잔고 감소가 절반 미만", "수시 RP · PB 재투자 상담 (3,000만원 이상은 PB 콜리스트)", "입금 다음 날 알림톡 → 7일째 알림", "P002"],
    ["예수금", "달러 예수금 방치", "달러 이용료와 외화 RP 금리의 차이 (외화 RP 금리 확인 필요)", "달러 잔고를 그날 환율로 원화 환산해 같은 기준 적용", "외화 RP (환전 권유 안 함)", "7일째 정보성 → 30일마다 이용 안내(광고성)", "P001"],
    ["세금", "해외주식 양도세 (손실 상계)", "평가손실을 올해 확정하지 않아 더 내는 양도세", "올해 유진 계좌 해외주식 실현이익 250만원 초과 + 평가손실 종목", "보유 종목 손익 확인, PB 절세 상담 (매도 권유 아님)", "발견 즉시 + 마지막 매도일 D-7 (정보성)", "P001"],
    ["세금", "해외주식 기본공제 남음", "쓰지 않고 넘어가는 기본공제 250만원", "올해 실현이익 250만원 미만 + 평가이익 종목", "보유 종목 손익 확인, PB 절세 상담 (매도 권유 아님)", "발견 즉시 + 마지막 매도일 D-7 (정보성)", "P004"],
    ["권리", "유상증자 청약 권리", "청약하지 않으면 받지 못하는 신주 (현재가 기준 청약가와의 차이)", "보유 종목의 유상증자 청약 일정 + 현재가 > 청약가", "앱에서 청약 내용 확인 (청약 권유 아님)", "청약 14일 전 발견 즉시 + 마감 D-7 (정보성)", "P001"],
    ["세금", "ISA 비과세 한도 활용", "ISA 순이익 비과세 한도(일반형 200만원·서민형 400만원) × 일반 계좌 세율 15.4% = 아낄 수 있는 세금(최대)", "10~12월, 유진 ISA 올해 납입액이 연 한도 2,000만원 미만 (안 쓴 한도는 이월)", "앱에서 직접 입금 (광고성: 수신 동의 필요, 원금 손실 가능·예금자보호 대상 아님·의무가입 3년 고지)", "10월부터 발견 즉시 + 연말 D-7 (광고성)", "P002"],
    ["만기", "펀드·ELS 만기", "상환금이 예수금으로 쉬는 동안의 이자 (한 달 기준)", "보유 펀드·ELS 만기 14일 전", "만기 후 계획 미리 정하기 · 예수금 자동 RP · PB 상담 (재투자 권유 아님)", "만기 14일 전 + D-7 (정보성)", "P003"],
  ];
  function pageItems() {
    $app.innerHTML = `<h1>기준 안내</h1>
      <p class="lead">고객이 놓치거나 잊기 쉬운 돈과 일정을 계좌 데이터만으로 찾습니다. 금액 계산은 검증 가능한 규칙 엔진이 맡고, 문장은 숫자를 바꿀 수 없습니다.</p>
      <div class="tablewrap" style="max-height:none"><table><thead><tr><th>구분</th><th>항목</th><th>놓치는 돈</th><th>찾는 방법</th><th>안내</th><th>알림 시점</th><th>데모 고객</th></tr></thead>
      <tbody>${ITEMS.map(r => `<tr><td>${r[0]}</td><td><b>${r[1]}</b></td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td><a href="#client/${r[6]}">${r[6]} ${esc(CUST[r[6]].name)}</a></td></tr>`).join("")}</tbody></table></div>
      <h2>금리 기준</h2>
      <p>원화: 예탁금 이용료 연 ${pct(D.rates.deposit)}(100만원 초과분) → 챔피언CMA(RP형) 자유형 연 ${pct(RP)}(2026-08-28 기준, 세전). 차이 연 ${pct(RP - D.rates.deposit)}p.
        1억원이 1년 쉬면 약 ${man(1e8 * (RP - D.rates.deposit))}을 못 받습니다.</p>
      <h2>준법 고지</h2>
      <p>RP·CMA(RP형)는 예금자보호법에 따라 보호되지 않습니다. 상품을 안내하는 모든 문장(광고성 알림, PB 통화 스크립트, 앱 상품 카드)에 이 고지를 넣고,
        고지가 빠진 문장은 검증기가 걸러 기본 문구로 바꿉니다. 정보성 알림에는 상품명·금리·가입 권유를 넣지 않습니다.</p>
      <h2>다음 단계 후보</h2>
      <ul><li>ISA 비과세 한도 미활용 — 회사 ISA 취급 여부 확인 필요</li><li>배당금 입금 후 방치 — 소액 배당 묶음 안내</li><li>신주인수권 매도 안내 — 청약하지 않을 고객에게 권리 매도 일정 안내</li></ul>
      <h2>일부러 다루지 않는 것</h2>
      <ul><li>환전 수수료 비교, 저보수 상품 전환 — 회사 수익이 줄어드는 제안</li><li>IRP, 발행어음, 개인투자용 국채 — 유진투자증권 미취급</li></ul>`;
  }

  // ════════════════ ③ PB 고객 관리 ════════════════
  // 한 화면에서 "누구에게, 무엇을, 무슨 말로" 연락할지. 목록은 고객 단위, 오른쪽(모바일은 시트)에 상세.
  const PB_BY_FID = Object.fromEntries(D.pb.map(r => [r.finding_id, r]));
  const PB_STATUS = { called: "통화 완료", no_answer: "부재중", joined: "고객이 앱에서 직접 가입함", later: "나중에 연락" };
  let pbm = { tab: "today", q: "", cid: null, fid: null, sheet: false };

  function todo(f) {   // PB가 할 일 한 문장
    if (f.rule === "R1") return "쉬는 예수금으로 이자 받는 방법을 알려 주세요";
    return { R2: "연내 마지막 매도일 전에 해외주식 세금을 알려 주세요", R3: `청약 마감(D-${daysLeft(f.deadline)}) 전에 알려 주세요`,
      R4: "만기 뒤 상환금을 어떻게 쓸지 여쭤 보세요", R5: "ISA 남은 한도와 비과세 혜택을 알려 주세요" }[f.rule];
  }

  function pbCustomers() {
    return D.customers.filter(c => inView(c.id)).map(c => {
      const fs = findingsOf(c.id);
      if (!fs.length) return null;
      const calls = fs.filter(f => PB_BY_FID[f.finding_id]);
      const deadlines = fs.filter(f => f.deadline).map(f => daysLeft(f.deadline));
      const rank = calls.length ? Math.min(...calls.map(f => PB_BY_FID[f.finding_id].rank)) : 1e9;
      const lead = calls[0] || fs.slice().sort((a, b) => amountOf(b) - amountOf(a))[0];
      return { c, fs, calls, rank, lead, soon: deadlines.length ? Math.min(...deadlines) : null,
        interest: fs.filter(f => f.rule === "R1").reduce((s, f) => s + f.annual_projection_krw, 0) };
    }).filter(Boolean);
  }

  function scriptSteps(body) {
    return String(body).split("\n").filter(Boolean).map(line => {
      const m = line.match(/^\[(.+?)\]\s*(.*)$/);
      return m ? [m[1], m[2]] : ["", line];
    });
  }

  // ── 시장 이슈: 보유 종목 큰 등락·신용 담보 부족 ──
  const MK = D.market;
  const MK_KIND = { margin_call: "담보 부족 · 반대매매 위험", margin_warn: "반대매매 경고 · 하락 여력 10% 미만", big_move: "보유 종목 큰 등락", margin_watch: "담보비율 주의 · 하락 여력 20% 미만" };
  function marketCustomers() {
    if (!MK) return [];
    const by = {};
    MK.alerts.forEach(a => inView(a.customer_id) && (by[a.customer_id] ||= []).push(a));
    return Object.entries(by).map(([cid, as]) => ({ cid, c: CUST[cid], as, lead: as[0] }));
  }
  const pctTxt = v => `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  function mkHeadline(a) {
    if (a.kind === "margin_call") return `${a.name} 담보비율 ${ratioTxt(a.ratio)} · 반대매매 위험`;
    if (a.kind === "margin_warn" || a.kind === "margin_watch") return `${a.name} 반대매매까지 −${(a.room * 100).toFixed(1)}% · ${STAGE[a.kind][0]}`;
    return `${a.name} ${pctTxt(a.chg_pct)} (${a.trade_date.slice(5).replace("-", "/")})`;
  }
  function mkTodo(a) {
    if (a.kind === "margin_call") return "반대매매 전에 담보 부족을 알려 주세요";
    if (a.kind === "margin_warn") return "반대매매가 가까워졌다고 미리 알려 주세요";
    if (a.kind === "margin_watch") return "담보비율이 낮아지고 있다고 미리 알려 주세요";
    return `${a.name} ${a.chg_pct < 0 ? "급락" : "급등"} 소식과 이유를 알려 주세요`;
  }
  function spark(v, down) {
    const W = 240, H = 56, n = v.length, mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
    const pts = v.map((p, i) => `${(i / (n - 1) * W).toFixed(1)},${(H - 4 - (p - mn) / r * (H - 8)).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" aria-label="최근 20거래일 종가"><polyline fill="none" stroke="${down ? "#3182F6" : "#F04452"}" stroke-width="2" points="${pts}"/></svg>`;
  }
  function marketStrip() {
    if (!MK) return "";
    return `<div class="mk-strip"><span class="mk-date">${MK.ref_date} 종가 기준 · ${MK.generated.slice(5, 16)} 점검</span>${MK.indices.map(i =>
      `<span class="mk-idx"><b>${esc(i.name)}</b> ${i.close.toLocaleString("ko-KR")} <em class="${i.chg_pct < 0 ? "dn" : "up"}">${pctTxt(i.chg_pct)}</em>${i.date !== MK.ref_date ? `<small class="stale"> ${i.date.slice(5).replace("-", "/")}</small>` : ""}</span>`).join("")}</div>`;
  }
  function marketRow(r) {
    const a = r.lead, st = S.pb["m:" + r.cid], down = a.day_delta_krw < 0;
    const margin = a.kind.startsWith("margin");
    const amt = a.kind === "margin_call" ? `${man(a.shortfall_krw)}` : margin ? `−${(a.room * 100).toFixed(1)}%` : `${down ? "−" : "+"}${man(Math.abs(a.day_delta_krw))}`;
    const lbl = a.kind === "margin_call" ? "부족 담보" : margin ? "반대매매까지" : "하루 평가금액";
    return `<li class="${r.cid === pbm.cid ? "on" : ""} ${st ? "done" : ""}" data-cid="${r.cid}">
      <span class="ava ${a.kind === "margin_call" || a.kind === "margin_warn" ? "warn" : ""}">${esc(r.c.name.slice(0, 1))}</span>
      <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세</small><i>${esc(st ? PB_STATUS[st] : mkHeadline(a))}</i></span>
      <span class="amt"><b class="${a.kind === "margin_call" || a.kind === "margin_warn" ? "red" : margin ? "amber" : down ? "dn" : "up"}">${amt}</b><small>${lbl}${r.as.length > 1 ? ` 외 ${r.as.length - 1}` : ""}</small></span></li>`;
  }
  function marketDetail(r) {
    const a = r.as.find(x => x.symbol + x.kind === pbm.fid) || r.lead, c = r.c, st = S.pb["m:" + r.cid];
    const down = a.chg_pct < 0;
    const consent = c.consent_push || c.consent_kakao;
    const kv = a.kind === "big_move"
      ? [["종가", `${a.currency === "USD" ? "$" + a.close.toLocaleString("en-US") : won(a.close)} (${pctTxt(a.chg_pct)})`], ["보유", `${a.qty.toLocaleString("ko-KR")}주 · 평가 ${man(a.value_krw)}`],
         ["하루 평가금액 변동", `${down ? "−" : "+"}${man(Math.abs(a.day_delta_krw))}`], ["매입 후 손익", `${a.pnl_krw < 0 ? "−" : "+"}${man(Math.abs(a.pnl_krw))}`]]
      : [["담보비율", `${ratioTxt(a.ratio)} (유지 ${Math.round(MK.maintenance_ratio * 100)}%)`], ["반대매매 기준가", `${won(a.trigger_price)} (지금 ${won(a.close)})`],
         ["신용 대출금 / 담보 평가금액", `${man(a.credit_loan_krw)} / ${man(a.value_krw)}`],
         ...(a.kind === "margin_call" ? [["부족 금액", `약 ${man(a.shortfall_krw)}`]] : []), ["주의 단계 밖으로 돌리려면", `약 ${man(a.to_safe_krw)} 추가`], ["종가 등락", pctTxt(a.chg_pct)]];
    return `<button class="back" data-back>← 목록</button>
      <div class="who-big"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
        <div><h2>${esc(c.name)}님</h2><p class="sub">${c.age}세 · ${esc(c.risk)} · ${consent ? "광고 수신 동의" : "광고 미동의"}</p></div></div>
      <div class="todo ${a.kind === "margin_call" ? "red" : ""}"><span>오늘 할 일</span><b>${esc(mkTodo(a))}</b><p>${esc(MK_KIND[a.kind])}</p></div>
      ${st ? `<div class="state">${PB_STATUS[st]} <button class="txt" data-undo>되돌리기</button></div>` : ""}
      ${r.as.length > 1 ? `<h3>이 고객의 시장 이슈 ${r.as.length}건</h3><ul class="items">${r.as.map(x => `<li class="${x === a ? "on" : ""}" data-fid="${esc(x.symbol + x.kind)}"><span><b>${esc(mkHeadline(x))}</b><small>${MK_KIND[x.kind]}</small></span></li>`).join("")}</ul>` : ""}
      ${a.kind.startsWith("margin") ? `<h3>반대매매까지 얼마나 남았나요</h3>${creditGauge(a)}${ratioTrend(a)}<h3>${esc(a.name)} · 숫자</h3>` : `<h3>${esc(a.name)} · 최근 20거래일</h3>`}
      <div class="mk-card">${a.kind.startsWith("margin") ? "" : spark(a.spark, down)}${kv.map(([k, v]) => `<div class="s-kv"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <h3>${a.kind === "big_move" ? "왜 움직였나요" : "왜 담보가 줄었나요"}</h3>
      <div class="mk-why">${a.reason ? `<p>${esc(a.reason)}</p><ul>${(a.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`
        : `<p class="sub">아직 이유를 확인하지 않았어요. 아침 점검 때 뉴스를 확인해 채웁니다.</p>`}</div>
      <h3>이렇게 말해 보세요</h3>
      <ol class="steps">${scriptSteps(a.script).map(([k, t]) => `<li><span>${esc(k)}</span><p>${esc(t)}</p></li>`).join("")}</ol>
      <h3>최근 연락</h3>${logList(logsOf(r.cid).slice(0, 2), false)}
      <div class="acts">
        <textarea id="pbmemo" class="memo" rows="2" placeholder="통화 메모 (선택) · 연락 기록에 함께 쌓여요"></textarea>
        <button class="cta" data-st="called">통화 완료</button>
        <div class="row three"><button class="ghost" data-st="no_answer">부재중</button><button class="ghost" data-st="later">나중에</button><a class="ghost center" href="#client/${r.cid}">고객 전체 보기</a></div>
        <p class="fine">사실과 보도 내용만 전하고 매수·매도를 권하거나 주가 방향을 단정하지 않아요. 이유는 언론 보도 요약이며 출처를 함께 확인하세요.</p>
      </div>`;
  }

  // ── 신용 위험도: 반대매매 전에 알 수 있게 ──
  const ratioTxt = r => { const m = MK ? MK.maintenance_ratio : 1.4; const v = r * 100; return Math.abs(r - m) < 0.01 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`; };
  const STAGE = { margin_call: ["위험", "반대매매 기준 미달"], margin_warn: ["경고", "하락 여력 10% 미만"],
    margin_watch: ["주의", "하락 여력 20% 미만"], margin_safe: ["안전", "하락 여력 20% 이상"] };
  const stageCls = k => ({ margin_call: "s-call", margin_warn: "s-warn", margin_watch: "s-watch", margin_safe: "s-safe" }[k]);
  const priceTxt = (v, cur) => cur === "USD" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : won(v);

  function creditGauge(b) {   // 하락 여력 0~30% 위에 현재 위치. 왼쪽 끝이 반대매매 기준
    const room = Math.max(0, b.room), max = 0.30, pos = Math.min(1, room / max) * 100;
    return `<div class="cg ${stageCls(b.kind)}">
      <div class="cg-head"><b>${b.kind === "margin_call" ? "이미 반대매매 기준 아래" : `반대매매까지 −${(b.room * 100).toFixed(1)}%`}</b><span class="cg-tag">${STAGE[b.kind][0]}</span></div>
      <div class="cg-track"><i class="z1"></i><i class="z2"></i><i class="z3"></i><span class="cg-dot" style="left:${pos}%"></span></div>
      <div class="cg-scale"><span>반대매매 기준</span><span>−10%</span><span>−20%</span><span>−30%</span></div>
      <p class="cg-note">${b.kind === "margin_call" ? `담보가 약 ${man(b.shortfall_krw)} 부족해요.` : `주가가 ${priceTxt(b.trigger_price, "KRW")} 아래로 내리면 담보비율이 ${Math.round(MK.maintenance_ratio * 100)}% 밑으로 떨어져요.`}
        ${b.big_days ? ` 최근 ${b.lookback}거래일 중 하루에 이만큼 내린 날이 <b>${b.big_days}일</b> 있었어요.` : b.kind !== "margin_call" ? ` 최근 ${b.lookback}거래일 동안 하루에 이만큼 내린 날은 없었어요.` : ""}</p></div>`;
  }

  function ratioTrend(b) {
    const v = b.ratio_hist, n = v.length, maint = MK.maintenance_ratio;
    if (!n) return "";
    const W = 320, H = 90, lo = Math.min(...v, maint) - 0.05, hi = Math.max(...v) + 0.05;
    const x = i => i / (n - 1) * W, y = r => H - 14 - (r - lo) / (hi - lo) * (H - 22);
    const pts = v.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
    return `<div class="rt"><div class="rt-title">담보비율 최근 20거래일 <b>${Math.round(v[0] * 100)}% → ${Math.round(v[n - 1] * 100)}%</b><span class="rt-key">- - 유지비율 ${Math.round(maint * 100)}%</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="rt-svg" aria-label="담보비율 추이">
        <line x1="0" x2="${W}" y1="${y(maint)}" y2="${y(maint)}" stroke="#F04452" stroke-dasharray="4 4" stroke-width="1.2"/>
        <polyline fill="none" stroke="#191F28" stroke-width="2" points="${pts}"/></svg></div>`;
  }

  function creditSummary() {
    if (!MK || !MK.credit.length) return "";
    const n = k => MK.credit.filter(b => b.kind === k).length;
    return `<div class="cs"><span class="cs-t">신용 보유 고객 ${new Set(MK.credit.map(b => b.customer_id)).size}명</span>
      ${["margin_call", "margin_warn", "margin_watch", "margin_safe"].map(k => `<span class="cs-i ${stageCls(k)}"><i></i>${STAGE[k][0]} <b>${n(k)}</b></span>`).join("")}
      <span class="cs-h">위험·경고·주의는 아래 목록에 있어요</span></div>`;
  }

  function appStockCard(cid) {   // 고객 앱: 내 주식 (하루 큰 변동은 위로, 누르면 왜 움직였나요)
    if (!MK) return "";
    const mine = MK.positions.filter(p => p.customer_id === cid).sort((a, b) => Math.abs(b.chg_pct) - Math.abs(a.chg_pct));
    if (!mine.length) return "";
    return `<div class="a-card"><div class="a-title">내 주식 <small class="a-sub">${MK.ref_date.slice(5).replace("-", "/")} 종가</small></div>${mine.map(p => `
      <button class="a-row" data-sheet="move:${esc(p.symbol)}"><span class="a-ico">${esc(p.name.slice(0, 1))}</span>
        <span class="a-txt"><b>${esc(p.name)}</b><small>${p.qty.toLocaleString("ko-KR")}주 · ${man(p.value_krw)}</small></span>
        <span class="a-amt"><b class="${p.chg_pct < 0 ? "dn" : "up"}">${pctTxt(p.chg_pct)}</b><small>${Math.abs(p.chg_pct) >= MK.big_move_pct ? "크게 움직였어요" : "어제"}</small></span></button>`).join("")}</div>`;
  }

  function appProfileCard(cid) {   // 고객 앱: 나의 투자 프로필 (PB용 메모·상품 방향은 보이지 않음)
    const p = D.details[cid] && D.details[cid].profile;
    if (!p || (!p.sectors.length && !p.events.length)) return "";
    const STY = { "우량주 장기 보유": "우량주를 오래 들고 가는 편이에요", "우량주 중심": "우량주 중심으로 담고 있어요", "공격적 투자": "변동성 큰 종목에도 투자하는 편이에요",
      "활발한 매매": "매매를 자주 하는 편이에요", "균형형": "여러 업종에 나눠 담고 있어요", "예수금 위주": "예수금 비중이 높은 편이에요", "보유 주식 없음": "아직 보유한 주식이 없어요" };
    const ev = (D.events || []).filter(e => p.events.includes(e.id)).slice(0, 2);
    return `<div class="a-card"><div class="a-title">나의 투자 프로필</div>
      ${p.sectors.length ? `<div class="ap-sec">${p.sectors.slice(0, 3).map(x => `<span><b>${esc(x.name)}</b>${Math.round(x.pct * 100)}%</span>`).join("")}</div>` : ""}
      <p class="ap-line">${STY[p.style] || ""} · 최근 90일 매매 ${p.trade_days}일</p>
      ${ev.length ? `<div class="ap-sub">관심 분야 행사 소식</div>${ev.map(e => `<button class="a-row" data-done="${esc(e.title)} 참가 신청을 받았어요 (데모)"><span class="a-ico sm">${+e.date.slice(5, 7)}/${+e.date.slice(8)}</span>
        <span class="a-txt"><b>${esc(e.title)}</b><small>${esc(e.place)} · ${e.time}</small></span><span class="a-go ap-go">신청 ›</span></button>`).join("")}` : ""}</div>`;
  }

  function appCreditCard(cid) {   // 고객 앱: 본인 신용 보유분
    if (!MK) return "";
    const mine = MK.credit.filter(b => b.customer_id === cid);
    if (!mine.length) return "";
    return `<div class="a-card"><div class="a-title">신용으로 산 주식</div>${mine.map(b => `
      <div class="ac-credit"><div class="ac-top"><b>${esc(b.name)}</b><span class="cg-tag ${stageCls(b.kind)}">${STAGE[b.kind][0]}</span></div>
      <p class="ac-line">${b.kind === "margin_call" ? `담보가 약 ${man(b.shortfall_krw)} 부족해서 반대매매될 수 있어요` : `주가가 <b>${(b.room * 100).toFixed(1)}%</b> 더 내리면 반대매매될 수 있어요`}</p>
      <div class="cg-track mini ${stageCls(b.kind)}"><i class="z1"></i><i class="z2"></i><i class="z3"></i><span class="cg-dot" style="left:${Math.min(1, Math.max(0, b.room) / 0.3) * 100}%"></span></div>
      <p class="ac-sub">담보비율 ${ratioTxt(b.ratio)} · 기준가 ${won(b.trigger_price)} · ${MK.ref_date.slice(5).replace("-", "/")} 종가</p></div>`).join("")}</div>`;
  }

  // ════════════════ 연락 기록 (이 브라우저에 날짜별로 누적) ════════════════
  const LOG_RESULT = { called: "통화 완료", no_answer: "부재중", joined: "고객이 앱에서 직접 가입함", later: "나중에 연락", memo: "메모" };
  if (!Array.isArray(S.log)) S.log = [];
  function addLog(cid, result, topic, memo) {
    S.log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cid, at: new Date().toISOString(),
      result, topic: topic || "", memo: (memo || "").trim() });
    save();
  }
  const logsOf = cid => S.log.filter(l => l.cid === cid).sort((a, b) => b.at.localeCompare(a.at));
  const fmtAt = iso => { const d = new Date(iso); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const isToday = iso => new Date(iso).toDateString() === new Date().toDateString();
  function logList(list, withName) {
    if (!list.length) return `<p class="sub">아직 연락 기록이 없어요.</p>`;
    return `<ul class="tl">${list.map(l => `<li><span class="tl-dot ${l.result}"></span><div>
      <p class="tl-head"><b>${LOG_RESULT[l.result]}</b>${withName && CUST[l.cid] ? ` · <a href="#client/${l.cid}">${esc(CUST[l.cid].name)}</a>` : ""}<small>${fmtAt(l.at)}</small></p>
      ${l.topic ? `<p class="tl-topic">${esc(l.topic)}</p>` : ""}${l.memo ? `<p class="tl-memo">${esc(l.memo)}</p>` : ""}</div></li>`).join("")}</ul>`;
  }
  function exportLogs() {
    const blob = new Blob([JSON.stringify(S.log, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `연락기록_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importLogs(file) {
    file.text().then(t => {
      const rows = JSON.parse(t);
      if (!Array.isArray(rows)) throw new Error("형식 오류");
      const seen = new Set(S.log.map(l => l.id));
      const add = rows.filter(r => r && r.id && r.cid && r.at && !seen.has(r.id));
      S.log.push(...add); save(); toast(`연락 기록 ${add.length}건을 가져왔어요`); render();
    }).catch(() => toast("기록 파일을 읽지 못했어요"));
  }

  // ════════════════ PB 아침 브리핑 ════════════════
  function priorityList() {
    const out = [];
    if (MK) MK.alerts.forEach(a => {
      if (a.kind === "margin_call") out.push({ cid: a.customer_id, w: 0, why: `${a.name} 담보 ${ratioTxt(a.ratio)} · 약 ${man(a.shortfall_krw)} 부족`, tag: "반대매매 위험", cls: "s-call" });
      if (a.kind === "margin_warn") out.push({ cid: a.customer_id, w: 1, why: `${a.name} 반대매매까지 −${(a.room * 100).toFixed(1)}%`, tag: "반대매매 경고", cls: "s-warn" });
      if (a.kind === "big_move") out.push({ cid: a.customer_id, w: 3, amt: Math.abs(a.day_delta_krw), why: `${a.name} ${pctTxt(a.chg_pct)} · 평가 ${a.day_delta_krw < 0 ? "−" : "+"}${man(Math.abs(a.day_delta_krw))}`, tag: "보유 종목 급등락", cls: "s-move" });
    });
    D.customers.forEach(c => findingsOf(c.id).forEach(f => {
      if (f.deadline && daysLeft(f.deadline) <= 3) out.push({ cid: c.id, w: 2, why: headline(f), tag: `마감 D-${daysLeft(f.deadline)}`, cls: "s-due" });
    }));
    const seen = new Set();
    return out.sort((a, b) => a.w - b.w || (b.amt || 0) - (a.amt || 0)).filter(x => !seen.has(x.cid) && seen.add(x.cid));
  }

  function upcoming(days) {
    const by = {};
    D.customers.filter(c => inView(c.id)).forEach(c => findingsOf(c.id).forEach(f => {
      if (!f.deadline) return;
      const dl = daysLeft(f.deadline);
      if (dl < 0 || dl > days) return;
      const key = `${f.deadline}|${f.subtype}|${f.rule === "R3" ? f.meta.stock : f.rule === "R4" ? "" : ""}`;
      (by[key] ||= { date: f.deadline, dl, label: f.rule === "R3" ? `${f.meta.stock} 유상증자 청약 마감` : f.rule === "R4" ? "펀드·ELS 만기" : f.rule === "R2" ? "해외주식 올해 마지막 매도일" : f.rule === "R5" ? "ISA 올해 납입 한도 기준일" : f.subtype_label, cids: new Set(), sum: 0 });
      by[key].cids.add(c.id); by[key].sum += f.rule === "R4" ? f.meta.expected : f.amount_krw; by[key].r4 = f.rule === "R4";
    }));
    return Object.values(by).sort((a, b) => a.dl - b.dl);
  }

  function pageBrief() {
    const now = new Date();
    const pri = priorityList();
    const top = pri.slice(0, 6);
    const contact = todayRows().length, careN = careRows().length;
    const risk = MK ? MK.credit.filter(b => b.kind === "margin_call" || b.kind === "margin_warn").length : 0;
    const movers = MK ? new Set(MK.alerts.filter(a => a.kind === "big_move").map(a => a.customer_id)).size : 0;
    const due = upcoming(7).reduce((s, u) => s + u.cids.size, 0);
    const issues = MK ? Object.values(MK.alerts.filter(a => a.kind === "big_move").reduce((o, a) => {
      (o[a.symbol] ||= { a, n: new Set() }).n.add(a.customer_id); return o; }, {})) : [];

    $app.innerHTML = `<div class="pbm brief">
      <p class="sub">${now.getMonth() + 1}월 ${now.getDate()}일 ${"일월화수목금토"[now.getDay()]}요일 아침</p>
      <h1>오늘은 ${pri.length ? `<span class="hl">${esc(CUST[pri[0].cid].name)}님</span>부터 연락하세요` : "급한 연락이 없어요"}</h1>
      <p class="sub">${pri.length ? esc(pri[0].why) : ""}</p>
      <div class="pbm-stats five">
        <div><span>반대매매 위험·경고</span><b class="${risk ? "red" : ""}">${risk}명</b></div>
        <div><span>보유 종목 ±10%</span><b>${movers}명</b></div>
        <div><span>마감 7일 이내</span><b>${due}건</b></div>
        <div><span>오늘 연락 (급함)</span><b>${contact}명</b><small><a href="#clients">고객 목록 ›</a></small></div>
        <div><span>관리 필요</span><b>${careN}명</b><small>예수금 90일 넘게 그대로</small></div>
      </div>

      <div class="brief-grid">
        <section class="bcard"><div class="bhead"><h2>먼저 연락할 고객</h2><a href="#clients">전체 보기 ›</a></div>
          <ul class="pri">${top.map((x, i) => `<li><a href="#client/${x.cid}"><em>${i + 1}</em>
            <span class="who"><b>${esc(CUST[x.cid].name)}</b><small>${CUST[x.cid].age}세</small><i>${esc(x.why)}</i></span>
            <span class="tag ${x.cls}">${esc(x.tag)}</span></a></li>`).join("") || `<li class="empty">없어요</li>`}</ul></section>

        <section class="bcard"><div class="bhead"><h2>${MK ? mkDay() : "어제"} 시장</h2>${MK ? `<span class="sub">${mkDate()} 마감</span>` : ""}</div>
          ${MK ? `<div class="idx-grid">${MK.indices.map(i => `<div><span>${esc(i.name)}</span><b>${i.close.toLocaleString("ko-KR")}</b><em class="${i.chg_pct < 0 ? "dn" : "up"}">${pctTxt(i.chg_pct)}</em>${i.date !== MK.ref_date ? `<small class="stale">${i.date.slice(5).replace("-", "/")} 기준</small>` : ""}</div>`).join("")}</div>
          <h3>고객 보유 종목 이슈</h3>
          <ul class="issues">${issues.map(({ a, n }) => `<li><div class="is-top"><b>${esc(a.name)}</b><em class="${a.chg_pct < 0 ? "dn" : "up"}">${pctTxt(a.chg_pct)}</em><small>보유 고객 ${n.size}명</small></div>
            <p>${esc(a.reason ? a.reason.split(/(?<=다\.)\s/)[0] : "이유 확인 전")}</p></li>`).join("") || `<li class="empty">크게 움직인 보유 종목이 없어요</li>`}</ul>`
          : `<p class="sub">아침 시장 점검을 아직 돌리지 않았어요.</p>`}</section>

        <section class="bcard"><div class="bhead"><h2>다가오는 마감 (14일)</h2><a href="#calendar">달력에서 보기 ›</a></div>
          <ul class="cal">${upcoming(14).map(u => `<li><span class="d"><b>${u.date.slice(5).replace("-", "/")}</b><small class="${u.dl <= 3 ? "red" : ""}">D-${u.dl}</small></span>
            <span class="t"><b>${esc(u.label)}</b><small>고객 ${u.cids.size}명 · ${u.r4 ? "상환 예정" : "합계"} ${man(u.sum)}</small></span></li>`).join("") || `<li class="empty">없어요</li>`}</ul>
          <p class="sub small">${D.as_of} 기준</p></section>

        <section class="bcard"><div class="bhead"><h2>관리 필요</h2><a href="#clients" data-care>전체 보기 ›</a></div>
          <p class="sub small">예수금 1,000만원 이상이 90일 넘게 거의 그대로인 고객 (금액 큰 순)</p>
          <ul class="pri">${careRows().slice(0, 5).map((r, i) => `<li><a href="#client/${r.c.id}"><em>${i + 1}</em>
            <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세</small><i>예수금 ${man(r.care.cash)} · ${r.care.days} 그대로</i></span>
            <span class="tag s-care">관리 필요</span></a></li>`).join("") || `<li class="empty">없어요</li>`}</ul></section>
      </div></div>`;
    const care = $app.querySelector("[data-care]"); if (care) care.onclick = () => { cl.tab = "care"; };
  }

  // ════════════════ 고객 한 명 전체 보기 (PB용) ════════════════
  // 왼쪽: 진단·잔고 추이·챙길 것·보유 종목·통화 녹음 분석 / 오른쪽: 최근 통화 요약·할 일·케어 일정
  if (!S.calls || typeof S.calls !== "object") S.calls = {};
  let cv = { cid: null, month: null, showWhy: false, stage: "idle", progress: "", transcript: "", source: "", seconds: 0, result: null, todos: [] };

  if (!S.done || typeof S.done !== "object") S.done = {};
  const callsOf = cid => [...(D.calls && D.calls[cid] || []), ...(S.calls[cid] || [])].map(c => c.ai ? { ...c, todos: c.result.todos } : c)
    .sort((a, b) => b.at.localeCompare(a.at));
  const todoDone = (cl, i) => cl.ai ? !!S.done[`${cl.id}|${i}`] : !!cl.todos[i].done;
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function careEvents(cid) {   // 케어 일정: 마감(빨강) + 할 일(파랑)
    const ev = [];
    findingsOf(cid).forEach(f => f.deadline && ev.push({ date: f.deadline, kind: "due", text: headline(f).replace(/ · D-\d+$/, "").replace(/ D-\d+$/, "") }));
    callsOf(cid).forEach(c => c.todos.forEach((t, i) => !todoDone(c, i) && t.due && ev.push({ date: t.due, kind: "todo", text: t.text })));
    return ev.sort((a, b) => a.date.localeCompare(b.date));
  }

  function calendar(cid) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const base = cv.month || new Date(today.getFullYear(), today.getMonth(), 1);
    const y = base.getFullYear(), m = base.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const ev = careEvents(cid), mark = {};
    ev.forEach(e => { if (e.date.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)) (mark[+e.date.slice(8)] ||= new Set()).add(e.kind); });
    let cells = "";
    for (let i = 0; i < first; i++) cells += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const k = mark[d], isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
      cells += `<span class="${isToday ? "today" : ""} ${k ? (k.has("due") ? "m-due" : "m-todo") : ""}">${d}</span>`;
    }
    const upcoming = ev.filter(e => e.date >= ymd(today)).slice(0, 5);
    return `<div class="cal-head"><button class="txt" data-mon="-1">‹</button><b>${y}년 ${m + 1}월</b><button class="txt" data-mon="1">›</button></div>
      <div class="cal-grid"><i>일</i><i>월</i><i>화</i><i>수</i><i>목</i><i>금</i><i>토</i>${cells}</div>
      <p class="cal-sub">다가오는 일정</p>
      <ul class="cal-list">${upcoming.map(e => `<li><span class="dot ${e.kind}"></span><b>${+e.date.slice(5, 7)}월 ${+e.date.slice(8)}일</b><span>${esc(e.text)}</span>${e.kind === "due" ? `<em>D-${daysLeft(e.date)}</em>` : ""}</li>`).join("") || `<li class="empty">예정된 일정이 없어요</li>`}</ul>`;
  }

  function areaChart(tr) {
    const v = tr.cash, n = v.length; if (!n) return "";
    const W = 640, H = 200, L = 46, B = 24, T = 10, max = Math.max(1, ...v) * 1.15;
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const x = i => L + (W - L - 8) * i / (n - 1), y = val => T + (H - T - B) * (1 - val / top);
    let g = "";
    for (let t = 0; t <= top + 1e-9; t += step) g += `<line x1="${L}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" stroke="#EEF1F5"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#8B95A1">${t.toLocaleString("ko-KR")}</text>`;
    const start = new Date(tr.start + "T00:00:00");
    for (let i = 0; i < n; i++) { const d = new Date(start.getTime() + i * 864e5); if (d.getDate() === 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#8B95A1">${d.getMonth() + 1}/1</text>`; }
    const pts = v.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" class="area" role="img" aria-label="최근 6개월 예수금 추이">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3182F6" stop-opacity=".22"/><stop offset="1" stop-color="#3182F6" stop-opacity="0"/></linearGradient></defs>
      ${g}<polygon fill="url(#ag)" points="${pts} ${x(n - 1)},${y(0)} ${x(0)},${y(0)}"/><polyline fill="none" stroke="#3182F6" stroke-width="2.4" points="${pts}"/>
      <circle cx="${x(n - 1)}" cy="${y(v[n - 1])}" r="4.5" fill="#3182F6"/></svg>`;
  }

  function diagnosisCard(cid) {
    const fs = findingsOf(cid), r1 = fs.find(f => f.rule === "R1" && f.currency === "KRW") || fs.find(f => f.rule === "R1"), found = foundOf(cid);
    if (found) return `<section class="dcard ok"><div class="dhead"><span class="dico">₩</span><h2>예수금 자동 RP 이용 중</h2></div>
      <div class="dstats"><div><span>지금 RP에 있는 돈</span><b>${man(found.invested_krw)}</b></div><div><span>깨운 뒤 받은 이자</span><b class="okc">${won(found.found_krw)}</b><small>${found.days}일</small></div><div><span>이대로 1년이면</span><b>약 ${man(found.annual_krw)}</b></div></div></section>`;
    if (!r1) return "";
    const usdF = r1.currency === "USD";
    return `<section class="dcard"><div class="dhead"><span class="dico">₩</span><h2>잠자는 예수금 진단</h2><span class="dtag">${esc(r1.subtype_label)}</span></div>
      <div class="dstats">
        <div><span>${usdF ? "달러 예수금" : "예수금"}</span><b>${usdF ? usd(r1.meta.cash_today) : man(r1.meta.cash_today)}</b><small>쉬는 돈 ${man(r1.meta.idle_krw)}</small></div>
        <div><span>쉬고 있는 기간</span><b>${r1.meta.streak}<em>일째</em></b><small>500만원 이상이 이어진 날</small></div>
        <div><span>RP 활용 시 예상 이자 차이</span><b class="hot">연 약 ${man(r1.annual_projection_krw)}</b><small>세전 · ${esc(r1.amount_label.replace("놓친", "못 받은"))} ${man(r1.amount_krw)}</small></div>
      </div>
      ${cv.showWhy ? `<ul class="why-list">${r1.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      <div class="dfoot"><span>금리와 보유기간에 따라 달라질 수 있습니다. 가입은 고객이 앱에서 직접 합니다.</span>
        <div><button class="ghost sm" data-why>${cv.showWhy ? "근거 접기" : "산출 근거 보기"}</button></div></div></section>`;
  }

  function callPanel(cid) {
    const st = cv.stage;
    if (st === "idle") return `<div class="cin">
        <label class="drop"><input type="file" id="audio" accept="audio/*" hidden><b>통화 녹음 파일 올리기</b><span>mp3·wav·m4a · 녹음은 이 브라우저 안에서만 처리돼요</span></label>
        <div class="cin-alt">${cid === "P003" ? `<button class="ghost sm" id="demoAudio">데모 녹음으로 해보기 (1분 40초)</button>` : ""}<button class="ghost sm" id="pasteBtn">녹취록 텍스트 붙여넣기</button></div>
        <p class="fine">처음 한 번은 음성인식 모델(약 200MB)을 내려받아요. 이후에는 바로 시작해요.</p></div>`;
    if (st === "working") return `<div class="cin working"><div class="spin"></div><b>${esc(cv.progress)}</b><p class="fine">녹음 파일은 외부로 전송되지 않아요.</p></div>`;
    if (st === "edit") return `<div class="cin"><p class="sub">${cv.source ? esc(cv.source) + " · " : ""}녹취록을 확인하고 잘못 들린 부분(특히 날짜·금액)을 고친 뒤 분석하세요.</p>
        <textarea id="tx" rows="10">${esc(cv.transcript)}</textarea>
        <div class="row-btns"><button class="cta sm" id="runAnalyze">요약·할 일 정리</button><button class="ghost sm" id="cancelCall">취소</button></div></div>`;
    const r = cv.result;
    return `<div class="cres">
      <p class="cres-h">${esc(r.headline)}</p>
      <div class="cres-grid">
        <div><h4>핵심 내용</h4><ul>${r.key.map(k => `<li>${esc(k)}</li>`).join("") || "<li>-</li>"}</ul></div>
        <div><h4>고객 요청·질문</h4><ul>${r.requests.map(k => `<li>${esc(k)}</li>`).join("") || "<li>-</li>"}</ul></div>
        <div><h4>PB가 약속한 것</h4><ul>${r.promises.map(k => `<li>${esc(k)}</li>`).join("") || "<li>-</li>"}</ul></div>
        <div><h4>준법 점검</h4><ul class="chk">${r.checks.map(c => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "!"} ${esc(c.t)}</li>`).join("") || "<li>해당 항목 없음</li>"}</ul></div>
      </div>
      <h4>해야 할 일 <small>체크를 풀면 저장되지 않아요</small></h4>
      <ul class="todo-edit">${cv.todos.map((t, i) => `<li><label><input type="checkbox" data-keep="${i}" ${t.keep ? "checked" : ""}> <span>${esc(t.text)}</span></label><em>${esc(t.dueLabel)}</em><small>${esc(t.from)}</small></li>`).join("") || "<li class='empty'>정리된 할 일이 없어요</li>"}</ul>
      <div class="row-btns"><button class="cta sm" id="saveCall">PB 확인 완료 · 상담 기록에 저장</button><button class="ghost sm" id="backEdit">녹취록 다시 고치기</button></div>
      <p class="fine">자동 요약은 참고용이에요. PB가 내용을 확인한 뒤 저장하고, 고객에게 보낼 때도 PB가 다시 확인해요.</p></div>`;
  }

  function pageClient(cid) { return pageClientTabs(cid); }
  function pageClientOld(cid) {
    const c = CUST[cid];
    if (!c) { location.hash = "#clients"; return; }
    if (cv.cid !== cid) cv = { cid, month: null, showWhy: false, stage: "idle", progress: "", transcript: "", source: "", seconds: 0, result: null, todos: [], open: null, upload: false };
    const fs = findingsOf(cid), det = D.details[cid];
    const krw = c.balance.KRW || { cash: 0, auto_rp: 0 }, usdB = c.balance.USD;
    const pos = MK ? MK.positions.filter(p => p.customer_id === cid) : [];
    const credit = MK ? MK.credit.filter(b => b.customer_id === cid) : [];
    const stock = pos.reduce((s, p) => s + p.value_krw, 0), loan = pos.reduce((s, p) => s + p.credit_loan_krw, 0);
    const alerts = D.outbox.filter(r => r.cid === cid).sort((a, b) => b.at.localeCompare(a.at));
    const calls = callsOf(cid), last = calls[0], logs = logsOf(cid);
    const openTodos = calls.flatMap(cl => cl.todos.map((t, i) => ({ ...t, call: cl.id, i, done: todoDone(cl, i) }))).filter(t => !t.done).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    const consent = [c.consent_push && "앱 푸시", c.consent_kakao && "카카오톡"].filter(Boolean);
    const total = krw.cash + (krw.auto_rp || 0) + (usdB ? usdB.cash * usdB.rate : 0) + stock;
    const others = fs.filter(f => f.rule !== "R1");

    $app.innerHTML = `<div class="pg c360">
      <a class="crumb" href="#clients">‹ 고객 목록</a>
      <div class="c360-head"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
        <div class="c360-id"><h1>${esc(c.name)}님 <small>${cid}</small></h1><p class="sub">${c.age}세 · ${esc(c.risk)} · ${consent.length ? "광고 동의 " + consent.join("·") : "광고 미동의 · PB 연락만"} · 담당 ${c.pb}</p></div>
</div>

      <div class="kpis">
        <div><span>총자산</span><b>${man(total)}</b><small>예수금·RP·달러·주식</small></div>
        <div><span>원화 예수금</span><b>${man(krw.cash)}</b>${krw.auto_rp ? `<small>자동 RP ${man(krw.auto_rp)}</small>` : `<small>&nbsp;</small>`}</div>
        <div><span>달러 예수금</span><b>${usdB ? usd(usdB.cash) : "–"}</b><small>${usdB ? `약 ${man(usdB.cash * usdB.rate)}` : "&nbsp;"}</small></div>
        <div><span>주식 평가금액</span><b>${pos.length ? man(stock) : "–"}</b><small>${loan ? `신용 ${man(loan)}` : MK && pos.length ? `${MK.ref_date.slice(5).replace("-", "/")} 종가` : "&nbsp;"}</small></div>
      </div>

      <div class="c360-grid">
        <div class="col">
          ${contactCard(cid)}
          ${diagnosisCard(cid)}
          ${det.trend.start ? `<section class="panel"><div class="bhead"><h2>자산 잔고 추이</h2><span class="sub">최근 6개월 · 총자산 · 만원</span></div>
            <div class="area-now"><span>지금 총자산</span><b>${man(total)}</b></div>${assetChart(cid)}</section>` : ""}

          ${pos.length ? `<section class="panel"><div class="bhead"><h2>보유 종목 ${pos.length}개</h2><span class="sub">${MK.ref_date} 종가</span></div>
            <ul class="hold">${pos.sort((a, b) => b.value_krw - a.value_krw).map(p => { const b = credit.find(x => x.symbol === p.symbol);
              return `<li><span class="who"><b>${esc(p.name)}</b><small>${p.qty.toLocaleString("ko-KR")}주</small>${b ? `<span class="cg-tag ${stageCls(b.kind)}">신용 · ${STAGE[b.kind][0]}${b.kind === "margin_call" ? ` · ${man(b.shortfall_krw)} 부족` : b.kind !== "margin_safe" ? ` · 반대매매까지 −${(b.room * 100).toFixed(1)}%` : ""}</span>` : ""}</span>
                <span class="amt"><b>${man(p.value_krw)}</b><small class="${p.chg_pct < 0 ? "dn" : "up"}">${pctTxt(p.chg_pct)}</small></span>
                <span class="amt"><b class="${p.pnl_krw < 0 ? "dn" : "up"}">${p.pnl_krw < 0 ? "−" : "+"}${man(Math.abs(p.pnl_krw))}</b><small>매입 후 손익</small></span></li>`; }).join("")}</ul></section>` : ""}

          ${others.length ? `<section class="panel"><div class="bhead"><h2>함께 챙길 것</h2></div><ul class="items">${others.map(f => `<li class="static"><span><b>${esc(headline(f))}</b><small>${SHORT[f.rule]}${f.deadline ? ` · 마감 ${f.deadline.slice(5).replace("-", "/")}` : ""}${amtNote(f) ? ` · ${amtNote(f)}` : ""}</small></span><em>${amtText(f)}</em></li>`).join("")}</ul></section>` : ""}

          <section class="panel"><div class="bhead"><h2>통화 녹음 분석</h2>${cv.stage === "idle" && !cv.upload ? `<button class="ghost sm" id="openUpload">녹음 올리기</button>` : ""}</div>
            ${cv.stage === "idle" && !cv.upload ? `<p class="sub">녹음을 올리면 받아쓰고 요약·할 일을 정리해요. 분석한 통화는 오른쪽 '최근 통화 요약'에 쌓여요.</p>` : callPanel(cid)}</section>

          <details class="panel fold"><summary><h2>이 고객에게 간 알림</h2><span class="sub">최근 30일 · ${alerts.length}건</span></summary>
            ${alerts.length ? `<ul class="alog">${alerts.slice(0, 12).map(r => `<li><details><summary><span><b>${esc(r.title)}</b><small>${r.at} · ${chName(r)} · ${MT[r.msg_type]}${r.hold ? " · " + esc(holdLabel(r.hold)) : ""}</small></span><em>${ST[r.status] || r.status}</em></summary><p>${esc(r.body)}</p></details></li>`).join("")}</ul>` : `<p class="sub">보낸 알림이 없어요.</p>`}</details>
        </div>

        <div class="col side">
          <section class="panel"><div class="bhead"><h2>최근 통화 요약</h2>${last ? `<span class="pill-tag ${last.ai ? "ai" : ""}">${last.ai ? "AI 요약 · PB 확인 전" : "PB 확인 완료"}</span>` : ""}</div>
            ${last ? callSummary(last, calls) : `<p class="sub">아직 분석한 통화가 없어요.</p>`}</section>

          <section class="panel"><div class="bhead"><h2>해야 할 일</h2><span class="sub">${openTodos.length}건</span></div>
            <ul class="todo-list">${openTodos.map(t => `<li><label><input type="checkbox" data-done="${t.call}|${t.i}"> <span>${esc(t.text)}</span></label><em class="${t.due && t.due <= ymd(new Date()) ? "red" : ""}">${esc(t.dueLabel)}</em></li>`).join("") || `<li class="empty">남은 할 일이 없어요</li>`}</ul></section>

          <section class="panel"><div class="bhead"><h2>케어 일정</h2></div>${calendar(cid)}</section>
        </div>
      </div></div>`;
    bindClient(cid);
    $app.querySelectorAll("[data-ci]").forEach(b => (b.onclick = () => { cv.open = cv.open === b.dataset.ci ? "__none" : b.dataset.ci; pageClient(cid); }));
    const up = $app.querySelector("#openUpload"); if (up) up.onclick = () => { cv.upload = true; pageClient(cid); };
    const cancel = $app.querySelector("#cancelCall"); if (cancel) cancel.onclick = () => { cv.upload = false; setStage(cid, { stage: "idle" }); };
  }

  function callSummary(last, calls) {
    const r = last.result;
    const rq = (r.requests || []).find(x => /(주세요|싶어요|싶습니다|부탁|하려고)/.test(x)) || (r.requests || [])[0];
    return `<p class="sub">${last.ai ? r.call_date || last.at.slice(0, 10) : fmtAt(last.at)} · ${esc(last.source)}${last.seconds ? ` · ${Math.round(last.seconds)}초` : ""}</p>
      <p class="sum-box">${esc(r.headline)}</p>
      ${r.summary ? `<p class="sum-p">${esc(r.summary)}</p>` : ""}
      <dl class="kv2">${rq ? `<dt>고객 요청</dt><dd>${esc(rq)}</dd>` : ""}${(r.promises || [])[0] ? `<dt>PB 후속 약속</dt><dd>${esc(r.promises.join(" · "))}</dd>` : ""}
        ${(r.customer_context || []).length ? `<dt>고객 상황</dt><dd>${r.customer_context.map(esc).join("<br>")}</dd>` : ""}</dl>
      ${(r.checks || []).length ? `<ul class="chk small">${r.checks.map(x => `<li class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "!"} ${esc(x.t)}</li>`).join("")}</ul>` : ""}
      ${last.audio ? `<audio controls preload="none" src="${esc(last.audio)}"></audio>` : ""}
      <details class="mini-hist"><summary>녹취록 보기</summary><pre class="tx">${esc(last.transcript)}</pre>
        ${(r.transcript_fixes || []).length ? `<p class="fine left">음성인식 보정: ${r.transcript_fixes.map(f => `${esc(f.heard)} → ${esc(f.meant)}`).join(", ")}</p>` : ""}</details>
      ${calls.length > 1 ? `<details class="mini-hist"><summary>이전 통화 ${calls.length - 1}건</summary><ul class="hist">${calls.slice(1).map(cl => `<li><b>${(cl.ai ? cl.result.call_date || cl.at : fmtAt(cl.at)).slice(5, 10)}</b><span>${esc(cl.result.headline)}</span></li>`).join("")}</ul></details>` : ""}`;
  }

  function setStage(cid, patch) { Object.assign(cv, patch); if (cv.cid === cid && location.hash.startsWith("#client/" + cid)) pageClient(cid); }

  async function runSTT(cid, input, label) {
    if (!window.STT) { toast("음성인식 모듈을 불러오지 못했어요. 녹취록 텍스트 붙여넣기를 써 주세요"); return; }
    setStage(cid, { stage: "working", progress: "음성인식 준비 중…", source: label });
    try {
      const r = await window.STT.transcribe(input, p => {
        const msg = p.stage === "download" ? `음성인식 모델 내려받는 중 ${Math.round(p.ratio * 100)}% (처음 한 번만)`
          : p.stage === "decode" ? "녹음 파일 읽는 중…" : `받아쓰는 중 ${p.done + 1}/${p.total} 구간 (${Math.round(p.seconds)}초 녹음)`;
        setStage(cid, { progress: msg });
      });
      setStage(cid, { stage: "edit", transcript: window.CallNote.normalize(r.text), seconds: r.seconds });
    } catch (e) {
      console.error(e);
      setStage(cid, { stage: "idle" }); toast("녹음을 받아쓰지 못했어요. 다른 파일이나 텍스트 붙여넣기를 써 주세요");
    }
  }

  function bindClient(cid) {
    const q = s => $app.querySelector(s);
    $app.querySelectorAll("[data-mon]").forEach(b => (b.onclick = () => {
      const t = new Date(); const base = cv.month || new Date(t.getFullYear(), t.getMonth(), 1);
      cv.month = new Date(base.getFullYear(), base.getMonth() + +b.dataset.mon, 1); pageClient(cid);
    }));
    const why = q("[data-why]"); if (why) why.onclick = () => { cv.showWhy = !cv.showWhy; pageClient(cid); };
    const audio = q("#audio"); if (audio) audio.onchange = e => { const f = e.target.files[0]; if (f) runSTT(cid, f, f.name); };
    const demo = q("#demoAudio"); if (demo) demo.onclick = () => runSTT(cid, "demo/call_P003.wav", "데모 녹음 (가상 통화)");
    const paste = q("#pasteBtn"); if (paste) paste.onclick = () => setStage(cid, { stage: "edit", transcript: "", source: "녹취록 붙여넣기" });
    const cancel = q("#cancelCall"); if (cancel) cancel.onclick = () => setStage(cid, { stage: "idle" });
    const run = q("#runAnalyze"); if (run) run.onclick = () => {
      const text = q("#tx").value.trim();
      if (text.length < 20) return toast("녹취록이 너무 짧아요");
      const result = window.CallNote.analyze(text, { today: new Date() });
      setStage(cid, { stage: "result", transcript: text, result, todos: result.todos.map(t => ({ ...t, keep: true })) });
    };
    $app.querySelectorAll("[data-keep]").forEach(ch => (ch.onchange = () => { cv.todos[+ch.dataset.keep].keep = ch.checked; }));
    const back = q("#backEdit"); if (back) back.onclick = () => setStage(cid, { stage: "edit" });
    const saveB = q("#saveCall"); if (saveB) saveB.onclick = () => {
      const id = Date.now().toString(36);
      (S.calls[cid] ||= []).push({ id, at: new Date().toISOString(), source: cv.source, seconds: cv.seconds, transcript: cv.transcript, result: cv.result,
        todos: cv.todos.filter(t => t.keep).map(({ keep, ...t }) => ({ ...t, done: false })) });
      save();
      toast("상담 기록과 할 일에 저장했어요"); setStage(cid, { stage: "idle", result: null, todos: [], transcript: "", upload: false });
    };
    $app.querySelectorAll("[data-done]").forEach(ch => (ch.onchange = () => {
      const [callId, i] = ch.dataset.done.split("|");
      if (callId.startsWith("ai-")) { S.done[`${callId}|${i}`] = true; save(); toast("할 일을 완료했어요"); pageClient(cid); return; }
      const cl = (S.calls[cid] || []).find(x => x.id === callId);
      if (cl) { cl.todos[+i].done = true; save(); toast("할 일을 완료했어요"); pageClient(cid); }
    }));
    $app.querySelectorAll("[data-log]").forEach(b => (b.onclick = () => {
      const memo = q("#memo").value;
      if (b.dataset.log === "memo" && !memo.trim()) return toast("메모 내용을 적어 주세요");
      addLog(cid, b.dataset.log, findingsOf(cid)[0] ? headline(findingsOf(cid)[0]) : "", memo);
      if (b.dataset.log !== "memo") { S.pb[cid] = b.dataset.log; save(); }
      toast(`${LOG_RESULT[b.dataset.log]}으로 기록했어요`); pageClient(cid);
    }));
  }

  // ════════════════ PB 워크스테이션: 고객 목록 ════════════════
  let cl = { tab: "today", q: "" };
  // ── 고객 분류: 오늘 연락(급함) / 이번 주 / 관리 필요(장기 변화 없음) / 전체 ──
  const CARE = { minCash: 1000, days: 90, flat: 0.02, quiet: 90 };   // 만원 단위 · 90일 넘게 ±2% 안 · PB 연락 90일 없음
  function clientBase() {
    const all = pbCustomers(), have = new Set(all.map(r => r.c.id));
    marketCustomers().forEach(m => { if (!have.has(m.cid)) all.push({ c: m.c, fs: [], calls: [], lead: null, soon: null, rank: 1e9 }); });
    return all;
  }
  function urgency(cid) {
    const mk = MK ? MK.alerts.filter(a => a.customer_id === cid) : [];
    const fs = findingsOf(cid);
    if (mk.some(a => a.kind === "margin_call" || a.kind === "margin_warn" || a.kind === "big_move")) return "today";
    if (fs.some(f => f.deadline && daysLeft(f.deadline) <= 3)) return "today";
    if (fs.some(f => f.subtype === "event_inflow" && f.meta.event && f.meta.event.days_since <= 1)) return "today";   // 큰 상환금 입금 다음 날
    if (fs.some(f => f.deadline && daysLeft(f.deadline) <= 7)) return "week";
    if (mk.some(a => a.kind === "margin_watch")) return "week";
    if (fs.some(f => f.subtype === "event_inflow" && PB_BY_FID[f.finding_id])) return "week";
    return null;
  }
  function careInfo(cid) {      // 예수금이 오래 거의 그대로 + PB 연락도 없음
    const t = D.details[cid].trend; if (!t.start) return null;
    const cash = t.cash, n = cash.length, last = cash[n - 1];
    if (last < CARE.minCash || CUST[cid].auto) return null;
    let k = 0;
    while (k < n && Math.abs(cash[n - 1 - k] - last) <= last * CARE.flat) k++;
    if (k < CARE.days) return null;
    const lc = lastContact(cid);
    if (lc && lc.days < CARE.quiet) return null;   // 최근 90일 안에 통화·미팅했으면 안 뜸
    return { days: k >= n ? `${n}일 넘게` : `${k}일째`, cash: last * 1e4, lastAt: lc && lc.date };
  }
  function todayRows() { return clientBase().filter(r => urgency(r.c.id) === "today").sort((a, b) => rankOf(a) - rankOf(b)); }
  function careRows() {
    return D.customers.filter(c => inView(c.id)).map(c => ({ c, ci: careInfo(c.id) })).filter(x => x.ci)
      .map(x => ({ c: x.c, fs: findingsOf(x.c.id), calls: [], lead: null, soon: null, rank: 1e9, care: x.ci })).sort((a, b) => b.care.cash - a.care.cash);
  }
  function pageClients() {
    const all = clientBase();
    const lists = {
      today: todayRows(),
      week: all.filter(r => urgency(r.c.id) === "week").sort((a, b) => (a.soon ?? 99) - (b.soon ?? 99)),
      care: careRows(),
      all: all.filter(r => r.lead).sort((a, b) => amountOf(b.lead) - amountOf(a.lead)).concat(all.filter(r => !r.lead)),
    };
    if (!lists[cl.tab]) cl.tab = "today";
    const q = cl.q;
    const rows = lists[cl.tab].filter(r => !q || (r.c.id + r.c.name).includes(q));
    const desc = { today: "반대매매 위험·경고, 보유 종목 ±10%, 마감 D-3 이내, 큰 상환금 입금 다음 날 — 오늘 꼭 연락할 고객이에요.",
      week: "마감 D-7 이내, 담보 주의, 상환금이 들어와 쉬고 있는 고객 — 이번 주 안에 챙기면 돼요.",
      care: `예수금 1,000만원 이상이 ${CARE.days}일 넘게 거의 그대로인 고객이에요. 상품 권유보다 자금 계획을 먼저 여쭤보세요.`,
      all: "챙길 것이 있는 고객 전체예요." }[cl.tab];
    $app.innerHTML = `<div class="pg">
      <div class="pg-head"><div><h1>고객</h1><p class="sub">누구에게, 왜 연락해야 하는지 한 줄로 보고 눌러서 자세히 확인하세요.</p></div></div>
      <div class="toolbar"><div class="seg">${[["today", "오늘 연락", lists.today.length], ["week", "이번 주", lists.week.length], ["care", "관리 필요", lists.care.length], ["all", "전체", lists.all.length]]
        .map(([k, t, n]) => `<button class="${cl.tab === k ? "on" : ""}" data-tab="${k}">${t} <em>${n}</em></button>`).join("")}</div>
        <input class="pill" type="search" id="clq" placeholder="이름이나 고객번호" value="${esc(q)}"></div>
      <p class="tab-desc">${desc}</p>
      <ul class="rows">${rows.map(clientRow).join("") || `<li class="empty">해당하는 고객이 없어요</li>`}</ul></div>`;
    $app.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => { cl.tab = b.dataset.tab; pageClients(); }));
    const inp = $app.querySelector("#clq");
    inp.oninput = () => { cl.q = inp.value.trim(); pageClients(); const n = $app.querySelector("#clq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  }
  function rankOf(r) {
    const mk = MK ? MK.alerts.filter(a => a.customer_id === r.c.id) : [];
    if (mk.some(a => a.kind === "margin_call")) return -3;
    if (mk.some(a => a.kind === "margin_warn")) return -2;
    if (mk.some(a => a.kind === "big_move")) return -1;
    return r.rank;
  }
  function clientRow(r) {
    if (r.care) {
      return `<li><a href="#client/${r.c.id}"><span class="ava">${esc(r.c.name.slice(0, 1))}</span>
        <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세 · ${r.c.id}</small><i>예수금이 ${r.care.days} 거의 그대로</i></span>
        <span class="tag s-care">관리 필요</span><span class="amt"><b>${man(r.care.cash)}</b><small>예수금</small></span><span class="go">›</span></a></li>`;
    }
    const mk = MK ? MK.alerts.filter(a => a.customer_id === r.c.id) : [];
    const m = mk[0], f = r.lead, st = null;
    const line = m ? mkHeadline(m) : f ? headline(f) : "";
    const tag = m ? (m.kind === "margin_call" ? ["반대매매 위험", "s-call"] : m.kind === "margin_warn" ? ["반대매매 경고", "s-warn"] : m.kind === "big_move" ? ["급등락", "s-move"] : ["담보 주의", "s-due"])
      : f && f.deadline && daysLeft(f.deadline) <= 7 ? [`마감 D-${daysLeft(f.deadline)}`, "s-due"]
      : f && f.subtype === "event_inflow" && f.meta.event && f.meta.event.days_since <= 1 ? ["어제 입금", "s-move"] : null;
    let amt = f ? amtText(f) : "", lbl = f ? SHORT[f.rule] : "", cls = "";
    if (m) {
      if (m.kind === "margin_call") { amt = man(m.shortfall_krw); lbl = "부족 담보"; cls = "red"; }
      else if (m.kind === "big_move") { amt = `${m.day_delta_krw < 0 ? "−" : "+"}${man(Math.abs(m.day_delta_krw))}`; lbl = "하루 평가금액"; cls = m.day_delta_krw < 0 ? "dn" : "up"; }
      else { amt = `−${(m.room * 100).toFixed(1)}%`; lbl = "반대매매까지"; cls = "amber"; }
    }
    return `<li><a href="#client/${r.c.id}" class="${st ? "done" : ""}">
      <span class="ava">${esc(r.c.name.slice(0, 1))}</span>
      <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세 · ${r.c.id}</small><i>${esc(st ? `${PB_STATUS[st]} · ${line}` : line)}</i></span>
      ${tag ? `<span class="tag ${tag[1]}">${tag[0]}</span>` : "<span></span>"}
      <span class="amt"><b class="${cls}">${amt}</b><small>${lbl}${(r.fs.length + mk.length) > 1 ? ` 외 ${r.fs.length + mk.length - 1}건` : ""}</small></span><span class="go">›</span></a></li>`;
  }

  // ════════════════ 시장 이슈: ① 어제(지난 거래일) 시장 ② 내 고객 보유 종목 움직임 ③ 평가금 변동 큰 고객 ④ 신용 위험 ════════════════
  let mkv = { open: null, all: false };
  // 시장 요약은 지난 거래일 마감 기준: 기준일 전날이면 '어제', 주말·휴일을 건너뛰었으면 '지난 거래일'
  const mkDay = () => { const r = new Date(MK.ref_date + "T00:00:00"); return (AS_OF - r) / 864e5 === 1 ? "어제" : "지난 거래일"; };
  const mkDate = () => { const r = new Date(MK.ref_date + "T00:00:00"); return `${r.getMonth() + 1}/${r.getDate()}(${"일월화수목금토"[r.getDay()]})`; };
  // ① 시장 요약: 흐름 한 줄 → 왜(근거) → 국내·미국 오른 업종/내린 업종과 근거 → 환율·금리 → 출처(접힘)
  function mkBrief(sm) {
    if (!sm.headline) return sm.summary ? `<p class="mk-sum">${esc(sm.summary)}</p>` : `<p class="sub">${mkDay()} 시장 요약을 아직 쓰지 않았어요.</p>`;
    const sec = (list, up) => (list || []).map(x => `<li class="${up ? "up" : "dn"}"><div class="sc-h"><b>${esc(x.sector)}</b><span>${esc(x.move)}</span></div><p>${esc(x.why)}</p></li>`).join("");
    const col = (t, x) => x ? `<div class="mk-col"><h3>${t}</h3><p class="mk-line">${esc(x.line)}</p>
        ${(x.up || []).length ? `<p class="sc-t up">오른 업종</p><ul class="sc">${sec(x.up, true)}</ul>` : ""}
        ${(x.down || []).length ? `<p class="sc-t dn">내린 업종</p><ul class="sc">${sec(x.down, false)}</ul>` : ""}
        ${x.outlook ? `<p class="mk-out">${esc(x.outlook)}</p>` : ""}</div>` : "";
    const src = [...(sm.sources || [])];
    return `<p class="mk-sum">${esc(sm.headline)}</p>
      ${(sm.why || []).length ? `<ol class="mk-why">${sm.why.map(w => `<li><b>${esc(w.t)}</b><span>${esc(w.d)}</span></li>`).join("")}</ol>` : ""}
      <div class="mk-two">${col("국내", sm.kr)}${col("미국", sm.us)}</div>
      ${(sm.chips || []).length ? `<div class="mk-chips">${sm.chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
      ${src.length ? `<details class="mk-src"><summary>출처 ${src.length}건</summary>${srcLinks(src)}</details>` : ""}`;
  }
  const srcLinks = list => (list || []).length ? `<p class="src">${list.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title.split(":")[0])}</a>`).join(" · ")}</p>` : "";
  function pageMarket() {
    if (!MK) { $app.innerHTML = `<div class="pg"><h1>시장 이슈</h1><p class="sub">아침 시장 점검을 아직 돌리지 않았어요.</p></div>`; return; }
    const sm = MK.summary || {};
    const pos = (MK.positions || []).filter(p => inView(p.customer_id));
    const bigMove = Object.fromEntries(MK.alerts.filter(a => a.kind === "big_move" && inView(a.customer_id)).map(a => [a.symbol, a]));
    // 종목별: 보유 고객 수, 내 고객 전체 평가금 변동
    const bySym = {};
    pos.forEach(p => { const s = (bySym[p.symbol] ||= { symbol: p.symbol, name: p.name, chg: p.chg_pct, date: p.trade_date, holders: new Set(), delta: 0, value: 0, list: [] });
      s.holders.add(p.customer_id); s.delta += p.day_delta_krw; s.value += p.value_krw; s.list.push(p); });
    const syms = Object.values(bySym).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
    const shown = mkv.all ? syms : syms.filter(s => Math.abs(s.chg) >= 0.03).slice(0, 10);
    // 고객별: 하루 평가금 변동 합
    const byCust = {};
    pos.forEach(p => { const c = (byCust[p.customer_id] ||= { cid: p.customer_id, delta: 0, value: 0, items: [] }); c.delta += p.day_delta_krw; c.value += p.value_krw; c.items.push(p); });
    const movers = Object.values(byCust).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
    const credit = MK.credit.filter(b => b.kind !== "margin_safe" && inView(b.customer_id)).sort((a, b) => a.room - b.room);
    const myDelta = pos.reduce((s, p) => s + p.day_delta_krw, 0), myValue = pos.reduce((s, p) => s + p.value_krw, 0);
    const sign = v => (v < 0 ? "−" : "+") + man(Math.abs(v));

    $app.innerHTML = `<div class="pg mk2">
      <div class="pg-head"><div><h1>시장 이슈</h1><p class="sub">${mkDate()} 마감 기준 · ${mkDay()} 국내·미국 시장, 내 고객 보유 종목, 평가금이 크게 바뀐 고객 순서로 보세요</p></div></div>

      <section class="panel">
        <div class="bhead"><h2>① ${mkDay()} 시장 <small class="sub">${mkDate()} 마감 · 국내·미국</small></h2></div>
        <div class="idx-row">${MK.indices.map(i => `<div class="card-s soft"><span>${esc(i.name)}</span><b>${i.close.toLocaleString("ko-KR")}</b><em class="${i.chg_pct < 0 ? "dn" : "up"}">${pctTxt(i.chg_pct)}</em></div>`).join("")}</div>
        ${mkBrief(sm)}
      </section>

      <section class="panel">
        <div class="bhead"><h2>② 내 고객 보유 종목 움직임</h2><span class="sub">고객 ${new Set(pos.map(p => p.customer_id)).size}명 · 평가금 ${man(myValue)} · 하루 <b class="${myDelta < 0 ? "dn" : "up"}">${sign(myDelta)}</b></span></div>
        <ul class="syms">${shown.map(s => { const a = bigMove[s.symbol], why = (a && a.reason) ? a : (MK.stock_notes || {})[s.symbol], open = mkv.open === s.symbol || (mkv.open === null && a && s === syms.find(x => bigMove[x.symbol]));
          return `<li class="${a ? "hit" : ""} ${open ? "open" : ""}"><button class="sym-h" data-sym="${s.symbol}">
            <span class="sym-n"><b>${esc(s.name)}</b>${a ? `<span class="tag s-call">±${Math.round(MK.big_move_pct * 100)}% 넘음</span>` : ""}</span>
            <em class="${s.chg < 0 ? "dn" : "up"}">${pctTxt(s.chg)}</em>
            <span class="sym-m">보유 ${s.holders.size}명</span>
            <span class="sym-d ${s.delta < 0 ? "dn" : "up"}">${sign(s.delta)}</span><span class="chev">${open ? "⌃" : "⌄"}</span></button>
            ${open ? `<div class="sym-b">${spark((a || {}).spark || s.list[0].spark || [s.chg], s.chg < 0)}
              ${why ? `<h4>왜 움직였나요</h4><p class="mv-why">${esc(why.reason)}</p>${(why.sources || []).length ? `<p class="src">${why.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title.split(":")[0])}</a>`).join(" · ")}</p>` : ""}`
                : `<p class="sub">하루 ±${Math.round(MK.big_move_pct * 100)}% 미만이라 따로 뉴스를 찾지 않았어요.</p>`}
              <h4>보유 고객</h4><ul class="rows compact">${s.list.sort((x, y) => x.day_delta_krw - y.day_delta_krw).map(p => { const c = CUST[p.customer_id]; return `<li><a href="#client/${p.customer_id}"><span class="ava sm">${esc(c.name.slice(0, 1))}</span>
                <span class="who"><b>${esc(c.name)}</b><small>${c.age}세 · ${p.qty.toLocaleString("ko-KR")}주${p.credit_loan_krw ? " · 신용" : ""}</small></span><span></span>
                <span class="amt"><b class="${p.day_delta_krw < 0 ? "dn" : "up"}">${sign(p.day_delta_krw)}</b><small>평가 ${man(p.value_krw)}</small></span><span class="go">›</span></a></li>`; }).join("")}</ul></div>` : ""}</li>`; }).join("")}</ul>
        <button class="txt more" id="symAll">${mkv.all ? "크게 움직인 종목만 보기" : `전체 ${syms.length}종목 보기`}</button>
      </section>

      <section class="panel">
        <div class="bhead"><h2>③ 평가금이 크게 바뀐 고객</h2><span class="sub">하루 평가금 변동 큰 순 · 상위 10명</span></div>
        <ul class="rows compact">${movers.map(m => { const c = CUST[m.cid], top = m.items.slice().sort((a, b) => Math.abs(b.day_delta_krw) - Math.abs(a.day_delta_krw))[0];
          const pct = m.value - m.delta ? m.delta / (m.value - m.delta) : 0;
          return `<li><a href="#client/${m.cid}"><span class="ava sm ${m.delta < 0 ? "" : ""}">${esc(c.name.slice(0, 1))}</span>
            <span class="who"><b>${esc(c.name)}</b><small>${c.age}세 · 평가 ${man(m.value)}</small><i>${esc(top.name)} ${pctTxt(top.chg_pct)}${m.items.length > 1 ? ` 외 ${m.items.length - 1}종목` : ""}</i></span><span></span>
            <span class="amt"><b class="${m.delta < 0 ? "dn" : "up"}">${sign(m.delta)}</b><small>보유 주식 ${pctTxt(pct)}</small></span><span class="go">›</span></a></li>`; }).join("")}</ul>
      </section>

      <section class="panel">
        <div class="bhead"><h2>④ 신용 위험</h2><span class="sub">반대매매가 나기 전에 · 위험 ${MK.credit.filter(b => b.kind === "margin_call").length} · 경고 ${MK.credit.filter(b => b.kind === "margin_warn").length} · 주의 ${MK.credit.filter(b => b.kind === "margin_watch").length}</span></div>
        <ul class="rows compact">${credit.map(b => { const c = CUST[b.customer_id]; return `<li><a href="#client/${b.customer_id}"><span class="ava sm ${b.kind === "margin_call" || b.kind === "margin_warn" ? "warn" : ""}">${esc(c.name.slice(0, 1))}</span>
          <span class="who"><b>${esc(c.name)}</b><small>${c.age}세 · ${esc(b.name)}</small><i>담보비율 ${ratioTxt(b.ratio)} · 기준가 ${won(b.trigger_price)}</i></span>
          <span class="tag ${stageCls(b.kind)}">${STAGE[b.kind][0]}</span>
          <span class="amt"><b class="${b.kind === "margin_call" ? "red" : "amber"}">${b.kind === "margin_call" ? man(b.shortfall_krw) : `−${(b.room * 100).toFixed(1)}%`}</b><small>${b.kind === "margin_call" ? "부족 담보" : "반대매매까지"}</small></span><span class="go">›</span></a></li>`; }).join("") || `<li class="empty">위험·경고·주의 고객이 없어요</li>`}</ul>
      </section></div>`;
    $app.querySelectorAll("[data-sym]").forEach(b => (b.onclick = () => { mkv.open = mkv.open === b.dataset.sym ? "__none" : b.dataset.sym; pageMarket(); }));
    $app.querySelector("#symAll").onclick = () => { mkv.all = !mkv.all; pageMarket(); };
  }

  // ════════════════ 고객 페이지: 오늘 연락할 내용 ════════════════
  function contactItems(cid) {
    const out = [];
    const ci = careInfo(cid);
    if (ci) {
      const c = CUST[cid];
      out.push({ key: "care", tag: "관리 필요", cls: "s-care", title: `예수금 ${man(ci.cash)}이 ${ci.days} 거의 그대로예요`,
        todo: "상품 권유보다 자금 계획을 먼저 여쭤봐 주세요", reason: "", sources: [], gauge: null,
        script: `[인사] 안녕하세요, ${c.name}님. 유진투자증권 담당 PB입니다. 오랜만에 계좌 안부 여쭤보려고 연락드렸습니다.\n[근거] 계좌에 예수금 ${man(ci.cash)}이 ${ci.days} 거의 그대로 있어서요.\n[확인] 혹시 이 자금은 쓰실 계획이 정해져 있으신가요? 언제쯤 쓰실 예정이신지 여쭤봐도 될까요?\n[제안] 쓰실 때까지 기다리시는 동안 수시로 넣고 뺄 수 있는 곳에 두면 이자를 받을 수 있는데, 원하시면 안내드리겠습니다.\n[안내] 말씀해 주신 계획에 맞춰 필요할 때 다시 연락드리겠습니다.` });
    }
    (MK ? MK.alerts.filter(a => a.customer_id === cid) : []).forEach(a => out.push({ key: "m-" + a.symbol + a.kind, tag: MK_KIND[a.kind].split(" · ")[0],
      cls: a.kind === "margin_call" ? "s-call" : a.kind === "margin_warn" ? "s-warn" : a.kind === "big_move" ? "s-move" : "s-due",
      title: mkHeadline(a), todo: mkTodo(a), script: a.script, reason: a.reason, sources: a.sources || [], gauge: a.kind.startsWith("margin") ? a : null,
      why: a.kind === "big_move" ? "왜 움직였나요" : "왜 담보가 줄었나요" }));
    const fs = findingsOf(cid);
    fs.filter(f => PB_BY_FID[f.finding_id]).concat(fs.filter(f => !PB_BY_FID[f.finding_id])).forEach(f => out.push({ key: f.finding_id,
      tag: f.deadline ? `마감 D-${daysLeft(f.deadline)}` : SHORT[f.rule], cls: f.deadline ? "s-due" : "s-idle",
      title: headline(f), todo: todo(f), script: f.script, reason: "", sources: [], gauge: null, amount: `${amtText(f)} ${SHORT[f.rule]}`, note: amtNote(f), contact: !!PB_BY_FID[f.finding_id] }));
    return out;
  }
  function contactCard(cid) {
    const items = contactItems(cid);
    if (!items.length) return "";
    const openKey = cv.open || items[0].key;
    return `<section class="panel hl"><div class="bhead"><h2>오늘 연락할 내용</h2><span class="sub">${items.length}가지 · 눌러서 통화 문구 보기</span></div>
      <ul class="ci">${items.map(it => `<li class="${it.key === openKey ? "open" : ""}">
        <button class="ci-head" data-ci="${esc(it.key)}"><span class="tag ${it.cls}">${esc(it.tag)}</span><span class="ci-t"><b>${esc(it.title)}</b><small>${esc(it.todo)}</small></span>${it.amount ? `<em>${esc(it.amount)}</em>` : ""}<span class="chev">${it.key === openKey ? "⌃" : "⌄"}</span></button>
        ${it.key === openKey ? `<div class="ci-body">${it.note ? `<p class="ci-note">${esc(it.note)}</p>` : ""}
          ${it.gauge ? creditGauge(it.gauge) : ""}
          ${it.reason ? `<h4>${it.why}</h4><p class="mv-why">${esc(it.reason)}</p>${it.sources.length ? `<p class="src">${it.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title.split(":")[0])}</a>`).join(" · ")}</p>` : ""}` : ""}
          <h4>이렇게 말해 보세요</h4><ol class="steps">${scriptSteps(it.script || "").map(([k, t]) => `<li><span>${esc(k)}</span><p>${esc(t)}</p></li>`).join("")}</ol></div>` : ""}</li>`).join("")}</ul></section>`;
  }

  // ════════════════ 셸: 제목·검색·라우팅 ════════════════
  const PAGES = { calendar: "일정", today: "오늘", clients: "고객", client: "고객", market: "시장 이슈", outbox: "보낸 알림", insights: "성과", guide: "기준 안내", customer: "고객" };
  const ALIAS = { customer: "client", brief: "today", pbm: "clients", pb: "clients", overview: "clients", company: "insights", items: "guide" };
  function setupShell() {
    const dl = document.getElementById("custlist");
    dl.innerHTML = D.customers.map(c => `<option value="${esc(c.name)} · ${c.id}">`).join("");
    const box = document.getElementById("jump");
    const go = () => { const m = box.value.match(/([PC]\d{3,4})\s*$/i) || box.value.match(/^([PC]\d{3,4})$/i);
      const hit = m ? CUST[m[1].toUpperCase()] : D.customers.find(c => c.name === box.value.trim());
      if (hit) { if (!inView(hit.id)) { S.pbSel = "ALL"; save(); setupShell(); } location.hash = `#client/${hit.id}`; box.value = ""; box.blur(); } };
    box.onchange = go; box.onkeydown = e => e.key === "Enter" && go();
    const ps = document.getElementById("pbsel");
    ps.innerHTML = PB_LIST.map(p => `<option value="${p}" ${S.pbSel === p ? "selected" : ""}>${p} 담당 고객</option>`).join("") + `<option value="ALL" ${S.pbSel === "ALL" ? "selected" : ""}>전체 PB 고객</option>`;
    ps.onchange = () => { S.pbSel = ps.value; save(); render(); };
    document.getElementById("asof").innerHTML = `기준일 <b>${D.as_of}</b>${MK ? `<br>시장 ${MK.ref_date} 종가` : ""}`;
  }

  // ════════════════ 총자산 추이 (예수금·RP·달러 + 주식, 입출금 표시) ════════════════
  function assetChart(cid) {
    const det = D.details[cid], tr = det.trend, n = tr.cash.length;
    if (!n) return "";
    const cash = tr.cash.map((v, i) => v + tr.auto[i]), stock = det.stock || new Array(n).fill(0);
    const total = cash.map((v, i) => v + stock[i]);
    const W = 680, H = 230, L = 52, R = 10, T = 14, B = 26;
    const top = (() => { const mx = Math.max(1, ...total) * 1.12, st = niceStep(mx / 4); return Math.ceil(mx / st) * st; })(), step = niceStep(top / 4);
    const x = i => L + (W - L - R) * i / (n - 1), y = v => T + (H - T - B) * (1 - v / top);
    const start = new Date(tr.start + "T00:00:00"), dayIdx = d => Math.round((new Date(d + "T00:00:00") - start) / 864e5);
    let g = "";
    for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF1F5"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#8B95A1">${v.toLocaleString("ko-KR")}</text>`;
    for (let i = 0; i < n; i++) { const d = new Date(start.getTime() + i * 864e5); if (d.getDate() === 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#8B95A1">${d.getMonth() + 1}월</text>`; }
    const pts = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const base = `${x(n - 1)},${y(0)} ${x(0)},${y(0)}`;
    const cashArea = `<polygon fill="#3182F6" fill-opacity=".18" points="${pts(cash)} ${base}"/>`;
    const stockArea = det.stock ? `<polygon fill="#00B493" fill-opacity=".18" points="${pts(total)} ${cash.map((v, i) => `${x(n - 1 - i).toFixed(1)},${y(cash[n - 1 - i]).toFixed(1)}`).join(" ")}"/>` : "";
    const marks = (det.flows || []).map(f => { const i = dayIdx(f.d); if (i < 0 || i >= n) return "";
      const cx = x(i), cy = y(total[i]), up = !f.out, py = up ? cy - 10 : cy - 10;
      return `<g><title>${f.d} ${f.t} ${man(f.a)}</title><line x1="${cx}" x2="${cx}" y1="${cy}" y2="${py + (up ? 0 : 0)}" stroke="${up ? "#00A87E" : "#F04452"}" stroke-width="1.5"/>
        <path d="${up ? `M${cx - 5},${py} L${cx + 5},${py} L${cx},${py - 7} Z` : `M${cx - 5},${py - 7} L${cx + 5},${py - 7} L${cx},${py} Z`}" fill="${up ? "#00A87E" : "#F04452"}"/></g>`; }).join("");
    const hits = total.map((v, i) => { const d = new Date(start.getTime() + i * 864e5);
      return `<rect x="${(x(i) - (W - L - R) / n / 2).toFixed(1)}" y="${T}" width="${((W - L - R) / n).toFixed(2)}" height="${H - T - B}" fill="transparent"><title>${d.getMonth() + 1}/${d.getDate()} 총자산 ${man(v * 1e4)} · 예수금·RP ${man(cash[i] * 1e4)}${det.stock ? ` · 주식 ${man(stock[i] * 1e4)}` : ""}</title></rect>`; }).join("");
    const flows = (det.flows || []).slice().reverse();
    return `<div class="ac-legend"><span><i style="background:#3182F6"></i>예수금·RP·달러</span>${det.stock ? `<span><i style="background:#00B493"></i>주식</span>` : ""}<span><b style="color:#00A87E">▲</b> 입금</span><span><b style="color:#F04452">▼</b> 출금</span><span class="muted">그래프에 마우스를 올리면 날짜별 금액</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="area" role="img" aria-label="최근 6개월 총자산 추이">${g}${cashArea}${stockArea}
        <polyline fill="none" stroke="#191F28" stroke-width="2" points="${pts(total)}"/>${marks}${hits}</svg>
      ${flows.length ? `<h3>최근 입출금</h3><ul class="flows">${flows.slice(0, 6).map(f => `<li><span>${f.d.slice(5).replace("-", "/")}</span><b>${esc(f.t)}</b><em class="${f.out ? "out" : "in"}">${f.out ? "−" : "+"}${man(f.a)}</em></li>`).join("")}</ul>` : `<p class="fine left">최근 6개월 입출금이 없어요.</p>`}
      ${det.stock ? `<p class="fine left">주식은 지금 보유 수량을 기간 내내 가지고 있었다고 가정해 그날 종가로 계산했어요. 매수·매도 결제는 자산 안에서 옮겨 간 것이라 입출금에 넣지 않았어요.</p>` : ""}`;
  }

  // ════════════════ 일정: 전체 고객 달력 ════════════════
  const EV_KIND = {
    R2: ["해외주식 올해 마지막 매도일", "세금을 줄이려는 고객은 이날까지 매도해야 올해 결제돼요. 매도 권유가 아니라 일정 안내예요.", "s-due"],
    R3: ["유상증자 청약 마감", "청약하지 않으면 신주를 받지 못해요. 마감 전날까지 일정만 알려 주세요.", "s-move"],
    R4: ["펀드·ELS 만기", "상환금이 예수금으로 들어와요. 만기 전에 상환금 계획을 여쭤보세요.", "s-call"],
    R5: ["ISA 올해 납입 한도 기준일", "남은 한도는 이월되지만, 일찍 넣을수록 비과세로 투자하는 기간이 길어요. 원금 손실·예금자보호 미적용 안내와 함께.", "s-warn"],
    todo: ["PB 할 일 (통화 후속)", "통화에서 약속한 일이에요.", "s-todo"],
  };
  let calm = { month: null, day: null };
  function allEvents() {
    const ev = [];
    D.customers.filter(c => inView(c.id)).forEach(c => findingsOf(c.id).forEach(f => f.deadline && f.rule !== "R1" &&
      ev.push({ date: f.deadline, kind: f.rule, cid: c.id, label: f.rule === "R3" ? f.meta.stock : f.rule === "R4" ? f.meta.product_name : "", amt: f.rule === "R4" ? f.meta.expected : amountOf(f), amtLabel: SHORT[f.rule], f })));
    D.customers.filter(c => inView(c.id)).forEach(c => callsOf(c.id).forEach(cl => cl.todos.forEach((t, i) => t.due && !todoDone(cl, i) &&
      ev.push({ date: t.due, kind: "todo", cid: c.id, label: t.text, amt: 0 }))));
    return ev;
  }
  function pageCalendar() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ev = allEvents(), byDay = {};
    ev.forEach(e => (byDay[e.date] ||= []).push(e));
    const upcomingDays = Object.keys(byDay).filter(d => d >= ymd(today)).sort();
    if (!calm.day) calm.day = upcomingDays[0] || ymd(today);
    const base = calm.month || new Date(+calm.day.slice(0, 4), +calm.day.slice(5, 7) - 1, 1);
    const y = base.getFullYear(), m = base.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<div class="cd empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, list = byDay[key] || [];
      const kinds = {}; list.forEach(e => (kinds[e.kind] ||= new Set()).add(e.cid));
      const past = key < ymd(today);
      cells += `<button class="cd ${key === ymd(today) ? "today" : ""} ${key === calm.day ? "sel" : ""} ${past ? "past" : ""}" data-day="${key}">
        <span class="dn">${d}</span>${Object.entries(kinds).map(([k, s]) => `<span class="ev ${EV_KIND[k][2]}">${({ R2: "양도세", R3: "청약", R4: "만기", R5: "ISA", todo: "할 일" })[k]} ${s.size}</span>`).join("")}</button>`;
    }
    const sel = byDay[calm.day] || [];
    const groups = {};
    sel.forEach(e => { const k = e.kind + "|" + (e.kind === "todo" ? "" : e.label); (groups[k] ||= { kind: e.kind, label: e.label, items: [] }).items.push(e); });
    const dl = Math.round((new Date(calm.day + "T00:00:00") - today) / 864e5);
    const next14 = upcomingDays.filter(d => (new Date(d + "T00:00:00") - today) / 864e5 <= 14);

    $app.innerHTML = `<div class="pg">
      <div class="pg-head"><div><h1>일정</h1><p class="sub">모든 고객의 마감과 PB 할 일을 한 달력에서 봐요. 날짜를 누르면 누가 어떤 일정인지 나와요.</p></div></div>
      <div class="cal-wrap">
        <section class="panel calbig">
          <div class="cal-head"><button class="txt" data-mon="-1">‹</button><b>${y}년 ${m + 1}월</b><button class="txt" data-mon="1">›</button>
            <button class="ghost sm" data-today>오늘</button></div>
          <div class="cal-dow"><i>일</i><i>월</i><i>화</i><i>수</i><i>목</i><i>금</i><i>토</i></div>
          <div class="cal-cells">${cells}</div>
          <div class="cal-key">${Object.entries(EV_KIND).map(([k, v]) => `<span><i class="ev ${v[2]}"></i>${v[0]}</span>`).join("")}</div>
        </section>
        <section class="panel dayp">
          <p class="sub">${+calm.day.slice(5, 7)}월 ${+calm.day.slice(8)}일 ${"일월화수목금토"[new Date(calm.day + "T00:00:00").getDay()]}요일</p>
          <h2 class="dday">${dl === 0 ? "오늘" : dl > 0 ? `D-${dl}` : `${-dl}일 지남`} <small>${sel.length ? `${new Set(sel.map(e => e.cid)).size}명 · ${sel.length}건` : "일정 없음"}</small></h2>
          ${Object.values(groups).map(gp => `<div class="grp"><div class="grp-h"><span class="ev ${EV_KIND[gp.kind][2]}"></span><b>${EV_KIND[gp.kind][0]}${gp.label && gp.kind !== "todo" && gp.kind !== "R4" ? ` · ${esc(gp.label)}` : ""}</b><small>${gp.items.length}명</small></div>
            <p class="grp-tip">${EV_KIND[gp.kind][1]}${dl > 7 ? ` D-7(${(d => `${d.getMonth() + 1}/${d.getDate()}`)(new Date(new Date(calm.day + "T00:00:00").getTime() - 7 * 864e5))})에 고객 안내 알림이 한 번 더 나가요.` : ""}</p>
            <ul class="rows compact">${gp.items.sort((a, b) => b.amt - a.amt).map(e => { const c = CUST[e.cid]; return `<li><a href="#client/${e.cid}"><span class="ava sm">${esc(c.name.slice(0, 1))}</span>
              <span class="who"><b>${esc(c.name)}</b><small>${c.age}세 · ${e.cid}</small><i>${esc(e.kind === "todo" ? e.label : e.kind === "R4" ? e.label : todo(e.f))}</i></span><span></span>
              <span class="amt">${e.amt ? `<b>${e.kind === "R4" ? "" : "+"}${man(e.amt)}</b><small>${esc(e.amtLabel)}</small>` : ""}</span><span class="go">›</span></a></li>`; }).join("")}</ul></div>`).join("") || `<p class="sub">이날은 일정이 없어요.</p>`}
          ${next14.length ? `<h3>앞으로 14일</h3><ul class="nx">${next14.map(d => { const l = byDay[d]; return `<li><button data-day="${d}" class="${d === calm.day ? "on" : ""}"><b>${+d.slice(5, 7)}/${+d.slice(8)}</b><span>${[...new Set(l.map(e => EV_KIND[e.kind][0]))].join(" · ")}</span><em>${new Set(l.map(e => e.cid)).size}명</em></button></li>`; }).join("")}</ul>` : ""}
        </section>
      </div></div>`;
    $app.querySelectorAll("[data-day]").forEach(b => (b.onclick = () => { calm.day = b.dataset.day; calm.month = new Date(+calm.day.slice(0, 4), +calm.day.slice(5, 7) - 1, 1); pageCalendar(); }));
    $app.querySelectorAll("[data-mon]").forEach(b => (b.onclick = () => { calm.month = new Date(y, m + +b.dataset.mon, 1); pageCalendar(); }));
    $app.querySelector("[data-today]").onclick = () => { calm = { month: null, day: ymd(today) }; pageCalendar(); };
  }

  function pagePbHome() {
    const all = pbCustomers();
    const today = all.filter(r => r.calls.length).sort((a, b) => a.rank - b.rank);
    const soon = all.filter(r => r.soon !== null && r.soon <= 7).sort((a, b) => a.soon - b.soon);
    const every = all.slice().sort((a, b) => amountOf(b.lead) - amountOf(a.lead));
    const market = marketCustomers();
    const isMk = pbm.tab === "market";
    const lists = { today, soon, all: every };
    const q = pbm.q;
    const rows = isMk ? market.filter(r => !q || (r.cid + r.c.name).includes(q))
      : lists[pbm.tab].filter(r => !q || (r.c.id + r.c.name).includes(q));
    const idOf = r => isMk ? r.cid : r.c.id;
    if (!pbm.cid || !rows.find(r => idOf(r) === pbm.cid)) { pbm.cid = rows[0] && idOf(rows[0]); pbm.fid = null; }
    const sel = rows.find(r => idOf(r) === pbm.cid);
    const doneCount = today.filter(r => S.pb[r.c.id]).length;

    $app.innerHTML = `<div class="pbm ${pbm.sheet ? "sheet-open" : ""}">
      <h1>오늘 연락할 고객 ${today.length}명</h1>
      <p class="sub">${doneCount ? `${doneCount}명 처리했어요 · ` : ""}누구에게 무엇을 말할지 금액·근거·통화 스크립트까지 준비해 뒀어요</p>
      <div class="pbm-stats">
        <div><span>오늘 연락</span><b>${today.length}명</b></div>
        <div><span>시장 이슈 (${MK ? MK.ref_date.slice(5).replace("-", "/") : "-"})</span><b>${market.length}명</b></div>
        <div><span>고객들이 놓치는 1년 RP 이자</span><b>${man(every.reduce((s, r) => s + r.interest, 0))}</b></div>
      </div>
      ${isMk ? marketStrip() + creditSummary() : ""}
      <div class="pbm-tools">
        <div class="seg" role="tablist">${[["today", "오늘 연락", today.length], ["market", "시장 이슈", market.length], ["soon", "마감 임박", soon.length], ["all", "전체 고객", every.length]]
          .map(([k, t, n]) => `<button role="tab" class="${pbm.tab === k ? "on" : ""}" data-tab="${k}">${t} <em>${n}</em></button>`).join("")}</div>
        <input class="pill" type="search" id="pbq" placeholder="이름이나 고객번호로 찾기" value="${esc(q)}">
      </div>
      <div class="pbm-body">
        <ul class="pbm-list">${rows.map(isMk ? marketRow : pbRow).join("") || `<li class="empty">${isMk ? "오늘은 크게 움직인 보유 종목이 없어요" : "해당하는 고객이 없어요"}</li>`}</ul>
        <section class="pbm-detail">${sel ? (isMk ? marketDetail(sel) : pbDetail(sel)) : `<p class="sub">왼쪽에서 고객을 고르세요</p>`}</section>
      </div></div>`;

    $app.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => { pbm.tab = b.dataset.tab; pbm.cid = null; pagePbHome(); }));
    const input = $app.querySelector("#pbq");
    input.oninput = () => { pbm.q = input.value.trim(); pagePbHome(); const n = $app.querySelector("#pbq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $app.querySelectorAll("[data-cid]").forEach(li => (li.onclick = () => { pbm.cid = li.dataset.cid; pbm.fid = null; pbm.sheet = true; pagePbHome(); }));
    $app.querySelectorAll("[data-fid]").forEach(li => (li.onclick = () => { pbm.fid = li.dataset.fid; pagePbHome(); }));
    $app.querySelectorAll("[data-st]").forEach(b => (b.onclick = () => {
      const topic = ($app.querySelector(".pbm-detail .todo b") || {}).textContent || "";
      addLog(pbm.cid, b.dataset.st, topic, ($app.querySelector("#pbmemo") || {}).value);
      S.pb[(isMk ? "m:" : "") + pbm.cid] = b.dataset.st; save(); toast(`${PB_STATUS[b.dataset.st]}으로 기록했어요`); pagePbHome();
    }));
    const back = $app.querySelector("[data-back]");
    if (back) back.onclick = () => { pbm.sheet = false; pagePbHome(); };
    const undo = $app.querySelector("[data-undo]");
    if (undo) undo.onclick = () => { delete S.pb[(isMk ? "m:" : "") + pbm.cid]; save(); pagePbHome(); };
  }

  function pbRow(r) {
    const st = S.pb[r.c.id], f = r.lead, dl = f.deadline ? daysLeft(f.deadline) : null;
    return `<li class="${r.c.id === pbm.cid ? "on" : ""} ${st ? "done" : ""}" data-cid="${r.c.id}">
      <span class="ava">${esc(r.c.name.slice(0, 1))}</span>
      <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세</small><i>${esc(st ? PB_STATUS[st] : headline(f))}</i></span>
      <span class="amt"><b>${amtText(f)}</b><small class="${dl !== null && dl <= 7 ? "due" : ""}">${dl !== null && dl <= 7 ? `D-${dl} · ` : ""}${SHORT[f.rule]}${r.fs.length > 1 ? ` 외 ${r.fs.length - 1}` : ""}</small></span></li>`;
  }

  function pbDetail(r) {
    const c = r.c, fs = r.fs;
    const f = fs.find(x => x.finding_id === pbm.fid) || r.lead;
    const st = S.pb[c.id];
    const consent = c.consent_push || c.consent_kakao;
    const facts = [`${c.age}세`, c.risk, consent ? "광고 수신 동의" : "광고 미동의 · PB 연락만 가능"];
    const pb = PB_BY_FID[f.finding_id];
    return `<button class="back" data-back>← 목록</button>
      <div class="who-big"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
        <div><h2>${esc(c.name)}님</h2><p class="sub">${facts.map(esc).join(" · ")}</p></div></div>
      <div class="todo"><span>오늘 할 일</span><b>${esc(todo(f))}</b><p>${esc(headline(f))}</p></div>
      ${st ? `<div class="state">${PB_STATUS[st]} <button class="txt" data-undo>되돌리기</button></div>` : ""}

      <h3>고객이 받을 수 있는 돈</h3>
      <ul class="items">${fs.map(x => `<li class="${x.finding_id === f.finding_id ? "on" : ""}" data-fid="${esc(x.finding_id)}">
        <span><b>${esc(headline(x))}</b><small>${SHORT[x.rule]}${x.deadline ? ` · 마감 D-${daysLeft(x.deadline)}` : ""}</small></span>
        <em>${amtText(x)}</em></li>`).join("")}</ul>

      <h3>이렇게 말해 보세요</h3>
      <ol class="steps">${scriptSteps(f.script).map(([k, t]) => `<li><span>${esc(k)}</span><p>${esc(t)}</p></li>`).join("")}</ol>

      <details class="why"><summary>왜 이 고객인가요?</summary>
        ${pb ? `<p class="sub">${esc(pb.reasons.join(" · "))}</p>` : ""}
        <ul>${f.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>

      <h3>최근 연락</h3>${logList(logsOf(c.id).slice(0, 2), false)}
      <div class="acts">
        <textarea id="pbmemo" class="memo" rows="2" placeholder="통화 메모 (선택) · 연락 기록에 함께 쌓여요"></textarea>
        <button class="cta" data-st="called">통화 완료</button>
        <div class="row three"><button class="ghost" data-st="no_answer">부재중</button><button class="ghost" data-st="joined">고객이 직접 가입함</button><button class="ghost" data-st="later">나중에</button></div>
        <a class="link" href="#client/${c.id}">고객 전체 보기 ›</a>
        <p class="fine">PB는 고객 대신 가입하지 않아요. 가입은 고객이 앱에서 본인 인증 후 직접 해요. 처리 기록은 이 브라우저에만 저장돼요.</p>
      </div>`;
  }

  // ════════════════ ⑤ 알림 미리보기 ════════════════
  let obF = "", obSel = null;
  function pageOutbox() {
    const all = D.outbox.slice().sort((a, b) => b.at.localeCompare(a.at));
    const view = all.filter(r => !obF || (obF === "held" ? r.status === "held" : obF === "ad" ? r.msg_type === "ad" : obF === "pb" ? r.channel === "pb_queue" : r.cid === obF));
    if (!obSel || !view.find(r => r.id === obSel)) obSel = view[0] && view[0].id;
    const sel = all.find(r => r.id === obSel);
    $app.innerHTML = `<h1>보낸 알림</h1>
      <p class="lead">최근 30일 동안 매일 배치를 돌려 만든 발송함입니다. 실제로 보내지 않고, 수신 동의·야간 제한(21시~8시)·주 1회 빈도 제한·중복 방지를 적용한 결과만 쌓습니다.</p>
      <div class="filters">${[["", "전체"], ["held", "보류된 것만"], ["ad", "광고성만"], ["pb", "PB 통화만"], ["P002", "P002 상환금"], ["P003", "P003 장기방치"]].map(([k, t]) => `<button class="chip ${obF === k ? "on" : ""}" data-f="${k}">${t}</button>`).join("")}
        <span class="muted">${view.length.toLocaleString("ko-KR")}건</span></div>
      <div class="split"><div class="tablewrap"><table><thead><tr><th>예정 시각</th><th>고객</th><th>알림</th><th>채널</th><th>성격</th><th>상태</th><th>보류 사유</th></tr></thead>
        <tbody>${view.map(r => `<tr class="click ${r.id === obSel ? "sel" : ""}" data-id="${esc(r.id)}"><td class="small">${r.at}</td><td>${r.cid} ${esc(CUST[r.cid].name)}</td>
          <td class="small">${esc(TRIG[r.trigger] || r.trigger)}</td><td class="small">${chName(r)}</td><td class="small">${r.msg_type === "ad" ? badge("광고성", "accent") : "정보성"}</td>
          <td class="small">${ST[r.status] || r.status}</td><td class="small">${esc(holdLabel(r.hold))}</td></tr>`).join("")}</tbody></table></div>
      <div>${sel ? `<div class="card"><div class="pv-label">${sel.cid} ${esc(CUST[sel.cid].name)} · ${esc(TRIG[sel.trigger] || sel.trigger)}</div>
        ${badge(chName(sel))}${badge(MT[sel.msg_type], sel.msg_type === "ad" ? "accent" : "")}${sel.hold ? badge(holdLabel(sel.hold), "warn") : ""}
        <p class="muted small">예정 ${sel.at}${sel.msg_type === "ad" && sel.channel !== "pb_queue" ? " · 광고성은 제목 앞에 (광고) 표기" : ""}</p>
        ${sel.channel === "pb_queue" ? `<div class="pv-label">${esc(sel.title)}</div>` : ""}${phone({ ...sel })}</div>` : ""}</div></div>`;
    $app.querySelectorAll("[data-f]").forEach(b => (b.onclick = () => { obF = b.dataset.f; obSel = null; pageOutbox(); }));
    $app.querySelectorAll("tr[data-id]").forEach(tr => (tr.onclick = () => { obSel = tr.dataset.id; pageOutbox(); }));
  }

  // ════════════════ ⑥ 회사 대시보드 ════════════════
  function pageCompany() {
    const all = D.customers.flatMap(c => D.details[c.id].findings);
    const r1 = all.filter(f => f.rule === "R1"), items = all.filter(f => f.rule !== "R1");
    const group = (fs, val) => { const g = {}; fs.forEach(f => { (g[f.subtype_label] ||= { n: new Set(), v: 0, a: 0, idle: 0 }); const x = g[f.subtype_label]; x.n.add(f.customer_id); x.v += f.amount_krw; x.a += f.annual_projection_krw; x.idle += (f.meta.idle_krw || 0); }); return Object.entries(g).sort((a, b) => b[1][val] - a[1][val]); };
    const g1 = group(r1, "a"), g2 = group(items, "v");
    const { cash, auto } = D.company, util = auto / (cash + auto);
    const sent = ["sent_sim", "opened_sim", "executed_sim"];
    const fun = ["push", "kakao", "monthly_report"].map(ch => { const d = D.outbox.filter(r => r.channel === ch); return [CH[ch], d.length, d.filter(r => sent.includes(r.status)).length, d.filter(r => ["opened_sim", "executed_sim"].includes(r.status)).length, d.filter(r => r.status === "executed_sim").length]; });
    const tot = [1, 2, 3, 4].map(i => fun.reduce((s, r) => s + r[i], 0));
    const holds = {}; D.outbox.forEach(r => { if (r.hold) { const k = holdLabel(r.hold.split(":")[0]); holds[k] = (holds[k] || 0) + 1; } });
    const foundSum = D.customers.reduce((s, c) => s + (c.found ? c.found.found_krw : 0), 0);
    $app.innerHTML = `<h1>성과</h1>
      <p class="lead">가상 고객 300명 기준으로, 얼마나 많은 돈이 쉬고 있고 알림이 실행까지 얼마나 이어지는지 봅니다.</p>
      <div class="metrics">
        <div class="metric"><div class="k">예수금 활용률 (자동 RP ÷ 예수금+자동 RP)</div><div class="v">${(util * 100).toFixed(1)}%</div></div>
        <div class="metric"><div class="k">쉬는 돈이 있는 고객</div><div class="v">${new Set(r1.map(f => f.customer_id)).size}명</div></div>
        <div class="metric"><div class="k">지난 90일 놓친 이자 (합계)</div><div class="v accent">${man(r1.reduce((s, f) => s + f.amount_krw, 0))}</div></div>
        <div class="metric"><div class="k">깨우면 1년에 더 받을 이자 (합계)</div><div class="v">${man(r1.reduce((s, f) => s + f.annual_projection_krw, 0))}</div></div></div>
      <p class="muted">쉬는 돈 합계 ${man(r1.reduce((s, f) => s + f.meta.idle_krw, 0))} · 예수금 자동 RP 이용 ${D.customers.filter(c => c.found).length}명이 깨운 뒤 받은 이자 ${man(foundSum)} · 예수금 ${man(cash)}, 자동 RP ${man(auto)}</p>
      <h2>유형별 — 깨우면 1년에 더 받을 이자</h2>
      <div class="split"><div class="card">${bars(g1.map(([k, x]) => [k, x.a]), man)}</div>
        <div class="tablewrap"><table><thead><tr><th>유형</th><th class="num">고객 수</th><th class="num">90일 놓친 이자</th><th class="num">1년 더 받을 이자</th><th class="num">쉬는 돈</th></tr></thead>
        <tbody>${g1.map(([k, x]) => `<tr><td>${k}</td><td class="num">${x.n.size}명</td><td class="num">${man(x.v)}</td><td class="num">${man(x.a)}</td><td class="num">${man(x.idle)}</td></tr>`).join("")}</tbody></table></div></div>
      <h2>함께 챙길 항목 — 세금·권리·만기·ISA</h2>
      <div class="split"><div class="card">${bars(g2.map(([k, x]) => [k, x.v]), man, "var(--s-auto)")}</div>
        <div class="tablewrap"><table><thead><tr><th>항목</th><th class="num">고객 수</th><th class="num">금액 합계</th></tr></thead>
        <tbody>${g2.map(([k, x]) => `<tr><td>${k}</td><td class="num">${x.n.size}명</td><td class="num">${man(x.v)}</td></tr>`).join("")}</tbody></table></div></div>
      <h2>알림 퍼널 (최근 30일, 시뮬레이션)</h2>
      <div class="split"><div class="card">${bars([["1. 생성", tot[0]], ["2. 발송", tot[1]], ["3. 열람", tot[2]], ["4. 실행", tot[3]]], v => v.toLocaleString("ko-KR") + "건")}
        <p class="muted small">발송 대비 열람 ${tot[1] ? Math.round(tot[2] / tot[1] * 100) : 0}% · 실행 ${tot[1] ? Math.round(tot[3] / tot[1] * 100) : 0}% · PB 통화로 넘어간 ${D.outbox.filter(r => r.channel === "pb_queue").length}건은 제외</p></div>
        <div class="tablewrap"><table><thead><tr><th>채널</th><th class="num">생성</th><th class="num">발송</th><th class="num">열람</th><th class="num">실행</th></tr></thead>
        <tbody>${fun.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map(v => `<td class="num">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
      <h2>보류·변경 사유</h2>
      <div class="card">${bars(Object.entries(holds).sort((a, b) => b[1] - a[1]), v => v + "건", "var(--s-idle)")}
        <p class="muted small">광고 동의 없음은 PB 통화로 돌린 건, 야간은 다음 날 오전으로 미룬 건, 빈도 제한은 다음 주로 이월한 건입니다.</p></div>`;
  }

  // ── 라우팅 ──
  // ════════════════ 담당 PB 보기 · 오늘 할 일 상태 ════════════════
  const inView = cid => S.pbSel === "ALL" || (CUST[cid] && CUST[cid].pb === S.pbSel);
  if (!S.pbSel) S.pbSel = "PB01";
  if (!S.task || typeof S.task !== "object") S.task = {};
  const todayKey = () => ymd(new Date());
  const taskState = cid => (S.task[todayKey()] || {})[cid] || null;          // done | later | null
  function setTask(cid, st) { const k = todayKey(); (S.task[k] ||= {}); if (st) S.task[k][cid] = st; else delete S.task[k][cid]; save(); }

  // ── 마지막 연락 (통화·미팅): 예수금 방치처럼 '연락 없음'도 관리 척도 ──
  // 기본값은 데모용 가상 날짜(export), PB가 [통화 완료]/[미팅 완료]를 누르면 오늘로 바뀐다 (보는 사람 브라우저에 저장).
  // 실서비스 목표: 데스크 키폰 연동으로 통화를 자동 인식 → 기록·요약·할 일까지 자동.
  if (!S.contact || typeof S.contact !== "object") S.contact = {};
  function lastContact(cid) {
    const cands = [];
    const base = CUST[cid].last_contact; if (base) cands.push({ date: base.date, kind: base.kind });
    const c0 = callsOf(cid)[0]; if (c0) cands.push({ date: String(c0.ai ? (c0.result.call_date || c0.at) : c0.at).slice(0, 10), kind: "통화" });
    const mine = S.contact[cid]; if (mine) cands.push({ ...mine, mine: true });
    if (!cands.length) return null;
    const best = cands.sort((a, b) => b.date.localeCompare(a.date))[0];
    const days = Math.max(0, Math.round((new Date(todayKey() + "T00:00:00") - new Date(best.date + "T00:00:00")) / 864e5));
    return { ...best, days, level: days >= CARE.quiet ? "bad" : days >= 30 ? "mid" : "ok" };
  }
  // 프로필 머리 오른쪽: 연락 일수를 크게
  function contactBadge(cid) {
    const lc = lastContact(cid), today = lc && lc.mine && lc.days === 0;
    const big = !lc ? "기록 없음" : lc.days === 0 ? "오늘" : `${lc.days}일째`;
    const sub = !lc ? "연락 기록이 없어요" : lc.days === 0 ? `${lc.kind} 완료` : `연락 없음 · 마지막 ${lc.kind} ${lc.date.slice(5).replace("-", "/")}`;
    return `<div class="cbadge lv-${lc ? lc.level : "bad"}"><div class="cb-num"><b>${big}</b><small>${esc(sub)}</small></div>
      <div class="cb-acts">${today ? `<button class="txt" data-contact="undo">되돌리기</button>` : `<button class="ghost sm" data-contact="통화">통화 완료</button><button class="ghost sm" data-contact="미팅">미팅 완료</button>`}</div></div>`;
  }
  // 핵심 숫자: 총자산 · 예수금(쉬는 돈) · 주식(하루 변동) · 신용 · 더 받을 수 있는 돈
  function clientKpis(cid, { total, krw, usdB, pos, stock, loan, credit }) {
    const r1 = findingsOf(cid).find(f => f.rule === "R1" && f.currency === "KRW");
    const day = pos.reduce((s, p) => s + p.day_delta_krw, 0);
    const extra = findingsOf(cid).filter(f => f.rule !== "R4").reduce((s, f) => s + amountOf(f), 0);
    const worst = credit.filter(b => b.kind !== "margin_safe").sort((a, b) => a.room - b.room)[0];
    const k = [["총자산", man(total), ""],
      ["원화 예수금", man(krw.cash), r1 ? `<em class="warn">쉬는 돈 ${man(r1.meta.idle_krw)} · ${r1.meta.streak}일째</em>` : foundOf(cid) ? "예수금 자동 RP 이용 중" : ""]];
    if (usdB) k.push(["달러", usd(usdB.cash), ""]);
    k.push(["주식", pos.length ? man(stock) : "–", pos.length ? `어제 <span class="${day < 0 ? "dn" : "up"}">${day < 0 ? "−" : "+"}${man(Math.abs(day))}</span>` : ""]);
    if (loan) k.push(["신용", man(loan), worst ? `<em class="bad">${esc(STAGE[worst.kind][0])} · ${esc(worst.name)}</em>` : "안전"]);
    if (extra) k.push(["더 받을 수 있는 돈", `+${man(extra)}`, "1년 RP 이자·세금 등"]);
    return k.map(([t, v, s]) => `<div><span>${t}</span><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`).join("");
  }
  // 꼭 알아야 할 것: 위험·마감·쉬는 돈(엔진 순서) → 고객과 약속한 일 → 지난 통화 → 주의할 점. 최대 5개
  function mustKnow(cid, items, openTodos, last, consent) {
    const out = items.slice(0, 3).map(it => ({ tag: it.tag, cls: it.cls, t: it.title, d: it.todo }));
    openTodos.slice(0, 1).forEach(t => out.push({ tag: t.due ? `약속 D-${Math.max(0, daysLeft(t.due))}` : "약속", cls: "s-due", t: t.text, d: "지난 통화에서 고객과 약속한 일" }));
    if (last) { const r = last.ai ? last.result : last; const h = r.headline || r.summary || "";
      if (h) out.push({ tag: "지난 통화", cls: "s-info", t: String(h).split(/(?<=다\.)\s/)[0], d: String(last.ai ? (r.call_date || last.at) : last.at).slice(0, 10) }); }
    if (!consent.length) out.push({ tag: "주의", cls: "s-info", t: "광고 수신 동의가 없어요", d: "상품 안내는 문자·알림 대신 전화로만" });
    if (!out.length) return "";
    return `<section class="must"><h2>그 밖에 알아야 할 것</h2><ol>${out.slice(0, 5).map(o => `<li><span class="tag ${o.cls}">${esc(o.tag)}</span><div><b>${esc(o.t)}</b><small>${esc(o.d)}</small></div></li>`).join("")}</ol></section>`;
  }

  const PB_LIST = [...new Set(D.customers.map(c => c.pb))].sort();

  // 할 일 묶음: 지금 바로(시장·반대매매) / 오늘 중 / 이번 주 / 시간 날 때(관리 필요)
  const GROUPS = [["now", "지금 바로", "반대매매 위험·보유 종목 큰 등락"], ["today", "오늘 중", "마감 임박·상환금 입금 다음 날"],
    ["week", "이번 주", "마감 7일 안·담보 주의·쉬는 상환금"], ["later", "시간 날 때", "예수금이 오래 그대로인 고객"]];
  function taskGroup(cid) {
    const mk = MK ? MK.alerts.filter(a => a.customer_id === cid) : [];
    if (mk.some(a => a.kind === "margin_call" || a.kind === "margin_warn" || a.kind === "big_move")) return "now";
    const u = urgency(cid);
    if (u === "today") return "today";
    if (u === "week") return "week";
    if (careInfo(cid)) return "later";
    return null;
  }
  function myTasks() {
    return D.customers.filter(c => inView(c.id)).map(c => ({ c, g: taskGroup(c.id) })).filter(t => t.g)
      .map(t => ({ ...t, item: contactItems(t.c.id)[0], n: contactItems(t.c.id).length, st: taskState(t.c.id) }))
      .sort((a, b) => GROUPS.findIndex(g => g[0] === a.g) - GROUPS.findIndex(g => g[0] === b.g) || rankOf({ c: a.c, rank: 0 }) - rankOf({ c: b.c, rank: 0 }));
  }
  // 통화 문구에서 핵심 세 줄: 꼭 말할 숫자 / 이유·제안 / 물어볼 것
  function keyLines(script) {
    const st = scriptSteps(script || ""), pick = labels => (st.find(([k]) => labels.includes(k)) || [])[1];
    return [["꼭 말할 것", pick(["사실", "근거"])], ["이유·제안", pick(["이유", "제안", "안내"])], ["물어볼 것", pick(["확인"])]].filter(x => x[1]);
  }
  function callNow(cid) { toast(`데모라 실제로 전화를 걸지 않아요 · ${CUST[cid].name}님`); }

  // ════════════════ 고객 이야기 (조은식 고객이 겪는 순간을 시간 순서로) ════════════════
  // 고객이 받은 카톡 → 앱 화면 → 예전에는 어땠나 → (작게) 그 뒤에서 PB가 한 일. 숫자·문구는 전부 실제 데이터(kakao_test·통화 분석)에서
  function pageStory() {
    const cid = "T001", c = CUST[cid];
    if (!c) { $app.innerHTML = `<div class="pg"><p class="sub">테스트 고객 데이터가 없어요.</p></div>`; return; }
    const kt = (D.details[cid].kakao_test || []), msg = t => kt.find(p => p.trigger === t);
    const fs = findingsOf(cid), r1 = fs.find(f => f.rule === "R1"), r5 = fs.find(f => f.rule === "R5");
    const ev = r1 && r1.meta.event, call = callsOf(cid).find(x => x.ai), promises = call && call.result.customer_promises;
    const pos = MK ? MK.positions.filter(p => p.customer_id === cid) : [], big = pos.find(p => Math.abs(p.chg_pct) >= MK.big_move_pct);
    const D0 = s => new Date(s + "T00:00:00"), addD = (s, n) => ymd(new Date(D0(s).getTime() + n * 864e5));
    const md = s => `${D0(s).getMonth() + 1}/${D0(s).getDate()}(${"일월화수목금토"[D0(s).getDay()]})`;
    const sheet = p => ({ T_EVENT: `why:${p.fid}`, T_IDLE_FIRST: `why:${p.fid}`, T_IDLE_UPDATE: `buy:${p.fid}`, T_ISA: `item:${p.fid}`,
      T_MOVE: `move:${p.sym}` }[p.trigger]);
    const bubble = p => {
      if (!p) return "";
      const lines = p.body.split("\n"), body = (lines[0].startsWith("[유진투자증권]") ? lines.slice(2) : lines).join("\n");
      return `<div class="kk"><div class="kk-head"><span class="kk-ico">유진</span><b>${p.msg_type === "ad" ? "브랜드 메시지" : "알림톡"}</b><small>유진투자증권</small></div>
        <div class="kk-bubble"><p class="kk-title">${esc(p.title)}</p><p class="kk-body">${esc(body)}</p>
        <a class="kk-btn" href="app.html?c=${cid}&s=${encodeURIComponent(sheet(p))}" target="_blank" rel="noopener">앱에서 확인하기</a></div></div>`;
    };
    const rp = r1 ? { amt: r1.recommendation.suggest_amount, prod: D.products[r1.recommendation.product_id] } : null;
    const yearAt = r => rp.amt * r, monthAt = r => rp.amt * r * 30 / 365;
    const calcHtml = () => `<div class="st-calc"><p class="st-calc-t">${man(rp.amt)}을 1년 두면</p>
      <div class="sc-row"><span>예수금 그대로 <small>이용료 연 ${pct(D.rates.deposit)}</small></span><i style="width:${D.rates.deposit / rp.prod.rate * 100}%"></i><b>약 ${man(yearAt(D.rates.deposit))}</b></div>
      <div class="sc-row on"><span>${esc(rp.prod.name)}에 맡기면 <small>연 ${pct(rp.prod.rate)} · 세전, 변동</small></span><i style="width:100%"></i><b>약 ${man(yearAt(rp.prod.rate))}</b></div>
      <p class="sc-diff">차이 <b>+${man(r1.annual_projection_krw)}</b> · 이미 쉰 ${r1.meta.streak}일 동안 못 받은 이자 약 ${man(r1.amount_krw)}</p>
      <p class="sc-note">RP는 예금자보호 대상이 아니고, 수시 RP 금리는 바뀔 수 있어요.</p></div>`;
    const earnHtml = () => `<div class="st-calc earn"><p class="st-calc-t">한 달 뒤 고객 앱 (예시)</p>
      <p class="sc-big">+${man(monthAt(rp.prod.rate))}</p><p class="sc-sub">깨운 뒤 받은 이자 (30일) · 예수금으로 뒀다면 약 ${man(monthAt(D.rates.deposit))}</p>
      <p class="sc-note">${man(rp.amt)}을 ${esc(rp.prod.name)} 연 ${pct(rp.prod.rate)}로 맡겼다고 가정한 예시예요.</p></div>`;
    const steps = [
      ev && { date: md(addD(ev.date, 1)), tag: "입금 다음 날", title: `${EVENT_LBL[ev.flow_type] || "상환금"} ${man(ev.amount)}이 들어온 다음 날, 먼저 알려 줘요`,
        msg: msg("T_EVENT"), before: "상환금이 들어온 걸 따로 확인하지 않으면, 이자가 거의 없는 예수금으로 그냥 남아 있어요.",
        behind: "PB '오늘 할 일'에 '상환금 입금 다음 날'로 올라가요." },
      r1 && { date: "같은 주", tag: `원래 있던 돈은 ${r1.meta.streak}일째`, title: `원래 쉬던 돈까지 합쳐 ${man(r1.meta.idle_krw)}이 쉬고 있다고, 못 받은 이자와 함께 알려 줘요`,
        msg: msg("T_IDLE_FIRST"), before: `상환금 말고도 몇 달째 그대로인 돈이 있었지만, ${r1.amount_label.replace("놓친 이자", "")}얼마를 못 받았는지 아무도 알려 주지 않았어요.`,
        behind: "평소 하루에 쓰는 돈은 남겨 두고, 진짜로 쉬는 돈만 계산해요." },
      r1 && { date: "그다음 주", tag: "핵심 · 쉬는 돈 깨우기", key: true, title: `쉬는 ${man(rp.amt)}을 RP에 맡기면 1년에 약 ${man(r1.annual_projection_krw)}을 더 받아요`,
        msg: msg("T_IDLE_UPDATE"), calc: true, before: "예수금으로 두면 이용료(연 " + pct(D.rates.deposit) + ")만 붙는데, 얼마나 손해인지 몰랐어요. 상품을 찾아 메뉴를 헤매거나 지점에 전화해야 했고요.",
        behind: "평소 쓰는 돈은 남기고 쉬는 돈만 계산해 금액까지 제안해요. 광고는 동의한 고객에게만, 주 1건까지. 가입은 고객이 앱에서 직접 해요." },
      r1 && { date: "맡긴 뒤 매달", tag: "예시", key: true, title: "맡긴 뒤에는, 깨운 돈이 이자를 얼마나 벌었는지 매달 알려 줘요",
        earn: true, before: "RP에 넣어 둔 돈이 얼마를 벌었는지 따로 찾아보지 않으면 알 수 없었어요.",
        behind: "매월 1일 '깨운 뒤 받은 이자' 알림. 출금하거나 주식을 사면 RP에서 자동으로 빠져요(예수금 자동 RP)." },
      r5 && { date: "연말 전", tag: `ISA 남은 한도 ${man(r5.meta.remain)}`, title: `ISA 비과세 한도로 세금을 최대 약 ${man(r5.amount_krw)} 아낄 수 있다고 알려 줘요`,
        msg: msg("T_ISA"), before: "ISA 한도가 남은 줄 모르고, 일반 계좌에서 이자·배당 세금을 그대로 냈어요.",
        behind: "연말 전에 한 번 더 알려요. 입금과 상품 선택은 고객이 앱에서 직접 해요." },
      big && { date: md(addD(big.trade_date, 1)) + " 아침", tag: "시장 급락", title: `${big.name}가 하루 ${pctTxt(big.chg_pct)} 움직인 다음 날 아침, 내 계좌 기준으로 알려 줘요`,
        msg: msg("T_MOVE"), before: "뉴스로 '폭락' 소식만 보고, 내 계좌가 어떻게 됐는지는 앱을 열어 직접 찾아봐야 했어요.",
        behind: "같은 시각 PB 화면 '지금 바로'에 이 고객과 등락 이유·통화 문구가 올라가요." },
      call && { date: md(call.result.call_date), tag: "고객이 PB에게 전화", title: "전화를 받은 PB는 이미 고객 상황을 다 알고 있어요",
        quote: call.result.headline, before: "PB가 계좌를 하나씩 열어 보며 상황을 파악하느라, 상담이 길어지고 놓치는 게 생겼어요.",
        behind: `쉬는 상환금·보유 손실·ISA 한도가 한 화면에. 통화가 끝나면 녹음 요약과 할 일 ${call.todos.length}건이 일정에 들어가요.` },
      promises && { date: promises.filter(n => n.date).map(n => md(n.date)).join(" · "), tag: "약속한 날", title: "약속한 날, 약속한 대로",
        list: promises, before: "PB가 바쁘면 '알아봐 드릴게요'가 흐지부지되기도 했어요.",
        behind: "통화에서 나온 약속은 PB '일정'에 들어가 그날 '오늘 할 일'로 떠요." },
    ].filter(Boolean);
    const extraYear = fs.filter(f => f.rule === "R1").reduce((s, f) => s + f.annual_projection_krw, 0) + fs.filter(f => f.rule !== "R1").reduce((s, f) => s + f.amount_krw, 0);
    $app.innerHTML = `<div class="pg story">
      <div class="st-hero"><p class="st-kicker">고객 이야기</p>
        <h1>${esc(c.name)}님이 필요한 순간마다<br><span class="hl">먼저 연락이 왔어요.</span></h1>
        <p class="sub">${c.age}세 · ${esc(c.risk)} · 예수금 ${r1 ? man(r1.meta.cash_today) : ""}(그중 ELS 상환금 ${ev ? man(ev.amount) : ""})이 쉬고 있고, 주식은 손실 중이고, 연말 세액공제 한도도 남아 있는 고객.<br>
          고객이 겪는 순간을 시간 순서로 따라가 봐요. 각 카톡의 버튼을 누르면 고객이 보게 될 앱 화면이 열려요.</p></div>
      <div class="st-kpis">
        ${rp ? `<div class="hi"><small>쉬는 돈 깨우면 (1년)</small><b>+${man(r1.annual_projection_krw)}</b><i>${man(rp.amt)}을 ${esc(rp.prod.name)}에 맡기면</i></div>` : ""}
        <div><small>놓치기 쉬운 돈까지 합치면 (1년)</small><b>+${man(extraYear)}</b><i>쉬는 돈 이자 + ISA 비과세</i></div>
        <div><small>고객이 먼저 받은 안내</small><b>${steps.filter(s => s.msg).length}번</b><i>묻기 전에, 필요한 때에</i></div>
        <div><small>통화에서 한 약속</small><b>${call ? call.todos.length : 0}건 → 일정</b><i>잊히지 않게</i></div>
      </div>
      <ol class="st-line">${steps.map((s, i) => `<li class="${s.key ? "key" : ""}">
        <div class="st-when"><span class="st-n">${i + 1}</span><b>${esc(s.date)}</b><small>${esc(s.tag)}</small></div>
        <div class="st-card"><h2>${esc(s.title)}</h2>
          <div class="st-body">
            ${s.msg ? bubble(s.msg) : ""}
            ${s.earn ? earnHtml() : ""}
            ${s.quote ? `<div class="st-quote"><small>통화 요약 (AI)</small><p>${esc(s.quote)}</p></div>` : ""}
            ${s.list ? `<ul class="st-promise">${s.list.map(n => `<li><b>${n.date ? md(n.date) : "입금되면"}</b><span>${esc(n.t)}</span></li>`).join("")}</ul>` : ""}
            <div class="st-side">${s.calc ? calcHtml() : ""}<p class="st-before"><b>예전에는</b>${esc(s.before)}</p><p class="st-behind"><b>그 뒤에서</b>${esc(s.behind)}</p></div>
          </div></div></li>`).join("")}</ol>
      <section class="panel st-end"><h2>고객 입장에서 달라지는 것</h2>
        <ul><li><b>쉬는 돈을 깨워 더 받게</b> 해 줘요. 쉬는 예수금을 찾아 RP로 받을 이자를 금액으로 보여 주고, 앱에서 바로 맡겨요.</li>
          <li><b>잊고 있던 돈을 금액으로</b> 알려 줘요. 만기, 청약, 세액공제.</li>
          <li><b>불안한 순간에 먼저</b> 연락이 와요. 보유 종목 급등락 다음 날 아침, 내 계좌 기준으로.</li>
          <li><b>상담에서 한 약속이 지켜져요.</b> 약속한 날, PB가 먼저 연락해요.</li>
          <li><b>결정은 고객이 직접</b> 해요. 사고팔기를 권하지 않고, 가입은 앱에서 본인이.</li></ul>
        <p class="sub">반대매매 위험 안내는 회사가 이미 고객에게 보내고 있어 사이로그는 PB 화면에서만 보여 줘요.</p></section>
    </div>`;
  }
  const EVENT_LBL = { els_redemption: "ELS 상환금", bond_maturity: "채권 상환금", dividend: "배당금" };

  // ════════════════ 메인 ════════════════
  function pageHome() {
    const tasks = myTasks(), core = tasks.filter(t => t.g === "now" || t.g === "today");
    const done = core.filter(t => t.st === "done").length, next = core.find(t => !t.st) || tasks.find(t => !t.st);
    const cnt = g => tasks.filter(t => t.g === g && t.st !== "done").length;
    const sm = MK && MK.summary, ko = MK && MK.indices.find(i => i.name === "코스피");
    const affected = MK ? new Set(MK.alerts.filter(a => inView(a.customer_id)).map(a => a.customer_id)).size : 0;
    const due = upcoming(14).slice(0, 4);
    const now = new Date();
    $app.innerHTML = `<div class="pg home">
      <p class="sub">${now.getMonth() + 1}월 ${now.getDate()}일 ${"일월화수목금토"[now.getDay()]}요일 · ${S.pbSel === "ALL" ? "전체 PB" : S.pbSel} 고객 ${D.customers.filter(c => inView(c.id)).length}명</p>
      <h1>${core.length ? (done === core.length ? "오늘 꼭 할 일을 모두 끝냈어요" : `오늘 꼭 연락할 고객이 <span class="hl">${core.length - done}명</span> 남았어요`) : "오늘은 급한 연락이 없어요"}</h1>
      <div class="home-grid">
        <section class="panel prog">
          <div class="bhead"><h2>오늘 할 일</h2><span class="sub">${done} / ${core.length} 완료</span></div>
          <div class="pbar"><i style="width:${core.length ? done / core.length * 100 : 100}%"></i></div>
          ${next ? `<div class="next"><span class="sub">다음 고객</span>
            <a class="next-c" href="#tasks"><span class="ava">${esc(next.c.name.slice(0, 1))}</span><span class="who"><b>${esc(next.c.name)}</b><small>${next.c.age}세</small><i>${esc(next.item ? next.item.title : "")}</i></span><span class="tag ${tagCls(next.g)}">${GROUPS.find(g => g[0] === next.g)[1]}</span></a></div>` : ""}
          <a class="cta big-cta" href="#tasks">오늘 할 일 시작하기</a>
        </section>
        <section class="panel">
          <div class="bhead"><h2>할 일 한눈에</h2></div>
          <ul class="glist">${GROUPS.map(([k, t, d]) => `<li><a href="#tasks"><span class="dot g-${k}"></span><span><b>${t}</b><small>${d}</small></span><em>${cnt(k)}명</em></a></li>`).join("")}</ul>
        </section>
        ${MK ? homeMarket(sm, affected) : ""}
        <section class="panel span2"><div class="bhead"><h2>다가오는 마감</h2><a href="#calendar">일정 ›</a></div>
          <ul class="cal">${due.map(u => `<li><span class="d"><b>${u.date.slice(5).replace("-", "/")}</b><small class="${u.dl <= 3 ? "red" : ""}">D-${u.dl}</small></span><span class="t"><b>${esc(u.label)}</b><small>고객 ${u.cids.size}명</small></span></li>`).join("") || `<li class="empty">14일 안에 마감이 없어요</li>`}</ul></section>
      </div></div>`;
  }
  // 메인 '어제 시장': 지수(국내·미국) → 금리·환율 등 → 왜 움직였나 → 국내·미국 강한/약한 업종 → 내 고객 영향
  function homeMarket(sm, affected) {
    const idx = MK.indices.map(i => `<div class="ix"><small>${esc(i.name)}</small><b>${i.close.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</b><em class="${i.chg_pct < 0 ? "dn" : "up"}">${pctTxt(i.chg_pct)}</em></div>`).join("");
    const secs = (arr, cls) => (arr || []).slice(0, 2).map(x => `<li><span class="${cls}">${cls === "up" ? "▲" : "▼"}</span><div><b>${esc(x.sector)}</b><small>${esc(x.move)}</small></div></li>`).join("");
    const side = (t, x) => x ? `<div class="hm-col"><h3>${t}</h3><p class="hm-line">${esc(x.line || "")}</p><ul class="hm-sec">${secs(x.down, "dn")}${secs(x.up, "up")}</ul></div>` : "";
    return `<section class="panel span2 hm"><div class="bhead"><h2>${mkDay()} 시장 <small class="sub">${mkDate()}</small></h2><a href="#market">시장 이슈 자세히 ›</a></div>
      ${sm && sm.headline ? `<p class="hm-head">${esc(sm.headline)}</p>` : `<p class="sub">시장 요약 전이에요</p>`}
      <div class="ixs">${idx}</div>
      ${sm && sm.chips ? `<div class="hm-chips">${sm.chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
      ${sm ? `<div class="hm-grid">
        ${sm.why ? `<div class="hm-col"><h3>왜 움직였나</h3><ul class="hm-why">${sm.why.map(w => `<li><b>${esc(w.t)}</b><small>${esc(w.d)}</small></li>`).join("")}</ul></div>` : ""}
        ${side("국내", sm.kr)}${side("미국", sm.us)}</div>
        ${sm.kr && sm.kr.outlook ? `<p class="hm-out"><b>전망</b> ${esc(sm.kr.outlook)}</p>` : ""}` : ""}
      <a class="hm-me" href="#market">내 고객 <b>${affected}명</b>이 영향을 받았어요 (보유 종목 큰 등락·담보 부족) ›</a></section>`;
  }
  const tagCls = g => ({ now: "s-call", today: "s-due", week: "s-plain", later: "s-plain" }[g]);

  // ════════════════ 오늘 할 일 ════════════════
  let tk = { open: null, showDone: false };
  function pageTasks() {
    const tasks = myTasks(), core = tasks.filter(t => t.g === "now" || t.g === "today");
    const done = core.filter(t => t.st === "done").length;
    const active = tasks.filter(t => !t.st), finished = tasks.filter(t => t.st === "done"), later = tasks.filter(t => t.st === "later");
    if (!tk.open || !active.some(t => t.c.id === tk.open)) tk.open = active[0] && active[0].c.id;
    $app.innerHTML = `<div class="pg tasks">
      <div class="pg-head"><div><h1>오늘 할 일</h1><p class="sub">위에서부터 한 명씩 처리하세요. 완료하면 다음 고객이 올라와요.</p></div></div>
      <div class="panel prog slim"><div class="bhead"><b>오늘 꼭 할 일 ${done} / ${core.length}</b><span class="sub">지금 바로 + 오늘 중</span></div><div class="pbar"><i style="width:${core.length ? done / core.length * 100 : 100}%"></i></div></div>
      ${GROUPS.map(([k, t, d]) => { const list = active.filter(x => x.g === k); if (!list.length) return "";
        return `<h2 class="sec"><span class="dot g-${k}"></span>${t} <small>${list.length}명 · ${d}</small></h2><div class="tcards">${list.map(taskCard).join("")}</div>`; }).join("") || `<div class="panel"><p class="sub">남은 할 일이 없어요.</p></div>`}
      ${later.length ? `<h2 class="sec muted">내일로 미룬 고객 <small>${later.length}명</small></h2><div class="tcards">${later.map(t => taskCard(t, true)).join("")}</div>` : ""}
      ${finished.length ? `<h2 class="sec muted">완료 <small>${finished.length}명</small></h2><div class="tcards">${finished.map(t => taskCard(t, true)).join("")}</div>` : ""}
    </div>`;
    $app.querySelectorAll("[data-open]").forEach(b => (b.onclick = () => { tk.open = tk.open === b.dataset.open ? "__" : b.dataset.open; pageTasks(); }));
    $app.querySelectorAll("[data-call]").forEach(b => (b.onclick = e => { e.stopPropagation(); callNow(b.dataset.call); }));
    $app.querySelectorAll("[data-tst]").forEach(b => (b.onclick = e => { e.stopPropagation(); const [cid, st] = b.dataset.tst.split("|");
      setTask(cid, st === "undo" ? null : st); toast(st === "done" ? "완료했어요" : st === "later" ? "내일로 미뤘어요" : "되돌렸어요"); pageTasks(); }));
  }
  function taskCard(t, compact) {
    const it = t.item, open = !compact && tk.open === t.c.id, cid = t.c.id;
    const lines = it ? keyLines(it.script) : [];
    return `<article class="tcard ${open ? "open" : ""} ${t.st ? "st-" + t.st : ""}">
      <button class="tc-head" data-open="${cid}"><span class="ava">${esc(t.c.name.slice(0, 1))}</span>
        <span class="who"><b>${esc(t.c.name)}</b><small>${t.c.age}세 · ${cid}</small><i>${esc(it ? it.title : "")}</i></span>
        ${it && it.amount ? `<span class="tc-amt">${esc(it.amount.split(" ")[0])}<small>${esc(it.amount.split(" ").slice(1).join(" "))}</small></span>` : "<span></span>"}
        ${t.n > 1 ? `<span class="tc-more">외 ${t.n - 1}건</span>` : "<span></span>"}</button>
      ${open ? `<div class="tc-body">
        <p class="tc-todo">${esc(it.todo)}</p>
        ${it.gauge ? creditGauge(it.gauge) : ""}
        <dl class="klines">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        <details class="mini-hist"><summary>전체 통화 문구 보기</summary><ol class="steps">${scriptSteps(it.script || "").map(([k, v]) => `<li><span>${esc(k)}</span><p>${esc(v)}</p></li>`).join("")}</ol></details>
        <a class="link-sm" href="#client/${cid}">고객 페이지에서 자세히 ›</a></div>` : ""}
      <div class="tc-acts">${t.st ? `<span class="sub">${t.st === "done" ? "완료" : "내일 다시"}</span><button class="txt" data-tst="${cid}|undo">되돌리기</button>`
        : `<button class="cta sm" data-call="${cid}">전화 걸기</button><button class="ghost sm" data-tst="${cid}|done">완료</button><button class="txt" data-tst="${cid}|later">내일로</button>`}</div>
    </article>`;
  }

  // ════════════════ 도넛 그래프 (자산 구성·업종 구성) ════════════════
  // 색은 항목마다 고정(순위 아님), 조각 사이 2px 틈, 범례에 금액·비중을 늘 함께 써서 색만으로 읽지 않게. 6조각 넘으면 '기타'로 묶음
  const PAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
  const ASSET_COLOR = { "국내 주식": PAL[0], "해외 주식": PAL[1], "원화 예수금": PAL[2], "예수금 자동 RP": PAL[3], "달러 예수금": PAL[4], "펀드·ELS": PAL[5] };
  const SECTOR_COLOR = { "반도체": PAL[0], "2차전지": PAL[1], "바이오": PAL[2], "방산·조선·원전": PAL[3], "AI·빅테크": PAL[4], "인터넷·플랫폼": PAL[5], "자동차": PAL[6] };
  function donut(parts, { center = "", sub = "", maxParts = 6, pctOnly = false } = {}) {
    let ps = parts.filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    if (ps.length > maxParts) { const rest = ps.slice(maxParts - 1); ps = ps.slice(0, maxParts - 1).concat([{ label: "기타", value: rest.reduce((s, p) => s + p.value, 0), color: "#8B95A1", note: rest.map(p => p.label).join(" · ") }]); }
    const total = ps.reduce((s, p) => s + p.value, 0);
    if (!total) return `<p class="sub">표시할 자산이 없어요.</p>`;
    const r = 54, cx = 72, cy = 72, C = 2 * Math.PI * r, gap = 2;
    let off = 0;
    const arcs = ps.map(p => { const len = C * p.value / total, dash = Math.max(0.5, len - (ps.length > 1 ? gap : 0));
      const s = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(p.label)} ${pctOnly ? "" : man(p.value) + " "}(${Math.round(p.value / total * 100)}%)</title></circle>`;
      off += len; return s; }).join("");
    return `<div class="donut"><svg viewBox="0 0 144 144" width="144" height="144" role="img" aria-label="${esc(center)} 구성">${arcs}
        <text x="72" y="68" text-anchor="middle" font-size="12" fill="#6B7684">${esc(sub)}</text><text x="72" y="86" text-anchor="middle" font-size="${center.length > 7 ? 11 : 14}" font-weight="700" fill="#191F28">${esc(center)}</text></svg>
      <ul class="dlg">${ps.map(p => `<li><i style="background:${p.color}"></i><span><b>${esc(p.label)}</b>${p.note ? `<small>${esc(p.note)}</small>` : ""}</span><em>${pctOnly ? "" : man(p.value)}<small>${Math.round(p.value / total * 100)}%</small></em></li>`).join("")}</ul></div>`;
  }
  // 자산 구성: 국내·해외 주식, 원화 예수금, 자동 RP, 달러 예수금, 펀드·ELS(만기 예정 상환액 기준)
  function assetMix(cid) {
    const c = CUST[cid], krw = c.balance.KRW || { cash: 0, auto_rp: 0 }, usd = c.balance.USD;
    const pos = MK ? MK.positions.filter(p => p.customer_id === cid) : [];
    const kr = pos.filter(p => p.currency === "KRW").reduce((s, p) => s + p.value_krw, 0), us = pos.filter(p => p.currency !== "KRW").reduce((s, p) => s + p.value_krw, 0);
    const prods = (D.details[cid].products || []), fund = prods.reduce((s, p) => s + p.amount, 0);
    const parts = [["국내 주식", kr], ["해외 주식", us], ["원화 예수금", krw.cash], ["예수금 자동 RP", krw.auto_rp || 0], ["달러 예수금", usd ? usd.cash * usd.rate : 0],
      ["펀드·ELS", fund]].map(([label, value]) => ({ label, value, color: ASSET_COLOR[label], note: label === "펀드·ELS" ? prods.map(p => p.name).join(" · ") : "" }));
    const total = parts.reduce((s, p) => s + p.value, 0);
    return { html: donut(parts, { center: man(total), sub: "총자산" }), total, fund, prods };
  }
  function sectorMix(cid) {
    const p = D.details[cid].profile;
    const parts = p.sectors.map(s => ({ label: s.name, value: Math.round(s.pct * 1000), color: SECTOR_COLOR[s.name] || "#8B95A1", note: s.stocks.join(" · ") }));
    return donut(parts, { center: p.sectors.length ? p.sectors[0].name : "–", sub: "가장 큰 업종", pctOnly: true });
  }

  // ════════════════ 고객 분석 (PB용 '분석' 탭) ════════════════
  // 보유 종목·거래 빈도·자산 구성으로 관심 분야와 투자 스타일을 보여 주고, 맞는 행사·상품 상담 방향을 정리한다
  function profileTab(cid) {
    const p = D.details[cid].profile, c = CUST[cid];
    if (!p) return `<section class="panel"><p class="sub">분석 데이터가 없어요.</p></section>`;
    const pc = x => `${Math.round(x * 100)}%`;
    const ev = (D.events || []).filter(e => p.events.includes(e.id));
    const top = p.sectors[0], same = top ? D.customers.filter(x => inView(x.id) && x.id !== cid && x.prof.tags.includes(top.name + " 관심")).length : 0;
    const kv = [["거래 빈도", `최근 90일 중 ${p.trade_days}일 매매 · ${p.activity}`], ["우량주 비중", p.mix.stock ? pc(p.bluechip) : "–"],
      ["변동성 큰 종목", p.mix.stock ? pc(p.volatile) : "–"], ["해외주식 비중", p.mix.stock ? pc(p.overseas) : "–"],
      ["예수금 비중", `총자산의 ${pc(p.mix.cash_ratio)} · ${man(p.mix.cash)}`], ["신용", p.credit ? "신용으로 산 주식 있음" : "없음"], ["등록 투자성향", c.risk]];
    const wd = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
    return `<section class="panel pf-head"><p class="sub">고객 분석 · 보유 종목, 거래 빈도, 자산 구성으로 정리했어요</p>
        <h2>${esc(p.summary)}</h2><div class="pf-tags">${p.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>
        ${p.gap ? `<p class="pf-gap">${esc(p.gap)}</p>` : ""}</section>
      <div class="ov-grid"><div class="col">
        <section class="panel"><div class="bhead"><h2>자산 구성</h2><span class="sub">${MK ? MK.ref_date.slice(5).replace("-", "/") + " 종가" : ""}</span></div>${assetMix(cid).html}</section>
        <section class="panel"><div class="bhead"><h2>보유 주식 업종</h2><span class="sub">평가금액 기준</span></div>
          ${p.sectors.length ? sectorMix(cid) : `<p class="sub">보유한 주식이 없어요.</p>`}
          ${same ? `<a class="link-sm" href="#clients" data-int="${esc(top.name)} 관심">${esc(top.name)}에 관심 있는 고객 ${same}명 더 보기 ›</a>` : ""}</section>
        <section class="panel"><div class="bhead"><h2>투자 스타일</h2><span class="sub">${esc(p.style)}</span></div>
          <dl class="pf-kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>
      </div><div class="col">
        <section class="panel"><div class="bhead"><h2>맞춤 행사 안내</h2><span class="sub">${ev.length}건 · 가상 일정</span></div>
          ${ev.length ? `<ul class="pf-ev">${ev.map(e => `<li><span class="d"><b>${+e.date.slice(5, 7)}/${+e.date.slice(8)}</b><small>${wd(e.date)} ${e.time}</small></span>
            <span><b>${esc(e.title)}</b><small>${esc(e.place)}</small><i>${esc(e.desc)}</i></span></li>`).join("")}</ul>` : `<p class="sub">맞는 행사가 아직 없어요.</p>`}</section>
        <section class="panel"><div class="bhead"><h2>상품 상담 방향</h2></div>
          ${p.offers.length ? `<ul class="pf-off">${p.offers.map(o => `<li><b>${esc(o.t)}</b><small>${esc(o.why)}</small><i>${esc(o.note)}</i></li>`).join("")}</ul>` : `<p class="sub">지금 제안할 방향이 없어요.</p>`}
          <p class="sub small">권유가 아니라 상담 방향이에요. 투자성향에 맞는 위험등급만 안내하고, 가입은 고객이 직접 해요.</p></section>
      </div></div>`;
  }

  // ════════════════ 고객 관리 ════════════════
  // 한눈에 보고 분류하는 표: 상태 칩(지금 바로·오늘 중·이번 주·시간 날 때) + 관심 분야 칩 + 검색. 정렬은 표 머리글을 눌러서
  // 줄마다 상황 · 총자산 · 예수금(쉬는 돈) · 주식(어제 변동·신용) · 관심·스타일 · 마지막 연락
  let cm = { g: "", sec: "", q: "", sort: "urgent", dir: -1 };
  function pageClientsMgmt() {
    const all = D.customers.filter(c => inView(c.id)).map(c => {
      const krw = c.balance.KRW || { cash: 0, auto_rp: 0 }, usd = c.balance.USD;
      const pos = MK ? MK.positions.filter(p => p.customer_id === c.id) : [];
      const stock = pos.reduce((s, p) => s + p.value_krw, 0), delta = pos.reduce((s, p) => s + p.day_delta_krw, 0);
      const cash = krw.cash + (krw.auto_rp || 0) + (usd ? usd.cash * usd.rate : 0);
      const r1 = findingsOf(c.id).find(f => f.rule === "R1" && f.currency === "KRW");
      const worst = MK ? MK.credit.filter(b => b.customer_id === c.id && b.kind !== "margin_safe").sort((a, b) => a.room - b.room)[0] : null;
      const items = contactItems(c.id);
      const fund = (D.details[c.id].products || []).reduce((a, p) => a + p.amount, 0);
      return { c, g: taskGroup(c.id), item: items[0], n: items.length, lc: lastContact(c.id), cash, krwCash: krw.cash, stock, delta, total: cash + stock + fund,
        idle: r1 ? r1.meta.idle_krw : 0, streak: r1 ? r1.meta.streak : 0, worst };
    });
    const cnt = {}; all.forEach(x => x.g && (cnt[x.g] = (cnt[x.g] || 0) + 1));
    const secCnt = {};   // 업종 관심만 (절세 관심 같은 상황 태그는 제외) — 분석 탭과 같은 기준(비중 30% 이상)
    all.forEach(x => D.details[x.c.id].profile.sectors.filter(sec => sec.pct >= 0.3).forEach(sec => (secCnt[sec.name] = (secCnt[sec.name] || 0) + 1)));
    const sectors = Object.entries(secCnt).sort((a, b) => b[1] - a[1]);
    if (cm.sec && !secCnt[cm.sec]) cm.sec = "";
    const secPct = x => (D.details[x.c.id].profile.sectors.find(s => s.name === cm.sec) || { pct: 0 }).pct;
    const lcDays = x => x.lc ? x.lc.days : 9999;
    const KEY = { urgent: x => -((x.g ? GROUPS.findIndex(g => g[0] === x.g) : 9)), total: x => x.total, cash: x => x.krwCash, stock: x => x.stock,
      contact: x => lcDays(x), interest: x => cm.sec ? secPct(x) : (x.c.prof.top_pct || 0) };
    const sorted = () => all.filter(x => (!cm.g || x.g === cm.g) && (!cm.sec || x.c.prof.tags.includes(cm.sec + " 관심")) && (!cm.q || (x.c.id + x.c.name).includes(cm.q)))
      .sort((a, b) => (KEY[cm.sort](b) - KEY[cm.sort](a)) * -cm.dir || a.c.name.localeCompare(b.c.name));
    const sum = k => all.reduce((s, x) => s + x[k], 0), idleN = all.filter(x => x.idle).length;
    const COLS = [["", "고객"], ["", "상황"], ["total", "총자산"], ["cash", "예수금"], ["stock", "주식"], ["interest", "관심·스타일"], ["contact", "연락"]];
    const arrow = k => cm.sort === k ? (cm.dir < 0 ? " ↓" : " ↑") : "";
    const head = () => `<li class="cm-head">${COLS.map(([k, t]) => k ? `<button class="${cm.sort === k ? "on" : ""}" data-sort="${k}">${t}${arrow(k)}</button>` : `<span>${t}</span>`).join("")}</li>`;
    const row = x => { const c = x.c, p = c.prof, top = p.top && p.top_pct >= 0.3 ? `${p.top} ${Math.round(p.top_pct * 100)}%` : "";
      return `<li><a class="cm-row" href="#client/${c.id}">
        <span class="who"><span class="ava">${esc(c.name.slice(0, 1))}</span><span><b>${esc(c.name)}</b><small>${c.age}세 · ${esc(c.risk)}</small></span></span>
        <span class="st">${x.g ? `<i class="tag ${tagCls(x.g)}">${GROUPS.find(g => g[0] === x.g)[1]}</i>` : ""}<span>${esc(x.item ? x.item.title : "챙길 것 없음")}${x.n > 1 ? ` <small>외 ${x.n - 1}</small>` : ""}</span></span>
        <span class="num"><b>${man(x.total)}</b></span>
        <span class="num"><b>${man(x.krwCash)}</b><small class="${x.idle ? "idle" : ""}">${x.idle ? `쉬는 돈 ${man(x.idle)} · ${x.streak}일` : c.auto ? "자동 RP 이용" : ""}</small></span>
        <span class="num"><b>${x.stock ? man(x.stock) : "–"}</b><small>${x.stock ? `<i class="${x.delta < 0 ? "dn" : "up"}">${x.delta < 0 ? "−" : "+"}${man(Math.abs(x.delta))}</i>` : ""}${x.worst ? ` <i class="cg-tag ${stageCls(x.worst.kind)}">신용 ${STAGE[x.worst.kind][0]}</i>` : ""}</small></span>
        <span class="pf"><b>${esc(top || p.style)}</b><small>${esc(top ? p.style : p.tags.filter(t => !t.endsWith(" 관심") && !t.startsWith("거래")).slice(0, 2).join(" · "))}</small></span>
        <span class="lcd lv-${x.lc ? x.lc.level : "bad"}"><b>${x.lc ? (x.lc.days ? x.lc.days + "일" : "오늘") : "–"}</b></span></a></li>`; };
    const list = () => { const r = sorted(); return head() + (r.map(row).join("") || `<li class="empty">해당하는 고객이 없어요</li>`); };
    const ev = cm.sec ? (D.events || []).filter(e => e.tags.includes(cm.sec)) : [];
    $app.innerHTML = `<div class="pg cmp">
      <div class="pg-head"><div><h1>고객 관리</h1>
        <p class="sub">${S.pbSel === "ALL" ? "전체 PB" : S.pbSel} 담당 ${all.length}명 · 총자산 ${man(sum("total"))} · 예수금 ${man(sum("krwCash"))} · 쉬는 돈 ${man(sum("idle"))} (${idleN}명)</p></div>
        <input class="pill" type="search" id="cmq" placeholder="이름이나 고객번호" value="${esc(cm.q)}"></div>
      <div class="chips">${[["", "전체", all.length], ...GROUPS.map(([k, t]) => [k, t, cnt[k] || 0])].map(([k, t, n]) => `<button class="chip ${cm.g === k ? "on" : ""}" data-g="${k}">${t} <em>${n}</em></button>`).join("")}</div>
      <div class="chips sec"><span class="lbl">관심 분야</span>${sectors.map(([s, n]) => `<button class="chip ${cm.sec === s ? "on" : ""}" data-sec="${esc(s)}">${esc(s)} <em>${n}</em></button>`).join("")}
        ${ev.length ? `<span class="evs">안내할 행사 ${ev.map(e => `<i>${esc(e.title)} <small>${+e.date.slice(5, 7)}/${+e.date.slice(8)}</small></i>`).join("")}</span>` : ""}</div>
      <ul class="cm-list">${list()}</ul></div>`;
    const bind = () => {
      $app.querySelectorAll("[data-sort]").forEach(b => (b.onclick = () => { const k = b.dataset.sort; if (cm.sort === k) cm.dir = -cm.dir; else { cm.sort = k; cm.dir = -1; } redraw(); }));
    };
    const redraw = () => { $app.querySelector(".cm-list").innerHTML = list(); bind(); };
    bind();
    $app.querySelectorAll("[data-g]").forEach(b => (b.onclick = () => { cm.g = b.dataset.g; pageClientsMgmt(); }));
    $app.querySelectorAll("[data-sec]").forEach(b => (b.onclick = () => { cm.sec = cm.sec === b.dataset.sec ? "" : b.dataset.sec; cm.sort = cm.sec ? "interest" : "urgent"; cm.dir = -1; pageClientsMgmt(); }));
    const inp = $app.querySelector("#cmq");   // 검색은 목록만 다시 그린다 (입력칸을 다시 만들면 한글 조합이 끊김)
    inp.oninput = () => { cm.q = inp.value.trim(); redraw(); };
  }

  // ════════════════ 고객 페이지 (할 일 띠 + 탭) ════════════════
  function pageClientTabs(cid) {
    const c = CUST[cid];
    if (!c) { location.hash = "#clients"; return; }
    if (cv.cid !== cid) cv = { cid, month: null, showWhy: false, stage: "idle", progress: "", transcript: "", source: "", seconds: 0, result: null, todos: [], open: null, upload: false, tab: "overview" };
    const items = contactItems(cid), lead = items[0], g = taskGroup(cid), st = taskState(cid);
    const krw = c.balance.KRW || { cash: 0, auto_rp: 0 }, usdB = c.balance.USD;
    const pos = MK ? MK.positions.filter(p => p.customer_id === cid) : [], credit = MK ? MK.credit.filter(b => b.customer_id === cid) : [];
    const stock = pos.reduce((s, p) => s + p.value_krw, 0), loan = pos.reduce((s, p) => s + p.credit_loan_krw, 0);
    const fundAmt = (D.details[cid].products || []).reduce((a, p) => a + p.amount, 0);   // 펀드·ELS(만기 예정 상환액)도 총자산에
    const total = krw.cash + (krw.auto_rp || 0) + (usdB ? usdB.cash * usdB.rate : 0) + stock + fundAmt;
    const calls = callsOf(cid), last = calls[0];
    const openTodos = calls.flatMap(cl => cl.todos.map((t, i) => ({ ...t, call: cl.id, i, done: todoDone(cl, i) }))).filter(t => !t.done).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    const alerts = D.outbox.filter(r => r.cid === cid).sort((a, b) => b.at.localeCompare(a.at));
    const consent = [c.consent_push && "앱 푸시", c.consent_kakao && "카카오톡"].filter(Boolean);
    const others = findingsOf(cid).filter(f => f.rule !== "R1");
    const TABS = [["overview", "개요"], ["analysis", "분석"], ["holdings", `보유 종목 ${pos.length}`], ["calls", `통화 ${calls.length}`], ["plan", "일정·알림"]];
    const lines = lead ? keyLines(lead.script) : [];
    let body = "";
    if (cv.tab === "overview") body = `<div class="ov-grid"><div class="col">${contactCard(cid)}${diagnosisCard(cid)}</div><div class="col">
        ${D.details[cid].trend.start ? `<section class="panel"><div class="bhead"><h2>자산 잔고 추이</h2><span class="sub">최근 6개월 · 만원</span></div>${assetChart(cid)}</section>` : ""}
        ${others.length ? `<section class="panel"><div class="bhead"><h2>함께 챙길 것</h2></div><ul class="items">${others.map(f => `<li class="static"><span><b>${esc(headline(f))}</b><small>${SHORT[f.rule]}${f.deadline ? ` · 마감 ${f.deadline.slice(5).replace("-", "/")}` : ""}</small></span><em>${amtText(f)}</em></li>`).join("")}</ul></section>` : ""}
        <section class="panel"><div class="bhead"><h2>해야 할 일</h2><span class="sub">${openTodos.length}건</span></div><ul class="todo-list">${openTodos.map(t => `<li><label><input type="checkbox" data-done="${t.call}|${t.i}"> <span>${esc(t.text)}</span></label><em class="${t.due && t.due <= ymd(new Date()) ? "red" : ""}">${esc(t.dueLabel)}</em></li>`).join("") || `<li class="empty">통화에서 나온 할 일이 없어요</li>`}</ul></section></div></div>`;
    else if (cv.tab === "analysis") body = profileTab(cid);
    else if (cv.tab === "holdings") body = `<div class="ov-grid"><div class="col"><section class="panel"><div class="bhead"><h2>자산 구성</h2><span class="sub">주식·예수금·상품을 한눈에</span></div>${assetMix(cid).html}</section>
        ${(D.details[cid].products || []).length ? `<section class="panel"><div class="bhead"><h2>펀드·ELS</h2></div><ul class="pf-sec">${D.details[cid].products.map(x => `<li><span><b>${esc(x.name)}</b><small>${esc(x.kind)} · 만기 ${x.maturity.slice(5).replace("-", "/")}</small></span><em>${man(x.amount)}</em></li>`).join("")}</ul></section>` : ""}</div>
        <div class="col">` + (pos.length ? `<section class="panel"><div class="bhead"><h2>보유 종목</h2><span class="sub">${MK.ref_date} 종가</span></div>
        <ul class="hold">${pos.sort((a, b) => b.value_krw - a.value_krw).map(p => { const b = credit.find(x => x.symbol === p.symbol);
          return `<li><span class="who"><b>${esc(p.name)}</b><small>${p.qty.toLocaleString("ko-KR")}주</small>${b ? `<span class="cg-tag ${stageCls(b.kind)}">신용 · ${STAGE[b.kind][0]}${b.kind === "margin_call" ? ` · ${man(b.shortfall_krw)} 부족` : b.kind !== "margin_safe" ? ` · 반대매매까지 −${(b.room * 100).toFixed(1)}%` : ""}</span>` : ""}</span>
            <span class="amt"><b>${man(p.value_krw)}</b><small class="${p.chg_pct < 0 ? "dn" : "up"}">${pctTxt(p.chg_pct)}</small></span>
            <span class="amt"><b class="${p.pnl_krw < 0 ? "dn" : "up"}">${p.pnl_krw < 0 ? "−" : "+"}${man(Math.abs(p.pnl_krw))}</b><small>매입 후 손익</small></span></li>`; }).join("")}</ul>
        ${credit.filter(b => b.kind !== "margin_safe").map(b => `<h3>${esc(b.name)} 신용 · 반대매매까지</h3>${creditGauge(b)}${ratioTrend(b)}`).join("")}</section>`
      : `<section class="panel"><p class="sub">보유 종목이 없어요.</p></section>`) + `</div></div>`;
    else if (cv.tab === "calls") body = `<div class="ov-grid"><div class="col"><section class="panel"><div class="bhead"><h2>최근 통화 요약</h2>${last ? `<span class="pill-tag ${last.ai ? "ai" : ""}">${last.ai ? "AI 요약 · PB 확인 전" : "PB 확인 완료"}</span>` : ""}</div>${last ? callSummary(last, calls) : `<p class="sub">아직 분석한 통화가 없어요.</p>`}</section></div>
        <div class="col"><section class="panel"><div class="bhead"><h2>통화 녹음 분석</h2></div>${callPanel(cid)}</section></div></div>`;
    else body = `<div class="ov-grid"><div class="col"><section class="panel"><div class="bhead"><h2>케어 일정</h2></div>${calendar(cid)}</section></div>
        <div class="col">${kakaoPanel(cid)}<section class="panel"><div class="bhead"><h2>이 고객에게 간 알림</h2><span class="sub">최근 30일 · ${alerts.length}건</span></div>
        ${alerts.length ? `<ul class="alog">${alerts.slice(0, 12).map(r => `<li><details><summary><span><b>${esc(r.title)}</b><small>${r.at} · ${chName(r)} · ${MT[r.msg_type]}${r.hold ? " · " + esc(holdLabel(r.hold)) : ""}</small></span><em>${ST[r.status] || r.status}</em></summary><p>${esc(r.body)}</p></details></li>`).join("")}</ul>` : `<p class="sub">보낸 알림이 없어요.</p>`}</section></div></div>`;

    $app.innerHTML = `<div class="pg c360">
      <a class="crumb" href="#clients">‹ 고객 관리</a>
      <section class="c360-top">
        <div class="c360-head"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
          <div class="c360-id"><h1>${esc(c.name)}님 <small>${cid}</small></h1><p class="sub">${c.age}세 · ${esc(c.risk)} · ${consent.length ? "광고 동의 " + consent.join("·") : "광고 미동의 · PB 연락만"} · 담당 ${c.pb}</p>
            ${c.prof ? `<button class="psum" data-ctab="analysis">${esc(c.prof.summary)}<span>${c.prof.tags.filter(t => t !== "거래 보통").slice(0, 4).map(t => `<i>${esc(t)}</i>`).join("")}</span></button>` : ""}</div>
          ${contactBadge(cid)}</div>
        <div class="ckpis">${clientKpis(cid, { total, krw, usdB, pos, stock, loan, credit })}</div>
      </section>
      ${lead ? `<section class="actbar ${g ? "g-" + g : ""}">
        <div class="ab-main"><span class="tag ${tagCls(g)}">${g ? GROUPS.find(x => x[0] === g)[1] : "참고"}</span><div><b>${esc(lead.title)}</b><small>${esc(lead.todo)}</small></div></div>
        <dl class="klines inline">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        <div class="ab-acts">${st ? `<span class="sub">${st === "done" ? "오늘 완료" : "내일 다시"}</span><button class="txt" data-tst="undo">되돌리기</button>`
          : `<button class="cta sm" data-callnow>전화 걸기</button>${kakaoLocal && kakaoLocal.cids[cid] ? `<button class="ghost sm" data-ctab="plan">카톡 보내기</button>` : ""}<button class="ghost sm" data-tst="done">완료</button><button class="txt" data-tst="later">내일로</button>`}</div></section>` : ""}
      ${mustKnow(cid, lead ? items.slice(1) : items, openTodos, last, consent)}
      <nav class="ctabs">${TABS.map(([k, t]) => `<button class="${cv.tab === k ? "on" : ""}" data-ctab="${k}">${t}</button>`).join("")}</nav>
      ${body}</div>`;
    bindClient(cid);
    bindKakao(cid);
    $app.querySelectorAll("[data-ctab]").forEach(b => (b.onclick = () => { cv.tab = b.dataset.ctab; pageClientTabs(cid); }));
    $app.querySelectorAll("[data-ci]").forEach(b => (b.onclick = () => { cv.open = cv.open === b.dataset.ci ? "__none" : b.dataset.ci; pageClientTabs(cid); }));
    const callB = $app.querySelector("[data-callnow]"); if (callB) callB.onclick = () => callNow(cid);
    $app.querySelectorAll("[data-contact]").forEach(b => (b.onclick = () => {
      const k = b.dataset.contact;
      if (k === "undo") { delete S.contact[cid]; toast("되돌렸어요"); } else { S.contact[cid] = { date: todayKey(), kind: k }; toast(`${k} 완료 · 연락 없는 날을 0일로 바꿨어요`); }
      save(); pageClientTabs(cid);
    }));
    $app.querySelectorAll("[data-tst]").forEach(b => (b.onclick = () => { setTask(cid, b.dataset.tst === "undo" ? null : b.dataset.tst); toast(b.dataset.tst === "done" ? "완료했어요" : b.dataset.tst === "later" ? "내일로 미뤘어요" : "되돌렸어요"); pageClientTabs(cid); }));
    const up = $app.querySelector("#openUpload"); if (up) up.onclick = () => { cv.upload = true; pageClientTabs(cid); };
    $app.querySelectorAll("[data-int]").forEach(b => (b.onclick = () => { cm.sec = b.dataset.int.replace(" 관심", ""); cm.g = ""; cm.sort = "interest"; cm.dir = -1; }));
  }

  // 카톡 알림 버튼의 &s= → 열 화면 (why·buy·item:발견번호, report). 자동 RP를 제안한 경우 buy는 auto로
  function deepSheet(cid) {
    const s = new URLSearchParams(location.search).get("s");
    if (!s) return null;
    if (s === "report") return D.details[cid].previews.some(p => p.trigger === "T_MONTHLY") ? "report" : null;
    if (s.startsWith("move:")) return MK && MK.positions.some(p => p.customer_id === cid && p.symbol === s.slice(5)) ? s : null;
    const day = id => id.replace(/-\d{8}$/, "");   // 발견번호 끝의 기준일은 매일 바뀌므로 빼고 비교 (어제 받은 알림도 열림)
    const [kind, fid0] = s.split(":"), f = findingsOf(cid).find(x => day(x.finding_id) === day(fid0 || "")), fid = f && f.finding_id;
    if (!f || !["why", "buy", "item"].includes(kind)) return null;
    if (kind === "buy" && (foundOf(cid) || f.recommendation.product_id === "AUTO_RP")) return foundOf(cid) ? null : `auto:${fid}`;
    return `${kind}:${fid}`;
  }

  // ── 고객용 데모 화면 (app.html?c=고객번호): 카톡 알림 버튼으로 들어온 고객 한 명의 앱 화면만 ──
  const CUSTOMER_MODE = document.body.dataset.mode === "customer";
  function pageCustomerOnly() {
    const cid = new URLSearchParams(location.search).get("c");
    if (!CUST[cid]) { $app.innerHTML = `<p class="muted" style="padding:60px 0;text-align:center">알림의 버튼으로 들어와 주세요.</p>`; return; }
    if (cx.cid !== cid) cx = { cid, scene: "home", sheet: deepSheet(cid), step: 0, ans: [] };  // 알림을 눌러 들어왔으니 잠금화면 없이 앱부터
    $app.innerHTML = `<div class="device"><div class="device-screen" id="phone">${phoneScreen(cid)}</div></div>`;
    bindPhone();
  }

  function render() {
    if (CUSTOMER_MODE) return pageCustomerOnly();
    if (!location.hash || location.hash === "#intro") { location.replace("landing.html"); return; }   // 첫 화면은 서비스 소개 랜딩
    let [page, arg, arg2] = location.hash.slice(1).split("/");
    const AL = { today: "home", brief: "home", pbm: "clients", pb: "clients", overview: "clients", company: "insights", items: "guide", customer: "client" };
    if (AL[page]) { location.replace("#" + AL[page] + (arg ? "/" + arg : "")); return; }
    const nav = page === "client" ? "clients" : page;
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.page === nav));
    const T = { story: "고객 이야기", home: "메인", tasks: "오늘 할 일", clients: "고객 관리", client: "고객 관리", calendar: "일정", market: "시장 이슈", outbox: "보낸 알림", insights: "성과", guide: "기준 안내" };
    document.getElementById("pgtitle").textContent = T[page] || "메인";
    ({ story: pageStory, home: pageHome, tasks: pageTasks, clients: pageClientsMgmt, client: () => pageClientTabs(arg), calendar: pageCalendar, market: pageMarket,
       outbox: pageOutbox, insights: pageCompany, guide: pageItems }[page] || pageHome)();
  }
  if (!CUSTOMER_MODE) { setupShell(); kakaoPing(); }
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
})();
