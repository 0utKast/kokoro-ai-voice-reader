/**
 * Kokoro AI Voice Reader - Side Panel UI Controller
 */

import { KOKORO_VOICES, MESSAGE_TYPES, DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings } from '../shared/storage.js';
import { extractTextFromPDF } from '../shared/pdf-extractor.js';

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
const btnLoadFile = document.getElementById('btn-load-file');
const fileInput = document.getElementById('file-input');
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
  spanishGroup.label = '🇪🇸 Español (Voces Recomendadas)';
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
    // 1. Ensure offscreen document is alive
    await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
    // 2. Query hardware status from offscreen
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

  // Show status feedback
  modelProgressCard.classList.remove('hidden');
  modelStatusText.textContent = 'Iniciando motor neuronal...';
  modelPercentText.textContent = '0%';
  modelProgressBar.style.width = '5%';

  try {
    // Ensure offscreen is ready first
    await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });

    // Send request to offscreen engine
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PLAY_TEXT,
      text: text,
      voice: voice,
      speed: speed,
      volume: 1.0
    });

    updatePlayPauseUI(true, false);
  } catch (err) {
    console.error('Error starting playback:', err);
    modelStatusText.textContent = `Error: ${err.message}`;
    modelProgressCard.classList.remove('hidden');
  }
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

  // Extract article or selection from active page
  btnExtractArticle.addEventListener('click', async () => {
    try {
      let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      if (!tab?.id) {
        modelStatusText.textContent = 'No se encontró la pestaña activa del navegador.';
        modelPercentText.textContent = 'ℹ️';
        modelProgressCard.classList.remove('hidden');
        return;
      }

      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        modelStatusText.textContent = 'Abre una pestaña web normal (ej. Wikipedia o un artículo) para capturar su texto.';
        modelPercentText.textContent = 'ℹ️';
        modelProgressBar.style.width = '100%';
        modelProgressCard.classList.remove('hidden');
        return;
      }

      // Check if active tab is a PDF document
      if (tab.url && tab.url.toLowerCase().includes('.pdf')) {
        modelProgressCard.classList.remove('hidden');
        modelStatusText.textContent = 'Detectado documento PDF en pestaña. Extrayendo texto...';
        modelPercentText.textContent = '...';
        modelProgressBar.style.width = '30%';

        try {
          const resp = await fetch(tab.url);
          const buf = await resp.arrayBuffer();
          const pdfText = await extractTextFromPDF(buf, (curr, total) => {
            modelPercentText.textContent = `${curr}/${total}`;
            modelProgressBar.style.width = `${Math.round((curr / total) * 100)}%`;
          });
          if (pdfText && pdfText.length > 0) {
            textInput.value = pdfText;
            modelStatusText.textContent = '✓ Texto del PDF extraído correctamente.';
            modelPercentText.textContent = '100%';
            modelProgressBar.style.width = '100%';
            setTimeout(() => modelProgressCard.classList.add('hidden'), 2000);
            return;
          }
        } catch (pdfErr) {
          console.warn('Direct PDF fetch failed:', pdfErr);
          modelStatusText.textContent = 'Para leer un archivo PDF local (file://), pulsa el botón "Cargar PDF / TXT" o arrástralo aquí.';
          modelPercentText.textContent = 'ℹ️';
          return;
        }
      }

      let text = '';
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.EXTRACT_ARTICLE });
        text = response?.text || '';
      } catch {
        // Tab was loaded before extension reload: inject Readability & content script dynamically
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/libs/Readability.js', 'src/content/content.js']
          });
          const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.EXTRACT_ARTICLE });
          text = response?.text || '';
        } catch (injectErr) {
          console.warn('Dynamic script injection failed, attempting inline extraction:', injectErr);
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const sel = window.getSelection()?.toString().trim();
              if (sel && sel.length > 5) return sel;
              const NOISE = /(publicidad|anuncio|advertisement|patrocinad[oa]|publi\b|hazte socio|suscr[ií]bete|cookies|aviso legal|lo m[aá]s visto|destacadas\b|actualidad\b|v[ií]deos\b|tremending)/i;
              const article = document.querySelector('article, main, #content, .mw-parser-output, .post-content, [role="main"]') || document.body;
              const clone = article.cloneNode(true);
              clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, .ad, [aria-hidden="true"]').forEach(e => e.remove());
              const pTags = Array.from(clone.querySelectorAll('p, h1, h2, h3, h4, li'))
                .map(p => p.textContent.replace(/\s+/g, ' ').trim())
                .filter(t => t.length >= 30 && !NOISE.test(t));
              return pTags.length > 0 ? pTags.join('\n\n') : clone.innerText.trim();
            }
          });
          text = result?.result || '';
        }
      }

      if (text && text.length > 0) {
        textInput.value = text;
        const originalHTML = btnExtractArticle.innerHTML;
        btnExtractArticle.textContent = '✓ Capturado';
        btnExtractArticle.style.borderColor = 'var(--primary-color)';
        setTimeout(() => {
          btnExtractArticle.innerHTML = originalHTML;
          btnExtractArticle.style.borderColor = '';
        }, 1500);
      } else {
        modelStatusText.textContent = 'No se detectó texto en la página. Puedes escribir o pegar el texto directamente.';
        modelPercentText.textContent = 'ℹ️';
        modelProgressCard.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('Error extracting article:', err);
      modelStatusText.textContent = `No se pudo extraer: ${err.message}`;
      modelPercentText.textContent = '⚠️';
      modelProgressCard.classList.remove('hidden');
    }
  });

  // Load file (PDF / TXT / MD)
  btnLoadFile.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleSelectedFile(file);
    fileInput.value = '';
  });

  // Drag and drop onto textInput
  textInput.addEventListener('dragover', (e) => {
    e.preventDefault();
    textInput.style.borderColor = 'var(--primary-color)';
  });
  textInput.addEventListener('dragleave', () => {
    textInput.style.borderColor = '';
  });
  textInput.addEventListener('drop', async (e) => {
    e.preventDefault();
    textInput.style.borderColor = '';
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await handleSelectedFile(file);
    }
  });

  async function handleSelectedFile(file) {
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    modelProgressCard.classList.remove('hidden');
    modelStatusText.textContent = `Cargando ${file.name}...`;
    modelPercentText.textContent = '...';
    modelProgressBar.style.width = '20%';

    try {
      if (isPDF) {
        modelStatusText.textContent = `Extrayendo texto de ${file.name}...`;
        const buffer = await file.arrayBuffer();
        const extracted = await extractTextFromPDF(buffer, (page, total) => {
          modelPercentText.textContent = `${page}/${total}`;
          modelProgressBar.style.width = `${Math.round((page / total) * 100)}%`;
        });
        if (extracted && extracted.trim()) {
          textInput.value = extracted;
          modelStatusText.textContent = `✓ PDF cargado: ${file.name}`;
          modelPercentText.textContent = '100%';
          modelProgressBar.style.width = '100%';
          setTimeout(() => modelProgressCard.classList.add('hidden'), 2500);
        } else {
          modelStatusText.textContent = 'El archivo PDF no contiene texto seleccionable (posible imagen o escaneo).';
          modelPercentText.textContent = '⚠️';
        }
      } else {
        const text = await file.text();
        textInput.value = text;
        modelStatusText.textContent = `✓ Archivo cargado: ${file.name}`;
        modelPercentText.textContent = '100%';
        modelProgressBar.style.width = '100%';
        setTimeout(() => modelProgressCard.classList.add('hidden'), 1500);
      }
    } catch (err) {
      console.error('Error reading file:', err);
      modelStatusText.textContent = `Error al leer archivo: ${err.message}`;
      modelPercentText.textContent = '❌';
    }
  }

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
        const p = message.progress;
        if (p) {
          const fileName = p.file ? p.file.split('/').pop() : 'modelo neuronal';
          if (p.status === 'initiate') {
            modelStatusText.textContent = `Iniciando: ${fileName}...`;
            modelPercentText.textContent = '...';
            modelProgressBar.style.width = '10%';
          } else if (p.status === 'done') {
            modelStatusText.textContent = `Descarga completada: ${fileName}`;
            modelPercentText.textContent = '100%';
            modelProgressBar.style.width = '100%';
          } else if (typeof p.loaded === 'number') {
            const loadedMB = (p.loaded / 1048576).toFixed(1);
            if (p.total && p.total > 0) {
              const totalMB = (p.total / 1048576).toFixed(1);
              const pct = Math.min(100, Math.round((p.loaded / p.total) * 100));
              modelStatusText.textContent = `Descargando ${fileName} (${loadedMB} / ${totalMB} MB)...`;
              modelPercentText.textContent = `${pct}%`;
              modelProgressBar.style.width = `${pct}%`;
            } else {
              // Chunked streaming where total content-length is omitted by CDN
              modelStatusText.textContent = `Descargando ${fileName} (${loadedMB} MB)...`;
              modelPercentText.textContent = `${loadedMB} MB`;
              const estimatedPct = Math.min(95, Math.max(10, Math.round((p.loaded / (325 * 1048576)) * 100)));
              modelProgressBar.style.width = `${estimatedPct}%`;
            }
          } else if (typeof p.progress === 'number' && !isNaN(p.progress)) {
            const pct = Math.min(100, Math.round(p.progress));
            modelPercentText.textContent = `${pct}%`;
            modelProgressBar.style.width = `${pct}%`;
          }
        }
        break;
      }

      case MESSAGE_TYPES.MODEL_LOADED: {
        modelProgressCard.classList.add('hidden');
        break;
      }

      case MESSAGE_TYPES.MODEL_ERROR: {
        modelProgressCard.classList.remove('hidden');
        modelStatusText.textContent = message.error || 'Error en el modelo neuronal';
        modelPercentText.textContent = '❌';
        modelProgressBar.style.width = '100%';
        modelProgressBar.style.backgroundColor = '#ef4444';
        updatePlayPauseUI(false, false);
        break;
      }

      case MESSAGE_TYPES.PLAYBACK_STATE: {
        if (message.isPlaying) {
          modelProgressCard.classList.add('hidden');
        }
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
