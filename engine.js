// 제작 엔진: 장면 목록(이미지 + 나레이션 문장)을 받아 음성, 자막, 리모션 모션, 효과음(SFX), 합성까지 처리한다.
const {execFile} = require('child_process');
const fs = require('fs');
const path = require('path');
function resolveBinary(moduleName, defaultName, fallbackPaths = []) {
  const isWin = typeof process !== 'undefined' && process.platform === 'win32';
  const binName = isWin ? (defaultName.endsWith('.exe') ? defaultName : `${defaultName}.exe`) : defaultName;
  const platformFolder = isWin ? 'win32-x64' : (process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64');

  // 1) Electron unpacked resources path FIRST (bundled ffmpeg has libass compiled in!)
  const candidates = [];
  if (typeof process !== 'undefined' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', platformFolder, binName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffprobe-installer', platformFolder, binName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', moduleName, platformFolder, binName));
    candidates.push(path.join(process.resourcesPath, 'bin', binName));
    candidates.push(path.join(process.resourcesPath, binName));
  }
  if (typeof __dirname !== 'undefined') {
    candidates.push(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'node_modules', '@ffmpeg-installer', platformFolder, binName));
    candidates.push(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'node_modules', '@ffprobe-installer', platformFolder, binName));
    candidates.push(path.join(__dirname, 'bin', binName));
  }
  for (const c of candidates) {
    if (c.endsWith(defaultName) && fs.existsSync(c)) {
      try { fs.chmodSync(c, 0o755); } catch (_) {}
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch (_) {}
    }
  }

  // 2) Try direct module require
  try {
    const p = require(moduleName).path;
    if (p && fs.existsSync(p)) {
      try { fs.chmodSync(p, 0o755); } catch (_) {}
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch (_) {}
    }
  } catch (_) {}

  // 3) Fallback paths
  for (const fp of fallbackPaths) {
    if (fs.existsSync(fp)) {
      try {
        fs.accessSync(fp, fs.constants.X_OK);
        return fp;
      } catch (_) {}
    }
  }
  return defaultName;
}

let ffmpegPath = resolveBinary('@ffmpeg-installer/ffmpeg', 'ffmpeg', [
  '/Applications/Video Agent Studio.app/Contents/Resources/app.asar.unpacked/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg',
  '/Applications/Shorts Maker.app/Contents/Resources/app/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'ffmpeg.exe',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg'
]);
let ffprobePath = resolveBinary('@ffprobe-installer/ffprobe', 'ffprobe', [
  '/Applications/Video Agent Studio.app/Contents/Resources/app.asar.unpacked/node_modules/@ffprobe-installer/darwin-arm64/ffprobe',
  '/Applications/Shorts Maker.app/Contents/Resources/app/node_modules/@ffprobe-installer/darwin-arm64/ffprobe',
  'C:\\ffmpeg\\bin\\ffprobe.exe',
  'ffprobe.exe',
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe'
]);
const {synthesize} = require('./tts');
const {ensureSfxFile, pickAutoSfx} = require('./sfx');

const FPS = 30;
const GAP = 0.8;

// 자막 스타일 프리셋: 한글 11종 + 글로벌 영문 10종 인기 크리에이터 폰트 (모바일 숏폼 최적화 82~96pt)
const CAPTION_PRESETS = {
  // 🇰🇷 한국어 대표 폰트 11종
  scdream: {font: 'S-Core Dream 8 Heavy', size: 84},
  jalnan: {font: 'Jalnan', size: 86},
  cafe24: {font: 'Cafe24 Danjunghae', size: 84},
  maruburi: {font: 'MaruBuri Bold', size: 82},
  pretendard: {font: 'Pretendard', size: 84},
  gmarket: {font: 'Gmarket Sans', size: 84},
  blackhan: {font: 'Black Han Sans', size: 88},
  dohyeon: {font: 'Do Hyeon', size: 84},
  jua: {font: 'Jua', size: 84},
  myeongjo: {font: 'NanumMyeongjo', size: 78},
  pen: {font: 'Nanum Pen', size: 94},

  // 🇺🇸 글로벌 영문 대표 폰트 10종
  anton: {font: 'Anton', size: 88},
  bebas: {font: 'Bebas Neue', size: 92},
  montserrat: {font: 'Montserrat', size: 84},
  poppins: {font: 'Poppins', size: 84},
  oswald: {font: 'Oswald', size: 86},
  inter: {font: 'Inter', size: 82},
  playfair: {font: 'Playfair Display', size: 84},
  pacifico: {font: 'Pacifico', size: 86},
  bangers: {font: 'Bangers', size: 90},
  caveat: {font: 'Caveat', size: 96},
};

