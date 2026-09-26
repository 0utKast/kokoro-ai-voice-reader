/**
 * Kokoro AI Voice Reader - Side Panel UI Controller
 */

import { KOKORO_VOICES, MESSAGE_TYPES, DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings } from '../shared/storage.js';

// DOM Elements
const hardwareBadge = document.getElementById('hardware-badge');
const hardwareText = document.getElementById('hardware-text');
const modelProgressCard = document.getElementById('model-progress-container');
const modelStatusText = document.getElementById('model-status-text');
const modelPercentText = document.getElementById('model-percent-text');
const modelProgressBar = document.getElementById('model-progress-bar');

const textInput = document.getElementById('text-input');
const karaokeDisplay = document.getElementById('karaoke-display');
const karaokeChunksContainer = document.getElementById('karaoke-chunks');
const playbackStatusBar = document.getElementById('playback-status-bar');
const currentChunkBadge = document.getElementById('current-chunk-badge');

const btnExtractArticle = document.getElementById('btn-extract-article');
const btnClearText = document.getElementById('btn-clear-text');
const btnDownloadWav = document.getElementById('btn-download-wav');

const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnStop = document.getElementById('btn-stop');
const btnPrevChunk = document.getElementById('btn-prev-chunk');
const btnNextChunk = document.getElementById('btn-next-chunk');

const voiceSelect = document.getElementById('voice-select');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');

// State
let isPlaying = false;
let isPaused = false;
let currentChunks = [];
let activeChunkIndex = 0;

// 1. Initialization
async function init() {
  await loadAndRenderVoices();
  await loadSavedSettings();
  await checkHardwareStatus();
  setupEventListeners();
}

async function loadAndRenderVoices() {
  voiceSelect.innerHTML = '';
  
  const spanishGroup = document.createElement('optgroup');
  spanishGroup.label = '🇪🇸 Español';
  const englishUSGroup = document.createElement('optgroup');
  englishUSGroup.label = '🇺🇸 English (US)';
  const englishUKGroup = document.createElement('optgroup');
  englishUKGroup.label = '🇬🇧 English (UK)';

  for (const voice of KOKORO_VOICES) {
    const opt = document.createElement('option');
    opt.value = voice.id;
    opt.textContent = `${voice.name} (${voice.gender} - ${voice.desc})`;

    if (voice.lang === 'es') {
      spanishGroup.appendChild(opt);
    } else if (voice.lang === 'en-us') {
      englishUSGroup.appendChild(opt);
    } else {
      englishUKGroup.appendChild(opt);
    }
  }

  voiceSelect.appendChild(spanishGroup);
  voiceSelect.appendChild(englishUSGroup);
  voiceSelect.appendChild(englishUKGroup);
}

async function loadSavedSettings() {
  const settings = await getSettings();
  if (settings.selectedVoice) {
    voiceSelect.value = settings.selectedVoice;
  }
  if (settings.speed) {
    speedSlider.value = settings.speed;
    speedValue.textContent = `${parseFloat(settings.speed).toFixed(2)}x`;
  }
}

async function checkHardwareStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHECK_ENGINE });
    if (response?.webgpuSupported) {
      hardwareBadge.className = 'badge badge-webgpu';
      hardwareText.textContent = 'WebGPU Activo';
    } else {
      hardwareBadge.className = 'badge badge-wasm';
      hardwareText.textContent = 'WASM Fallback';
    }
  } catch (err) {
    hardwareBadge.className = 'badge';
    hardwareText.textContent = 'Motor TTS Listo';
  }
}

// 2. Playback UI Sync
function updatePlayPauseUI(playing, paused) {
  isPlaying = playing;
  isPaused = paused;

  if (playing && !paused) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    textInput.classList.add('hidden');
    karaokeDisplay.classList.remove('hidden');
    playbackStatusBar.classList.remove('hidden');
    btnDownloadWav.disabled = false;
  } else if (playing && paused) {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  } else {
    // Stopped
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    playbackStatusBar.classList.add('hidden');
    textInput.classList.remove('hidden');
    karaokeDisplay.classList.add('hidden');
  }
}

