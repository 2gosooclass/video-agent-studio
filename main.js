const {app, BrowserWindow, ipcMain, dialog, shell} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {buildProject} = require('./engine');

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
    const outDir = path.join(app.getPath('movies'), 'VideoAgent');
    fs.mkdirSync(outDir, {recursive: true});
    const outputPath = path.join(outDir, `video-${stamp}.mp4`);
    const result = await buildProject(
      {scenes: payload.scenes, keywords: payload.keywords || [], workDir, outputPath},
      (stage, cur, total) => event.sender.send('progress', {stage, cur, total})
    );
    return result;
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
