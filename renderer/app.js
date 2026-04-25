let config = {};
let messages = [];
let vocabList = [];
let sessionsList = [];
let isRecording = false;
let selectedLevel = 'N1';
let audioContext = null;
let analyser = null;
let calibratedGain = 1.0;
let noiseFloor = 0.01;
let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadCalibration();
  setupTabs();
  setupChat();
  setupSessions();
  setupVocabulary();
  setupSettings();
  loadSessions();
  showTab('chat');
});

async function loadCalibration() {
  try {
    const cal = await window.api.getCalibration();
    calibratedGain = cal.gain || 1.0;
    noiseFloor = cal.noiseFloor || 0.01;
    console.log(`[Audio] Loaded calibration: Gain=${calibratedGain.toFixed(2)}, Noise floor=${noiseFloor.toFixed(4)}`);
  } catch (e) {
    console.log('[Audio] No calibration data, using defaults');
  }
}

async function loadConfig() {
  try {
    config = await window.api.getConfig();
    updateSettingsDisplay();
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

function updateSettingsDisplay() {
  const levelBadge = document.getElementById('levelBadge');
  const levelDisplay = document.getElementById('levelDisplay');
  const level = config.proficiencyLevel || 'N5';
  
  if (levelBadge) levelBadge.textContent = level;
  if (levelDisplay) levelDisplay.textContent = level;
  
  const immersionBadge = document.getElementById('immersionBadge');
  if (immersionBadge) {
    immersionBadge.textContent = `${config.immersionRatio || 70}% Immersion`;
  }
  
  document.getElementById('api-key-input').value = config.apiKey || '';
  document.getElementById('immersion-slider').value = config.immersionRatio || 70;
  document.getElementById('immersion-value').textContent = `${config.immersionRatio || 70}%`;
  document.getElementById('tts-voice-select').value = config.ttsVoice || 'ja-JP-NanamiNeural';
  document.getElementById('tts-speed-slider').value = (config.ttsSpeed || 1.0) * 100;
  document.getElementById('tts-speed-value').textContent = `${config.ttsSpeed || 1.0}x`;
  document.getElementById('stt-lang-toggle').value = config.sttLanguageHint || 'ja';
  
  selectedLevel = config.proficiencyLevel || 'N1';
  updateLevelGrid();
}

function updateLevelGrid() {
  document.querySelectorAll('.level-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.level === selectedLevel);
  });
}

function showTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const panels = document.querySelectorAll('.chat-panel, .sessions-panel, .vocabulary-panel, .settings-panel');
  panels.forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`${tabName}-panel`);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  if (tabName === 'vocabulary') {
    renderVocab();
  } else if (tabName === 'sessions') {
    renderSessions();
  }
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
    });
  });

  window.api.onShowSettingsPrompt(() => {
    showTab('settings');
  });
}

function setupChat() {
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  micBtn.addEventListener('mousedown', startRecording);
  micBtn.addEventListener('mouseup', stopRecording);
  micBtn.addEventListener('mouseleave', () => {
    if (isRecording) stopRecording();
  });

  if (!config.apiKey || config.apiKey.trim() === '') {
    addSystemMessage('Please enter your Groq API key in Settings to start chatting.');
  } else {
    addSystemMessage('こんにちは！Welcome to NihongoSpeak. Let\'s practice Japanese together!');
  }
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  if (!config.apiKey || config.apiKey.trim() === '') {
    addSystemMessage('Please enter your Groq API key in Settings first.');
    showTab('settings');
    return;
  }

  addUserMessage(text);
  input.value = '';
  updateStatus('Sending...');

  try {
    const systemPrompt = await window.api.getSystemPrompt();
    const langSetting = `You are teaching at ${config.proficiencyLevel || 'N5'} level with ${config.immersionRatio || 70}% immersion ratio.`;
    const fullSystemPrompt = systemPrompt + '\n\n' + langSetting;

    messages.push({ role: 'user', content: text });

    const allMessages = [
      { role: 'system', content: fullSystemPrompt },
      ...messages
    ];

    const result = await window.api.chatCompletion(allMessages, config.apiKey);

    if (result.success) {
      messages.push({ role: 'assistant', content: result.message });
      addSenseiMessage(result.message);

      const extractedJapanese = extractJapaneseText(result.message);
      if (extractedJapanese) {
        await window.api.ttsSpeak(extractedJapanese, config.ttsVoice, config.ttsSpeed);
      }

      const vocabFlag = extractVocabFlag(result.message);
      if (vocabFlag) {
        await addVocabWord(vocabFlag);
      }

      autoSaveSession();
    } else {
      updateStatus('Error: ' + result.error);
      addSystemMessage('Error: ' + result.error);
    }
  } catch (error) {
    console.error('Chat error:', error);
    updateStatus('Error: ' + error.message);
    addSystemMessage('Error: ' + error.message);
  }
}

