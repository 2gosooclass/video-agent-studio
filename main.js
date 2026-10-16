const {app, BrowserWindow, ipcMain, dialog, shell} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {buildProject, buildVideoProject} = require('./engine');
const {analyzeScenes} = require('./analysis');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    return {apiKey: '', model: 'gemini-2.5-flash'};
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    backgroundColor: '#17181c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
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
    const fontsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'fonts')
      : path.join(__dirname, 'assets', 'fonts');
    const result = await buildProject(
      {
        scenes: payload.scenes,
        keywords: payload.keywords || [],
        captionStyle: payload.captionStyle || 'dohyeon',
        aspect: payload.aspect || '9:16',
        title: payload.title || '',
        workDir,
        outputPath,
        fontsDir,
        tts: {
          apiKey: settings.apiKey || '',
          ttsModel: settings.ttsModel || 'gemini-2.5-flash-preview-tts',
          voice: settings.voice || 'Kore',
        },
      },
      (stage, cur, total) => event.sender.send('progress', {stage, cur, total})
    );
    return result;
  });

  ipcMain.handle('pick-videos', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv']}],
    });
    return r.canceled ? [] : r.filePaths;
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
        videoPath: payload.video,
        captionStyle: payload.captionStyle || 'dohyeon',
        aspect: payload.aspect || '9:16',
        title: payload.title || '',
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
    fs.mkdirSync(path.dirname(settingsPath()), {recursive: true});
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    return true;
  });

  ipcMain.handle('analyze', async (event, payload) => {
    const settings = loadSettings();
    if (!settings.apiKey) throw new Error('먼저 설정에서 AI API 키를 입력해 주세요.');
    const drafts = await analyzeScenes({
      apiKey: settings.apiKey,
      model: settings.model || 'gemini-2.5-flash',
      scenes: payload.scenes,
    });
    return drafts;
  });

  ipcMain.handle('open-file', async (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
