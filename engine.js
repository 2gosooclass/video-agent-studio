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
  const {scenes, workDir, outputPath, keywords = [], tts = {}, fontsDir = null} = project;
  fs.mkdirSync(workDir, {recursive: true});
  const audioDir = path.join(workDir, 'audio');
  const segDir = path.join(workDir, 'segments');
  fs.mkdirSync(audioDir, {recursive: true});
  fs.mkdirSync(segDir, {recursive: true});

  const starts = [];
  const segFiles = [];
  let t = 0;

  for (let i = 0; i < scenes.length; i++) {
    const n = i + 1;
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
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='1+0.05*on/${frames}':d=${frames}:s=1080x1920:fps=${FPS}[v];[1:a]apad[a]`,
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

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push('Style: Main,Do Hyeon,58,&HFFFFFF,&HFFFFFF,&H000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,60,60,240,1');
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
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
  const burnArgs = ['-y', '-loglevel', 'error', '-i', joined, '-vf', `ass=${assPath}`, '-c:a', 'copy', outputPath];
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

module.exports = {buildProject};
