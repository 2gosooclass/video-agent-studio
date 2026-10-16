const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('agent', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  build: (payload) => ipcRenderer.invoke('build', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  onProgress: (cb) => ipcRenderer.on('progress', (e, data) => cb(data)),
});