function renderKaraokeChunks(chunks) {
  karaokeChunksContainer.innerHTML = '';
  currentChunks = chunks;

  chunks.forEach((chunkText, idx) => {
    const p = document.createElement('div');
    p.className = 'karaoke-chunk';
    p.dataset.index = idx;
    p.textContent = chunkText;
    karaokeChunksContainer.appendChild(p);
  });
}

function setActiveKaraokeChunk(index) {
  activeChunkIndex = index;
  const chunkElements = karaokeChunksContainer.querySelectorAll('.karaoke-chunk');

  chunkElements.forEach((el, idx) => {
    if (idx === index) {
      el.classList.add('active-chunk');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      el.classList.remove('active-chunk');
    }
  });

  if (currentChunks.length > 0) {
    currentChunkBadge.textContent = `Frase ${index + 1} de ${currentChunks.length}`;
  }
}

// 3. User Actions
async function startPlayback() {
  const text = textInput.value.trim();
  if (!text) {
    textInput.focus();
    return;
  }

  const voice = voiceSelect.value;
  const speed = parseFloat(speedSlider.value);

  // Send request to background/offscreen
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAY_TEXT,
    text: text,
    voice: voice,
    speed: speed,
    volume: 1.0
  });

  updatePlayPauseUI(true, false);
}

async function pausePlayback() {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PAUSE_PLAYBACK });
  updatePlayPauseUI(true, true);
}

async function resumePlayback() {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESUME_PLAYBACK });
  updatePlayPauseUI(true, false);
}

async function stopPlayback() {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_PLAYBACK });
  updatePlayPauseUI(false, false);
}

// 4. Setup Event Listeners
function setupEventListeners() {
  // Play/Pause button
  btnPlayPause.addEventListener('click', async () => {
    if (!isPlaying) {
      await startPlayback();
    } else if (isPlaying && !isPaused) {
      await pausePlayback();
    } else {
      await resumePlayback();
    }
  });

  // Stop button
  btnStop.addEventListener('click', async () => {
    await stopPlayback();
  });

  // Voice selector
  voiceSelect.addEventListener('change', async (e) => {
    await saveSettings({ selectedVoice: e.target.value });
  });

  // Speed slider
  speedSlider.addEventListener('input', async (e) => {
    const val = parseFloat(e.target.value);
    speedValue.textContent = `${val.toFixed(2)}x`;
    await saveSettings({ speed: val });
    if (isPlaying) {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SPEED, speed: val });
    }
  });

  // Extract article from active page
  btnExtractArticle.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.EXTRACT_ARTICLE });
      if (response?.text) {
        textInput.value = response.text;
      }
    } catch (err) {
      console.warn('Error extracting article:', err);
    }
  });

  // Clear text
  btnClearText.addEventListener('click', () => {
    stopPlayback();
    textInput.value = '';
    textInput.focus();
  });

  // Download WAV
  btnDownloadWav.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_WAV' });
    if (res?.dataUrl) {
      const a = document.createElement('a');
      a.href = res.dataUrl;
      a.download = `kokoro-speech-${Date.now()}.wav`;
      a.click();
    }
  });

  // Message listener from background/offscreen
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case MESSAGE_TYPES.MODEL_PROGRESS: {
        modelProgressCard.classList.remove('hidden');
        if (message.message) modelStatusText.textContent = message.message;
        if (message.progress?.progress) {
          const pct = Math.round(message.progress.progress);
          modelPercentText.textContent = `${pct}%`;
          modelProgressBar.style.width = `${pct}%`;
        }
        break;
      }

      case MESSAGE_TYPES.MODEL_LOADED: {
        modelProgressCard.classList.add('hidden');
        break;
      }

      case MESSAGE_TYPES.PLAYBACK_STATE: {
        if (message.chunks) {
          renderKaraokeChunks(message.chunks);
        }
        updatePlayPauseUI(message.isPlaying, message.isPaused);
        break;
      }

      case MESSAGE_TYPES.CURRENT_CHUNK_INDEX: {
        setActiveKaraokeChunk(message.chunkIndex);
        break;
      }
    }
  });
}

// Start controller
document.addEventListener('DOMContentLoaded', init);
