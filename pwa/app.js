/**
 * Kokoro AI Voice Reader - Mobile PWA App Controller
 * Pure Web API implementation: WebGPU / WASM, Web Audio API, MediaSession, IndexedDB, PWA install.
 */

import { KokoroTTS, env } from '../src/libs/kokoro.web.js';
import { KOKORO_VOICES, DEFAULT_MODEL_ID, DEFAULT_SETTINGS } from '../src/shared/constants.js';
import { 
  ProgressiveMp3Encoder, 
  normalizeTextForSpeech, 
  splitTextIntoSmartChunks, 
  SmartTextSplitter, 
  trimAudioSilence 
} from '../src/shared/audio-utils.js';
import { saveAudioBlob, getAudioBlob, clearAudioBlobs } from '../src/shared/audio-storage.js';
import { extractTextFromPDF } from '../src/shared/pdf-extractor.js';

// Configure local WASM paths for ONNX Runtime Web (must be absolute URL for dynamic import())
const libsAbsoluteUrl = new URL('../src/libs/', import.meta.url).href;
if (env) {
  env.wasmPaths = libsAbsoluteUrl;
  env.numThreads = 1;
}

// --- DOM Elements ---
const hardwareBadge = document.getElementById('hardware-badge');
const hardwareText = document.getElementById('hardware-text');
const installBanner = document.getElementById('install-banner');
const btnInstallPwa = document.getElementById('btn-install-pwa');

const modelProgressCard = document.getElementById('model-progress-container');
const modelStatusText = document.getElementById('model-status-text');
const modelPercentText = document.getElementById('model-percent-text');
const modelProgressBar = document.getElementById('model-progress-bar');

const textInput = document.getElementById('text-input');
const karaokeDisplay = document.getElementById('karaoke-display');
const karaokeChunksContainer = document.getElementById('karaoke-chunks');
const playbackStatusBar = document.getElementById('playback-status-bar');
const currentChunkBadge = document.getElementById('current-chunk-badge');
const conversionStatusBadge = document.getElementById('conversion-status-badge');
const conversionProgressFill = document.getElementById('conversion-progress-fill');

const btnLoadFile = document.getElementById('btn-load-file');
const fileInput = document.getElementById('file-input');
const btnPasteClip = document.getElementById('btn-paste-clip');
const btnClearText = document.getElementById('btn-clear-text');
const btnDownloadAudio = document.getElementById('btn-download-mp3');
const btnDownloadText = document.getElementById('btn-download-text');

const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnStop = document.getElementById('btn-stop');
const btnPrevChunk = document.getElementById('btn-prev-chunk');
const btnNextChunk = document.getElementById('btn-next-chunk');

const voiceSelect = document.getElementById('voice-select');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');

// --- State Variables ---
let audioCtx = null;
let gainNode = null;
let kokoroModel = null;
let isModelLoading = false;
let currentDevice = 'webgpu'; // 'webgpu' or 'wasm'

let isPlaying = false;
let isPaused = false;
let activeSources = [];
let nextStartTime = 0;
let progressiveMp3Encoder = null;
let currentVoice = DEFAULT_SETTINGS.selectedVoice;
let currentSpeed = DEFAULT_SETTINGS.speed;
let currentVolume = 1.0;
let abortGeneration = false;
let activeSessionId = 0;

let currentChunks = [];
let activeChunkIndex = 0;
let scheduledChunks = [];
let totalExpectedChunks = 0;
let convertedChunks = 0;
let isConversionComplete = false;
let currentDocumentTitle = '';
let playbackMonitorInterval = null;
let wakeLock = null;
let deferredPrompt = null;

// --- 1. Initialization ---
async function init() {
  registerServiceWorker();
  loadAndRenderVoices();
  loadSavedSettings();
  handleSharedTargetParams();
  await checkHardwareStatus();
  await restoreLastConversion();
  setupEventListeners();
  setupPwaInstallPrompt();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
    });
  }
}

