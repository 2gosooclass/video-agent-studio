// @remotion/sfx 및 예능 방송용 효과음 생성 · 캐시 · FFmpeg 오디오 믹싱 모듈
// 온라인일 때는 공식 Remotion SFX (https://remotion.media/*.wav)를 캐시하고,
// 오프라인이거나 즉시 합성이 필요할 때는 44.1kHz PCM 파형 합성으로 100% 무결점 WAV를 즉시 생성한다.
const fs = require('fs');
const path = require('path');

const REMOTION_SFX_URLS = {
  whoosh: 'https://remotion.media/whoosh.wav',
  ding: 'https://remotion.media/ding.wav',
  mouseClick: 'https://remotion.media/mouse-click.wav',
  pageTurn: 'https://remotion.media/page-turn.wav',
  vineBoom: 'https://remotion.media/vine-boom.wav',
  uiSwitch: 'https://remotion.media/ui-switch.wav',
};

const SFX_LABELS = {
  auto: '자동 (문맥 맞춤)',
  whoosh: '휙 (whoosh · 장면전환)',
  ding: '띵 (ding · 핵심강조)',
  vineBoom: '쿵 (vineBoom · 반전/임팩트)',
  mouseClick: '딸깍 (mouseClick · 클릭)',
  pageTurn: '촤락 (pageTurn · 슬라이드)',
  uiSwitch: '탁 (uiSwitch · 팝업)',
  none: '효과음 없음',
};

// 16-bit 44.1kHz Mono WAV 헤더 + 샘플 작성기
function writeWav(filePath, samples, sampleRate = 44100) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(1, 22);  // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// 오프라인에서도 즉각 작동하는 물리 모델링 기반 효과음 파형 합성기
function synthesizeSfxWav(kind, outPath) {
  const sr = 44100;
  if (kind === 'ding') {
    // 맑고 청아한 벨 하모닉스 (880Hz + 1760Hz + 2640Hz)
    const dur = 0.65;
    const len = Math.floor(sr * dur);
    const samples = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 6.5) * Math.min(1, t * 250);
      samples[i] = env * (
        0.55 * Math.sin(2 * Math.PI * 1046.5 * t) +
        0.30 * Math.sin(2 * Math.PI * 2093.0 * t) * Math.exp(-t * 10) +
        0.15 * Math.sin(2 * Math.PI * 3139.5 * t) * Math.exp(-t * 16)
      );
    }
    return writeWav(outPath, samples, sr);
  }

  if (kind === 'vineBoom') {
    // 묵직한 서브베이스 드롭 (140Hz -> 32Hz) + 어택 펀치
    const dur = 0.85;
    const len = Math.floor(sr * dur);
    const samples = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const freq = 34 + 115 * Math.exp(-t * 9.5);
      phase += (2 * Math.PI * freq) / sr;
      const env = Math.exp(-t * 3.8) * Math.min(1, t * 400);
      const sub = Math.sin(phase) + 0.35 * Math.sin(phase * 2) * Math.exp(-t * 8);
      const punch = (Math.random() * 2 - 1) * Math.exp(-t * 45) * 0.4;
      samples[i] = Math.tanh((sub * env + punch) * 1.4) * 0.85;
    }
    return writeWav(outPath, samples, sr);
  }

  if (kind === 'mouseClick' || kind === 'uiSwitch') {
    // 경쾌한 맥북/기계식 스위치 클릭음
    const dur = 0.12;
    const len = Math.floor(sr * dur);
    const samples = new Float32Array(len);
    const baseFreq = kind === 'mouseClick' ? 1600 : 1200;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const click1 = Math.exp(-t * 180) * Math.sin(2 * Math.PI * baseFreq * t);
      const t2 = Math.max(0, t - 0.022);
      const click2 = t > 0.022 ? 0.6 * Math.exp(-t2 * 220) * Math.sin(2 * Math.PI * (baseFreq * 0.72) * t2) : 0;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 260) * 0.35;
      samples[i] = (click1 + click2 + noise) * 0.8;
    }
    return writeWav(outPath, samples, sr);
  }

  if (kind === 'pageTurn') {
    // 부드러운 브러시 스윕 (촤락 종이 넘김)
    const dur = 0.32;
    const len = Math.floor(sr * dur);
    const samples = new Float32Array(len);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.sin((t / dur) * Math.PI) * Math.exp(-t * 3.2);
      const white = Math.random() * 2 - 1;
      lp = lp * 0.82 + white * 0.18;
      samples[i] = (white * 0.35 + lp * 0.65) * env * 0.55;
    }
    return writeWav(outPath, samples, sr);
  }

  // 기본: whoosh (휙 바람을 가르는 시네마틱 스윕)
  const dur = 0.38;
  const len = Math.floor(sr * dur);
  const samples = new Float32Array(len);
  let phase = 0;
  let band = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const norm = t / dur;
    const env = Math.sin(norm * Math.PI) * Math.sin(norm * Math.PI);
    const sweepFreq = 180 + 620 * Math.sin(norm * Math.PI);
    phase += (2 * Math.PI * sweepFreq) / sr;
    const noise = Math.random() * 2 - 1;
    band = band * 0.88 + noise * 0.12;
    samples[i] = env * (0.45 * Math.sin(phase) + 0.55 * band) * 0.75;
  }
  return writeWav(outPath, samples, sr);
}

// 효과음 파일 준비 (공식 Remotion SFX 다운로드 시도 후 실패 시 로컬 즉시 합성)
async function ensureSfxFile(kind, workDir) {
  if (!kind || kind === 'none') return null;
  const sfxDir = path.join(workDir, 'sfx-cache');
  fs.mkdirSync(sfxDir, {recursive: true});
  const target = path.join(sfxDir, `${kind}.wav`);
  if (fs.existsSync(target)) return target;

  const url = REMOTION_SFX_URLS[kind];
  if (url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(url, {signal: controller.signal});
      clearTimeout(timer);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 512) {
          fs.writeFileSync(target, buf);
          return target;
        }
      }
    } catch (e) {
      // 오프라인 또는 타임아웃 시 로컬 파형 합성으로 즉시 대체
    }
  }
  return synthesizeSfxWav(kind, target);
}

// 문장/장면 특성에 맞춰 가장 어울리는 효과음 자동 추천
function pickAutoSfx(narration = '', keyword = '', index = 0, pack = 'variety') {
  if (pack === 'none') return 'none';
  if (pack === 'transition') return 'whoosh';
  const text = `${narration} ${keyword}`;
  if (pack === 'lecture') {
    if (index === 0) return 'whoosh';
    if (/[!！?？]|핵심|정답|중요|결론|비법/.test(text)) return 'ding';
    if (/클릭|버튼|선택|입력|코드/.test(text)) return 'mouseClick';
    return 'pageTurn';
  }
  // variety (예능 풀패키지)
  if (/충격|반전|위험|망하|폭탄|비상|실화|진짜|괴물|0원|무료/.test(text)) return 'vineBoom';
  if (/[!！?？]|핵심|비법|성공|완성|100%|끝/.test(text)) return 'ding';
  if (/클릭|버튼|설치|드래그/.test(text)) return 'mouseClick';
  if (index === 0) return 'whoosh';
  return index % 2 === 1 ? 'uiSwitch' : 'whoosh';
}

module.exports = {
  REMOTION_SFX_URLS,
  SFX_LABELS,
  ensureSfxFile,
  pickAutoSfx,
  synthesizeSfxWav,
};