function addUserMessage(text) {
  const container = document.getElementById('message-list');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(new Date());

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(time);
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
}

function addSenseiMessage(text) {
  const container = document.getElementById('message-list');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message sensei';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const parts = text.split('\n\n').filter(p => !p.includes('{"vocab_flag"'));
  parts.forEach(part => {
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(part)) {
      const jp = document.createElement('div');
      jp.className = 'japanese-text';
      jp.textContent = part;
      bubble.appendChild(jp);
    } else if (part.trim()) {
      const en = document.createElement('div');
      en.className = 'english-text';
      en.textContent = part;
      en.style.display = 'none';
      en.addEventListener('click', () => {
        en.style.display = en.style.display === 'none' ? 'block' : 'none';
      });
      bubble.appendChild(en);
    }
  });

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(new Date());

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(time);
  container.appendChild(messageDiv);
  container.scrollTop = container.scrollHeight;
  updateStatus('Ready');
}

function addSystemMessage(text) {
  const container = document.getElementById('message-list');
  const msg = document.createElement('div');
  msg.className = 'system-message';
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function extractJapaneseText(text) {
  const lines = text.split('\n');
  let japanese = '';
  lines.forEach(line => {
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(line)) {
      japanese += line + ' ';
    }
  });
  return japanese.trim();
}

function extractVocabFlag(text) {
  try {
    const match = text.match(/\{["']vocab_flag["']:\s*\{["']word["']:\s*["']([^"']+)["'],\s*["']reading["']:\s*["']([^"']+)["'],\s*["']meaning["']:\s*["']([^"']+)["']\}\}/);
    if (match) {
      return {
        word: match[1],
        reading: match[2],
        meaning: match[3]
      };
    }
  } catch (e) {}
  return null;
}

function updateStatus(text) {
  const volLabel = document.getElementById('volLabel');
  if (volLabel) volLabel.textContent = text;
}

async function startVolumeVisualizerFromAnalyser(analyserNode) {
  if (!analyserNode) return;
  
  try {
    audioContext = new AudioContext();
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    const bars = document.querySelectorAll('.vol-bar');
    const volMeter = document.getElementById('volMeter');

    function draw() {
      if (!isRecording) {
        if (audioContext) {
          audioContext.close();
          audioContext = null;
        }
        return;
      }
      analyserNode.getByteFrequencyData(dataArray);
      const avg = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const level = Math.min(avg / 128, 1);
      
      bars.forEach((bar, i) => {
        const threshold = i / bars.length;
        bar.style.opacity = level > threshold ? '1' : '0.15';
        bar.style.transform = level > threshold ? 'scaleY(1)' : 'scaleY(0.4)';
      });
      
      if (volMeter) volMeter.classList.add('active');
      requestAnimationFrame(draw);
    }
    draw();
  } catch (err) {
    console.error('Volume visualizer error:', err);
  }
}

    function draw() {
      if (!isRecording) {
        if (audioContext) {
          audioContext.close();
          audioContext = null;
        }
        return;
      }
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const level = Math.min(avg / 128, 1);
      
      bars.forEach((bar, i) => {
        const threshold = i / bars.length;
        bar.style.opacity = level > threshold ? '1' : '0.15';
        bar.style.transform = level > threshold ? 'scaleY(1)' : 'scaleY(0.4)';
      });
      
      if (volMeter) volMeter.classList.add('active');
      requestAnimationFrame(draw);
    }
    draw();
  } catch (err) {
    console.error('Volume visualizer error:', err);
  }
}

async function startRecording() {
  if (!config.apiKey || config.apiKey.trim() === '') {
    addSystemMessage('Please enter your Groq API key in Settings first.');
    return;
  }

  isRecording = true;
  const micBtn = document.getElementById('mic-btn');
  const micIcon = micBtn.querySelector('.mic-icon');
  const recordingIcon = micBtn.querySelector('.recording-icon');
  
  micBtn.classList.add('recording');
  if (micIcon) micIcon.style.display = 'none';
  if (recordingIcon) recordingIcon.style.display = 'block';
  updateStatus('Recording...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      },
      video: false
    });

    currentStream = stream;
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = calibratedGain;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const highPass = audioCtx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 80;

    source.connect(highPass);
    highPass.connect(gainNode);
    gainNode.connect(compressor);

    const dest = audioCtx.createMediaStreamDestination();
    compressor.connect(dest);

    const analyserForViz = audioCtx.createAnalyser();
    analyserForViz.fftSize = 256;
    compressor.connect(analyserForViz);
    startVolumeVisualizerFromAnalyser(analyserForViz);

    mediaRecorder = new MediaRecorder(dest.stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    recordedChunks = [];
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      audioCtx.close();
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      await sendToWhisper(blob);
    };

    mediaRecorder.start();
  } catch (error) {
    console.error('Recording error:', error);
    isRecording = false;
    micBtn.classList.remove('recording');
    if (micIcon) micIcon.style.display = 'block';
    if (recordingIcon) recordingIcon.style.display = 'none';
    updateStatus('Recording failed');
  }
}