// Verify WebGPU & fallback detection
async function verifyWebGPUSupport() {
  if (!navigator.gpu) {
    return { supported: false, reason: "navigator.gpu no disponible." };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: "No se encontró un adaptador GPU compatible." };
    }
    return { supported: true, name: adapter.info?.device || "WebGPU Device" };
  } catch (err) {
    return { supported: false, reason: err.message };
  }
}

async function checkHardwareStatus() {
  const gpu = await verifyWebGPUSupport();
  if (gpu.supported) {
    currentDevice = 'webgpu';
    hardwareBadge.className = 'badge badge-webgpu';
    hardwareText.textContent = 'WebGPU Activo';
  } else {
    currentDevice = 'wasm';
    hardwareBadge.className = 'badge badge-wasm';
    hardwareText.textContent = 'WASM Fallback';
  }
}

function loadAndRenderVoices() {
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
    } else if (voice.lang === 'en-gb') {
      englishUKGroup.appendChild(opt);
    }
  }

  voiceSelect.appendChild(spanishGroup);
  voiceSelect.appendChild(englishUSGroup);
  voiceSelect.appendChild(englishUKGroup);
}

function loadSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('kokoro_pwa_settings') || '{}');
    if (saved.voice) {
      voiceSelect.value = saved.voice;
      currentVoice = saved.voice;
    }
    if (saved.speed) {
      speedSlider.value = saved.speed;
      currentSpeed = parseFloat(saved.speed);
      speedValue.textContent = `${currentSpeed.toFixed(2)}x`;
    }
  } catch {}
}

function saveSetting(key, val) {
  try {
    const saved = JSON.parse(localStorage.getItem('kokoro_pwa_settings') || '{}');
    saved[key] = val;
    localStorage.setItem('kokoro_pwa_settings', JSON.stringify(saved));
  } catch {}
}

