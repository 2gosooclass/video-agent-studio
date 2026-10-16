// 제작 엔진: 장면 목록(이미지 + 나레이션 문장)을 받아 음성, 자막, 합성까지 처리한다.
// 프로토타입(build.py)에서 검증된 흐름을 그대로 옮긴 것.
const {execFile} = require('child_process');
const fs = require('fs');
const path = require('path');
let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (e) { /* 시스템 ffmpeg 사용 */ }
try {
  ffprobePath = require('@ffprobe-installer/ffprobe').path;
} catch (e) { /* 시스템 ffprobe 사용 */ }
const {synthesize} = require('./tts');

const FPS = 30;
const GAP = 0.8;

// 자막 스타일 프리셋: 폰트와 크기, 테두리 두께만 바꾸면 분위기가 달라진다
const CAPTION_PRESETS = {
  dohyeon: {font: 'Do Hyeon', size: 58, outline: 7},
  blackhan: {font: 'Black Han Sans', size: 60, outline: 7},
  jua: {font: 'Jua', size: 58, outline: 7},
  myeongjo: {font: 'NanumMyeongjo', size: 54, outline: 5},
  pen: {font: 'Nanum Pen', size: 68, outline: 4},
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {maxBuffer: 1024 * 1024 * 64}, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve(stdout);
    });
  });
}

async function duration(file) {
  const out = await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(out.trim());
}

function assTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

function styled(text, keyword) {
  if (keyword && text.includes(keyword)) {
    return text.replace(keyword, '{\\c&H00FFFF&}' + keyword + '{\\c&HFFFFFF&}');
  }
  return text;
}

