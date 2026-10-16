const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('agent', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  build: (payload) => ipcRenderer.invoke('build', payload),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  onProgress: (cb) => ipcRenderer.on('progress', (e, data) => cb(data)),
});