// Handle Web Share Target API query parameters (e.g. from Android Share menu)
function handleSharedTargetParams() {
  const params = new URLSearchParams(window.location.search);
  const sharedText = params.get('text') || '';
  const sharedTitle = params.get('title') || '';
  const sharedUrl = params.get('url') || '';

  const incoming = [sharedText, sharedUrl].filter(Boolean).join('\n\n').trim();
  if (incoming) {
    textInput.value = normalizeTextForSpeech(incoming);
    if (sharedTitle) {
      currentDocumentTitle = sharedTitle.slice(0, 40);
    }
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// Restore last conversion from IndexedDB + localStorage
async function restoreLastConversion() {
  try {
    const record = await getAudioBlob('latest_book_audio').catch(() => null);
    const lastMeta = JSON.parse(localStorage.getItem('kokoro_last_conversion') || 'null');

    if (record?.blob && record.blob.size > 0) {
      isConversionComplete = true;
      const sizeMB = (record.blob.size / 1024 / 1024).toFixed(1);
      const total = lastMeta?.totalChunks || record.totalChunks || 1;
      totalExpectedChunks = total;

      if (lastMeta?.title || record.title) {
        currentDocumentTitle = lastMeta?.title || record.title;
      }
      if (!textInput.value.trim() && (lastMeta?.text || record.text)) {
        textInput.value = lastMeta?.text || record.text;
      }
      if (lastMeta?.chunks && Array.isArray(lastMeta.chunks)) {
        currentChunks = lastMeta.chunks;
      }

      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.add('btn-download-ready');
      if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
      btnDownloadAudio.title = `Descargar último audio (${sizeMB} MB, ${total} frases)`;

      playbackStatusBar.classList.remove('hidden');
      conversionProgressFill.style.width = '100%';
      conversionProgressFill.classList.add('done');
      conversionStatusBadge.textContent = `✓ Audio guardado (${sizeMB} MB)`;
      conversionStatusBadge.classList.add('done');
      currentChunkBadge.textContent = `🔊 Audio listo (${total} frases)`;
    }
  } catch (err) {
    console.warn('Error restaurando última sesión:', err);
  }
}

// --- 2. Kokoro TTS Engine ---
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    // Use device native sample rate (44.1k/48k) so suspend() and resume() never hang or fail on mobile OS
    audioCtx = new AudioContextClass();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = currentVolume;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended' && !isPaused) {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

async function initKokoroEngine(preferredDevice = currentDevice) {
  if (kokoroModel) return kokoroModel;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (kokoroModel) return kokoroModel;
  }

  isModelLoading = true;
  modelProgressCard.classList.remove('hidden');
  modelStatusText.textContent = 'Verificando aceleración WebGPU...';

  const gpuCheck = await verifyWebGPUSupport();
  currentDevice = (preferredDevice === 'webgpu' && gpuCheck.supported) ? 'webgpu' : 'wasm';

  const progressCallback = (p) => {
    if (!p) return;
    const fileName = p.file ? p.file.split('/').pop() : 'modelo neuronal';
    if (p.status === 'initiate') {
      modelStatusText.textContent = `Iniciando: ${fileName}...`;
      modelPercentText.textContent = '10%';
      modelProgressBar.style.width = '10%';
    } else if (p.status === 'done') {
      modelStatusText.textContent = `Completado: ${fileName}`;
      modelPercentText.textContent = '100%';
      modelProgressBar.style.width = '100%';
    } else if (typeof p.loaded === 'number' && p.total && p.total > 0) {
      const pct = Math.min(100, Math.round((p.loaded / p.total) * 100));
      const loadedMB = (p.loaded / 1048576).toFixed(1);
      const totalMB = (p.total / 1048576).toFixed(1);
      modelStatusText.textContent = `Descargando ${fileName} (${loadedMB} / ${totalMB} MB)...`;
      modelPercentText.textContent = `${pct}%`;
      modelProgressBar.style.width = `${pct}%`;
    }
  };

  try {
    modelStatusText.textContent = `Cargando Kokoro-82M (${currentDevice.toUpperCase()})...`;
    try {
      kokoroModel = await KokoroTTS.from_pretrained(DEFAULT_MODEL_ID, {
        dtype: 'fp32',
        device: currentDevice,
        progress_callback: progressCallback
      });
    } catch (gpuErr) {
      if (currentDevice === 'webgpu') {
        console.warn('WebGPU falló, activando fallback WASM:', gpuErr);
        currentDevice = 'wasm';
        modelStatusText.textContent = 'WebGPU no disponible, cargando modo WASM...';
        kokoroModel = await KokoroTTS.from_pretrained(DEFAULT_MODEL_ID, {
          dtype: 'fp32',
          device: 'wasm',
          progress_callback: progressCallback
        });
      } else {
        throw gpuErr;
      }
    }

    modelProgressCard.classList.add('hidden');
    return kokoroModel;
  } catch (err) {
    console.error('Error cargando motor TTS:', err);
    modelStatusText.textContent = `Error: ${err.message}`;
    modelPercentText.textContent = '❌';
    throw err;
  } finally {
    isModelLoading = false;
  }
}

// --- 3. Playback Lifecycle & Streaming ---
function stopAudioPlayback() {
  abortGeneration = true;
  isPlaying = false;
  isPaused = false;
  nextStartTime = 0;
  activeChunkIndex = -1;
  scheduledChunks = [];
  stopPlaybackMonitor();
  releaseWakeLock();

  for (const src of activeSources) {
    try {
      src.onended = null;
      src.stop(0);
      src.disconnect();
    } catch {}
  }
  activeSources = [];

  updatePlayPauseUI(false, false);
}

async function startPlayback() {
  const rawText = textInput.value.trim();
  if (!rawText) {
    textInput.focus();
    return;
  }

  const text = normalizeTextForSpeech(rawText);
  stopAudioPlayback();
  abortGeneration = false;
  isConversionComplete = false;
  const sessionId = ++activeSessionId;

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  isPlaying = true;
  isPaused = false;
  progressiveMp3Encoder = new ProgressiveMp3Encoder(24000, 64);
  currentChunks = [];
  activeChunkIndex = 0;
  karaokeChunksContainer.innerHTML = '';
  scheduledChunks = [];
  nextStartTime = ctx.currentTime + 0.05;
  convertedChunks = 0;

  btnDownloadAudio.disabled = true;
  btnDownloadAudio.classList.remove('btn-download-ready');
  if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';

  // Smart sentence chunking
  const smartChunks = splitTextIntoSmartChunks(text, {
    firstChunkTarget: 200,
    normalChunkTarget: 350,
    maxChunkLimit: 450
  });

  const splitter = new SmartTextSplitter(smartChunks);
  totalExpectedChunks = smartChunks.length;

  updatePlayPauseUI(true, false);
  updateConversionUI({ isPlaying: true, isConversionComplete: false, conversionProgress: 0 });
  acquireWakeLock();
  setupMediaSession();

  try {
    const model = await initKokoroEngine(currentDevice);
    let chunkIndex = 0;
    const chunkTexts = [];

    for await (const chunk of model.stream(splitter, { voice: currentVoice, speed: currentSpeed })) {
      if (abortGeneration || activeSessionId !== sessionId) break;

      const rawPcm = chunk.audio?.audio;
      if (!rawPcm || rawPcm.length === 0) continue;

      const cleanPcm = trimAudioSilence(rawPcm, chunk.audio.sampling_rate || 24000, 20, 40);

      // Feed MP3 encoder
      if (progressiveMp3Encoder) {
        try {
          progressiveMp3Encoder.feed(cleanPcm);
        } catch (encErr) {
          console.warn('Error en codificador MP3:', encErr);
        }
      }

      chunkTexts.push(chunk.text);
      currentChunks = chunkTexts;
      convertedChunks++;

      const pct = Math.min(100, Math.round((convertedChunks / totalExpectedChunks) * 100));
      updateConversionUI({
        isPlaying: true,
        conversionProgress: pct,
        convertedChunks: convertedChunks,
        totalExpectedChunks: totalExpectedChunks,
        isConversionComplete: false
      });

      renderKaraokeChunks(chunkTexts);

      const audioBuffer = ctx.createBuffer(1, cleanPcm.length, chunk.audio.sampling_rate || 24000);
      audioBuffer.copyToChannel(cleanPcm, 0);

      const isParagraphEnd = splitter.chunkMetadata[chunkIndex]?.isParagraphEnd ?? false;
      scheduleChunkPlayback(audioBuffer, chunkIndex++, chunk.text, isParagraphEnd);
    }

    if (!abortGeneration && activeSessionId === sessionId) {
      isConversionComplete = true;

      let mp3Blob = null;
      if (progressiveMp3Encoder) {
        try {
          mp3Blob = progressiveMp3Encoder.finish();
        } catch (e) {
          console.error('Error finish MP3:', e);
        }
      }

      if (mp3Blob && mp3Blob.size > 0) {
        const duration = progressiveMp3Encoder?.durationSeconds || 0;
        const metadata = {
          format: 'mp3',
          totalChunks: convertedChunks,
          duration: duration,
          size: mp3Blob.size,
          updatedAt: Date.now(),
          title: currentDocumentTitle || 'audio_kokoro',
          text: text,
          chunks: chunkTexts,
          voice: currentVoice,
          speed: currentSpeed
        };

        await saveAudioBlob('latest_book_audio', mp3Blob, metadata).catch(() => {});
        localStorage.setItem('kokoro_last_conversion', JSON.stringify({
          hasAudio: true,
          totalChunks: convertedChunks,
          size: mp3Blob.size,
          duration: duration,
          title: metadata.title,
          text: text,
          chunks: chunkTexts
        }));
      }

      updateConversionUI({
        isPlaying: isPlaying,
        isConversionComplete: true,
        conversionProgress: 100,
        convertedChunks: convertedChunks,
        totalExpectedChunks: convertedChunks
      });
    }
  } catch (err) {
    console.error('Synthesis error:', err);
    stopAudioPlayback();
  }
}

function scheduleChunkPlayback(audioBuffer, chunkIndex, text, isParagraphEnd = false) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = 1.0;
  source.connect(gainNode);

  const duration = audioBuffer.duration;
  const startTime = Math.max(ctx.currentTime + 0.05, nextStartTime);
  source.start(startTime);
  const endTime = startTime + duration;
  nextStartTime = endTime + (isParagraphEnd ? 0.20 : 0.015);

  activeSources.push(source);
  scheduledChunks.push({ chunkIndex, startTime, endTime, duration, text });

  if (chunkIndex === 0 && activeChunkIndex <= 0) {
    setActiveKaraokeChunk(0);
  }

  startPlaybackMonitor();

  source.onended = () => {
    const idx = activeSources.indexOf(source);
    if (idx !== -1) activeSources.splice(idx, 1);

    if (isConversionComplete && activeSources.length === 0) {
      isPlaying = false;
      isPaused = false;
      stopPlaybackMonitor();
      releaseWakeLock();
      updatePlayPauseUI(false, false);
      updateConversionUI({ isPlaying: false, isConversionComplete: true });
    }
  };
}

