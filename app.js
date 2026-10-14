/* 잠자는 예수금 깨우기 — 정적 웹 데모.
   계산은 전부 파이썬 엔진(scripts/export_site.py)이 끝낸 결과(data.js)를 쓴다.
   데모 버튼(재진단·자동 RP 신청·PB 처리)은 보는 사람 브라우저에만 저장된다. */
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
    const fs = D.details[cid].findings.map(f => (S.reassessed[cid] && D.after_reassess[f.finding_id]) || f);
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

  // ════════════════ ① 고객 앱 화면 ════════════════
  function customerOrder() {
    const amt = {};
    D.customers.forEach(c => { amt[c.id] = D.details[c.id].findings.reduce((s, f) => s + f.amount_krw, 0); });
    const rest = D.customers.map(c => c.id).filter(id => !PERSONAS.includes(id));
    rest.sort((a, b) => (amt[b] - amt[a]) || ((CUST[b].found ? 1 : 0) - (CUST[a].found ? 1 : 0)) || a.localeCompare(b));
    return { ids: [...PERSONAS, ...rest], amt };
  }

  function pageCustomer(cid) {
    const { ids, amt } = customerOrder();
    cid = CUST[cid] ? cid : "P003";
    const c = CUST[cid], fs = findingsOf(cid), found = foundOf(cid), det = D.details[cid];
    const reassessed = S.reassessed[cid];
    const valid = c.diag_valid || !!reassessed;
    const consent = [c.consent_push && "앱 푸시", c.consent_kakao && "알림톡"].filter(Boolean);
    const willMiss = c.will_miss - (S.auto[cid] !== undefined ? det.findings.filter(f => f.rule === "R1" && f.currency === "KRW").reduce((s, f) => s + f.annual_projection_krw, 0) : 0);
    const opts = ids.map(id => {
      const x = CUST[id];
      const tag = x.persona ? ` · 데모: ${x.persona}` : amt[id] ? ` · 챙길 돈 ${man(amt[id])}` : "";
      return `<option value="${id}" ${id === cid ? "selected" : ""}>${id} ${esc(x.name)} (${x.age}세, ${x.risk})${esc(tag)}</option>`;
    }).join("");
    const ms = AS_OF.getMonth() + 1;

    $app.innerHTML = `
      <h1>고객 앱 화면</h1>
      <p class="lead">고객 본인이 앱에서 보는 '잠자는 예수금 깨우기'를 재현했습니다. 계좌·거래 데이터만으로 쉬고 있는 돈과 놓친 이자, 기한이 있는 일정을 찾아 보여줍니다.</p>
      <div class="note">버튼(재진단, 예수금 자동 RP 신청, 매수 화면 이동)은 <b>고객 본인이 앱에서 직접 누르는 상황</b>을 재현합니다. 직원이 대신 가입하거나 실행하는 기능은 없습니다.
        눌러 본 결과는 이 브라우저에만 저장됩니다. <button class="btn link" id="reset">데모 처음으로</button></div>
      <select class="select" id="cid" aria-label="고객 선택">${opts}</select>
      <div style="margin-top:10px">${badge(c.age + "세")}${badge(reassessed || c.risk)}
        ${valid ? badge(`진단 ${reassessed ? D.as_of : c.diag} 유효`, "ok") : badge(`진단 ${c.diag} 만료`, "warn")}
        ${consent.length ? badge("광고 동의: " + consent.join("·")) : badge("광고 수신 동의 없음", "warn")}
        ${found ? badge("예수금 자동 RP 이용 중", "ok") : ""}</div>
      <div class="metrics">
        <div class="metric"><div class="k">이번 달 못 받은 이자 (${ms}/1–${ms}/${AS_OF.getDate()})</div><div class="v accent">${man(c.missed_month)}</div></div>
        <div class="metric"><div class="k">깨우면 1년에 더 받을 이자</div><div class="v">${man(willMiss)}</div></div>
        <div class="metric"><div class="k">깨운 뒤 받은 이자</div><div class="v ok">${found ? won(found.found_krw) : "0원"}</div></div>
        <div class="metric"><div class="k">함께 챙길 것 (절세·청약·만기·연금)</div><div class="v">${man(fs.filter(f => f.rule !== "R1").reduce((s, f) => s + f.amount_krw, 0))}</div></div>
      </div>
      ${det.trend.start ? `<h2>최근 6개월 예수금과 쉬는 돈</h2>${lineChart(det.trend)}
        <p class="muted">쉬는 돈 = 예수금 − 미결제 매수금 − 평소 쓰는 돈(최근 3개월 중 하루에 가장 많이 쓴 금액). 달러는 원화로 환산.</p>` : ""}
      <h2>지금 확인할 것</h2>
      ${found ? foundCard(found) : ""}
      ${fs.map(f => f.rule === "R1" ? r1Card(f, cid) : itemCard(f)).join("")}
      ${!fs.length && !found ? `<div class="okbox">지금은 쉬고 있는 돈이 없어요. 예수금이 잘 쓰이고 있어요.</div>` : ""}
      <h2>이 고객에게 나가는 안내 (예시)</h2>
      <p class="muted">실제로 보내지 않습니다. 엔진이 계산한 숫자를 템플릿에 채우고, 검증기(숫자 일치·정보성 금칙어·글자 수)를 통과한 문장만 씁니다.
        말투는 나이에 맞춰 바뀝니다 (60대 이상 쉬운 말, 40·50대 표준, 20·30대 숫자 먼저).</p>
      <div class="phones">${det.previews.filter(p => p.channel !== "pb_queue").map(previewBlock).join("")}</div>
      ${det.previews.filter(p => p.channel === "pb_queue").map(p => `<h2 style="font-size:1rem">${esc(p.label)}</h2>${p.note ? `<p class="muted">${esc(p.note)}</p>` : ""}${phone(p)}`).join("")}
    `;
    $app.querySelector("#cid").onchange = e => (location.hash = `#customer/${e.target.value}`);
    $app.querySelector("#reset").onclick = () => { S = { reassessed: {}, auto: {}, pb: {}, log: [] }; save(); toast("데모 상태를 처음으로 되돌렸어요"); render(); };
    $app.querySelectorAll("[data-act]").forEach(b => (b.onclick = () => act(b.dataset.act, cid, b.dataset.fid)));
    $app.querySelectorAll("input[data-doc]").forEach(ch => (ch.onchange = () => {
      const b = $app.querySelector(`[data-act=buy][data-fid="${ch.dataset.doc}"]`); if (b) b.disabled = !ch.checked;
    }));
  }

  function evidence(f) {
    return `<details><summary>근거 보기</summary><ul>${f.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>`;
  }

  function r1Card(f, cid) {
    const m = f.meta, rec = f.recommendation, fid = esc(f.finding_id), krw = f.currency === "KRW";
    let body = "";
    if (f.action.type === "reassess") {
      body = `<div class="warnbox">투자성향 진단 유효기간이 지나 지금은 바로 시작할 수 없어요. 진단을 다시 받으면 이용할 수 있는 방법이 열려요.</div>
        <div class="btns"><button class="btn primary" data-act="reassess" data-fid="${fid}">투자성향 다시 진단하기</button>
        ${krw ? `<button class="btn" disabled title="투자성향 진단 후 이용할 수 있어요">예수금 자동 RP 신청</button>` : ""}</div>`;
    } else if (f.action.type === "pb_consult") {
      body = `<div class="btns"><button class="btn primary" data-act="pbcall" data-fid="${fid}">담당 PB와 상담하기</button></div>`;
    } else if (rec.product_id === "AUTO_RP") {
      const p = D.products.AUTO_RP;
      body = `<div class="product"><b>예수금 자동 RP</b> · 연 ${pct(p.rate)} · ${p.grade}등급(${p.grade_label})<br>
        <span class="muted">주식을 대신 사고팔지 않고, 매수할 때 자동으로 빠져서 매매에 지장이 없어요. 매수 대기 자금이라 약정식 RP는 권하지 않아요.</span>${protectLine}</div>
        <div class="btns"><button class="btn primary" data-act="auto" data-fid="${fid}">예수금 자동 RP 신청</button></div>`;
    } else {
      const p = D.products[rec.product_id];
      const others = (rec.candidates || []).filter(x => x !== rec.product_id).map(x => D.products[x].name);
      body = `<div class="product"><b>${esc(p.name)}</b> · 연 ${pct(p.rate)} · ${p.grade}등급(${p.grade_label})<br>
        <span class="muted">맡길 수 있는 금액 ${money(rec.suggest_amount, f.currency)}${others.length ? " · 다른 선택: " + esc(others.join(", ")) : ""}</span>${protectLine}</div>
        <label class="check"><input type="checkbox" data-doc="${fid}"> 상품설명서를 확인했어요</label>
        <div class="btns"><button class="btn primary" data-act="buy" data-fid="${fid}" disabled>데모: 매수 화면으로 이동</button>
        ${krw ? `<button class="btn" data-act="auto" data-fid="${fid}">예수금 자동 RP 신청</button>` : ""}
        ${f.subtype === "event_inflow" ? `<button class="btn" data-act="pbcall" data-fid="${fid}">PB와 재투자 상담</button>` : ""}</div>`;
    }
    return `<div class="card">${badge(f.subtype_label)}${badge(krw ? "원화" : "달러")}${f.pb_flag ? badge("PB 연결 대상", "accent") : ""}
      <div class="card-title">${esc(f.title)}</div>
      <div class="nums"><div><div class="k">${esc(f.amount_label)}</div><div class="big">약 ${man(f.amount_krw)}</div></div>
        <div><div class="k">이대로 1년 두면</div><div class="big ink">약 ${man(f.annual_projection_krw)}</div></div>
        <div><div class="k">지금 쉬고 있는 돈</div><div class="big ink">${man(m.idle_krw)}</div></div></div>
      ${evidence(f)}${body}
      <button class="btn link" data-act="dismiss" data-fid="${fid}">괜찮아요, 지금은 그대로 둘게요</button></div>`;
  }

  function itemCard(f) {
    const dl = f.meta.days_left, fid = esc(f.finding_id);
    return `<div class="card">${badge(f.subtype_label)}${badge(`마감 ${f.deadline} · D-${dl}`, dl <= 7 ? "warn" : "")}${f.pb_flag ? badge("PB 연결 대상", "accent") : ""}
      <div class="card-title">${esc(f.title)}</div>
      <div class="k muted">${esc(f.amount_label)}</div><div class="big">약 ${man(f.amount_krw)}</div>
      ${f.rule === "R4" ? `<div class="muted">상환 예정 금액 ${man(f.meta.expected)}</div>` : ""}
      ${evidence(f)}
      <div class="btns"><button class="btn primary" data-act="item" data-fid="${fid}">${esc(f.action.label)}</button>
        <button class="btn" data-act="pbcall" data-fid="${fid}">PB와 상담하기</button></div>
      <button class="btn link" data-act="dismiss" data-fid="${fid}">괜찮아요, 지금은 넘어갈게요</button></div>`;
  }

  function foundCard(fd) {
    return `<div class="card">${badge("예수금 자동 RP 이용 중", "ok")}
      <div class="card-title">예수금을 깨운 뒤 받은 이자</div>
      <div class="nums"><div><div class="k">받은 이자 (${fd.days}일)</div><div class="big ok">${won(fd.found_krw)}</div></div>
        <div><div class="k">지금 RP에 있는 돈</div><div class="big ink">${man(fd.invested_krw)}</div></div>
        <div><div class="k">이대로 1년이면</div><div class="big ink">약 ${man(fd.annual_krw)}</div></div></div>
      <p class="muted">${fd.on_date ? fd.on_date + "에 신청" : "신청일 기록 없음"} · 남겨둘 금액을 넘는 돈에 연 ${pct(RP)}를 적용한 시뮬레이션${fd.demo ? " (오늘 신청했다고 가정한 첫날 이자)" : ""}</p></div>`;
  }

  function findF(cid, fid) { return findingsOf(cid).find(f => f.finding_id === fid); }

  function act(kind, cid, fid) {
    const f = findF(cid, fid);
    if (kind === "dismiss") return toast(`${D.rules.snooze}일 동안 이 알림을 보내지 않아요`);
    if (kind === "pbcall") return toast("담당 PB에게 상담 요청을 보냈어요 (데모)");
    if (kind === "reassess") return reassessDialog(cid);
    if (kind === "auto") return autoDialog(cid, f);
    if (kind === "buy") {
      const p = D.products[f.recommendation.product_id];
      return modal(`<h3>데모: 매수 화면으로 이동</h3>
        <p>실서비스에서는 고객 앱의 <b>${esc(p.name)}</b> 매수 화면으로 이동하고, 금액 <b>${money(f.recommendation.suggest_amount, f.currency)}</b>이 미리 채워집니다. 고객이 본인 인증 후 직접 주문합니다.</p>${protectLine}
        <p class="muted">프로토타입이라 실제 주문은 연동하지 않습니다.</p><div class="btns"><button class="btn primary" data-close>확인</button></div>`);
    }
    if (kind === "item") {
      const m = f.meta;
      const text = f.rule === "R2"
        ? `<p>고객 앱의 <b>해외주식 손익 화면</b>으로 이동합니다. 종목별 평가손익과 올해 실현손익이 함께 보입니다.</p>
           <ul><li>올해 실현이익 ${won(m.realized)}</li><li>평가손실 ${won(m.loss)} · 평가이익 ${won(m.gain)}</li><li>계산상 줄일 수 있는 세금 약 ${man(f.amount_krw)} (마지막 매도일 ${f.deadline})</li></ul>
           <p class="muted">매도 여부는 고객이 판단합니다. 다른 증권사 손익은 반영하지 않습니다.</p>`
        : f.rule === "R3"
        ? `<p>고객 앱의 <b>유상증자 청약 화면</b>으로 이동합니다. ${esc(m.stock)} 청약 가능 수량 ${m.shares.toLocaleString("ko-KR")}주가 미리 채워집니다.</p>
           <ul><li>청약가 ${won(m.issue_price)} · 현재가 ${won(m.now)}</li><li>청약 기간 ${m.start} ~ ${f.deadline}</li></ul>
           <p class="muted">청약 여부는 고객이 판단합니다. 주가가 바뀌면 차이도 달라집니다.</p>`
        : f.rule === "R5"
        ? `<p>고객 앱의 <b>연금저축 입금 화면</b>으로 이동합니다.</p>
           <ul><li>올해 납입 ${won(m.paid)} / 한도 ${won(m.limit)}</li><li>남은 한도 ${won(m.remain)} → 다 채우면 약 ${man(f.amount_krw)} 환급 (${f.deadline}까지 납입분)</li></ul>
           <div class="protect">연금저축계좌는 펀드·ETF 등에 투자해 원금 손실이 날 수 있고 예금자보호 대상이 아닙니다.</div>
           <p class="muted">다른 금융사 납입분은 반영하지 않습니다. 입금은 고객이 직접 합니다.</p>`
        : `<p>만기 뒤 상환금을 어디에 둘지 미리 정하는 화면입니다.</p>
           <ul><li>${esc(m.product_name)} 만기 ${f.deadline}, 상환 예정 ${man(m.expected)}</li>
           <li>선택지: 예수금 자동 RP 신청(쓸 때 자동으로 빠짐) · 담당 PB와 재투자 상담 · 그대로 두기</li></ul>
           <p class="muted">재투자를 권유하지 않습니다. 가입은 고객이 앱에서 직접 합니다.</p>`;
      return modal(`<h3>앱에서 직접 진행 (데모)</h3>${text}<div class="btns"><button class="btn primary" data-close>확인</button></div>`);
    }
  }

  function autoDialog(cid, f) {
    const buffer = f ? Math.round(f.meta.buffer_krw) : 1000000, p = D.products.AUTO_RP;
    modal(`<h3>예수금 자동 RP 신청</h3>
      <p><b>주식이나 펀드를 대신 사고팔지 않아요.</b> 정한 금액을 넘는 예수금만 RP에 넣어 두고, 주식을 사거나 출금할 때 필요한 만큼 자동으로 빼요.</p>
      <label>남겨둘 금액 (원)<input type="number" id="keep" min="0" step="100000" value="${buffer}"></label>
      <p class="muted small" id="keepman">남겨둘 금액 ${man(buffer)} · 기본값은 최근 3개월 중 하루에 가장 많이 쓰신 금액이에요.</p>
      <details><summary>상품설명서 요약 (데모)</summary><ul><li>위험등급 ${p.grade}등급(${p.grade_label})</li><li>금리 연 ${pct(p.rate)} (변동될 수 있음)</li>
        <li>${PROTECT}</li><li>언제든 해지할 수 있고, 해지하면 다음 영업일부터 예수금으로 남음</li></ul></details>
      ${protectLine}<label class="check"><input type="checkbox" id="c1"> 상품설명서를 확인했어요 (예금자보호 대상이 아님을 포함)</label>
      <label class="check"><input type="checkbox" id="c2"> 예수금 자동 RP 이용에 동의해요</label>
      <div class="btns"><button class="btn primary" id="go" disabled>신청하기</button><button class="btn" data-close>닫기</button></div>`, dlg => {
      const keep = dlg.querySelector("#keep"), go = dlg.querySelector("#go"), c1 = dlg.querySelector("#c1"), c2 = dlg.querySelector("#c2");
      const upd = () => { go.disabled = !(c1.checked && c2.checked); dlg.querySelector("#keepman").textContent = `남겨둘 금액 ${man(+keep.value || 0)} · 기본값은 최근 3개월 중 하루에 가장 많이 쓰신 금액이에요.`; };
      [keep, c1, c2].forEach(el => (el.oninput = el.onchange = upd));
      go.onclick = () => {
        S.auto[cid] = Math.max(0, +keep.value || 0); save(); closeModal();
        toast(`예수금 자동 RP를 신청했어요. ${won(S.auto[cid])}을 넘는 예수금만 RP에 넣어요.`); render();
      };
    });
  }

  function reassessDialog(cid) {
    const q = [["투자해 본 상품", ["예적금만", "RP·채권 정도", "주식·펀드", "파생상품까지"]],
      ["원금 손실은 어디까지 괜찮으세요?", ["손실은 싫어요", "조금은 괜찮아요", "어느 정도 감수해요", "크게 감수할 수 있어요"]],
      ["투자하실 기간", ["1년 미만", "1~3년", "3년 이상"]]];
    const PROFILES = ["안정형", "안정추구형", "위험중립형", "적극투자형", "공격투자형"];
    modal(`<h3>투자성향 다시 진단하기</h3><p class="muted small">데모용 간이 진단입니다. 실서비스는 회사 투자성향 진단 절차를 그대로 따릅니다.</p>
      ${q.map(([t, opts], i) => `<fieldset><legend>${t}</legend>${opts.map((o, j) => `<label class="check"><input type="radio" name="q${i}" value="${j}" ${j === 0 ? "checked" : ""}> ${o}</label>`).join("")}</fieldset>`).join("")}
      <div class="okbox" id="res"></div>
      <div class="btns"><button class="btn primary" id="go">진단 완료</button><button class="btn" data-close>닫기</button></div>`, dlg => {
      const score = () => [0, 1, 2].reduce((s, i) => s + +dlg.querySelector(`input[name=q${i}]:checked`).value, 0);
      const prof = () => PROFILES[Math.min(4, Math.floor(score() / 2))];
      const upd = () => (dlg.querySelector("#res").textContent = `진단 결과: ${prof()}`);
      dlg.querySelectorAll("input").forEach(el => (el.onchange = upd)); upd();
      dlg.querySelector("#go").onclick = () => {
        S.reassessed[cid] = prof(); save(); closeModal();
        toast(`투자성향을 ${S.reassessed[cid]}으로 다시 진단했어요. 이제 바로 시작할 수 있어요.`); render();
      };
    });
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
  // 한 화면에서 "누구에게, 왜, 무슨 말로" 연락할지. 목록은 고객 단위, 오른쪽(모바일은 시트)에 상세.
  const PB_BY_FID = Object.fromEntries(D.pb.map(r => [r.finding_id, r]));
  const PB_STATUS = { called: "통화 완료", joined: "고객이 앱에서 직접 가입함", later: "나중에 연락" };
  let pbm = { tab: "today", q: "", cid: null, fid: null, sheet: false };

  function pbCustomers() {
    return D.customers.map(c => {
      const fs = findingsOf(c.id);
      if (!fs.length) return null;
      const calls = fs.filter(f => PB_BY_FID[f.finding_id]);
      const total = fs.reduce((s, f) => s + (f.rule === "R1" ? f.annual_projection_krw : f.amount_krw), 0);
      const deadlines = fs.filter(f => f.deadline).map(f => daysLeft(f.deadline));
      const rank = calls.length ? Math.min(...calls.map(f => PB_BY_FID[f.finding_id].rank)) : 1e9;
      const reasons = [...new Set(calls.flatMap(f => PB_BY_FID[f.finding_id].reasons))];
      const lead = (calls[0] || fs[0]);
      return { c, fs, calls, total, rank, reasons, lead, soon: deadlines.length ? Math.min(...deadlines) : null };
    }).filter(Boolean);
  }

  function scriptSteps(body) {
    return String(body).split("\n").filter(Boolean).map(line => {
      const m = line.match(/^\[(.+?)\]\s*(.*)$/);
      return m ? [m[1], m[2]] : ["", line];
    });
  }

  function pagePbHome() {
    const all = pbCustomers();
    const today = all.filter(r => r.calls.length).sort((a, b) => a.rank - b.rank);
    const soon = all.filter(r => r.soon !== null && r.soon <= 7).sort((a, b) => a.soon - b.soon);
    const every = all.slice().sort((a, b) => b.total - a.total);
    const lists = { today, soon, all: every };
    const q = pbm.q;
    const rows = lists[pbm.tab].filter(r => !q || (r.c.id + r.c.name).includes(q));
    if (!pbm.cid || !rows.find(r => r.c.id === pbm.cid)) { pbm.cid = rows[0] && rows[0].c.id; pbm.fid = null; }
    const sel = rows.find(r => r.c.id === pbm.cid);
    const doneCount = today.filter(r => S.pb[r.c.id]).length;

    $app.innerHTML = `<div class="pbm ${pbm.sheet ? "sheet-open" : ""}">
      <div class="pbm-head">
        <div><h1>오늘 연락할 고객 ${today.length}명</h1>
          <p class="sub">${doneCount ? `${doneCount}명 처리했어요 · ` : ""}금액·근거·통화 스크립트까지 준비해 뒀어요</p></div>
      </div>
      <div class="pbm-stats">
        <div><span>오늘 연락</span><b>${today.length}명</b></div>
        <div><span>마감 7일 이내</span><b>${soon.length}명</b></div>
        <div><span>담당 고객이 챙길 돈</span><b>${man(every.reduce((s, r) => s + r.total, 0))}</b></div>
      </div>
      <div class="pbm-tools">
        <div class="seg" role="tablist">${[["today", "오늘 연락", today.length], ["soon", "마감 임박", soon.length], ["all", "전체 고객", every.length]]
          .map(([k, t, n]) => `<button role="tab" class="${pbm.tab === k ? "on" : ""}" data-tab="${k}">${t} <em>${n}</em></button>`).join("")}</div>
        <input class="pill" type="search" id="pbq" placeholder="이름이나 고객번호로 찾기" value="${esc(q)}">
      </div>
      <div class="pbm-body">
        <ul class="pbm-list">${rows.map(r => pbRow(r)).join("") || `<li class="empty">해당하는 고객이 없어요</li>`}</ul>
        <section class="pbm-detail">${sel ? pbDetail(sel) : `<p class="sub">왼쪽에서 고객을 고르세요</p>`}</section>
      </div></div>`;

    $app.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => { pbm.tab = b.dataset.tab; pbm.cid = null; pagePbHome(); }));
    const input = $app.querySelector("#pbq");
    input.oninput = () => { pbm.q = input.value.trim(); pagePbHome(); const n = $app.querySelector("#pbq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $app.querySelectorAll("[data-cid]").forEach(li => (li.onclick = () => { pbm.cid = li.dataset.cid; pbm.fid = null; pbm.sheet = true; pagePbHome(); }));
    $app.querySelectorAll("[data-fid]").forEach(li => (li.onclick = () => { pbm.fid = li.dataset.fid; pagePbHome(); }));
    $app.querySelectorAll("[data-st]").forEach(b => (b.onclick = () => {
      S.pb[pbm.cid] = b.dataset.st; save(); toast(`${PB_STATUS[b.dataset.st]}으로 기록했어요`); pagePbHome();
    }));
    const back = $app.querySelector("[data-back]");
    if (back) back.onclick = () => { pbm.sheet = false; pagePbHome(); };
    const undo = $app.querySelector("[data-undo]");
    if (undo) undo.onclick = () => { delete S.pb[pbm.cid]; save(); pagePbHome(); };
  }

  function pbRow(r) {
    const st = S.pb[r.c.id];
    const sub = r.reasons.length ? r.reasons.slice(0, 2).join(" · ") : r.lead.title;
    return `<li class="${r.c.id === pbm.cid ? "on" : ""} ${st ? "done" : ""}" data-cid="${r.c.id}">
      <span class="ava">${esc(r.c.name.slice(0, 1))}</span>
      <span class="who"><b>${esc(r.c.name)}</b><small>${r.c.age}세 · ${r.c.id}</small><i>${esc(st ? PB_STATUS[st] : sub)}</i></span>
      <span class="amt"><b>${man(r.total)}</b>${r.soon !== null && r.soon <= 7 ? `<small class="due">D-${r.soon}</small>` : `<small>챙길 돈</small>`}</span></li>`;
  }

  function pbDetail(r) {
    const c = r.c, fs = r.fs;
    const f = fs.find(x => x.finding_id === pbm.fid) || r.calls[0] || fs[0];
    const st = S.pb[c.id];
    const consent = c.consent_push || c.consent_kakao;
    const facts = [`${c.age}세`, c.risk, c.diag_valid || S.reassessed[c.id] ? "투자성향 진단 유효" : "투자성향 진단 만료", consent ? "광고 수신 동의" : "광고 미동의 · PB 연락만 가능"];
    const pb = PB_BY_FID[f.finding_id];
    return `<button class="back" data-back>← 목록</button>
      <div class="who-big"><span class="ava lg">${esc(c.name.slice(0, 1))}</span>
        <div><h2>${esc(c.name)}님</h2><p class="sub">${facts.map(esc).join(" · ")}</p></div></div>
      <div class="total"><span>챙길 돈</span><b>${man(r.total)}</b></div>
      ${st ? `<div class="state">${PB_STATUS[st]} <button class="txt" data-undo>되돌리기</button></div>` : ""}

      <h3>챙길 것 ${fs.length}가지</h3>
      <ul class="items">${fs.map(x => `<li class="${x.finding_id === f.finding_id ? "on" : ""}" data-fid="${esc(x.finding_id)}">
        <span><b>${esc(x.title)}</b><small>${esc(x.subtype_label)}${x.deadline ? ` · D-${daysLeft(x.deadline)}` : ""}${PB_BY_FID[x.finding_id] ? " · 연락 대상" : ""}</small></span>
        <em>${man(x.rule === "R1" ? x.annual_projection_krw : x.amount_krw)}</em></li>`).join("")}</ul>

      <h3>이렇게 말해 보세요</h3>
      <ol class="steps">${scriptSteps(f.script).map(([k, t]) => `<li><span>${esc(k)}</span><p>${esc(t)}</p></li>`).join("")}</ol>

      <details class="why"><summary>왜 이 고객인가요?</summary>
        ${pb ? `<p class="sub">${esc(pb.reasons.join(" · "))}</p>` : ""}
        <ul>${f.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>

      <div class="acts">
        <button class="cta" data-st="called">통화 완료</button>
        <div class="row"><button class="ghost" data-st="joined">고객이 앱에서 직접 가입함</button><button class="ghost" data-st="later">나중에</button></div>
        <a class="link" href="#customer/${c.id}">고객이 보는 앱 화면 보기</a>
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
    const [page, arg] = (location.hash.slice(1) || "customer").split("/");
    const tab = page === "overview" || page === "pb" ? "pbm" : page;
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.page === tab));
    document.body.classList.toggle("is-pbm", tab === "pbm");
    ({ customer: () => pageCustomer(arg), items: pageItems, pbm: pagePbHome, overview: pagePbHome, pb: pagePbHome, outbox: pageOutbox, company: pageCompany }[page] || pageCustomer)();
  }
  document.getElementById("asof").textContent = `기준일 ${D.as_of}`;
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
})();
