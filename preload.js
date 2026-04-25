const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt'),
  chatCompletion: (messages, apiKey) => ipcRenderer.invoke('chat-completion', { messages, apiKey }),
  ttsSpeak: (text, voice, speed) => ipcRenderer.invoke('tts-speak', { text, voice, speed }),
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  transcribeAudio: (apiKey, audioBase64, format) => ipcRenderer.invoke('transcribe-audio', { apiKey, audioBase64, format }),
  saveSession: (sessionData) => ipcRenderer.invoke('save-session', { sessionData }),
  loadSessions: () => ipcRenderer.invoke('load-sessions'),
  deleteSession: (filePath) => ipcRenderer.invoke('delete-session', { filePath }),
  saveVocab: (vocab) => ipcRenderer.invoke('save-vocab', { vocab }),
  loadVocab: () => ipcRenderer.invoke('load-vocab'),
  showError: (title, message) => ipcRenderer.invoke('show-error', { title, message }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onShowSettingsPrompt: (callback) => ipcRenderer.on('show-settings-prompt', callback),
  calibrateMic: () => ipcRenderer.invoke('calibrate-mic'),
  saveCalibration: (gain, noiseFloor) => ipcRenderer.invoke('save-calibration', { gain, noiseFloor }),
  getCalibration: () => ipcRenderer.invoke('get-calibration')
});