function startPlaybackMonitor() {
  if (playbackMonitorInterval) return;
  playbackMonitorInterval = setInterval(() => {
    if (!isPlaying || isPaused || !audioCtx) return;
    const t = audioCtx.currentTime;
    for (let i = 0; i < scheduledChunks.length; i++) {
      const c = scheduledChunks[i];
      if (t >= c.startTime && t < c.endTime) {
        if (activeChunkIndex !== c.chunkIndex) {
          setActiveKaraokeChunk(c.chunkIndex);
        }
        break;
      }
    }
  }, 40);
}

function stopPlaybackMonitor() {
  if (playbackMonitorInterval) {
    clearInterval(playbackMonitorInterval);
    playbackMonitorInterval = null;
  }
}

// --- 4. UI Updating Functions ---
function updatePlayPauseUI(playing, paused) {
  isPlaying = playing;
  isPaused = paused;

  if (playing && !paused) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    textInput.classList.add('hidden');
    karaokeDisplay.classList.remove('hidden');
    playbackStatusBar.classList.remove('hidden');
  } else if (playing && paused) {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    textInput.classList.remove('hidden');
    karaokeDisplay.classList.add('hidden');
    if (!isConversionComplete) {
      playbackStatusBar.classList.add('hidden');
    }
  }
}

