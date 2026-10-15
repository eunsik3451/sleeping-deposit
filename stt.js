/* 통화 녹음 → 녹취록 (브라우저 안에서 Whisper 실행. 녹음 파일은 어디로도 전송되지 않는다).
   처음 한 번은 음성인식 모델을 내려받는다 (이후 브라우저 캐시).
   긴 녹음은 말이 끊기는 곳에서 짧게 나눠 하나씩 받아쓴다 (30초 단위로 자르면 경계에서 문장이 빠지고 반복 오류가 생김). */
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL = "onnx-community/whisper-base";
const SR = 16000;
let asr = null;

async function load(onProgress) {
  if (asr) return asr;
  const { pipeline, env } = await import(LIB);
  env.allowLocalModels = false;
  const files = {};
  asr = await pipeline("automatic-speech-recognition", MODEL, {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: p => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        const all = Object.values(files), total = all.reduce((s, f) => s + f.total, 0), loaded = all.reduce((s, f) => s + f.loaded, 0);
        onProgress && onProgress({ stage: "download", ratio: total ? loaded / total : 0, mb: total / 1e6 });
      }
    },
  });
  return asr;
}

async function decode(input) {
  const buf = input instanceof Blob ? await input.arrayBuffer() : await (await fetch(input)).arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  const audio = await ctx.decodeAudioData(buf);
  ctx.close();
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const a = audio.getChannelData(0), b = audio.getChannelData(1), mono = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
  return mono;
}

// 말이 끊기는 곳(0.3초 이상 조용한 구간)에서 나누고, 한 조각은 최대 20초
function segments(x) {
  const F = Math.round(SR * 0.03), n = Math.floor(x.length / F), rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * F; j < (i + 1) * F; j++) s += x[j] * x[j]; rms[i] = Math.sqrt(s / F); }
  const sorted = Array.from(rms).sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.2)] || 0, peak = sorted[Math.floor(n * 0.95)] || 0;
  const thr = floor + (peak - floor) * 0.08;
  const out = []; let start = null, quiet = 0;
  for (let i = 0; i < n; i++) {
    const loud = rms[i] > thr;
    if (loud && start === null) start = Math.max(0, i - 5);
    if (start !== null) {
      quiet = loud ? 0 : quiet + 1;
      const len = (i - start) * 0.03;
      if ((quiet >= 10 && len >= 1) || len >= 20 || i === n - 1) {
        out.push(x.subarray(start * F, Math.min(x.length, (i + 1) * F)));
        start = null; quiet = 0;
      }
    }
  }
  return out.length ? out : [x];
}

// 반복 오류 제거: 같은 2~6글자 덩어리가 4번 넘게 이어지면 잘라낸다
const dedupe = t => t.replace(/(.{2,6}?)(?:[\s,']*\1){3,}/g, "$1").trim();

async function transcribe(input, onProgress) {
  const t0 = performance.now();
  const model = await load(onProgress);
  onProgress && onProgress({ stage: "decode" });
  const x = await decode(input);
  const parts = segments(x), lines = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress && onProgress({ stage: "transcribe", done: i, total: parts.length, seconds: x.length / SR });
    const out = await model(parts[i], { language: "korean", task: "transcribe", no_repeat_ngram_size: 4 });
    const t = dedupe((out.text || "").trim());
    if (t && !/^[\s.,!?'"]*$/.test(t)) lines.push(t);
  }
  return { text: lines.join("\n"), seconds: x.length / SR, took: (performance.now() - t0) / 1000, segments: parts.length };
}

window.STT = { transcribe, model: MODEL };
