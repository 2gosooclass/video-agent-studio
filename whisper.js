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
    text: (s.text || '').trim(),
  })).filter((s) => s.text && s.end > s.start);
  const segments = raw.flatMap((s) => splitSegment(s));
  return segments;
}

module.exports = {transcribe};