function updateConversionUI(info) {
  if (!info) return;
  const done = Boolean(isConversionComplete || info.isConversionComplete);
  const pct = typeof info.conversionProgress === 'number' ? info.conversionProgress : (done ? 100 : 0);
  const converted = info.convertedChunks || convertedChunks || 0;
  const total = info.totalExpectedChunks || totalExpectedChunks || converted || 0;

  if (conversionProgressFill) {
    conversionProgressFill.style.width = `${pct}%`;
    if (done) conversionProgressFill.classList.add('done');
    else conversionProgressFill.classList.remove('done');
  }

  if (conversionStatusBadge) {
    if (done) {
      conversionStatusBadge.textContent = `✓ Audio completo (${total} frases)`;
      conversionStatusBadge.classList.add('done');
    } else if (total > 0) {
      conversionStatusBadge.textContent = `⚡ Sintetizado: ${converted}/${total} (${pct}%)`;
      conversionStatusBadge.classList.remove('done');
    }
  }

  if (done) {
    btnDownloadAudio.disabled = false;
    btnDownloadAudio.classList.add('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = `Descargar archivo MP3 (${total} frases generadas)`;
  } else if (info.isPlaying) {
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = `MP3 (${pct}%)`;
  } else {
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
  }
}

function renderKaraokeChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return;
  const existingCount = karaokeChunksContainer.children.length;

  if (existingCount > 0 && chunks.length >= existingCount && currentChunks[0] === chunks[0]) {
    if (chunks.length > existingCount) {
      const fragment = document.createDocumentFragment();
      for (let i = existingCount; i < chunks.length; i++) {
        const div = document.createElement('div');
        div.className = 'karaoke-chunk';
        div.textContent = chunks[i];
        div.dataset.index = i;
        fragment.appendChild(div);
      }
      karaokeChunksContainer.appendChild(fragment);
    }
    return;
  }

  karaokeChunksContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  chunks.forEach((chunkText, idx) => {
    const div = document.createElement('div');
    div.className = 'karaoke-chunk' + (idx === activeChunkIndex ? ' active-chunk' : '');
    div.dataset.index = idx;
    div.textContent = chunkText;
    fragment.appendChild(div);
  });
  karaokeChunksContainer.appendChild(fragment);
}