const ASPECTS = {'9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080]};

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

function wrapTwoLines(text) {
  if (!text || text.includes('\n') || text.includes('\\N')) return text;
  const words = text.split(' ');
  if (words.length <= 2 || text.length < 13) return text;
  const mid = Math.ceil(words.length / 2);
  return words.slice(0, mid).join(' ') + '\\N' + words.slice(mid).join(' ');
}

function cleanBrackets(text) {
  if (!text) return '';
  return text.replace(/[\[\]\{\}]/g, '').replace(/\s+/g, ' ').trim();
}

// 캡컷 스타일 팝업 애니메이션 태그 (\t) + 비비드 골드 옐로우(&H00E5FF&) 키워드 하이라이트 + 1줄 깔끔 노출
function styled(text, keyword, aspect = '9:16') {
  const animTag = '{\\t(0,160,\\fscx108\\fscy108)\\t(160,280,\\fscx100\\fscy100)}';
  const clean = cleanBrackets(text);
  // 대표님 원칙: 자막과 나레이션은 반드시 1줄로 끝나도록 단일 라인 유지 (26자 초과 시에만 분할)
  let formatted = clean.length > 28 ? wrapTwoLines(clean) : clean;
  const kw = cleanBrackets(keyword);
  if (kw && formatted.includes(kw)) {
    return animTag + formatted.replace(kw, '{\\c&H00E5FF&}' + kw + '{\\c&HFFFFFF&}');
  }
  return animTag + formatted;
}

// 안전 존: 세로 영상은 피드에서 4:5로 잘려 보이므로 자막과 제목을 그 안에 둔다
function safeMargins(W, H) {
  if (H > W) {
    const zH = Math.round((W * 5) / 4);
    if (zH < H) {
      const zTop = Math.round((H - zH) / 2);
      return {captionMarginV: H - (zTop + zH) + 12, titleMarginV: zTop + 16, tagMarginV: zTop + 120};
    }
  }
  return {captionMarginV: Math.max(56, Math.round(H * 0.09)), titleMarginV: 110, tagMarginV: 180};
}

async function svgToPng(svgPath, pngPath, VW, VH, ffmpegPath) {
  if (process.platform === 'darwin') {
    try {
      await run('sips', ['-s', 'format', 'png', '-z', String(VH), String(VW), svgPath, '--out', pngPath]);
      if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) return pngPath;
    } catch (e) {}
  }
  for (const bin of ['/opt/homebrew/bin/magick', 'magick', 'convert']) {
    try {
      await run(bin, [svgPath, '-resize', `${VW}x${VH}!`, pngPath]);
      if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) return pngPath;
    } catch (e) {}
  }
  await run(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x0F172A:s=${VW}x${VH}`,
    '-vf', 'vignette=PI/5', '-frames:v', '1', pngPath
  ]);
  return pngPath;
}

async function burnSubtitles(inputPath, assPath, outputPath, workDir, fontsDir, prepFilters = '') {
  const assEscaped = assPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const vfAss = prepFilters ? `${prepFilters},ass=filename='${assEscaped}'` : `ass=filename='${assEscaped}'`;
  const vfSub = prepFilters ? `${prepFilters},subtitles=filename='${assEscaped}'` : `subtitles=filename='${assEscaped}'`;

  const env = {...process.env};
  if (fontsDir && fs.existsSync(fontsDir)) {
    fontsConf(workDir, fontsDir);
    env.FONTCONFIG_PATH = workDir;
  }

  // 1) Try libass 'ass' filter (bundled ffmpeg in app.asar.unpacked)
  try {
    const argsAss = ['-y', '-loglevel', 'error', '-i', inputPath, '-vf', vfAss, '-c:a', 'aac', '-b:a', '160k', outputPath];
    await runWithEnv(ffmpegPath, argsAss, env);
    return;
  } catch (err1) {
    // 2) Fallback to 'subtitles' filter
    try {
      const argsSub = ['-y', '-loglevel', 'error', '-i', inputPath, '-vf', vfSub, '-c:a', 'aac', '-b:a', '160k', outputPath];
      await runWithEnv(ffmpegPath, argsSub, env);
      return;
    } catch (err2) {
      // 3) Final fallback: copy stream if subtitle filter is unavailable on host
      const argsCopy = ['-y', '-loglevel', 'error', '-i', inputPath, '-c', 'copy', outputPath];
      await run(ffmpegPath, argsCopy);
    }
  }
}

async function buildProject(project, onProgress) {
  const {
    scenes,
    keywords = [],
    workDir,
    outputPath,
    tts = {},
    fontsDir = null,
    captionStyle = 'dohyeon',
    shadowStyle = 'deepShadow',
    aspect = '9:16',
    title = '',
    titleMode = 'fullTime',
    titleStyle = 'shadow',
    titleSize = 'large',
    titleColor = 'mintWhite',
    showTitle = true,
    showSubtitles = true,
    outputMode = 'both', // 'both', 'voiceOnly', 'subtitlesOnly'
    sfxPack = 'variety', // variety, lecture, transition, none
  } = project;
  const preset = CAPTION_PRESETS[captionStyle] || CAPTION_PRESETS.scdream || CAPTION_PRESETS.blackhan;
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
    const curScene = scenes[i];

    // 1) 단색/그라디언트 배경 생성 (이미지가 bg: 이거나 존재하지 않는 경우)
    if (typeof curScene.image === 'string' && (curScene.image.startsWith('bg:') || !fs.existsSync(curScene.image))) {
      const bgPath = path.join(segDir, `bg${n}.png`);
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=${BG_PALETTES[i % BG_PALETTES.length]}:s=${VW}x${VH}`,
        '-vf', 'vignette=PI/5', '-frames:v', '1', bgPath
      ]);
      scenes[i] = {...curScene, image: bgPath};
    }

    // 2-A) 오리지널 음성이 있는 비디오 클립: 원본 음성을 100% 보존하고 구간만 자름
    if (curScene.originalVoice && curScene.video && fs.existsSync(curScene.video) && curScene.end > curScene.start) {
      onProgress && onProgress('voice', n, scenes.length);
      const segDur = curScene.end - curScene.start;
      const cutVideoSeg = path.join(segDir, `orig_seg${n}.mp4`);
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-ss', String(curScene.start.toFixed(3)),
        '-to', String(curScene.end.toFixed(3)),
        '-i', curScene.video,
        '-vf', `scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},fps=${FPS}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        cutVideoSeg
      ]);

      const sfxKind = curScene.sfx && curScene.sfx !== 'auto' && curScene.sfx !== 'none'
        ? curScene.sfx : null;
      if (sfxKind) {
        const sfxFile = await ensureSfxFile(sfxKind, workDir);
        if (sfxFile && fs.existsSync(sfxFile)) {
          const sfxMuxed = path.join(segDir, `orig_sfx_seg${n}.mp4`);
          try {
            await run(ffmpegPath, [
              '-y', '-loglevel', 'error',
              '-i', cutVideoSeg,
              '-i', sfxFile,
              '-filter_complex',
              '[1:a]volume=0.45[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]',
              '-map', '0:v', '-map', '[aout]',
              '-c:v', 'copy', '-c:a', 'aac',
              sfxMuxed
            ]);
            fs.copyFileSync(sfxMuxed, cutVideoSeg);
          } catch (_) {}
        }
      }

      segFiles.push(cutVideoSeg);
      starts.push([t, segDur]);
      t += segDur;
      continue;
    }

    // 2-B) 음성 나레이션 합성 또는 직접 녹음(customAudio) 적용 (이미지, 슬라이드, 모션, 무음 영상)
    const audioPath = path.join(audioDir, `nar${n}.mp3`);
    let nd = 3.2;

    if (curScene.customAudio && fs.existsSync(curScene.customAudio)) {
      // 사용자가 직접 녹음하거나 불러온 음성 파일 사용 (100% 본인 목소리 더빙)
      onProgress && onProgress('voice', n, scenes.length);
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', curScene.customAudio, '-ar', '44100', '-ac', '2', audioPath]);
      nd = Math.max(1.0, await duration(audioPath));
    } else if (outputMode === 'subtitlesOnly') {
      // 자막 전용 모드: TTS 호출 생략, 씬당 3.0~4.5초 슬라이드 시간 적용 및 무음 오디오 파일 생성
      onProgress && onProgress('render', n, scenes.length);
      nd = Math.max(2.8, Math.min(4.5, (scenes[i].narration || '').length * 0.16 + 1.2));
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(nd), audioPath]);
    } else {
      onProgress && onProgress('voice', n, scenes.length);
      let made = null;
      try {
        made = await synthesize(scenes[i].narration, audioPath, ffmpegPath, tts);
      } catch (e) {
        made = null;
      }
      if (made) {
        nd = await duration(audioPath);
      } else {
        nd = Math.max(3, (scenes[i].narration || '').length * 0.16);
        await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(nd), audioPath]);
      }
    }
    const segDur = nd + GAP;
    starts.push([t, nd]);

    // 3) @remotion/sfx 효과음 자동 믹싱 (장면 시작 또는 키워드 순간)
    let mixedAudioPath = audioPath;
    const sfxKind = curScene.sfx && curScene.sfx !== 'auto'
      ? curScene.sfx
      : pickAutoSfx(curScene.narration, curScene.keyword || keywords[i], i, sfxPack);
    const sfxFile = await ensureSfxFile(sfxKind, workDir);

    if (sfxFile && fs.existsSync(sfxFile)) {
      const sfxMixed = path.join(audioDir, `mixed_sfx${n}.wav`);
      try {
        await run(ffmpegPath, [
          '-y', '-loglevel', 'error',
          '-i', audioPath,
          '-i', sfxFile,
          '-filter_complex',
          '[1:a]volume=0.55[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]',
          '-map', '[aout]', sfxMixed
        ]);
        mixedAudioPath = sfxMixed;
      } catch (e) {
        // SFX 믹스 오류 시 원본 음성 유지
      }
    }

    // 4) 비디오 세그먼트 렌더링 (모션 애니메이션: 줌인, 줌아웃, 틸트다운, 틸트업, 페이드 인아웃)
    const frames = Math.ceil(segDur * FPS);
    const segPath = path.join(segDir, `seg${n}.mp4`);
    onProgress && onProgress('render', n, scenes.length);

    // 모션 종류 결정 (auto/kenburns/zoomIn/zoomOut/tiltDown/tiltUp/fade/none)
    const rawMotion = curScene.motion || 'auto';
    let chosenMotion = rawMotion;
    if (chosenMotion === 'auto' || chosenMotion === 'kenburns') {
      const autoCycle = ['zoomIn', 'tiltDown', 'zoomOut', 'tiltUp'];
      chosenMotion = autoCycle[i % autoCycle.length];
    }

    if (scenes[i].video && fs.existsSync(scenes[i].video)) {
      // 영상 클립 + 더빙(TTS 또는 직접 녹음) 길이 자동 맞춤 싱크 엔진:
      // - 영상이 더빙보다 길면: 더빙 길이(segDur)에 맞춰 자연스럽게 커팅
      // - 영상이 더빙보다 짧으면: 끊기는 점프컷 루프 대신 배속(setpts)을 부드럽게 늘려 영상과 더빙 끝점을 100% 일치시킴
      // - 첫 프레임(0.00초)부터 100% 선명하게 노출 (블랙 페이드인 완전 제거로 쇼츠/릴스 0.5초 이탈 방지)
      let vidDur = segDur;
      try {
        vidDur = await duration(scenes[i].video);
      } catch (_) {}
      let speedFilter = '';
      if (vidDur > 0.3 && vidDur < segDur) {
        const ptsRatio = Math.min(3.5, Math.max(1.01, (segDur + 0.15) / vidDur)).toFixed(4);
        speedFilter = `setpts=${ptsRatio}*PTS,`;
      }
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-stream_loop', '-1', '-i', scenes[i].video,
        '-i', mixedAudioPath,
        '-filter_complex',
        `[0:v]${speedFilter}scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},fps=${FPS}[v];[1:a]apad[a]`,
        '-map', '[v]', '-map', '[a]', '-t', String(segDur),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', segPath,
      ]);
    } else {
      // 스마트폰 세로 사진 EXIF 회전 버그 방지 (Auto-Orient 사전 단일 프레임 정규화)
      let sceneImg = scenes[i].image;
      if (typeof sceneImg === 'string' && fs.existsSync(sceneImg) && !sceneImg.startsWith('bg:')) {
        const normImg = path.join(segDir, `norm_orient_${n}.png`);
        let oriented = false;
        // 1) Python3 PIL ImageOps.exif_transpose (가장 완벽한 회전 보정)
        try {
          const pyCode = `from PIL import Image, ImageOps; im = Image.open("${sceneImg.replace(/\\/g, '/')}"); im = ImageOps.exif_transpose(im); im.save("${normImg.replace(/\\/g, '/')}")`;
          await run('python3', ['-c', pyCode]);
          if (fs.existsSync(normImg)) {
            sceneImg = normImg;
            oriented = true;
          }
        } catch (_) {}

        // 2) Fallback: Homebrew or system ffmpeg autorotate
        if (!oriented) {
          const ffbins = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', ffmpegPath];
          for (const fb of ffbins) {
            if (fs.existsSync(fb)) {
              try {
                await run(fb, ['-y', '-loglevel', 'error', '-i', scenes[i].image, '-frames:v', '1', normImg]);
                if (fs.existsSync(normImg)) {
                  sceneImg = normImg;
                  break;
                }
              } catch (_) {}
            }
          }
        }
      }

      let vFilter = '';
      if (chosenMotion === 'zoomIn') {
        // 부드럽고 생동감 넘치는 줌인 (1.02배 -> 1.20배) - 키네틱 컷 (블랙 스크린 없음)
        vFilter = `[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=z='1.02+0.18*(on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${VW}x${VH}:fps=${FPS}[v];[1:a]apad[a]`;
      } else if (chosenMotion === 'zoomOut') {
        // 부드러운 줌아웃 (1.20배 -> 1.02배) - 키네틱 컷 (블랙 스크린 없음)
        vFilter = `[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=z='1.20-0.18*(on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${VW}x${VH}:fps=${FPS}[v];[1:a]apad[a]`;
      } else if (chosenMotion === 'tiltDown') {
        // 위에서 아래로 세련되게 훑어내리는 틸트 다운 - 키네틱 컷 (블랙 스크린 없음)
        vFilter = `[0:v]scale=1200:2280:force_original_aspect_ratio=increase,crop=1200:2280,zoompan=z=1.18:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(on/${frames})':d=${frames}:s=${VW}x${VH}:fps=${FPS}[v];[1:a]apad[a]`;
      } else if (chosenMotion === 'tiltUp') {
        // 아래에서 위로 감상하는 틸트 업 - 키네틱 컷 (블랙 스크린 없음)
        vFilter = `[0:v]scale=1200:2280:force_original_aspect_ratio=increase,crop=1200:2280,zoompan=z=1.18:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(1-on/${frames})':d=${frames}:s=${VW}x${VH}:fps=${FPS}[v];[1:a]apad[a]`;
      } else if (chosenMotion === 'fade') {
        // 우아한 미세 무빙 (첫 씬은 쇼츠 0.00초 썸네일/이탈 방지를 위해 페이드인 생략하고 즉시 100% 노출)
        const fadeFilters = [];
        if (i > 0) {
          fadeFilters.push('fade=t=in:st=0:d=0.3');
        }
        const fadeOutStart = Math.max(0, segDur - 0.3).toFixed(2);
        fadeFilters.push(`fade=t=out:st=${fadeOutStart}:d=0.3`);
        const fadeStr = fadeFilters.length ? ',' + fadeFilters.join(',') : '';
        vFilter = `[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=z='1.02+0.08*(on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${VW}x${VH}:fps=${FPS}${fadeStr}[v];[1:a]apad[a]`;
      } else {
        // 정지 화면 (Static)
        vFilter = `[0:v]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH}[v];[1:a]apad[a]`;
      }

      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-loop', '1', '-i', sceneImg,
        '-i', mixedAudioPath,
        '-filter_complex', vFilter,
        '-map', '[v]', '-map', '[a]', '-t', String(segDur),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', segPath,
      ]);
    }
    segFiles.push(segPath);
    t += segDur;
  }

  // 5) 세그먼트 Concat 연결
  onProgress && onProgress('merge', scenes.length, scenes.length);
  const listPath = path.join(segDir, 'list.txt');
  fs.writeFileSync(listPath, segFiles.map((s) => `file '${s}'`).join('\n'));
  const joined = path.join(workDir, 'joined.mp4');
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', joined]);

  let burnSource = joined;
  if (project.bgm && fs.existsSync(project.bgm)) {
    const totalDur = t;
    const mixed = path.join(workDir, 'mixed.mp4');
    const bgmVol = typeof project.bgmVolume === 'number' ? project.bgmVolume : 0.35;
    const fadeStart = Math.max(0, totalDur - 1.5).toFixed(2);
    try {
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-i', joined, '-stream_loop', '-1', '-i', project.bgm,
        '-filter_complex',
        `[0:a]asplit=2[sc][mix];[mix]volume=1.4[mixv];[1:a]atrim=0:${totalDur.toFixed(2)},volume=${bgmVol},afade=t=out:st=${fadeStart}:d=1.5[bgmraw];[sc][bgmraw]sidechaincompress=threshold=0.025:ratio=7:attack=150:release=900[ducked];[mixv][ducked]amix=inputs=2:duration=first[aout]`,
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', mixed,
      ]);
      burnSource = mixed;
    } catch (e) {
      console.error('BGM ducking failed, falling back to joined audio:', e);
    }
  }

  // 6) ASS 예능 자막 & 상단 상황 태그 파일 작성
  let outlineWidth = 2;
  let shadowDepth = 7;
  let backColor = '&H95000000'; // Deep semi-transparent black
  let outlineColor = '&H00000000';

  if (shadowStyle === 'pureShadow') {
    outlineWidth = 0;
    shadowDepth = 8;
    backColor = '&HB0000000';
  } else if (shadowStyle === 'thickBorder') {
    outlineWidth = 7;
    shadowDepth = 2;
    backColor = '&H64000000';
  } else if (shadowStyle === 'glowShadow') {
    outlineWidth = 3;
    shadowDepth = 5;
    backColor = '&H80000000';
  } else {
    // deepShadow (기본값: 3D 딥 드롭섀도우 - 세련된 2px 미세 테두리 + 깊은 7px 입체 그림자)
    outlineWidth = 2;
    shadowDepth = 7;
    backColor = '&H95000000';
  }

  const isBoxBar = titleStyle === 'boxBar';
  // 3단계 제목 크기 옵션: xlarge (아주 크게 126pt), large (크게 108pt - 추천 기본값), normal (보통 88pt)
  let baseTitleSize = 108;
  if (titleSize === 'xlarge') baseTitleSize = 126;
  else if (titleSize === 'normal') baseTitleSize = 88;
  if (isBoxBar) baseTitleSize = Math.round(baseTitleSize * 0.88);
  const finalTitleSize = aspect === '9:16' ? baseTitleSize : Math.round(baseTitleSize * 0.72);

  const titleBorderStyle = isBoxBar ? 3 : 1;
  const titleOutlineWidth = isBoxBar ? 8 : (titleSize === 'xlarge' ? 3 : outlineWidth);
  const titleShadowDepth = isBoxBar ? 0 : (titleSize === 'xlarge' ? 8 : shadowDepth);
  const titleOutlineColor = isBoxBar ? '&H85000000' : outlineColor;
  const titleBackColor = isBoxBar ? '&H85000000' : backColor;

  // 2줄 배색 컬러 세팅 (ASS BGR 형식)
  // Mint: &H00D2FA5A& (R=90, G=250, B=210)
  // Vivid Yellow: &H0033E6FF& (R=255, G=230, B=51)
  // Crisp White: &H00FFFFFF&
  let titleColor1 = '&H00D2FA5A&'; // Line 1: 민트 기본값
  let titleColor2 = '&H00FFFFFF&'; // Line 2: 깔끔한 화이트

  if (titleColor === 'yellowWhite' || titleColor === 'yellow') {
    titleColor1 = '&H0033E6FF&'; // 1줄 옐로우
    titleColor2 = '&H00FFFFFF&'; // 2줄 화이트
  } else if (titleColor === 'whiteMint') {
    titleColor1 = '&H00FFFFFF&'; // 1줄 화이트
    titleColor2 = '&H00D2FA5A&'; // 2줄 민트
  } else if (titleColor === 'white') {
    titleColor1 = '&H00FFFFFF&';
    titleColor2 = '&H00FFFFFF&';
  } else if (titleColor === 'mintSingle') {
    titleColor1 = '&H00D2FA5A&';
    titleColor2 = '&H00D2FA5A&';
  } else if (titleColor === 'yellowSingle') {
    titleColor1 = '&H0033E6FF&';
    titleColor2 = '&H0033E6FF&';
  } else {
    // mintWhite (추천 기본값)
    titleColor1 = '&H00D2FA5A&';
    titleColor2 = '&H00FFFFFF&';
  }

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${VW}`, `PlayResY: ${VH}`, '');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push(`Style: Main,${preset.font},${capSize},&HFFFFFF,&HFFFFFF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},2,60,60,${capMarginV},1`);
  lines.push(`Style: Title,Black Han Sans,${finalTitleSize},&HFFFFFF,&HFFFFFF,${titleOutlineColor},${titleBackColor},-1,0,0,0,100,100,0,0,${titleBorderStyle},${titleOutlineWidth},${titleShadowDepth},8,40,40,${safe.titleMarginV},1`);
  lines.push(`Style: Tag,Jua,42,&H00E5FF,&H00E5FF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,1,${Math.min(2, outlineWidth)},4,9,40,40,${safe.tagMarginV},1`);
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  const cleanTitleStr = cleanBrackets(title);
  if (showTitle !== false && cleanTitleStr) {
    const totalVideoDur = starts.length ? (starts[starts.length - 1][0] + starts[starts.length - 1][1]) : 10;
    const firstDur = starts.length ? starts[0][0] + starts[0][1] : 3;
    const titleEnd = titleMode === 'fullTime' ? totalVideoDur : Math.min(3.5, firstDur);

    let line1 = '';
    let line2 = '';
    if (cleanTitleStr.includes('\n')) {
      const parts = cleanTitleStr.split('\n');
      line1 = parts[0].trim();
      line2 = parts.slice(1).join(' ').trim();
    } else if (cleanTitleStr.includes('|')) {
      const parts = cleanTitleStr.split('|');
      line1 = parts[0].trim();
      line2 = parts.slice(1).join(' ').trim();
    } else if (cleanTitleStr.includes('  ')) {
      const parts = cleanTitleStr.split(/\s{2,}/);
      line1 = parts[0].trim();
      line2 = parts.slice(1).join(' ').trim();
    } else if (cleanTitleStr.length > 13 && cleanTitleStr.includes(' ')) {
      const words = cleanTitleStr.split(' ');
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ').trim();
      line2 = words.slice(mid).join(' ').trim();
    } else {
      line1 = cleanTitleStr;
    }

    let formattedTitle = '';
    if (line2) {
      // 2줄 배색 스타일 적용: 1줄 포인트 컬러, 2줄 화이트 컬러
      formattedTitle = `{\\c${titleColor1}}${line1}\\N{\\c${titleColor2}}${line2}`;
    } else {
      formattedTitle = `{\\c${titleColor1}}${line1}`;
    }
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(titleEnd)},Title,,0,0,0,,${formattedTitle}`);
  }

  // 자막 출력 여부: outputMode === 'voiceOnly' (나레이션 전용)일 때는 하단 자막 완전 숨김
  if (showSubtitles !== false && outputMode !== 'voiceOnly') {
    scenes.forEach((scene, i) => {
      const [start, nd] = starts[i];
      const cleanTag = cleanBrackets(scene.tag || '');
      if (cleanTag && !cleanTag.includes('오리지널 음성') && !cleanTag.includes('무음')) {
        lines.push(`Dialogue: 2,${assTime(start)},${assTime(start + nd)},Tag,,0,0,0,,${cleanTag}`);
      }
      const narr = cleanBrackets(scene.narration || '');
      if (!narr) return;
      const sents = narr.split('. ').map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.endsWith('.') ? s : s + '.'));
      const total = sents.reduce((a, s) => a + s.length, 0);
      let cur = start + 0.15;
      for (const s of sents) {
        const end = cur + (nd * s.length) / Math.max(1, total) - 0.05;
        const kw = cleanBrackets(keywords[i] || scene.keyword || '');
        lines.push(`Dialogue: 0,${assTime(cur)},${assTime(end)},Main,,0,0,0,,${styled(s, kw, aspect)}`);
        cur = end + 0.05;
      }
    });
  }

  const assPath = path.join(workDir, 'captions.ass');
  fs.writeFileSync(assPath, lines.join('\n'));

  // 7) 최종 Libass 자막 번인 MP4 인코딩
  onProgress && onProgress('captions', scenes.length, scenes.length);
  const hasDialogues = lines.some((l) => l.startsWith('Dialogue:'));
  if (hasDialogues) {
    await burnSubtitles(burnSource, assPath, outputPath, workDir, fontsDir);
  } else {
    // 제목과 자막이 모두 꺼진 경우: 비디오 스트림 복사로 즉시 완료
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', burnSource, '-c', 'copy', outputPath]);
  }
  return {outputPath, totalDuration: await duration(outputPath)};
}

