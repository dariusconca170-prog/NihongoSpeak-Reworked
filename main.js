const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { spawn, exec } = require('child_process');

const store = new Store({
  name: 'nihongospeak-config',
  defaults: {
    apiKey: '',
    immersionRatio: 70,
    proficiencyLevel: 'N5',
    ttsVoice: 'ja-JP-NanamiNeural',
    ttsSpeed: 1.0,
    sttLanguageHint: 'ja',
    vocab: [],
    sessionsDir: path.join(app.getPath('home'), '.nihongo_sensei', 'sessions'),
    micGain: 1.0,
    noiseFloor: 0.01,
    lastCalibration: null
  }
});

let mainWindow;
let audioProcess = null;
let recordingProcess = null;
let tempAudioPath = path.join(app.getPath('temp'), 'nihongospeak-input.wav');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1a2e',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    checkApiKey();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function checkApiKey() {
  const apiKey = store.get('apiKey');
  if (!apiKey || apiKey.trim() === '') {
    mainWindow.webContents.send('show-settings-prompt');
  }
}

function ensureSessionDir() {
  const sessionsDir = store.get('sessionsDir');
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  return sessionsDir;
}

app.whenReady().then(() => {
  ensureSessionDir();
  checkWindowsMicBoost();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-config', () => {
  return {
    apiKey: store.get('apiKey'),
    immersionRatio: store.get('immersionRatio'),
    proficiencyLevel: store.get('proficiencyLevel'),
    ttsVoice: store.get('ttsVoice'),
    ttsSpeed: store.get('ttsSpeed'),
    sttLanguageHint: store.get('sttLanguageHint'),
    vocab: store.get('vocab') || [],
    sessionsDir: store.get('sessionsDir')
  };
});

ipcMain.handle('set-config', (event, config) => {
  if (config.apiKey !== undefined) store.set('apiKey', config.apiKey);
  if (config.immersionRatio !== undefined) store.set('immersionRatio', config.immersionRatio);
  if (config.proficiencyLevel !== undefined) store.set('proficiencyLevel', config.proficiencyLevel);
  if (config.ttsVoice !== undefined) store.set('ttsVoice', config.ttsVoice);
  if (config.ttsSpeed !== undefined) store.set('ttsSpeed', config.ttsSpeed);
  if (config.sttLanguageHint !== undefined) store.set('sttLanguageHint', config.sttLanguageHint);
  if (config.vocab !== undefined) store.set('vocab', config.vocab);
  return true;
});

ipcMain.handle('get-system-prompt', async () => {
  const promptPath = path.join(__dirname, 'resources', 'system_prompt.txt');
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch (error) {
    console.error('Failed to load system prompt:', error);
    return getDefaultSystemPrompt();
  }
});

function getDefaultSystemPrompt() {
  return `You are Sensei, a warm and encouraging Japanese language tutor.
You teach students at various proficiency levels from complete beginner (A0.1) to advanced (N1).
Use the 70/30 immersion method: when the immersion ratio is 70%, 70% of your output should be in Japanese with 30% English explanation.
Always be encouraging and never condescending.
Provide gentle inline error correction with brief explanations.
Weave cultural context naturally into your responses.
Use vocabulary flagging format when the user struggles with a word: {"vocab_flag": {"word": "word", "reading": "reading", "meaning": "meaning"}}`;
}