function setActiveKaraokeChunk(index) {
  activeChunkIndex = index;
  const children = karaokeChunksContainer.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (i === index) {
      el.classList.add('active-chunk');
      scrollChunkIntoView(el);
    } else {
      el.classList.remove('active-chunk');
    }
  }

  const total = totalExpectedChunks || currentChunks.length || 1;
  currentChunkBadge.textContent = `🔊 Frase ${index + 1} de ${total}`;
}

function scrollChunkIntoView(el) {
  if (!el || !karaokeDisplay) return;
  const containerRect = karaokeDisplay.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const relativeTop = elRect.top - containerRect.top + karaokeDisplay.scrollTop;
  const targetScrollTop = relativeTop - (karaokeDisplay.clientHeight / 2) + (elRect.height / 2);
  karaokeDisplay.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
}

async function pausePlayback() {
  if (!isPlaying || isPaused) return;
  isPaused = true;
  updatePlayPauseUI(true, true);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }
  if (audioCtx && audioCtx.state === 'running') {
    try {
      await Promise.race([
        audioCtx.suspend(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AudioContext suspend timeout')), 300))
      ]);
    } catch (e) {
      console.warn('AudioContext suspend warning:', e);
    }
  }
}

async function resumePlayback() {
  if (!isPlaying || !isPaused) return;
  isPaused = false;
  updatePlayPauseUI(true, false);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
  if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
    try {
      await Promise.race([
        audioCtx.resume(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AudioContext resume timeout')), 300))
      ]);
    } catch (e) {
      console.warn('AudioContext resume warning:', e);
    }
  }
  startPlaybackMonitor();
}

// --- 5. Mobile Native Features: MediaSession & WakeLock ---
function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentDocumentTitle || 'Lectura Kokoro AI',
      artist: 'Kokoro-82M Neural Voice',
      album: 'Voz local WebGPU',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    navigator.mediaSession.playbackState = 'playing';

    navigator.mediaSession.setActionHandler('play', async () => {
      await resumePlayback();
    });

    navigator.mediaSession.setActionHandler('pause', async () => {
      await pausePlayback();
    });

    navigator.mediaSession.setActionHandler('stop', () => {
      stopAudioPlayback();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (activeChunkIndex > 0) {
        setActiveKaraokeChunk(activeChunkIndex - 1);
      }
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const total = currentChunks.length;
      if (activeChunkIndex < total - 1) {
        setActiveKaraokeChunk(activeChunkIndex + 1);
      }
    });
  }
}

