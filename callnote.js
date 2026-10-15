/* 통화 녹취 분석 (외부 AI 없이 규칙으로). 녹취록 텍스트 → 주제·핵심 내용·고객 요청·PB 약속·할 일·준법 점검.
   숫자는 녹취록에 나온 그대로만 쓰고 새로 만들지 않는다. PB가 확인한 뒤에만 기록으로 남긴다. */
(function () {
  const TOPICS = [
    ["예수금·RP", /(예수금|RP|알피|CMA|이용료|금리|이자)/],
    ["펀드·ELS 만기", /(만기|상환금|상환)/],
    ["유상증자 청약", /(청약|유상증자|신주)/],
    ["해외주식 세금", /(양도세|해외주식|세금|공제)/],
    ["연금저축", /(연금)/],
    ["신용·반대매매", /(신용|반대매매|담보)/],
    ["주가 등락", /(급락|급등|떨어졌|올랐|내렸|하락|상승)/],
  ];
  const PROMISE = /(드리겠습니다|드리겠어요|드릴게요|드리도록 하겠|잡아 드리|보내드리겠|연락드리겠|안내해 드리)/;
  const CUST_COMMIT = /(입금할게요|입금하겠습니다|넣을게요|넣겠습니다|보낼게요|가겠습니다|갈게요|생각해 볼게요|알아볼게요)/;
  const REQUEST = /(주세요|싶어요|싶습니다|되나요|될까요|괜찮은 거|궁금|해 줘|알려 줘|어떻게 하나요|하려고요|원해요|부탁)/;
  const GREETING = /^(안녕하세요|네[,.\s]|네$|고마워|감사합니다|여보세요)/;
  const AMOUNT = /(\d[\d,.]*\s*(?:억|천만|백만|만|천)?\s*(?:만\s*)?원|[일이삼사오육칠팔구십백천]+\s*(?:억|천만|백만|만)\s*원)/g;
  const PERCENT = /\d+(?:\.\d+)?\s*(?:%|퍼센트|프로)/g;
  const FORBIDDEN = [[/원금\s*(?:이\s*)?보장/, "원금 보장"], [/무조건/, "무조건"], [/확실히\s*(?:오|수익|벌)/, "확실히 ~"], [/수익\s*(?:이\s*)?보장/, "수익 보장"],
    [/(?:꼭|반드시)\s*오르/, "꼭 오른다"], [/손해\s*(?:볼\s*일|안\s*)/, "손해 안 본다"]];
  const DAYS = "일월화수목금토";
  const DAY = 864e5;

  function sentences(text) {
    return text.replace(/\r/g, "").split(/\n+|(?<=[.?!])\s+/).map(s => s.trim()).filter(s => s.length > 1);
  }

  function dueOf(s, today) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) { const t = new Date(d.getFullYear(), +m[1] - 1, +m[2]); if (t < d) t.setFullYear(t.getFullYear() + 1); return t; }
    if (/오늘/.test(s)) return d;
    if (/내일/.test(s)) return new Date(d.getTime() + DAY);
    if (/모레/.test(s)) return new Date(d.getTime() + 2 * DAY);
    m = s.match(/(이번\s*주|다음\s*주|담주)\s*([월화수목금토일])요일/);
    if (m) {                                        // 한 주는 월요일부터
      const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
      const t = new Date(monday.getTime() + ((DAYS.indexOf(m[2]) + 6) % 7) * DAY);
      if (/다음|담/.test(m[1]) || t < d) t.setDate(t.getDate() + 7);
      return t;
    }
    if (/다음\s*주/.test(s)) return new Date(d.getTime() + (7 - ((d.getDay() + 6) % 7)) * DAY);   // 다음 주 월요일
    if (/다음\s*달/.test(s)) return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return null;
  }
  const fmt = t => t ? `${t.getMonth() + 1}/${t.getDate()}(${DAYS[t.getDay()]})` : "기한 없음";
  const iso = t => t ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}` : null;
  const clean = s => s.replace(/^(네|아|음|그럼|그리고|일단)[,.\s]+/g, "").trim();
  const timeOf = s => (s.match(/(오전|오후|저녁|아침)/) || [])[1] || "";

  // PB 말투를 할 일 문장으로: "문자로 보내드릴게요" → "문자로 보내기"
  const VERB = [
    [/\s*보내\s*드리겠습니다\.?|\s*보내드리겠습니다\.?|\s*보내드릴게요\.?/, " 보내기"],
    [/\s*(?:전화|연락)\s*드리겠습니다\.?|\s*(?:전화|연락)\s*드릴게요\.?|\s*(?:전화|연락)드리겠습니다\.?|\s*(?:전화|연락)드릴게요\.?/, " 연락하기"],
    [/\s*잡아\s*드리겠습니다\.?|\s*잡아\s*드릴게요\.?/, " 잡기"],
    [/\s*안내(?:해)?\s*드리겠습니다\.?|\s*안내(?:해)?\s*드릴게요\.?/, " 안내하기"],
    [/\s*확인(?:해)?\s*드리겠습니다\.?|\s*확인(?:해)?\s*드릴게요\.?/, " 확인하기"],
    [/\s*해\s*드리겠습니다\.?|\s*드리겠습니다\.?|\s*드릴게요\.?/, " 하기"],
  ];
  function asTask(s) {
    let t = s.replace(/^(네|물론입니다|그럼)[,.\s]+/g, "").replace(/(는|은)\s+(오늘|내일|모레)/, " $2");
    for (const [re, to] of VERB) if (re.test(t)) { t = t.replace(re, to); break; }
    return t.replace(/\s+/g, " ").trim();
  }

  // 음성인식이 자주 잘못 듣는 말 바로잡기 (금융 용어)
  const FIX = [[/(아홉\s*이의?|아홉\s*비|아오피|아르피|알피|i\s*O\s*P|에이알피)/gi, "RP"], [/(?<![A-Za-z])P\s*V(?![A-Za-z])|피비/g, "PB"],
    [/예금\s*자\s*보호/g, "예금자보호"], [/(\d{1,2})\s*월\s*(\d{1,2})\s*에(?=\s)/g, "$1월 $2일에"], [/시월/g, "10월"], [/씨엠에이/g, "CMA"],
    [/반대\s*매매/g, "반대매매"], [/상완금/g, "상환금"]];
  const normalize = t => FIX.reduce((s, [re, to]) => s.replace(re, to), t);

  function analyze(text, opt) {
    opt = opt || {};
    text = normalize(text);
    const today = opt.today || new Date();
    const ss = sentences(text);
    const topics = TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t);
    const amounts = [...new Set((text.match(AMOUNT) || []).map(a => a.replace(/\s+/g, " ").trim()))];
    const percents = [...new Set((text.match(PERCENT) || []).map(p => p.replace(/\s+/g, "").replace(/퍼센트|프로/, "%")))];

    const promises = [], requests = [], commits = [], points = [];
    ss.forEach((s, i) => {
      if (PROMISE.test(s) && !/드렸습니다/.test(s)) {
        s.split(/(?<=다\.|요\.)\s*/).filter(x => PROMISE.test(x)).forEach(x => promises.push({ text: clean(x), due: dueOf(x, today), time: timeOf(x) }));
      } else if (CUST_COMMIT.test(s)) {
        commits.push({ text: clean(s), due: dueOf(s, today), time: timeOf(s) });
      } else if (REQUEST.test(s) && !GREETING.test(s)) {
        requests.push(clean(s));
      }
      const score = (s.match(AMOUNT) || []).length * 2 + (s.match(PERCENT) || []).length + (TOPICS.some(([, re]) => re.test(s)) ? 1 : 0);
      if (score >= 2 && !GREETING.test(s)) points.push({ s: clean(s), score, i });
    });
    const key = points.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map(p => p.s);

    // 준법 점검
    const checks = [];
    const has = re => re.test(text);
    if (has(/(RP|알피|CMA)/)) checks.push(has(/예금자\s*보호/) ? { ok: true, t: "RP·CMA 예금자보호 미적용 안내함" } : { ok: false, t: "RP·CMA가 예금자보호 대상이 아니라는 안내가 없음" });
    if (has(/(금리|퍼센트|%)/) && has(/(RP|알피|CMA)/)) checks.push(has(/(바뀔|변동|달라질)/) ? { ok: true, t: "금리 변동 가능성 안내함" } : { ok: false, t: "금리가 바뀔 수 있다는 안내가 없음" });
    if (has(/(가입|신청|매수)/)) checks.push(has(/(직접|본인\s*인증)/) ? { ok: true, t: "가입은 고객이 직접 한다고 안내함" } : { ok: false, t: "고객이 직접 가입한다는 안내가 없음 (대리 가입 오해 소지)" });
    if (has(/(신용|담보)/)) checks.push(has(/반대매매/) ? { ok: true, t: "반대매매 가능성 안내함" } : { ok: false, t: "신용 상담인데 반대매매 안내가 없음" });
    if (has(/연금/)) checks.push(has(/원금\s*손실/) ? { ok: true, t: "연금저축 원금 손실 가능성 안내함" } : { ok: false, t: "연금저축 원금 손실·예금자보호 미적용 안내가 없음" });
    FORBIDDEN.forEach(([re, w]) => { if (re.test(text)) checks.push({ ok: false, t: `단정적 표현 "${w}" 사용` }); });

    // 할 일: PB 약속 + 고객이 한 약속 확인 + 고객 요청 후속 + 준법 보완
    const todos = promises.map(p => ({ text: asTask(p.text), due: iso(p.due), dueLabel: fmt(p.due) + (p.time ? " " + p.time : ""), from: "PB 약속" }));
    commits.forEach(c => todos.push({ text: `고객 약속 확인: "${c.text}"`, due: iso(c.due), dueLabel: fmt(c.due) + (c.time ? " " + c.time : ""), from: "고객 약속" }));
    requests.forEach(r => {
      const amt = (r.match(AMOUNT) || [])[0];
      if (amt && /(해 보고 싶|하고 싶|하려고)/.test(r)) todos.push({ text: `고객이 말한 ${amt.replace(/\s+/g, " ")} 진행 여부 확인 (가입은 고객이 직접)`, due: null, dueLabel: "다음 연락 때", from: "고객 요청" });
      if (/(전화|연락)\s*(주세요|줘)/.test(r) && !promises.some(p => /(연락|전화)/.test(p.text))) todos.push({ text: "고객이 요청한 재연락 일정 잡기", due: null, dueLabel: "기한 없음", from: "고객 요청" });
    });
    checks.filter(c => !c.ok).forEach(c => todos.push({ text: `준법 보완: ${c.t} → 다음 통화나 문자로 안내`, due: iso(today), dueLabel: fmt(today), from: "준법 점검" }));
    todos.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

    const firstAmt = requests.map(r => (r.match(AMOUNT) || [])[0]).find(Boolean);
    const next = todos.find(t => t.from === "PB 약속" && t.due);
    const headline = `${topics.slice(0, 2).join(", ") || "일반"} 상담` + (firstAmt ? ` · 고객 ${firstAmt.replace(/\s+/g, " ")} 의향` : "") + (next ? ` · ${next.dueLabel} 후속` : "");

    return { headline, topics, key, requests: requests.slice(0, 4), promises: promises.map(p => p.text), commits: commits.map(c => c.text),
      amounts, percents, checks, todos, stats: { sentences: ss.length, chars: text.length } };
  }

  window.CallNote = { analyze, normalize };
})();
