/**
 * Kokoro AI Voice Reader - Side Panel UI Controller
 */

import { KOKORO_VOICES, MESSAGE_TYPES, DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings } from '../shared/storage.js';
import { extractTextFromPDF } from '../shared/pdf-extractor.js';
import { normalizeTextForSpeech } from '../shared/audio-utils.js';
import { getAudioBlob, clearAudioBlobs } from '../shared/audio-storage.js';

// Document & Audio state
let currentDocumentTitle = '';

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
const conversionStatusBadge = document.getElementById('conversion-status-badge');
const conversionProgressFill = document.getElementById('conversion-progress-fill');

const btnExtractArticle = document.getElementById('btn-extract-article');
const btnLoadFile = document.getElementById('btn-load-file');
const fileInput = document.getElementById('file-input');
const btnClearText = document.getElementById('btn-clear-text');
const btnDownloadAudio = document.getElementById('btn-download-mp3') || document.getElementById('btn-download-wav');
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
const toggleSelectionPill = document.getElementById('toggle-selection-pill');

// State
let isPlaying = false;
let isPaused = false;
let currentChunks = [];
let activeChunkIndex = 0;
let totalExpectedChunks = 0;
let isConversionComplete = false;

// 1. Initialization
async function init() {
  await loadAndRenderVoices();
  await loadSavedSettings();
  await checkHardwareStatus();
  await syncPlaybackState();
  setupEventListeners();
}

async function syncPlaybackState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_PLAYBACK_STATE' });
    if (state?.isPlaying) {
      if (state.chunks && state.chunks.length > 0) {
        renderKaraokeChunks(state.chunks);
      }
      if (typeof state.chunkIndex === 'number') {
        setActiveKaraokeChunk(state.chunkIndex);
      }
      updatePlayPauseUI(state.isPlaying, state.isPaused);
      updateConversionUI(state);
    }
  } catch {
    // Engine not active or playing
  }
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
  if (toggleSelectionPill) {
    toggleSelectionPill.checked = Boolean(settings.showSelectionPill);
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
  } else if (playing && paused) {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  } else {
    // Stopped
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

  const pct = typeof info.conversionProgress === 'number' ? info.conversionProgress : (isConversionComplete ? 100 : 0);
  const converted = info.convertedChunks || 0;
  const total = info.totalExpectedChunks || totalExpectedChunks || 0;

  if (conversionProgressFill) {
    conversionProgressFill.style.width = `${pct}%`;
    if (info.isConversionComplete) {
      conversionProgressFill.classList.add('done');
    } else {
      conversionProgressFill.classList.remove('done');
    }
  }

  if (conversionStatusBadge) {
    if (info.isConversionComplete) {
      conversionStatusBadge.textContent = `✓ Audio completo (${total} frases)`;
      conversionStatusBadge.classList.add('done');
    } else if (total > 0) {
      conversionStatusBadge.textContent = `⚡ Sintetizado: ${converted}/${total} (${pct}%)`;
      conversionStatusBadge.classList.remove('done');
    } else {
      conversionStatusBadge.textContent = `⚡ Sintetizando...`;
      conversionStatusBadge.classList.remove('done');
    }
  }

  // Manage MP3 download button state
  if (info.isConversionComplete) {
    btnDownloadAudio.disabled = false;
    btnDownloadAudio.classList.add('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = `Descargar archivo MP3 ligero (${total} frases generadas)`;
  } else if (info.isPlaying) {
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = `MP3 (${pct}%)`;
    btnDownloadAudio.title = `Sintetizando audio: ${converted} de ${total} frases (${pct}%). La descarga MP3 estará lista al finalizar.`;
  } else {
    if (!isConversionComplete) {
      btnDownloadAudio.disabled = true;
      btnDownloadAudio.classList.remove('btn-download-ready');
      if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
      btnDownloadAudio.title = 'Inicia la lectura para sintetizar y descargar el audio MP3';
    }
  }
}

function renderKaraokeChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    karaokeChunksContainer.innerHTML = '';
    currentChunks = [];
    return;
  }

  const existingCount = karaokeChunksContainer.children.length;

  // Si es una actualización incremental de la sesión actual (añadiendo nuevas frases generadas)
  if (existingCount > 0 && chunks.length >= existingCount && currentChunks[0] === chunks[0]) {
    if (chunks.length > existingCount) {
      const fragment = document.createDocumentFragment();
      for (let idx = existingCount; idx < chunks.length; idx++) {
        const p = document.createElement('div');
        p.className = 'karaoke-chunk';
        p.dataset.index = idx;
        p.textContent = chunks[idx];
        fragment.appendChild(p);
      }
      karaokeChunksContainer.appendChild(fragment);
    }
    currentChunks = chunks;

    // Garantizar que la frase actualmente en reproducción mantenga el resaltado sin parpadeos
    if (typeof activeChunkIndex === 'number' && karaokeChunksContainer.children[activeChunkIndex]) {
      const activeEl = karaokeChunksContainer.children[activeChunkIndex];
      if (!activeEl.classList.contains('active-chunk')) {
        activeEl.classList.add('active-chunk');
      }
    }
    return;
  }

  // Renderizado completo (nueva reproducción o cambio de documento)
  karaokeChunksContainer.innerHTML = '';
  currentChunks = chunks;

  const fragment = document.createDocumentFragment();
  chunks.forEach((chunkText, idx) => {
    const p = document.createElement('div');
    p.className = 'karaoke-chunk' + (idx === activeChunkIndex ? ' active-chunk' : '');
    p.dataset.index = idx;
    p.textContent = chunkText;
    fragment.appendChild(p);
  });
  karaokeChunksContainer.appendChild(fragment);

  const total = totalExpectedChunks || currentChunks.length || 1;
  currentChunkBadge.textContent = `🔊 Frase ${activeChunkIndex + 1} de ${total}`;
}