async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// --- 6. Event Listeners ---
function setupEventListeners() {
  btnPlayPause.addEventListener('click', async () => {
    if (!isPlaying) {
      await startPlayback();
    } else if (isPlaying && !isPaused) {
      await pausePlayback();
    } else {
      await resumePlayback();
    }
  });

  btnStop.addEventListener('click', stopAudioPlayback);

  btnPrevChunk.addEventListener('click', () => {
    if (activeChunkIndex > 0) {
      setActiveKaraokeChunk(activeChunkIndex - 1);
    }
  });

  btnNextChunk.addEventListener('click', () => {
    const total = currentChunks.length;
    if (activeChunkIndex < total - 1) {
      setActiveKaraokeChunk(activeChunkIndex + 1);
    }
  });

  karaokeChunksContainer.addEventListener('click', (e) => {
    const target = e.target.closest('.karaoke-chunk');
    if (target && target.dataset.index !== undefined) {
      const idx = parseInt(target.dataset.index, 10);
      if (!isNaN(idx)) {
        setActiveKaraokeChunk(idx);
      }
    }
  });

  voiceSelect.addEventListener('change', (e) => {
    currentVoice = e.target.value;
    saveSetting('voice', currentVoice);
  });

  speedSlider.addEventListener('input', (e) => {
    currentSpeed = parseFloat(e.target.value);
    speedValue.textContent = `${currentSpeed.toFixed(2)}x`;
    saveSetting('speed', currentSpeed);
  });

  // Paste from clipboard
  btnPasteClip.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        textInput.value = normalizeTextForSpeech(text);
        btnPasteClip.textContent = '✓ Pegado';
        setTimeout(() => { btnPasteClip.textContent = 'Pegar'; }, 1500);
      }
    } catch {
      alert('Por favor, pega el texto manualmente en el recuadro.');
    }
  });

  // Load PDF / TXT
  btnLoadFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    modelProgressCard.classList.remove('hidden');
    modelStatusText.textContent = `Cargando ${file.name}...`;

    try {
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        const buffer = await file.arrayBuffer();
        const extracted = await extractTextFromPDF(buffer, (page, total) => {
          modelPercentText.textContent = `${page}/${total}`;
          modelProgressBar.style.width = `${Math.round((page / total) * 100)}%`;
        });
        if (extracted) {
          currentDocumentTitle = file.name.replace(/\.[^/.]+$/, '');
          textInput.value = normalizeTextForSpeech(extracted);
          setTimeout(() => modelProgressCard.classList.add('hidden'), 1200);
        }
      } else {
        const raw = await file.text();
        currentDocumentTitle = file.name.replace(/\.[^/.]+$/, '');
        textInput.value = normalizeTextForSpeech(raw);
        setTimeout(() => modelProgressCard.classList.add('hidden'), 800);
      }
    } catch (err) {
      alert(`Error al leer archivo: ${err.message}`);
      modelProgressCard.classList.add('hidden');
    }
    fileInput.value = '';
  });

  // Clear text
  btnClearText.addEventListener('click', async () => {
    stopAudioPlayback();
    textInput.value = '';
    currentDocumentTitle = '';
    currentChunks = [];
    isConversionComplete = false;
    await clearAudioBlobs().catch(() => {});
    localStorage.removeItem('kokoro_last_conversion');

    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    playbackStatusBar.classList.add('hidden');
    conversionProgressFill.style.width = '0%';
    conversionStatusBadge.textContent = '⚡ En espera';
  });

  // Download MP3
  btnDownloadAudio.addEventListener('click', async () => {
    const record = await getAudioBlob('latest_book_audio').catch(() => null);
    if (!record?.blob) {
      alert('Aún no se ha completado la síntesis del audio.');
      return;
    }

    const safeTitle = (currentDocumentTitle || 'kokoro-audio')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .slice(0, 50) || 'kokoro-audio';

    const filename = `${safeTitle}.mp3`;
    const blobUrl = URL.createObjectURL(record.blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  });
}

// PWA beforeinstallprompt capture
function setupPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBanner.classList.remove('hidden');

    btnInstallPwa.addEventListener('click', async () => {
      installBanner.classList.add('hidden');
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        deferredPrompt = null;
      }
    });
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