async function buildProject(project, onProgress) {
  const {scenes, workDir, outputPath, keywords = [], tts = {}, fontsDir = null, captionStyle = 'dohyeon', aspect = '9:16', title = ''} = project;
  const preset = CAPTION_PRESETS[captionStyle] || CAPTION_PRESETS.dohyeon;
  const [VW, VH] = ASPECTS[aspect] || ASPECTS['9:16'];
  const capSize = aspect === '9:16' ? preset.size : Math.round(preset.size * 0.72);
  const safe = safeMargins(VW, VH);
  const capMarginV = safe.captionMarginV;
  fs.mkdirSync(workDir, {recursive: true});
  const audioDir = path.join(workDir, 'audio');
  const segDir = path.join(workDir, 'segments');
  fs.mkdirSync(audioDir, {recursive: true});
  fs.mkdirSync(segDir, {recursive: true});

  const starts = [];
  const segFiles = [];
  let t = 0;

  const BG_PALETTES = ['0x0B1026', '0x101E1A', '0x1E0F16', '0x0E1A2E'];
  for (let i = 0; i < scenes.length; i++) {
    const n = i + 1;
    if (typeof scenes[i].image === 'string' && scenes[i].image.startsWith('bg:')) {
      // 텍스트 모드: 장면 배경을 단색 그라데이션으로 생성한다
      const bgPath = path.join(segDir, `bg${n}.png`);
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${BG_PALETTES[i % BG_PALETTES.length]}:s=${VW}x${VH}`, '-vf', 'vignette=PI/5', '-frames:v', '1', bgPath]);
      scenes[i] = {...scenes[i], image: bgPath};
    }
    onProgress && onProgress('voice', n, scenes.length);
    const audioPath = path.join(audioDir, `nar${n}.mp3`);
    let made = null;
    try {
      made = await synthesize(scenes[i].narration, audioPath, ffmpegPath, tts);
    } catch (e) {
      made = null;
    }
    let nd;
    if (made) {
      nd = await duration(audioPath);
    } else {
      // 음성이 없으면 글자 수로 장면 길이를 추정 (자막 전용 모드)
      nd = Math.max(3, scenes[i].narration.length * 0.16);
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(nd), audioPath]);
    }
    const segDur = nd + GAP;
    starts.push([t, nd]);
    const frames = Math.ceil(segDur * FPS);
    const segPath = path.join(segDir, `seg${n}.mp4`);
    onProgress && onProgress('render', n, scenes.length);
    await run(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-loop', '1', '-i', scenes[i].image,
      '-i', audioPath,
      '-filter_complex',
      `[0:v]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},zoompan=z='1+0.05*on/${frames}':d=${frames}:s=${VW}x${VH}:fps=${FPS}[v];[1:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', '-t', String(segDur),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', segPath,
    ]);
    segFiles.push(segPath);
    t += segDur;
  }

  onProgress && onProgress('merge', scenes.length, scenes.length);
  const listPath = path.join(segDir, 'list.txt');
  fs.writeFileSync(listPath, segFiles.map((s) => `file '${s}'`).join('\n'));
  const joined = path.join(workDir, 'joined.mp4');
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', joined]);

  // 배경음악: 나레이션을 사이드체인으로 음악을 자동으로 눌러 준다 (덕킹)
  let burnSource = joined;
  if (project.bgm) {
    onProgress && onProgress('merge', scenes.length, scenes.length);
    const totalDur = t;
    const mixed = path.join(workDir, 'mixed.mp4');
    await run(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-i', joined, '-stream_loop', '-1', '-i', project.bgm,
      '-filter_complex',
      `[0:a]asplit=2[sc][mix];[mix]volume=1.5[mixv];[1:a]atrim=0:${totalDur.toFixed(2)},volume=0.35[bgmraw];[sc][bgmraw]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=1000[ducked];[mixv][ducked]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', mixed,
    ]);
    burnSource = mixed;
  }

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${VW}`, `PlayResY: ${VH}`, '');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push(`Style: Main,${preset.font},${capSize},&HFFFFFF,&HFFFFFF,&H000000,&H64000000,-1,0,0,0,100,100,0,0,1,${preset.outline},2,2,60,60,${capMarginV},1`);
  lines.push(`Style: Title,Black Han Sans,96,&H003CC9FF,&H003CC9FF,&H000000,&H64000000,-1,0,0,0,100,100,0,0,1,8,2,8,60,60,${safe.titleMarginV},1`);
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  if (title) {
    const firstDur = starts.length ? starts[0][0] + starts[0][1] : 3;
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(3.2, firstDur))},Title,,0,0,0,,${title}`);
  }
  scenes.forEach((scene, i) => {
    const [start, nd] = starts[i];
    const sents = scene.narration.split('. ').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.endsWith('.') ? s : s + '.'));
    const total = sents.reduce((a, s) => a + s.length, 0);
    let cur = start + 0.15;
    for (const s of sents) {
      const end = cur + (nd * s.length) / total - 0.05;
      lines.push(`Dialogue: 0,${assTime(cur)},${assTime(end)},Main,,0,0,0,,${styled(s, keywords[i])}`);
      cur = end + 0.05;
    }
  });
  const assPath = path.join(workDir, 'captions.ass');
  fs.writeFileSync(assPath, lines.join('\n'));

  onProgress && onProgress('captions', scenes.length, scenes.length);
  const burnArgs = ['-y', '-loglevel', 'error', '-i', burnSource, '-vf', `ass=${assPath}`, '-c:a', 'copy', outputPath];
  if (fontsDir && fs.existsSync(fontsDir)) {
    // 번들 폰트를 libass가 찾도록 fontconfig 경로를 작업 폴더에 만든다
    const fc = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
      '<fontconfig>',
      `<dir>${fontsDir}</dir>`,
      `<cachedir>${path.join(workDir, 'fc-cache')}</cachedir>`,
      '</fontconfig>',
    ].join('\n');
    fs.writeFileSync(path.join(workDir, 'fonts.conf'), fc);
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, burnArgs, {env: {...process.env, FONTCONFIG_PATH: workDir}, maxBuffer: 1024 * 1024 * 64}, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).slice(-600)));
        else resolve(stdout);
      });
    });
  } else {
    await run(ffmpegPath, burnArgs);
  }
  return {outputPath, totalDuration: await duration(outputPath)};
}

// 안전 존: 세로 영상은 피드에서 4:5로 잘려 보이므로 자막과 제목을 그 안에 둔다
function safeMargins(W, H) {
  if (H > W) {
    const zH = Math.round((W * 5) / 4);
    if (zH < H) {
      const zTop = Math.round((H - zH) / 2);
      return {captionMarginV: H - (zTop + zH) + 12, titleMarginV: zTop + 16};
    }
  }
  return {captionMarginV: Math.max(56, Math.round(H * 0.09)), titleMarginV: 110};
}

const {transcribe} = require('./whisper');

const ASPECTS = {'9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080]};

function srtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`;
}

function fontsConf(workDir, fontsDir) {
  const fc = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    `<dir>${fontsDir}</dir>`,
    `<cachedir>${path.join(workDir, 'fc-cache')}</cachedir>`,
    '</fontconfig>',
  ].join('\n');
  fs.writeFileSync(path.join(workDir, 'fonts.conf'), fc);
}

function runWithEnv(cmd, args, env) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {env, maxBuffer: 1024 * 1024 * 64}, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve(stdout);
    });
  });
}

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {maxBuffer: 1024 * 1024 * 64}, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve({stdout, stderr});
    });
  });
}

// 무음 구간을 찾아 남길 구간(말이 있는 부분) 목록을 만든다
async function detectKeeps(wavPath, totalDur) {
  const {stderr} = await runCapture(ffmpegPath, ['-i', wavPath, '-af', 'silencedetect=noise=-35dB:d=0.7', '-f', 'null', '-']);
  const silences = [];
  let cur = null;
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = parseFloat(s[1]);
    if (e && cur !== null) {
      silences.push([cur, parseFloat(e[1])]);
      cur = null;
    }
  }
  if (cur !== null) silences.push([cur, totalDur]);
  const keeps = [];
  let cursor = 0;
  for (const [ss, se] of silences) {
    const keepEnd = ss + 0.12;
    if (keepEnd - cursor >= 0.3) keeps.push({start: cursor, end: keepEnd});
    cursor = Math.max(cursor, se - 0.12);
  }
  if (totalDur - cursor >= 0.3) keeps.push({start: cursor, end: totalDur});
  // 너무 가까운 구간은 합친다
  const merged = [];
  for (const k of keeps) {
    const last = merged[merged.length - 1];
    if (last && k.start - last.end < 0.25) last.end = k.end;
    else merged.push({...k});
  }
  return merged;
}