const {transcribe} = require('./whisper');

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

function pickShortWindow(segments, target) {
  let best = null;
  for (let i = 0; i < segments.length; i++) {
    let j = i;
    let chars = 0;
    while (j < segments.length && segments[j].end - segments[i].start <= target) {
      chars += segments[j].text.length;
      j++;
    }
    if (j === i) continue;
    const dur = segments[j - 1].end - segments[i].start;
    if (dur < target * 0.5) continue;
    let score = chars / Math.max(dur, 1);
    const head = segments.slice(i, Math.min(i + 2, j)).map((s) => s.text).join(' ');
    if (/[?？]/.test(head)) score *= 1.25;
    if (/\d/.test(head)) score *= 1.2;
    if (!best || score > best.score) best = {score, start: segments[i].start, end: segments[j - 1].end};
  }
  if (!best) return {start: Math.max(0, segments[0].start - 0.1), end: segments[0].end + 0.1};
  return {start: Math.max(0, best.start - 0.1), end: best.end + 0.1};
}

async function buildVideoProject(project, onProgress) {
  const {
    videoPath,
    workDir,
    outputPath,
    fontsDir = null,
    captionStyle = 'dohyeon',
    aspect = '9:16',
    whisper,
    title = '',
    trimSilence = false,
    shortForm = 0,
    videoPaths = [],
    sfxPack = 'variety'
  } = project;
  const [W, H] = ASPECTS[aspect] || ASPECTS['9:16'];
  const preset = CAPTION_PRESETS[captionStyle] || CAPTION_PRESETS.dohyeon;
  fs.mkdirSync(workDir, {recursive: true});

  let activeVideo = videoPath;
  const vList = (videoPaths && videoPaths.length) ? videoPaths : (videoPath ? [videoPath] : []);
  if (vList.length > 1) {
    onProgress && onProgress('render', 1, vList.length);
    const normFiles = [];
    for (let i = 0; i < vList.length; i++) {
      const p = path.join(workDir, `norm_${i + 1}.mp4`);
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-i', vList[i],
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
        p
      ]);
      normFiles.push(p);
    }
    const concatTxt = path.join(workDir, 'concat_vlist.txt');
    fs.writeFileSync(concatTxt, normFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
    activeVideo = path.join(workDir, 'merged_input.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c', 'copy', activeVideo]);
  }

  onProgress && onProgress('transcribe', 0, 1);
  let segments = await transcribe({
    videoPath: activeVideo,
    workDir,
    ffmpegPath,
    whisperBin: whisper.bin,
    modelPath: whisper.model,
    language: whisper.language || 'ko',
  });
  if (!segments.length) throw new Error('음성에서 자막을 만들 문장을 찾지 못했습니다.');

  let burnVideo = activeVideo;
  let finalKeeps = null;
  if (shortForm > 0) {
    finalKeeps = [pickShortWindow(segments, shortForm)];
  } else if (trimSilence) {
    const totalDur = await duration(videoPath);
    const keeps = await detectKeeps(path.join(workDir, 'audio16k.wav'), totalDur);
    const keptDur = keeps.reduce((a, k) => a + (k.end - k.start), 0);
    if (keeps.length && keeps.length <= 300 && keptDur < totalDur * 0.97) finalKeeps = keeps;
  }
  if (finalKeeps) {
    const keeps = finalKeeps;
    {
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

  // 영상 모드 효과음 오버레이 (0초 훅 whoosh + 핵심 반전 ding)
  if (sfxPack !== 'none') {
    try {
      const whooshFile = await ensureSfxFile('whoosh', workDir);
      const sfxMuxed = path.join(workDir, 'video_sfx.mp4');
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-i', burnVideo,
        '-i', whooshFile,
        '-filter_complex',
        '[1:a]volume=0.45[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]',
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', sfxMuxed
      ]);
      burnVideo = sfxMuxed;
    } catch (e) {
      // SFX 오류 시 원본 영상 유지
    }
  }

  // 영상 모드 배경음악(BGM) 오토더킹 믹싱
  if (project.bgm && fs.existsSync(project.bgm)) {
    try {
      const totalDur = segments.length > 0 ? segments[segments.length - 1].end : 30;
      const bgmMuxed = path.join(workDir, 'video_bgm.mp4');
      const bgmVol = typeof project.bgmVolume === 'number' ? project.bgmVolume : 0.35;
      const fadeStart = Math.max(0, totalDur - 1.5).toFixed(2);
      await run(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-i', burnVideo, '-stream_loop', '-1', '-i', project.bgm,
        '-filter_complex',
        `[0:a]asplit=2[sc][mix];[mix]volume=1.3[mixv];[1:a]atrim=0:${totalDur.toFixed(2)},volume=${bgmVol},afade=t=out:st=${fadeStart}:d=1.5[bgmraw];[sc][bgmraw]sidechaincompress=threshold=0.03:ratio=6:attack=150:release=900[ducked];[mixv][ducked]amix=inputs=2:duration=first[aout]`,
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', bgmMuxed
      ]);
      burnVideo = bgmMuxed;
    } catch (e) {
      console.error('Video BGM mix failed:', e);
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
    // 단어 시작 시 팝업 스케일 애니메이션 태그
    lines.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Main,,0,0,0,,{\\t(0,180,\\fscx108\\fscy108)\\t(180,280,\\fscx100\\fscy100)}${s.text}`);
  });
  const assPath = path.join(workDir, 'captions.ass');
  fs.writeFileSync(assPath, lines.join('\n'));

  const srtPath = outputPath.replace(/\.mp4$/i, '.srt');
  const srt = segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}`).join('\n\n');
  fs.writeFileSync(srtPath, srt + '\n');

  onProgress && onProgress('captions', 1, 1);
  const prep = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;
  await burnSubtitles(burnVideo, assPath, outputPath, workDir, fontsDir, prep);
  return {outputPath, srtPath, totalDuration: await duration(outputPath), segmentCount: segments.length};
}

module.exports = {buildProject, buildVideoProject, CAPTION_PRESETS, ASPECTS};