ipcMain.handle('chat-completion', async (event, { messages, apiKey }) => {
  const Groq = require('groq-sdk');
  const groq = new Groq({ apiKey });

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1024
    });

    return {
      success: true,
      message: completion.choices[0]?.message?.content || ''
    };
  } catch (error) {
    console.error('Groq API error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('tts-speak', async (event, { text, voice, speed }) => {
  const settings = {
    voice: voice || store.get('ttsVoice'),
    speed: speed || store.get('ttsSpeed')
  };

  const voices = {
    'ja-JP-NanamiNeural': 'ja-JP-NanamiNeural',
    'ja-JP-KeitaNeural': 'ja-JP-KeitaNeural'
  };

  const selectedVoice = voices[settings.voice] || 'ja-JP-NanamiNeural';
  const rate = Math.round(settings.speed * 100) + '%';

  const outputPath = path.join(app.getPath('temp'), 'nihongospeak-output.mp3');

  return new Promise((resolve, reject) => {
    const args = [
      '--voice', selectedVoice,
      '--rate', `+${rate}`,
      '--write', outputPath,
      text
    ];

    audioProcess = spawn('edge-tts', args);

    audioProcess.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        const audioArgs = [outputPath];
        const audioPlayer = process.platform === 'win32' 
          ? spawn('powershell', ['-c', `(New-Object Media.SoundPlayer '${outputPath.Replace("\\", "\\\\")}').PlaySync()`])
          : spawn('afplay', audioArgs);

        audioPlayer.on('close', () => {
          try { fs.unlinkSync(outputPath); } catch (e) {}
          resolve({ success: true });
        });

        audioPlayer.on('error', (err) => {
          console.error('Audio playback error:', err);
          resolve({ success: false, error: err.message });
        });
      } else {
        resolve({ success: false, error: 'TTS generation failed' });
      }
    });

    audioProcess.on('error', (err) => {
      console.error('edge-tts error:', err);
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('start-recording', async () => {
  return new Promise((resolve) => {
    try {
      const recorderCommand = process.platform === 'win32'
        ? 'node'
        : 'node';

      const recordScript = path.join(__dirname, 'src', 'record_temp.js');
      
      const tempDir = app.getPath('temp');
      tempAudioPath = path.join(tempDir, 'nihongospeak-input.wav');

      recordingProcess = spawn('node', [recordScript, tempAudioPath], {
        cwd: __dirname
      });

      recordingProcess.on('close', (code) => {
        resolve({ success: code === 0 });
      });

      setTimeout(() => resolve({ success: true }), 100);
    } catch (error) {
      console.error('Recording error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('stop-recording', async () => {
  return new Promise((resolve) => {
    if (recordingProcess) {
      recordingProcess.kill();
      recordingProcess = null;
    }
    resolve({ success: true });
  });
});

ipcMain.handle('transcribe-audio', async (event, { apiKey, audioBase64, format }) => {
  const Groq = require('groq-sdk');
  const groq = new Groq({ apiKey });

  try {
    if (!audioBase64) {
      return { success: false, error: 'No audio data provided' };
    }

    const transcription = await groq.audio.transcriptions.create({
      file: {
        data: audioBase64,
        format: format || 'webm'
      },
      model: 'whisper-large-v3',
      language: store.get('sttLanguageHint') || 'ja',
      response_format: 'text'
    });

    return {
      success: true,
      text: transcription.text || ''
    };
  } catch (error) {
    console.error('Transcription error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('save-session', async (event, { sessionData }) => {
  const sessionsDir = ensureSessionDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `session_${timestamp}.json`;
  const filePath = path.join(sessionsDir, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Session save error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-sessions', async () => {
  const sessionsDir = ensureSessionDir();

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const sessions = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(sessionsDir, file), 'utf-8');
        sessions.push(JSON.parse(content));
      } catch (e) {
        console.error('Failed to load session:', file, e);
      }
    }

    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { success: true, sessions };
  } catch (error) {
    return { success: false, error: error.message, sessions: [] };
  }
});

ipcMain.handle('delete-session', async (event, { filePath }) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-vocab', async (event, { vocab }) => {
  store.set('vocab', vocab);
  return { success: true };
});

ipcMain.handle('load-vocab', async () => {
  return store.get('vocab') || [];
});

ipcMain.handle('show-error', (event, { title, message }) => {
  dialog.showErrorBox(title, message);
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

function checkWindowsMicBoost() {
  if (process.platform !== 'win32') return;
  try {
    const result = execSync(
      'powershell -command "Get-AudioDevice -RecordingDefault | Select-Object -ExpandProperty Name"',
      { timeout: 3000, encoding: 'utf8' }
    ).trim();
    console.log('[Audio] Default recording device:', result);
  } catch {
    console.log('[Audio] Could not detect Windows audio device');
  }
}

ipcMain.handle('calibrate-mic', async () => {
  return {
    gain: store.get('micGain', 1.0),
    noiseFloor: store.get('noiseFloor', 0.01),
    lastCalibration: store.get('lastCalibration')
  };
});

ipcMain.handle('save-calibration', async (event, { gain, noiseFloor }) => {
  store.set('micGain', gain);
  store.set('noiseFloor', noiseFloor);
  store.set('lastCalibration', new Date().toISOString());
  return { success: true };
});

ipcMain.handle('get-calibration', async () => {
  return {
    gain: store.get('micGain', 1.0),
    noiseFloor: store.get('noiseFloor', 0.01),
    lastCalibration: store.get('lastCalibration')
  };
});