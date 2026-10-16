const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('agent', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  saveSlide: (payload) => ipcRenderer.invoke('save-slide', payload),
  build: (payload) => ipcRenderer.invoke('build', payload),
  buildVideo: (payload) => ipcRenderer.invoke('build-video', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  onProgress: (cb) => ipcRenderer.on('progress', (e, data) => cb(data)),
});
