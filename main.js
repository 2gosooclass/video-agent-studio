const {app, BrowserWindow, ipcMain, dialog, shell} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {buildProject, buildVideoProject} = require('./engine');
const {analyzeScenes, planSuperpowersProject, regenerateSceneImage} = require('./analysis');
const {ensureSfxFile} = require('./sfx');
const {synthesize} = require('./tts');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    return {apiKey: '', model: 'gemini-2.5-flash', voice: 'Kore'};
  }
}

function getFfmpegPath() {
  const isWin = typeof process !== 'undefined' && process.platform === 'win32';
  const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const platformFolder = isWin ? 'win32-x64' : (process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64');
  let ffmpegPath = isWin ? 'ffmpeg.exe' : '/opt/homebrew/bin/ffmpeg';

  try {
    const p = require('@ffmpeg-installer/ffmpeg').path;
    if (p && fs.existsSync(p)) ffmpegPath = p;
  } catch (_) {}

  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', platformFolder, binName);
    if (fs.existsSync(bundled)) ffmpegPath = bundled;
    const direct = path.join(process.resourcesPath, 'bin', binName);
    if (fs.existsSync(direct)) ffmpegPath = direct;
  }
  if (!fs.existsSync(ffmpegPath)) {
    if (isWin && fs.existsSync('C:\\ffmpeg\\bin\\ffmpeg.exe')) {
      ffmpegPath = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
    } else if (fs.existsSync('/usr/local/bin/ffmpeg')) {
      ffmpegPath = '/usr/local/bin/ffmpeg';
    }
  }
  return ffmpegPath;
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Video Agent Studio',
    width: 1220,
    height: 840,
    backgroundColor: '#17181c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Prevent Chromium from navigating away to dropped files (fixes raw binary text bug)
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

function resolveBgmPath(bgmVal) {
  if (!bgmVal || bgmVal === 'none') return null;
  if (path.isAbsolute(bgmVal) && fs.existsSync(bgmVal)) {
    return bgmVal;
  }
  const bgmDirs = [
    app.isPackaged ? path.join(process.resourcesPath, 'assets', 'bgm') : null,
    app.isPackaged ? path.join(process.resourcesPath, 'bgm') : null,
    path.join(__dirname, 'assets', 'bgm'),
  ].filter(Boolean);
  for (const dir of bgmDirs) {
    const candidate = path.join(dir, `${bgmVal}.mp3`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

app.whenReady().then(() => {
  const win = createWindow();

  ipcMain.handle('pick-images', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp']}],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('build', async (event, payload) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-agent-'));
    let baseDir;
    try {
      baseDir = app.getPath('movies');
    } catch (e) {
      try {
        baseDir = app.getPath('documents');
      } catch (e2) {
        baseDir = app.getPath('home');
      }
    }
    const outDir = path.join(baseDir, 'VideoAgent');
    fs.mkdirSync(outDir, {recursive: true});
    const outputPath = path.join(outDir, `video-${stamp}.mp4`);
    const settings = loadSettings();
    const chosenVoice = payload.voice || settings.voice || 'Kore';
    const fontsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'fonts')
      : path.join(__dirname, 'assets', 'fonts');
    const result = await buildProject(
      {
        scenes: payload.scenes,
        keywords: payload.keywords || [],
        captionStyle: payload.captionStyle || 'scdream',
        shadowStyle: payload.shadowStyle || 'deepShadow',
        aspect: payload.aspect || '9:16',
        title: payload.title || '',
        titleMode: payload.titleMode || 'fullTime',
        titleStyle: payload.titleStyle || 'shadow',
        titleSize: payload.titleSize || 'large',
        titleColor: payload.titleColor || 'mintWhite',
        showTitle: payload.showTitle !== false,
        showSubtitles: payload.showSubtitles !== false,
        outputMode: payload.outputMode || 'both',
        bgm: resolveBgmPath(payload.bgm),
        bgmVolume: Number(payload.bgmVolume) || 0.35,
        sfxPack: payload.sfxPack || 'variety',
        autoMosaic: !!payload.autoMosaic,
        globalMosaicTarget: payload.globalMosaicTarget || '',
        apiKey: settings.apiKey || '',
        workDir,
        outputPath,
        fontsDir,
        tts: {
          apiKey: settings.apiKey || '',
          ttsModel: settings.ttsModel || 'gemini-2.5-flash-preview-tts',
          voice: chosenVoice,
          voiceboxUrl: settings.voiceboxUrl || 'http://192.168.12.86:17493',
          voiceboxProfile: settings.voiceboxProfile || 'ddf94b87-c330-41cf-96be-820d5c279dcd',
        },
      },
      (stage, cur, total) => event.sender.send('progress', {stage, cur, total})
    );
    return result;
  });

  async function generateVideoThumbs(filePaths) {
    if (!Array.isArray(filePaths) || !filePaths.length) return [];
    const ffmpegPath = getFfmpegPath();
    const thumbDir = path.join(os.tmpdir(), 'video-agent-thumbs');
    fs.mkdirSync(thumbDir, {recursive: true});
    const results = [];
    const {execFile} = require('child_process');
    for (let i = 0; i < filePaths.length; i++) {
      const fp = filePaths[i];
      const basename = path.basename(fp);
      const thumbFile = path.join(thumbDir, `thumb-${Date.now()}-${i}.jpg`);
      // 1.2초 지점 고화질(720p) 프레임 추출 (영상이 1.2초보다 짧으면 0.2초 폴백)
      await new Promise((res) => {
        execFile(ffmpegPath, ['-y', '-ss', '1.2', '-i', fp, '-vframes', '1', '-vf', 'scale=720:-1', '-q:v', '2', thumbFile], () => {
          if (fs.existsSync(thumbFile) && fs.statSync(thumbFile).size > 500) {
            res(thumbFile);
          } else {
            execFile(ffmpegPath, ['-y', '-ss', '0.2', '-i', fp, '-vframes', '1', '-vf', 'scale=720:-1', '-q:v', '2', thumbFile], () => res(thumbFile));
          }
        });
      });
      results.push({
        path: fp,
        name: basename,
        thumb: fs.existsSync(thumbFile) ? thumbFile : null,
      });
    }
    return results;
  }

  ipcMain.handle('pick-videos', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']}],
    });
    if (r.canceled || !r.filePaths.length) return [];
    return generateVideoThumbs(r.filePaths);
  });

  ipcMain.handle('process-video-files', async (event, filePaths) => {
    return generateVideoThumbs(filePaths);
  });

  ipcMain.handle('transcribe-video', async (event, videoPath) => {
    const whisperDir = app.isPackaged
      ? path.join(process.resourcesPath, 'whisper')
      : path.join(__dirname, 'assets', 'whisper');
    const whisperBin = path.join(whisperDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    const modelPath = path.join(whisperDir, 'ggml-small.bin');
    try { fs.chmodSync(whisperBin, 0o755); } catch (_) {}

    const ffmpegPath = getFfmpegPath();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-agent-transcribe-'));
    const thumbDir = path.join(os.tmpdir(), 'video-agent-thumbs');
    fs.mkdirSync(thumbDir, {recursive: true});

    try {
      const {transcribe} = require('./whisper');
      const segments = await transcribe({
        videoPath,
        workDir,
        ffmpegPath,
        whisperBin,
        modelPath,
        language: 'ko',
      });

      const {execFile} = require('child_process');
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const mid = Math.max(0.2, (seg.start + seg.end) / 2).toFixed(2);
        const segThumb = path.join(thumbDir, `seg-${Date.now()}-${i}.jpg`);
        await new Promise((res) => {
          execFile(ffmpegPath, ['-y', '-ss', String(mid), '-i', videoPath, '-vframes', '1', '-vf', 'scale=720:-1', '-q:v', '2', segThumb], () => res(segThumb));
        });
        seg.thumb = fs.existsSync(segThumb) ? segThumb : null;
      }
      return {success: true, segments};
    } catch (e) {
      return {success: false, error: e.message, segments: []};
    } finally {
      try { fs.rmSync(workDir, {recursive: true, force: true}); } catch (_) {}
    }
  });

  // 내 목소리 직접 녹음 저장 & 자동 받아쓰기 (Whisper)
  ipcMain.handle('save-recorded-audio', async (event, payload) => {
    try {
      const ffmpegPath = getFfmpegPath();
      const recDir = path.join(os.tmpdir(), 'video-agent-recordings');
      fs.mkdirSync(recDir, {recursive: true});
      const stamp = Date.now();
      const ext = (payload && payload.ext) || 'webm';
      const rawPath = path.join(recDir, `raw-${stamp}.${ext}`);
      const wavPath = path.join(recDir, `rec-${stamp}.wav`);

      let audioBuf;
      if (payload && payload.buffer) {
        if (Buffer.isBuffer(payload.buffer)) {
          audioBuf = payload.buffer;
        } else if (payload.buffer instanceof Uint8Array || payload.buffer instanceof ArrayBuffer) {
          audioBuf = Buffer.from(payload.buffer);
        } else if (typeof payload.buffer === 'object') {
          audioBuf = Buffer.from(Object.values(payload.buffer));
        }
      } else if (payload && payload.base64) {
        audioBuf = Buffer.from(payload.base64.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      } else if (typeof payload === 'string') {
        audioBuf = Buffer.from(payload.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      } else if (Buffer.isBuffer(payload)) {
        audioBuf = payload;
      }

      if (!audioBuf || audioBuf.length === 0) {
        return {success: false, error: '녹음 오디오 데이터가 비어 있습니다.'};
      }

      fs.writeFileSync(rawPath, audioBuf);

      const {execFile} = require('child_process');
      await new Promise((resolve, reject) => {
        execFile(ffmpegPath, ['-y', '-loglevel', 'error', '-i', rawPath, '-ar', '44100', '-ac', '2', wavPath], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 녹음된 길이 측정 및 위스퍼로 대사 자동 추출
      let durSec = 0;
      let transcript = '';
      try {
        const whisperDir = app.isPackaged
          ? path.join(process.resourcesPath, 'whisper')
          : path.join(__dirname, 'assets', 'whisper');
        const whisperBin = path.join(whisperDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
        const modelPath = path.join(whisperDir, 'ggml-small.bin');
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-agent-rec-tr-'));
        try {
          const {transcribe} = require('./whisper');
          const segs = await transcribe({
            videoPath: wavPath,
            workDir,
            ffmpegPath,
            whisperBin,
            modelPath,
            language: 'ko',
          });
          if (segs && segs.length) {
            transcript = segs.map((s) => s.text).join(' ').trim();
            durSec = segs[segs.length - 1].end;
          }
        } finally {
          try { fs.rmSync(workDir, {recursive: true, force: true}); } catch (_) {}
        }
      } catch (_) {}

      const dataUri = 'data:audio/wav;base64,' + fs.readFileSync(wavPath).toString('base64');
      return {
        success: true,
        audioPath: wavPath,
        dataUri,
        duration: durSec,
        transcript,
        text: transcript,
      };
    } catch (err) {
      console.error('save-recorded-audio 처리 오류:', err);
      return {success: false, error: err.message};
    }
  });

  // 연령대별 나레이션 보이스 미리듣기
  ipcMain.handle('preview-voice', async (event, voiceName) => {
    const settings = loadSettings();
    const ffmpegPath = getFfmpegPath();
    const cacheDir = path.join(os.tmpdir(), 'video-agent-voice-preview');
    fs.mkdirSync(cacheDir, {recursive: true});
    const outPath = path.join(cacheDir, `voice-preview-${voiceName}.mp3`);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 500) {
      await synthesize(
        '안녕하세요, 영상을 더욱 품격 있게 만들어 드리는 나레이션 목소리입니다.',
        outPath,
        ffmpegPath,
        {
          apiKey: settings.apiKey || '',
          ttsModel: settings.ttsModel || 'gemini-2.5-flash-preview-tts',
          voice: voiceName || 'Kore',
          voiceboxUrl: settings.voiceboxUrl || 'http://192.168.12.86:17493',
          voiceboxProfile: settings.voiceboxProfile || 'ddf94b87-c330-41cf-96be-820d5c279dcd',
        }
      );
    }
    if (fs.existsSync(outPath)) {
      return 'data:audio/mp3;base64,' + fs.readFileSync(outPath).toString('base64');
    }
    return null;
  });

  ipcMain.handle('build-video', async (event, payload) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-agent-'));
    let baseDir;
    try {
      baseDir = app.getPath('movies');
    } catch (e) {
      try {
        baseDir = app.getPath('documents');
      } catch (e2) {
        baseDir = app.getPath('home');
      }
    }
    const outDir = path.join(baseDir, 'VideoAgent');
    fs.mkdirSync(outDir, {recursive: true});
    const outputPath = path.join(outDir, `video-${stamp}.mp4`);
    const fontsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'fonts')
      : path.join(__dirname, 'assets', 'fonts');
    const whisperDir = app.isPackaged
      ? path.join(process.resourcesPath, 'whisper')
      : path.join(__dirname, 'assets', 'whisper');
    const result = await buildVideoProject(
      {
        videoPaths: payload.videoPaths || (payload.video ? [payload.video] : []),
        videoPath: payload.video || (payload.videoPaths && payload.videoPaths[0]),
        captionStyle: payload.captionStyle || 'dohyeon',
        aspect: payload.aspect || '9:16',
        title: payload.title || '',
        trimSilence: !!payload.trimSilence,
        shortForm: Number(payload.shortForm) || 0,
        bgm: resolveBgmPath(payload.bgm),
        bgmVolume: Number(payload.bgmVolume) || 0.35,
        sfxPack: payload.sfxPack || 'variety',
        autoMosaic: !!payload.autoMosaic,
        workDir,
        outputPath,
        fontsDir,
        whisper: {
          bin: path.join(whisperDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
          model: path.join(whisperDir, 'ggml-small.bin'),
          language: 'ko',
        },
      },
      (stage, cur, total) => event.sender.send('progress', {stage, cur, total})
    );
    return result;
  });

  ipcMain.handle('pick-audio', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg']}],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('pick-pdf', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{name: 'PDF', extensions: ['pdf']}],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return {path: r.filePaths[0], data: fs.readFileSync(r.filePaths[0]).toString('base64')};
  });

  ipcMain.handle('save-slide', async (event, {index, base64, text}) => {
    const dir = path.join(os.tmpdir(), 'video-agent-slides');
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, `slide-${Date.now()}-${index}.png`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return {image: file, narration: (text || '').slice(0, 300)};
  });

  ipcMain.handle('get-settings', async () => loadSettings());

  ipcMain.handle('save-settings', async (event, settings) => {
    const cur = loadSettings();
    const merged = {...cur, ...settings};
    fs.mkdirSync(path.dirname(settingsPath()), {recursive: true});
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
    return true;
  });

  ipcMain.handle('analyze', async (event, payload) => {
    const settings = loadSettings();
    if (!settings.apiKey) throw new Error('먼저 설정에서 AI API 키를 입력해 주세요.');
    const targetScenes = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.scenes) ? payload.scenes : []);
    const drafts = await analyzeScenes({
      apiKey: settings.apiKey,
      model: settings.model || 'gemini-2.5-flash',
      scenes: targetScenes,
      lang: (payload && payload.lang) || 'ko',
    });
    return drafts;
  });

  ipcMain.handle('plan-superpowers', async (event, payload) => {
    const settings = loadSettings();
    const plan = await planSuperpowersProject({
      apiKey: settings.apiKey || '',
      model: settings.model || 'gemini-2.5-flash',
      topic: payload.topic,
      aspect: payload.aspect || '9:16',
      onProgress: (p) => event.sender.send('progress', p),
    });
    return plan;
  });

  ipcMain.handle('regenerate-scene-image', async (event, payload) => {
    const settings = loadSettings();
    if (!settings.apiKey) throw new Error('먼저 설정에서 Gemini API 키를 입력해 주세요.');
    const newImg = await regenerateSceneImage({
      apiKey: settings.apiKey,
      narration: payload.narration,
      prompt: payload.prompt,
      aspect: payload.aspect || '9:16',
    });
    return newImg;
  });

  ipcMain.handle('preview-sfx', async (event, kind) => {
    const workDir = path.join(os.tmpdir(), 'video-agent-sfx-preview');
    fs.mkdirSync(workDir, {recursive: true});
    const sfxPath = await ensureSfxFile(kind, workDir);
    if (sfxPath && fs.existsSync(sfxPath)) {
      return 'data:audio/wav;base64,' + fs.readFileSync(sfxPath).toString('base64');
    }
    return null;
  });

  ipcMain.handle('preview-bgm', async (event, bgmKey) => {
    const bgmPath = resolveBgmPath(bgmKey);
    if (bgmPath && fs.existsSync(bgmPath)) {
      const buf = fs.readFileSync(bgmPath);
      const slice = buf.length > 2500000 ? buf.slice(0, 2500000) : buf;
      return 'data:audio/mp3;base64,' + slice.toString('base64');
    }
    return null;
  });

  ipcMain.handle('open-file', async (event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return true;
      }
      if (filePath && fs.existsSync(path.dirname(filePath))) {
        await shell.openPath(path.dirname(filePath));
        return true;
      }
      let baseDir = app.getPath('videos');
      if (!fs.existsSync(baseDir)) {
        try { baseDir = app.getPath('movies'); } catch (_) { baseDir = app.getPath('home'); }
      }
      const outDir = path.join(baseDir, 'VideoAgent');
      if (fs.existsSync(outDir)) {
        await shell.openPath(outDir);
      } else {
        await shell.openPath(baseDir);
      }
      return true;
    } catch (e) {
      console.error('Failed to open folder:', e);
      return false;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