function remapSegments(segments, keeps) {
  const mapped = [];
  let acc = 0;
  for (const k of keeps) {
    mapped.push({...k, newStart: acc});
    acc += k.end - k.start;
  }
  const out = [];
  for (const s of segments) {
    for (const k of mapped) {
      const a = Math.max(s.start, k.start);
      const b = Math.min(s.end, k.end);
      if (b - a >= 0.2) out.push({start: k.newStart + (a - k.start), end: k.newStart + (b - k.start), text: s.text});
    }
  }
  return out;
}

// 영상 모드: 원본 영상에 위스퍼 자막을 입히고 SRT를 함께 만든다.
async function buildVideoProject(project, onProgress) {
  const {videoPath, workDir, outputPath, fontsDir = null, captionStyle = 'dohyeon', aspect = '9:16', whisper, title = '', trimSilence = false} = project;
  const [W, H] = ASPECTS[aspect] || ASPECTS['9:16'];
  const preset = CAPTION_PRESETS[captionStyle] || CAPTION_PRESETS.dohyeon;
  fs.mkdirSync(workDir, {recursive: true});

  onProgress && onProgress('transcribe', 0, 1);
  let segments = await transcribe({
    videoPath,
    workDir,
    ffmpegPath,
    whisperBin: whisper.bin,
    modelPath: whisper.model,
    language: whisper.language || 'ko',
  });
  if (!segments.length) throw new Error('음성에서 자막을 만들 문장을 찾지 못했습니다.');

  // 무음 구간 자동 컷: 말이 없는 긴 공백을 잘라내고 자막 시간을 새 타임라인에 맞춘다
  let burnVideo = videoPath;
  if (trimSilence) {
    const totalDur = await duration(videoPath);
    const keeps = await detectKeeps(path.join(workDir, 'audio16k.wav'), totalDur);
    const keptDur = keeps.reduce((a, k) => a + (k.end - k.start), 0);
    if (keeps.length && keeps.length <= 300 && keptDur < totalDur * 0.97) {
      segments = remapSegments(segments, keeps);
      const cutPath = path.join(workDir, 'cut.mp4');
      const partFiles = [];
      for (let i = 0; i < keeps.length; i++) {
        const k = keeps[i];
        const part = path.join(workDir, `keep${i + 1}.mp4`);
        await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', videoPath, '-ss', k.start.toFixed(3), '-t', (k.end - k.start).toFixed(3), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', part]);
        partFiles.push(part);
      }
      const listPath = path.join(workDir, 'keeps.txt');
      fs.writeFileSync(listPath, partFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', cutPath]);
      burnVideo = cutPath;
    }
  }

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, '');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  const vsafe = safeMargins(W, H);
  const marginV = vsafe.captionMarginV;
  lines.push(`Style: Main,${preset.font},${preset.size},&HFFFFFF,&HFFFFFF,&H000000,&H64000000,-1,0,0,0,100,100,0,0,1,${preset.outline},2,2,60,60,${marginV},1`);
  lines.push(`Style: Title,Black Han Sans,96,&H003CC9FF,&H003CC9FF,&H000000,&H64000000,-1,0,0,0,100,100,0,0,1,8,2,8,60,60,${vsafe.titleMarginV},1`);
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  if (title) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(3.2)},Title,,0,0,0,,${title}`);
  }
  segments.forEach((s) => {
    lines.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Main,,0,0,0,,${s.text}`);
  });
  const assPath = path.join(workDir, 'captions.ass');
  fs.writeFileSync(assPath, lines.join('\n'));

  const srtPath = outputPath.replace(/\.mp4$/i, '.srt');
  const srt = segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`).join('\n\n');
  fs.writeFileSync(srtPath, srt + '\n');

  onProgress && onProgress('captions', 1, 1);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,ass=${assPath}`;
  const args = ['-y', '-loglevel', 'error', '-i', burnVideo, '-vf', vf, '-c:a', 'aac', '-b:a', '160k', outputPath];
  if (fontsDir && fs.existsSync(fontsDir)) {
    fontsConf(workDir, fontsDir);
    await runWithEnv(ffmpegPath, args, {...process.env, FONTCONFIG_PATH: workDir});
  } else {
    await run(ffmpegPath, args);
  }
  return {outputPath, srtPath, totalDuration: await duration(outputPath), segmentCount: segments.length};
}

module.exports = {buildProject, buildVideoProject, CAPTION_PRESETS, ASPECTS};