function setActiveKaraokeChunk(index) {
  activeChunkIndex = index;
  const chunkElements = karaokeChunksContainer.children;

  for (let idx = 0; idx < chunkElements.length; idx++) {
    const el = chunkElements[idx];
    if (idx === index) {
      el.classList.add('active-chunk');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      el.classList.remove('active-chunk');
    }
  }

  const total = totalExpectedChunks || currentChunks.length || 1;
  currentChunkBadge.textContent = `🔊 Frase ${index + 1} de ${total}`;
}

// 3. User Actions
async function startPlayback() {
  const rawText = textInput.value.trim();
  if (!rawText) {
    textInput.focus();
    return;
  }

  const text = normalizeTextForSpeech(rawText);

  isConversionComplete = false;
  totalExpectedChunks = 0;
  activeChunkIndex = 0;
  currentChunks = [];
  karaokeChunksContainer.innerHTML = '';
  btnDownloadAudio.disabled = true;
  btnDownloadAudio.classList.remove('btn-download-ready');
  if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';

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
  let isTogglingPlayback = false;
  btnPlayPause.addEventListener('click', async () => {
    if (isTogglingPlayback) return;
    isTogglingPlayback = true;
    try {
      if (!isPlaying) {
        await startPlayback();
      } else if (isPlaying && !isPaused) {
        await pausePlayback();
      } else {
        await resumePlayback();
      }
    } finally {
      isTogglingPlayback = false;
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

  // Floating selection pill toggle
  if (toggleSelectionPill) {
    toggleSelectionPill.addEventListener('change', async (e) => {
      await saveSettings({ showSelectionPill: e.target.checked });
    });
  }

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
            currentDocumentTitle = tab.title ? tab.title.replace(/\.pdf$/i, '') : 'documento_pdf';
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
        currentDocumentTitle = tab.title ? tab.title.slice(0, 40) : 'articulo_web';
        textInput.value = normalizeTextForSpeech(text);
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
          currentDocumentTitle = file.name.replace(/\.[^/.]+$/, '');
          textInput.value = normalizeTextForSpeech(extracted);
          modelStatusText.textContent = `✓ PDF cargado: ${file.name}`;
          modelPercentText.textContent = '100%';
          modelProgressBar.style.width = '100%';
          setTimeout(() => modelProgressCard.classList.add('hidden'), 2500);
        } else {
          modelStatusText.textContent = 'El archivo PDF no contiene texto seleccionable (posible imagen o escaneo).';
          modelPercentText.textContent = '⚠️';
        }
      } else {
        currentDocumentTitle = file.name.replace(/\.[^/.]+$/, '');
        const rawText = await file.text();
        textInput.value = normalizeTextForSpeech(rawText);
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
    currentDocumentTitle = '';
    clearAudioBlobs().catch(() => {});
    isConversionComplete = false;
    totalExpectedChunks = 0;
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = 'Inicia la lectura para sintetizar y descargar el audio MP3';
    if (conversionProgressFill) {
      conversionProgressFill.style.width = '0%';
      conversionProgressFill.classList.remove('done');
    }
    if (conversionStatusBadge) {
      conversionStatusBadge.textContent = '⚡ En espera';
      conversionStatusBadge.classList.remove('done');
    }
  });

  // Download MP3
  btnDownloadAudio.addEventListener('click', async () => {
    if (!isConversionComplete) {
      modelProgressCard.classList.remove('hidden');
      modelStatusText.textContent = 'El audio aún se está procesando en WebGPU. Espera a que la conversión alcance el 100% para descargarlo completo en MP3.';
      modelPercentText.textContent = '⏳';
      return;
    }

    const originalBtnText = btnDownloadText ? btnDownloadText.textContent : 'Descargar MP3';
    if (btnDownloadText) btnDownloadText.textContent = '⏳ Preparando...';
    btnDownloadAudio.disabled = true;

    try {
      await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});
      const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_MP3' });

      if (res?.error) {
        modelProgressCard.classList.remove('hidden');
        modelStatusText.textContent = res.error;
        modelPercentText.textContent = '⚠️';
        if (btnDownloadText) btnDownloadText.textContent = originalBtnText;
        btnDownloadAudio.disabled = false;
        return;
      }

      let blob = null;
      const ext = res?.format === 'wav' ? 'wav' : 'mp3';

      // 1. Retrieve Blob directly from IndexedDB (zero IPC size restrictions!)
      if (res?.storageKey) {
        const record = await getAudioBlob(res.storageKey);
        blob = record?.blob || null;
      }

      // 2. Backward-compatibility fallback if dataUrl was returned
      if (!blob && res?.dataUrl) {
        try {
          const resp = await fetch(res.dataUrl);
          blob = await resp.blob();
        } catch (fetchErr) {
          console.warn('Fallback dataUrl fetch failed:', fetchErr);
        }
      }

      if (!blob || blob.size === 0) {
        throw new Error('No se pudo recuperar el archivo de audio generado.');
      }

      // Create clean filename based on book/document title
      const safeTitle = (currentDocumentTitle || 'kokoro-audio')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '_')
        .slice(0, 50);
      const filename = `${safeTitle}.${ext}`;
      const fileSizeMB = (blob.size / 1024 / 1024).toFixed(1);

      // Create Object URL for the blob
      const blobUrl = URL.createObjectURL(blob);
      let downloadTriggered = false;

      // Primary download strategy: DOM anchor in sidepanel
      // Standard browser DOM behavior; works with gigabyte-scale Blobs with zero IPC/URL length limits
      try {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        downloadTriggered = true;
        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 2000);
      } catch (domErr) {
        console.warn('DOM anchor download fallo, probando chrome.downloads:', domErr);
      }

      // Secondary download strategy: chrome.downloads API
      if (!downloadTriggered && chrome.downloads && chrome.downloads.download) {
        try {
          await chrome.downloads.download({
            url: blobUrl,
            filename: filename,
            saveAs: false
          });
          downloadTriggered = true;
        } catch (dlErr) {
          console.warn('chrome.downloads API fallo:', dlErr);
        }
      }

      if (!downloadTriggered) {
        throw new Error('No se pudo iniciar la descarga del archivo en el navegador.');
      }

      // Clean up object URL after safe window
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 60000);

      if (btnDownloadText) btnDownloadText.textContent = `✓ MP3 (${fileSizeMB} MB)`;
      setTimeout(() => {
        if (btnDownloadText) btnDownloadText.textContent = originalBtnText;
        btnDownloadAudio.disabled = false;
      }, 3500);
    } catch (err) {
      console.error('Error al descargar audio:', err);
      modelProgressCard.classList.remove('hidden');
      modelStatusText.textContent = `Error al descargar: ${err.message}`;
      modelPercentText.textContent = '❌';
      if (btnDownloadText) btnDownloadText.textContent = originalBtnText;
      btnDownloadAudio.disabled = false;
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
        if (typeof message.totalExpectedChunks === 'number') {
          totalExpectedChunks = message.totalExpectedChunks;
        }
        if (typeof message.isConversionComplete === 'boolean') {
          isConversionComplete = message.isConversionComplete;
        }
        updatePlayPauseUI(message.isPlaying, message.isPaused);
        updateConversionUI(message);
        break;
      }

      case MESSAGE_TYPES.CURRENT_CHUNK_INDEX: {
        setActiveKaraokeChunk(message.chunkIndex);
        break;
      }

      case 'SELECTION_TEXT_LOADED': {
        if (message.text && textInput) {
          textInput.value = message.text;
        }
        break;
      }
    }
  });
}

// Start controller
document.addEventListener('DOMContentLoaded', init);