async function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  const micBtn = document.getElementById('mic-btn');
  const micIcon = micBtn.querySelector('.mic-icon');
  const recordingIcon = micBtn.querySelector('.recording-icon');
  const spinnerIcon = micBtn.querySelector('.spinner-icon');
  
  micBtn.classList.remove('recording');
  micBtn.classList.add('processing');
  
  if (micIcon) micIcon.style.display = 'none';
  if (recordingIcon) recordingIcon.style.display = 'none';
  if (spinnerIcon) spinnerIcon.style.display = 'block';
  
  updateStatus('Transcribing...');

  const bars = document.querySelectorAll('.vol-bar');
  bars.forEach(bar => {
    bar.style.opacity = '0.15';
    bar.style.transform = 'scaleY(0.4)';
  });
  const volMeter = document.getElementById('volMeter');
  if (volMeter) volMeter.classList.remove('active');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  } else {
    isRecording = false;
    const micBtn2 = document.getElementById('mic-btn');
    const micIcon2 = micBtn2.querySelector('.mic-icon');
    const spinnerIcon2 = micBtn2.querySelector('.spinner-icon');
    micBtn2.classList.remove('processing');
    if (micIcon2) micIcon2.style.display = 'block';
    if (spinnerIcon2) spinnerIcon2.style.display = 'none';
  }
}

async function sendToWhisper(blob) {
  try {
    const hasContent = await hasAudioContent(blob);
    if (!hasContent) {
      updateStatus('No speech detected');
      return;
    }

    updateStatus('Transcribing...');

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

    const result = await window.api.transcribeAudio(config.apiKey, base64, 'webm');

    if (result.success && result.text) {
      document.getElementById('chat-input').value = result.text;
      updateStatus('Ready');
    } else {
      updateStatus('No speech detected');
    }
  } catch (error) {
    console.error('Transcription error:', error);
    updateStatus('Transcription failed');
  } finally {
    const micBtn = document.getElementById('mic-btn');
    const micIcon = micBtn.querySelector('.mic-icon');
    const spinnerIcon = micBtn.querySelector('.spinner-icon');
    micBtn.classList.remove('processing');
    if (micIcon) micIcon.style.display = 'block';
    if (spinnerIcon) spinnerIcon.style.display = 'none';
  }
}

async function hasAudioContent(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new OfflineAudioContext(1, 16000 * 5, 16000);
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const data = decoded.getChannelData(0);
    const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    const gate = noiseFloor * 3;
    console.log(`[Audio] RMS: ${rms.toFixed(4)}, Gate: ${gate.toFixed(4)}`);
    return rms > gate;
  } catch {
    return true;
  }
}

function setupSessions() {
  document.getElementById('clear-sessions-btn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all sessions?')) {
      for (const session of sessionsList) {
        await window.api.deleteSession(session.filePath);
      }
      sessionsList = [];
      renderSessions();
    }
  });
}

