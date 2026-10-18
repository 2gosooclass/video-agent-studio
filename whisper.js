// 영상 소리를 받아쓰는 위스퍼 연결 모듈.
// whisper.cpp 실행 파일과 모델 파일을 앱 리소스에서 찾는다. 로컬 실행이라 무료이고 오프라인이다.
const {execFile} = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {maxBuffer: 1024 * 1024 * 64, ...opts}, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve(stdout);
    });
  });
}

// 위스퍼 한국어 모델이 무음/바람소리/배경소음 구간에서 습관적으로 뱉어내는 대표적 환각(Hallucination) 문구 필터
const HALLUCINATION_PATTERNS = [
  /^(음악|박수|웃음|music|applause|laughter|종소리|새소리|바람소리|물소리|소음|침묵|무음)$/i,
  /^감사합니다\.?$/i,
  /^고맙습니다\.?$/i,
  /^시청해\s*주셔서\s*감사합니다\.?$/i,
  /^끝까지\s*봐\s*주셔서\s*감사합니다\.?$/i,
  /^구독과\s*좋아요.*$/i,
  /^알림\s*설정.*$/i,
  /^다음\s*영상에서\s*만나요.*$/i,
  /^두\s*번째\s*(도착|곡|주인공)\.?$/i,
  /^자막\s*(제공|제작|협찬).*$/i,
  /^한글\s*자막.*$/i,
  /^(MBC|KBS|SBS|YTN|JTBC)\s*뉴스.*$/i,
  /^(네|아|음|어|흠|하|호)\.?$/i,
];

function isWhisperHallucination(text) {
  const clean = (text || '').replace(/[\[\]\{\}\(\)]/g, '').replace(/[.?!,~]/g, '').trim();
  if (!clean) return true;
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(clean)) return true;
  }
  return false;
}

// 긴 문장은 자막으로 읽기 좋게 나눈다 (시간은 글자 수 비율로 배분)
function splitSegment(seg, maxChars = 22) {
  const text = seg.text.trim();
  if (text.length <= maxChars) return [seg];
  const words = text.split(/\s+/);
  const chunks = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) chunks.push(cur);
  const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
  const out = [];
  let t = seg.start;
  for (const c of chunks) {
    const dur = ((seg.end - seg.start) * c.length) / total;
    out.push({start: t, end: t + dur, text: c});
    t += dur;
  }
  return out;
}

async function transcribe({videoPath, workDir, ffmpegPath, whisperBin, modelPath, language = 'ko'}) {
  const wavPath = path.join(workDir, 'audio16k.wav');
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', wavPath]);
  const outBase = path.join(workDir, 'transcript');
  await run(whisperBin, ['-m', modelPath, '-f', wavPath, '-l', language, '-oj', '-of', outBase]);
  const json = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8'));
  const raw = (json.transcription || []).map((s) => ({
    start: (s.offsets?.from || 0) / 1000,
    end: (s.offsets?.to || 0) / 1000,
    text: (s.text || '').replace(/[\[\]\{\}]/g, '').replace(/\s+/g, ' ').trim(),
  })).filter((s) => s.text && s.end > s.start && !isWhisperHallucination(s.text));

  // 전체 대사를 합쳐도 6글자 이하의 외마디뿐이라면 배경 소음 환각으로 간주하여 무음(AI 비전 분석 대상) 처리
  const combinedText = raw.map((r) => r.text.replace(/[.?!,\s]/g, '')).join('');
  if (combinedText.length <= 5) {
    return [];
  }

  const segments = raw.flatMap((s) => splitSegment(s));
  return segments;
}

module.exports = {transcribe, isWhisperHallucination};
