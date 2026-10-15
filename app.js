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
  const CH = { push: "앱 푸시", kakao: "알림톡", pb_queue: "PB 통화", monthly_report: "월간 리포트" };
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
        <div class="kk"><div class="kk-top">알림톡 도착</div><p>${esc(p.body)}</p></div></div></div>`;
    return `<div class="phone"><div class="screen report"><div class="kk-head"><span class="icon">유진</span>앱 > 월간 리포트</div>
      <div class="rep"><b>${esc(p.title)}</b><p>${esc(p.body)}</p></div></div></div>`;
  }
  function previewBlock(p) {
    return `<div><div class="pv-label">${esc(p.label)}</div>${badge(CH[p.channel])}${badge(MT[p.msg_type], p.msg_type === "ad" ? "accent" : "")}
      ${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ""}${phone(p)}
      <div class="muted small" style="text-align:center">${p.checked ? "검증 통과 (숫자 일치·금칙어·글자 수)" : "기본 문구로 교체됨"}</div></div>`;
  }

  // ── 항목 공통 표기 (고객 앱·PB 화면 같이 씀) ──
  const SHORT = { R1: "1년 RP 이자", R2: "양도세 절세", R3: "청약 차이", R4: "만기금 한 달 이자", R5: "연금 세액공제" };
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
      case "pension_credit": return `연금저축 한도 ${man(m.remain)} 남음 · D-${dl}`;
      default: return f.title;
    }
  }

  // ════════════════ ① 고객 앱 화면 ════════════════
  // 휴대폰 안에는 고객이 실제로 보는 앱만, 설명·데모 도구는 휴대폰 밖 발표자 패널에.
  let cx = { cid: null, scene: "lock", sheet: null, step: 0, ans: [] };
  const ITEM_ICON = { R2: "세", R3: "청", R4: "만", R5: "연" };

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
        <h1>고객 앱 화면</h1>
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
    $app.querySelector("#reset").onclick = () => { S = { reassessed: {}, auto: {}, pb: {}, log: S.log }; save(); cx.cid = null; toast("데모 상태를 처음으로 되돌렸어요"); render(); };
    bindPhone();
  }

  function guideFor(cid) {
    const fs = findingsOf(cid), r1 = fs.find(f => f.rule === "R1" && f.currency === "KRW");
    const g = [];
    if (firstPush(cid)) g.push("잠금화면 알림을 눌러 앱 열기");
    if (r1) g.push(r1.recommendation.product_id === "AUTO_RP" ? "매매가 잦아 예수금 자동 RP만 안내 (매수할 때 자동으로 빠짐)" : "하단 버튼으로 RP 맡기기 또는 예수금 자동 RP 신청");
    if (fs.some(f => f.currency === "USD")) g.push("달러는 환전 없이 외화 RP로");
    if (fs.some(f => f.rule !== "R1")) g.push("'함께 챙길 것'에서 세금·청약·만기·연금 항목 눌러 보기");
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
        <button class="h-meta link" data-sheet="why:${esc(r1.finding_id)}">지난 90일 못 받은 이자 ${man(idles.reduce((s, f) => s + f.amount_krw, 0))} · 근거 보기 ›</button>
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
    return `${hero}${appCreditCard(cid)}${chart}${idleRows}${itemRows}
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
    } else if (kind === "done") {
      body = `<div class="s-done"><div class="s-check-ico">✓</div><h3>${esc(fid)}</h3></div><button class="a-cta" data-close>확인</button>`;
    }
    return `<div class="sheet-dim" data-close></div><div class="sheet"><div class="grab"></div>${body}</div>`;
  }


  function itemSheet(f) {
    const m = f.meta, dl = daysLeft(f.deadline);
    const rows = {
      R2: [["올해 실현이익", won(m.realized)], ["평가손실 / 평가이익", `${won(m.loss)} / ${won(m.gain)}`], ["올해 마지막 매도일", `${f.deadline} (D-${dl})`]],
      R3: [["보유 → 청약 가능", `${m.qty.toLocaleString("ko-KR")}주 → ${m.shares.toLocaleString("ko-KR")}주`], ["청약가 / 현재가", `${won(m.issue_price)} / ${won(m.now)}`], ["청약 기간", `${m.start} ~ ${f.deadline}`]],
      R4: [["만기일", `${f.deadline} (D-${dl})`], ["상환 예정 금액", man(m.expected)], ["한 달 그대로 두면", `약 ${man(f.amount_krw)} 못 받음`]],
      R5: [["올해 납입 / 한도", `${man(m.paid)} / ${man(m.limit)}`], ["남은 한도", man(m.remain)], ["마감", `${f.deadline} 납입분까지 (D-${dl})`]],
    }[f.rule];
    const note = { R2: "매도를 권하는 안내가 아니에요. 다른 증권사 손익은 빠져 있어요.",
      R3: "청약 여부는 직접 판단해 주세요. 주가가 바뀌면 차이도 달라져요.",
      R4: "다시 투자할지는 직접 정하세요. 정하기 전까지는 예수금 자동 RP로 이자를 받을 수 있어요.",
      R5: "연금저축계좌는 펀드·ETF 등에 투자해 원금 손실이 날 수 있고 예금자보호 대상이 아니에요." }[f.rule];
    const go = { R2: "보유 종목 손익 보기", R3: "청약하러 가기", R4: "만기 후 계획 정하기", R5: "연금저축 입금하기" }[f.rule];
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
    ["세금", "연금저축 세액공제 한도 남음", "올해 채우지 않은 한도만큼 못 돌려받는 세금 (13.2%, 총급여 낮으면 16.5%)", "10~12월, 유진 연금저축 올해 납입액이 600만원 미만", "앱에서 직접 입금 (광고성: 수신 동의 필요, 원금 손실 가능·예금자보호 대상 아님 고지)", "10월부터 발견 즉시 + 연말 D-7 (광고성)", "P002"],
    ["만기", "펀드·ELS 만기", "상환금이 예수금으로 쉬는 동안의 이자 (한 달 기준)", "보유 펀드·ELS 만기 14일 전", "만기 후 계획 미리 정하기 · 예수금 자동 RP · PB 상담 (재투자 권유 아님)", "만기 14일 전 + D-7 (정보성)", "P003"],
  ];
  function pageItems() {
    $app.innerHTML = `<h1>항목 한눈에</h1>
      <p class="lead">고객이 놓치거나 잊기 쉬운 돈과 일정을 계좌 데이터만으로 찾습니다. 금액 계산은 검증 가능한 규칙 엔진이 맡고, 문장은 숫자를 바꿀 수 없습니다.</p>
      <div class="tablewrap" style="max-height:none"><table><thead><tr><th>구분</th><th>항목</th><th>놓치는 돈</th><th>찾는 방법</th><th>안내</th><th>알림 시점</th><th>데모 고객</th></tr></thead>
      <tbody>${ITEMS.map(r => `<tr><td>${r[0]}</td><td><b>${r[1]}</b></td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td><a href="#customer/${r[6]}">${r[6]} ${esc(CUST[r[6]].name)}</a></td></tr>`).join("")}</tbody></table></div>
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
      R4: "만기 뒤 상환금을 어떻게 쓸지 여쭤 보세요", R5: "연금저축 남은 한도를 알려 주세요" }[f.rule];
  }

  function pbCustomers() {
    return D.customers.map(c => {
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
    MK.alerts.forEach(a => (by[a.customer_id] ||= []).push(a));
    return Object.entries(by).map(([cid, as]) => ({ cid, c: CUST[cid], as, lead: as[0] }));
  }
  const pctTxt = v => `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  function mkHeadline(a) {
    if (a.kind === "margin_call") return `${a.name} 담보비율 ${Math.round(a.ratio * 100)}% · 반대매매 위험`;
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
      : [["담보비율", `${Math.round(a.ratio * 100)}% (유지 ${Math.round(MK.maintenance_ratio * 100)}%)`], ["반대매매 기준가", `${won(a.trigger_price)} (지금 ${won(a.close)})`],
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

  function appCreditCard(cid) {   // 고객 앱: 본인 신용 보유분
    if (!MK) return "";
    const mine = MK.credit.filter(b => b.customer_id === cid);
    if (!mine.length) return "";
    return `<div class="a-card"><div class="a-title">신용으로 산 주식</div>${mine.map(b => `
      <div class="ac-credit"><div class="ac-top"><b>${esc(b.name)}</b><span class="cg-tag ${stageCls(b.kind)}">${STAGE[b.kind][0]}</span></div>
      <p class="ac-line">${b.kind === "margin_call" ? `담보가 약 ${man(b.shortfall_krw)} 부족해서 반대매매될 수 있어요` : `주가가 <b>${(b.room * 100).toFixed(1)}%</b> 더 내리면 반대매매될 수 있어요`}</p>
      <div class="cg-track mini ${stageCls(b.kind)}"><i class="z1"></i><i class="z2"></i><i class="z3"></i><span class="cg-dot" style="left:${Math.min(1, Math.max(0, b.room) / 0.3) * 100}%"></span></div>
      <p class="ac-sub">담보비율 ${Math.round(b.ratio * 100)}% · 기준가 ${won(b.trigger_price)} · ${MK.ref_date.slice(5).replace("-", "/")} 종가</p></div>`).join("")}</div>`;
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
      if (a.kind === "margin_call") out.push({ cid: a.customer_id, w: 0, why: `${a.name} 담보 ${Math.round(a.ratio * 100)}% · 약 ${man(a.shortfall_krw)} 부족`, tag: "반대매매 위험", cls: "s-call" });
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
    D.customers.forEach(c => findingsOf(c.id).forEach(f => {
      if (!f.deadline) return;
      const dl = daysLeft(f.deadline);
      if (dl < 0 || dl > days) return;
      const key = `${f.deadline}|${f.subtype}|${f.rule === "R3" ? f.meta.stock : f.rule === "R4" ? "" : ""}`;
      (by[key] ||= { date: f.deadline, dl, label: f.rule === "R3" ? `${f.meta.stock} 유상증자 청약 마감` : f.rule === "R4" ? "펀드·ELS 만기" : f.rule === "R2" ? "해외주식 올해 마지막 매도일" : f.rule === "R5" ? "연금저축 올해 납입 마감" : f.subtype_label, cids: new Set(), sum: 0 });
      by[key].cids.add(c.id); by[key].sum += f.amount_krw;
    }));
    return Object.values(by).sort((a, b) => a.dl - b.dl);
  }

  function pageBrief() {
    const now = new Date();
    const pri = priorityList();
    const top = pri.slice(0, 6);
    const contact = D.customers.filter(c => findingsOf(c.id).some(f => PB_BY_FID[f.finding_id])).length;
    const risk = MK ? MK.credit.filter(b => b.kind === "margin_call" || b.kind === "margin_warn").length : 0;
    const movers = MK ? new Set(MK.alerts.filter(a => a.kind === "big_move").map(a => a.customer_id)).size : 0;
    const due = upcoming(7).reduce((s, u) => s + u.cids.size, 0);
    const todayLogs = S.log.filter(l => isToday(l.at));
    const issues = MK ? Object.values(MK.alerts.filter(a => a.kind === "big_move").reduce((o, a) => {
      (o[a.symbol] ||= { a, n: new Set() }).n.add(a.customer_id); return o; }, {})) : [];

    $app.innerHTML = `<div class="pbm brief">
      <p class="sub">${now.getMonth() + 1}월 ${now.getDate()}일 ${"일월화수목금토"[now.getDay()]}요일 아침</p>
      <h1>오늘은 ${pri.length ? `<span class="hl">${esc(CUST[pri[0].cid].name)}님</span>부터 연락하세요` : "급한 연락이 없어요"}</h1>
      <p class="sub">${pri.length ? esc(pri[0].why) : ""}</p>
      <div class="pbm-stats four">
        <div><span>반대매매 위험·경고</span><b class="${risk ? "red" : ""}">${risk}명</b></div>
        <div><span>보유 종목 ±10%</span><b>${movers}명</b></div>
        <div><span>마감 7일 이내</span><b>${due}건</b></div>
        <div><span>오늘 연락 대상</span><b>${contact}명</b></div>
      </div>

      <div class="brief-grid">
        <section class="bcard"><div class="bhead"><h2>먼저 연락할 고객</h2><a href="#pbm">전체 보기 ›</a></div>
          <ul class="pri">${top.map((x, i) => `<li><a href="#client/${x.cid}"><em>${i + 1}</em>
            <span class="who"><b>${esc(CUST[x.cid].name)}</b><small>${CUST[x.cid].age}세</small><i>${esc(x.why)}</i></span>
            <span class="tag ${x.cls}">${esc(x.tag)}</span>${S.log.some(l => l.cid === x.cid && isToday(l.at)) ? `<span class="done-mark">✓</span>` : ""}</a></li>`).join("") || `<li class="empty">없어요</li>`}</ul></section>

        <section class="bcard"><div class="bhead"><h2>어제 시장</h2>${MK ? `<span class="sub">${MK.ref_date} 종가</span>` : ""}</div>
          ${MK ? `<div class="idx-grid">${MK.indices.map(i => `<div><span>${esc(i.name)}</span><b>${i.close.toLocaleString("ko-KR")}</b><em class="${i.chg_pct < 0 ? "dn" : "up"}">${pctTxt(i.chg_pct)}</em>${i.date !== MK.ref_date ? `<small class="stale">${i.date.slice(5).replace("-", "/")} 기준</small>` : ""}</div>`).join("")}</div>
          <h3>고객 보유 종목 이슈</h3>
          <ul class="issues">${issues.map(({ a, n }) => `<li><div class="is-top"><b>${esc(a.name)}</b><em class="${a.chg_pct < 0 ? "dn" : "up"}">${pctTxt(a.chg_pct)}</em><small>보유 고객 ${n.size}명</small></div>
            <p>${esc(a.reason ? a.reason.split(/(?<=다\.)\s/)[0] : "이유 확인 전")}</p></li>`).join("") || `<li class="empty">크게 움직인 보유 종목이 없어요</li>`}</ul>`
          : `<p class="sub">아침 시장 점검을 아직 돌리지 않았어요.</p>`}</section>

        <section class="bcard"><div class="bhead"><h2>다가오는 마감 (14일)</h2></div>
          <ul class="cal">${upcoming(14).map(u => `<li><span class="d"><b>${u.date.slice(5).replace("-", "/")}</b><small class="${u.dl <= 3 ? "red" : ""}">D-${u.dl}</small></span>
            <span class="t"><b>${esc(u.label)}</b><small>고객 ${u.cids.size}명 · 합계 ${man(u.sum)}</small></span></li>`).join("") || `<li class="empty">없어요</li>`}</ul>
          <p class="sub small">${D.as_of} 기준</p></section>

        <section class="bcard"><div class="bhead"><h2>연락 기록</h2><span class="sub">오늘 ${todayLogs.length}건 · 전체 ${S.log.length}건</span></div>
          ${logList(S.log.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6), true)}
          <div class="row-btns"><button class="ghost sm" id="exp">기록 내보내기</button><label class="ghost sm">기록 가져오기<input type="file" id="imp" accept="application/json" hidden></label></div>
          <p class="fine">기록은 이 브라우저에 날짜별로 쌓여요. 다른 기기로 옮길 때는 내보내기·가져오기를 쓰세요.</p></section>
      </div></div>`;
    $app.querySelector("#exp").onclick = exportLogs;
    $app.querySelector("#imp").onchange = e => e.target.files[0] && importLogs(e.target.files[0]);
  }

  // ════════════════ 고객 한 명 전체 보기 ════════════════
  function pageClient(cid) {
    const c = CUST[cid];
    if (!c) { location.hash = "#pbm"; return; }
    const fs = findingsOf(cid), det = D.details[cid];
    const krw = c.balance.KRW || { cash: 0, auto_rp: 0 }, usdB = c.balance.USD;
    const pos = MK ? MK.positions.filter(p => p.customer_id === cid) : [];
    const credit = MK ? MK.credit.filter(b => b.customer_id === cid) : [];
    const stock = pos.reduce((s, p) => s + p.value_krw, 0), loan = pos.reduce((s, p) => s + p.credit_loan_krw, 0);
    const alerts = D.outbox.filter(r => r.cid === cid).sort((a, b) => b.at.localeCompare(a.at));
    const consent = [c.consent_push && "앱 푸시", c.consent_kakao && "알림톡"].filter(Boolean);

    $app.innerHTML = `<div class="pbm client">
      <a class="crumb" href="#pbm">‹ PB 고객 관리</a>
      <div class="who-big"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
        <div><h1>${esc(c.name)}님 <small>${cid}</small></h1>
          <p class="sub">${c.age}세 · ${esc(c.risk)} · ${consent.length ? "광고 동의: " + consent.join("·") : "광고 미동의 (PB 연락만)"} · 담당 ${c.pb}</p></div></div>

      <div class="pbm-stats four">
        <div><span>원화 예수금</span><b>${man(krw.cash)}</b>${krw.auto_rp ? `<small>자동 RP ${man(krw.auto_rp)}</small>` : ""}</div>
        <div><span>달러 예수금</span><b>${usdB ? usd(usdB.cash) : "–"}</b>${usdB ? `<small>약 ${man(usdB.cash * usdB.rate)}</small>` : ""}</div>
        <div><span>주식 평가금액</span><b>${pos.length ? man(stock) : "–"}</b>${MK && pos.length ? `<small>${MK.ref_date.slice(5).replace("-", "/")} 종가</small>` : ""}</div>
        <div><span>신용 대출금</span><b class="${credit.some(b => b.kind !== "margin_safe") ? "red" : ""}">${loan ? man(loan) : "없음"}</b></div>
      </div>

      <div class="client-grid">
        <div class="col">
          <section class="bcard"><div class="bhead"><h2>챙길 것 ${fs.length}가지</h2><a href="#customer/${cid}/home">고객 앱 화면 ›</a></div>
            ${fs.length ? `<ul class="items">${fs.map(f => `<li class="static"><span><b>${esc(headline(f))}</b><small>${SHORT[f.rule]}${f.deadline ? ` · 마감 D-${daysLeft(f.deadline)}` : ""}${PB_BY_FID[f.finding_id] ? " · 연락 대상" : ""}</small></span><em>+${man(amountOf(f))}</em></li>`).join("")}</ul>`
              : `<p class="sub">지금 챙길 것이 없어요.</p>`}
            ${foundOf(cid) ? `<p class="okline">예수금 자동 RP 이용 중 · 깨운 뒤 받은 이자 ${won(foundOf(cid).found_krw)}</p>` : ""}</section>

          <section class="bcard"><div class="bhead"><h2>보유 종목 ${pos.length}개</h2>${MK ? `<span class="sub">${MK.ref_date} 종가</span>` : ""}</div>
            ${pos.length ? `<ul class="hold">${pos.sort((a, b) => b.value_krw - a.value_krw).map(p => {
              const b = credit.find(x => x.symbol === p.symbol);
              return `<li><span class="who"><b>${esc(p.name)}</b><small>${p.qty.toLocaleString("ko-KR")}주</small>${b ? `<span class="cg-tag ${stageCls(b.kind)}">신용 · ${STAGE[b.kind][0]}${b.kind !== "margin_safe" ? ` −${(Math.max(0, b.room) * 100).toFixed(1)}%` : ""}</span>` : ""}</span>
                <span class="amt"><b>${man(p.value_krw)}</b><small class="${p.chg_pct < 0 ? "dn" : "up"}">${pctTxt(p.chg_pct)}</small></span>
                <span class="amt"><b class="${p.pnl_krw < 0 ? "dn" : "up"}">${p.pnl_krw < 0 ? "−" : "+"}${man(Math.abs(p.pnl_krw))}</b><small>매입 후 손익</small></span></li>`; }).join("")}</ul>`
              : `<p class="sub">보유 종목이 없어요 (가상 데이터).</p>`}
            ${credit.filter(b => b.kind !== "margin_safe").map(b => `<h3>${esc(b.name)} 신용 · 반대매매까지</h3>${creditGauge(b)}`).join("")}</section>

          ${det.trend.start ? `<section class="bcard"><div class="bhead"><h2>최근 6개월 예수금</h2></div>${lineChart(det.trend)}</section>` : ""}
        </div>

        <div class="col">
          <section class="bcard"><div class="bhead"><h2>연락 기록</h2><span class="sub">${logsOf(cid).length}건</span></div>
            <div class="logform">
              <textarea id="memo" rows="3" placeholder="통화 내용이나 다음에 할 일을 적어 두세요"></textarea>
              <div class="seg small">${["called", "no_answer", "joined", "later", "memo"].map(k => `<button data-log="${k}">${LOG_RESULT[k]}</button>`).join("")}</div>
            </div>
            ${logList(logsOf(cid), false)}</section>

          <section class="bcard"><div class="bhead"><h2>이 고객에게 간 알림</h2><span class="sub">최근 30일 · ${alerts.length}건</span></div>
            ${alerts.length ? `<ul class="alog">${alerts.slice(0, 12).map(r => `<li><details><summary><span><b>${esc(r.title)}</b><small>${r.at} · ${CH[r.channel]} · ${MT[r.msg_type]}${r.hold ? " · " + esc(holdLabel(r.hold)) : ""}</small></span><em>${ST[r.status] || r.status}</em></summary><p>${esc(r.body)}</p></details></li>`).join("")}</ul>`
              : `<p class="sub">보낸 알림이 없어요.</p>`}</section>
        </div>
      </div></div>`;

    $app.querySelectorAll("[data-log]").forEach(b => (b.onclick = () => {
      const memo = $app.querySelector("#memo").value;
      if (b.dataset.log === "memo" && !memo.trim()) return toast("메모 내용을 적어 주세요");
      const topic = fs[0] ? headline(fs[0]) : "";
      addLog(cid, b.dataset.log, topic, memo);
      if (b.dataset.log !== "memo") S.pb[cid] = b.dataset.log, save();
      toast(`${LOG_RESULT[b.dataset.log]}으로 기록했어요`); pageClient(cid);
    }));
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
      <span class="amt"><b>+${man(amountOf(f))}</b><small class="${dl !== null && dl <= 7 ? "due" : ""}">${dl !== null && dl <= 7 ? `D-${dl} · ` : ""}${SHORT[f.rule]}${r.fs.length > 1 ? ` 외 ${r.fs.length - 1}` : ""}</small></span></li>`;
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
        <em>+${man(amountOf(x))}</em></li>`).join("")}</ul>

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
    $app.innerHTML = `<h1>알림 미리보기</h1>
      <p class="lead">최근 30일 동안 매일 배치를 돌려 만든 발송함입니다. 실제로 보내지 않고, 수신 동의·야간 제한(21시~8시)·주 1회 빈도 제한·중복 방지를 적용한 결과만 쌓습니다.</p>
      <div class="filters">${[["", "전체"], ["held", "보류된 것만"], ["ad", "광고성만"], ["pb", "PB 통화만"], ["P002", "P002 상환금"], ["P003", "P003 장기방치"]].map(([k, t]) => `<button class="chip ${obF === k ? "on" : ""}" data-f="${k}">${t}</button>`).join("")}
        <span class="muted">${view.length.toLocaleString("ko-KR")}건</span></div>
      <div class="split"><div class="tablewrap"><table><thead><tr><th>예정 시각</th><th>고객</th><th>알림</th><th>채널</th><th>성격</th><th>상태</th><th>보류 사유</th></tr></thead>
        <tbody>${view.map(r => `<tr class="click ${r.id === obSel ? "sel" : ""}" data-id="${esc(r.id)}"><td class="small">${r.at}</td><td>${r.cid} ${esc(CUST[r.cid].name)}</td>
          <td class="small">${esc(TRIG[r.trigger] || r.trigger)}</td><td class="small">${CH[r.channel]}</td><td class="small">${r.msg_type === "ad" ? badge("광고성", "accent") : "정보성"}</td>
          <td class="small">${ST[r.status] || r.status}</td><td class="small">${esc(holdLabel(r.hold))}</td></tr>`).join("")}</tbody></table></div>
      <div>${sel ? `<div class="card"><div class="pv-label">${sel.cid} ${esc(CUST[sel.cid].name)} · ${esc(TRIG[sel.trigger] || sel.trigger)}</div>
        ${badge(CH[sel.channel])}${badge(MT[sel.msg_type], sel.msg_type === "ad" ? "accent" : "")}${sel.hold ? badge(holdLabel(sel.hold), "warn") : ""}
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
    $app.innerHTML = `<h1>회사 대시보드</h1>
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
      <h2>함께 챙길 항목 — 세금·권리·만기·연금</h2>
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
  function render() {
    const [page, arg, arg2] = (location.hash.slice(1) || "customer").split("/");
    const tab = page === "overview" || page === "pb" || page === "client" ? "pbm" : page;
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.page === tab));
    document.body.classList.toggle("is-pbm", tab === "pbm" || tab === "brief");
    ({ customer: () => pageCustomer(arg, arg2), items: pageItems, brief: pageBrief, client: () => pageClient(arg), pbm: pagePbHome, overview: pagePbHome, pb: pagePbHome, outbox: pageOutbox, company: pageCompany }[page] || pageCustomer)();
  }
  document.getElementById("asof").textContent = `기준일 ${D.as_of}${MK ? ` · 시장 ${MK.ref_date.slice(5).replace("-", "/")} 종가` : ""}`;
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
})();