async function loadSessions() {
  try {
    const result = await window.api.loadSessions();
    if (result.success) {
      sessionsList = result.sessions;
    }
  } catch (error) {
    console.error('Failed to load sessions:', error);
  }
}

function renderSessions() {
  const container = document.getElementById('sessions-list');
  container.innerHTML = '';

  if (!sessionsList || sessionsList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>No saved sessions yet</p>
        <p class="empty-hint">Start chatting to save a session</p>
      </div>
    `;
    return;
  }

  sessionsList.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';

    const date = new Date(session.timestamp).toLocaleString();
    const preview = session.messages && session.messages.length > 0
      ? session.messages[session.messages.length - 1].content.substring(0, 100) + '...'
      : 'Empty conversation';
    const count = session.messages ? session.messages.length : 0;

    card.innerHTML = `
      <div class="session-date">${date}</div>
      <div class="session-preview">${preview}</div>
      <div class="session-count">${count} messages</div>
    `;

    card.addEventListener('click', () => {
      loadSession(session);
    });

    container.appendChild(card);
  });
}

function loadSession(session) {
  messages = session.messages || [];
  const container = document.getElementById('message-list');
  container.innerHTML = '';

  messages.forEach(msg => {
    if (msg.role === 'user') {
      addUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      addSenseiMessage(msg.content);
    }
  });

  showTab('chat');
}

async function autoSaveSession() {
  if (messages.length === 0) return;

  const sessionData = {
    timestamp: new Date().toISOString(),
    messages: messages,
    level: config.proficiencyLevel,
    immersion: config.immersionRatio
  };

  await window.api.saveSession(sessionData);
  await loadSessions();
}

function setupVocabulary() {
  document.getElementById('vocab-search').addEventListener('input', renderVocab);
  document.getElementById('vocab-filter').addEventListener('change', renderVocab);
  document.getElementById('export-vocab-btn').addEventListener('click', exportVocab);
  loadVocab();
}

async function loadVocab() {
  try {
    vocabList = await window.api.loadVocab();
  } catch (error) {
    console.error('Failed to load vocab:', error);
    vocabList = [];
  }
}

function renderVocab() {
  const tbody = document.getElementById('vocab-tbody');
  const emptyState = document.getElementById('vocab-empty');
  tbody.innerHTML = '';

  const search = document.getElementById('vocab-search').value.toLowerCase();
  const filter = document.getElementById('vocab-filter').value;
  const today = new Date().toISOString().split('T')[0];

  let filtered = vocabList.filter(v => {
    const matchesSearch = !search ||
      v.word.toLowerCase().includes(search) ||
      v.reading.toLowerCase().includes(search) ||
      v.meaning.toLowerCase().includes(search);

    let matchesFilter = true;
    if (filter === 'due') {
      matchesFilter = v.nextReview <= today;
    } else if (filter === 'struggling') {
      matchesFilter = v.struggles >= 3;
    }

    return matchesSearch && matchesFilter;
  });

  if (filtered.length === 0) {
    tbody.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  tbody.style.display = 'table-row-group';
  emptyState.style.display = 'none';

  filtered.forEach((v, index) => {
    const tr = document.createElement('tr');
    const struggleClass = v.struggles <= 1 ? '' : v.struggles <= 3 ? 'warning' : 'danger';
    const dots = Array(Math.min(v.struggles, 5)).fill(0).map((_, i) =>
      `<span class="struggle-dot ${i < v.struggles ? (i < 2 ? '' : i < 4 ? 'warning' : 'danger') : ''}"></span>`
    ).join('');

    tr.innerHTML = `
      <td>${v.word}</td>
      <td>${v.reading}</td>
      <td>${v.meaning}</td>
      <td><div class="struggle-dots">${dots}</div></td>
      <td>${v.lastSeen}</td>
      <td>${v.nextReview}</td>
      <td><button class="delete-btn" data-index="${index}">Delete</button></td>
    `;
    tr.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.index);
      const actualIndex = vocabList.findIndex(item => item.word === filtered[idx].word);
      if (actualIndex >= 0) deleteVocab(actualIndex);
    });
    tbody.appendChild(tr);
  });
}

async function addVocabWord(vocabData) {
  const existing = vocabList.find(v => v.word === vocabData.word);
  const today = new Date().toISOString().split('T')[0];

  if (existing) {
    existing.struggles++;
    existing.lastSeen = today;
    if (existing.struggles === 1) existing.nextReview = getNextReviewDate(1);
    else if (existing.struggles === 2) existing.nextReview = getNextReviewDate(3);
    else existing.nextReview = getNextReviewDate(7);
  } else {
    vocabList.push({
      word: vocabData.word,
      reading: vocabData.reading,
      meaning: vocabData.meaning,
      struggles: 1,
      lastSeen: today,
      nextReview: getNextReviewDate(1)
    });
  }

  await window.api.saveVocab(vocabList);
  renderVocab();
}

function getNextReviewDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

async function deleteVocab(index) {
  vocabList.splice(index, 1);
  await window.api.saveVocab(vocabList);
  renderVocab();
}

function exportVocab() {
  const csv = 'Word,Reading,Meaning,Struggles,Last Seen,Next Review\n' +
    vocabList.map(v => `${v.word},${v.reading},${v.meaning},${v.struggles},${v.lastSeen},${v.nextReview}`).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vocabulary.csv';
  a.click();
}

function setupSettings() {
  const immersionSlider = document.getElementById('immersion-slider');
  const immersionValue = document.getElementById('immersion-value');
  immersionSlider.addEventListener('input', () => {
    immersionValue.textContent = `${immersionSlider.value}%`;
  });

  const ttsSpeedSlider = document.getElementById('tts-speed-slider');
  const ttsSpeedValue = document.getElementById('tts-speed-value');
  ttsSpeedSlider.addEventListener('input', () => {
    ttsSpeedValue.textContent = `${ttsSpeedSlider.value / 100}x`;
  });

  document.querySelectorAll('.level-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedLevel = card.dataset.level;
      updateLevelGrid();
    });
  });

  document.getElementById('toggle-api-key').addEventListener('click', () => {
    const input = document.getElementById('api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('groq-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://console.groq.com');
  });

  document.getElementById('recalibrateBtn').addEventListener('click', async () => {
    const resultDiv = document.getElementById('calibrationResult');
    resultDiv.textContent = 'Calibrating... stay quiet for 2 seconds.';
    resultDiv.style.color = 'var(--warning)';
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const samples = [];
      const dataArray = new Float32Array(analyser.fftSize);
      const sampleInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray);
        const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length);
        samples.push(rms);
      }, 100);

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      clearInterval(sampleInterval);
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();

      const avgRms = samples.reduce((a, b) => a + b, 0) / samples.length;
      const maxRms = Math.max(...samples);
      const noiseFloor = avgRms;
      const targetRms = 0.15;
      const measuredSpeechProxy = maxRms > 0 ? maxRms : 0.1;
      const calibratedGain = Math.min(Math.max(targetRms / measuredSpeechProxy, 0.1), 3.0);

      await window.api.saveCalibration(calibratedGain, noiseFloor);
      
      resultDiv.textContent = `Done. Gain: ${calibratedGain.toFixed(2)}x, Noise floor: ${(noiseFloor * 100).toFixed(1)}%`;
      resultDiv.style.color = 'var(--success)';
      console.log(`[Audio] Calibration done. Noise floor: ${noiseFloor.toFixed(4)}, Gain: ${calibratedGain.toFixed(2)}`);
    } catch (err) {
      resultDiv.textContent = `Calibration failed: ${err.message}`;
      resultDiv.style.color = 'var(--danger)';
      console.error('[Audio] Calibration failed:', err);
    }
  });
}

async function saveSettings() {
  const newConfig = {
    apiKey: document.getElementById('api-key-input').value,
    immersionRatio: parseInt(document.getElementById('immersion-slider').value),
    proficiencyLevel: selectedLevel,
    ttsVoice: document.getElementById('tts-voice-select').value,
    ttsSpeed: parseInt(document.getElementById('tts-speed-slider').value) / 100,
    sttLanguageHint: document.getElementById('stt-lang-toggle').value
  };

  await window.api.setConfig(newConfig);
  config = { ...config, ...newConfig };
  updateSettingsDisplay();

  addSystemMessage('Settings saved!');

  if (config.apiKey && config.apiKey.trim() !== '') {
    showTab('chat');
  }
}