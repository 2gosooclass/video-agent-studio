const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('agent', {
  pickImages: () => ipcRenderer.invoke('pick-images'),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  saveSlide: (payload) => ipcRenderer.invoke('save-slide', payload),
  saveRecordedAudio: (payload) => ipcRenderer.invoke('save-recorded-audio', payload),
  build: (payload) => ipcRenderer.invoke('build', payload),
  buildVideo: (payload) => ipcRenderer.invoke('build-video', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  planSuperpowers: (payload) => ipcRenderer.invoke('plan-superpowers', payload),
  regenerateSceneImage: (payload) => ipcRenderer.invoke('regenerate-scene-image', payload),
  previewSfx: (kind) => ipcRenderer.invoke('preview-sfx', kind),
  previewBgm: (bgmKey) => ipcRenderer.invoke('preview-bgm', bgmKey),
  previewVoice: (voiceName) => ipcRenderer.invoke('preview-voice', voiceName),
  transcribeVideo: (videoPath) => ipcRenderer.invoke('transcribe-video', videoPath),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  onProgress: (cb) => ipcRenderer.on('progress', (e, data) => cb(data)),
});
