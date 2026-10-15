/**
 * Kokoro AI Voice Reader - Side Panel UI Controller
 */

import { KOKORO_VOICES, MESSAGE_TYPES, DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings, getSessionState } from '../shared/storage.js';
import { extractTextFromPDF } from '../shared/pdf-extractor.js';
import { normalizeTextForSpeech, splitTextIntoSmartChunks } from '../shared/audio-utils.js';
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
const btnEditMode = document.getElementById('btn-edit-mode');
const fontSizeControls = document.getElementById('font-size-controls');
const btnFontSmaller = document.getElementById('btn-font-smaller');
const btnFontLarger = document.getElementById('btn-font-larger');

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
let lastConvertedText = '';
let currentKaraokeFontSize = 14.5;

// 1. Initialization
async function init() {
  await loadAndRenderVoices();
  await loadSavedSettings();
  await loadSavedFontSize();
  await checkHardwareStatus();
  const isPlayingActive = await syncPlaybackState();
  if (!isPlayingActive) {
    await restoreLastConversion();
  }
  setupEventListeners();
}

async function loadSavedFontSize() {
  try {
    const data = await chrome.storage.local.get('kokoro_karaoke_font_size');
    if (data?.kokoro_karaoke_font_size) {
      setKaraokeFontSize(data.kokoro_karaoke_font_size);
    }
  } catch {}
}

function setKaraokeFontSize(size) {
  currentKaraokeFontSize = Math.max(12, Math.min(22, size));
  document.documentElement.style.setProperty('--karaoke-font-size', `${currentKaraokeFontSize}px`);
  try {
    chrome.storage.local.set({ kokoro_karaoke_font_size: currentKaraokeFontSize });
  } catch {}
}

async function syncPlaybackState() {
  try {
    const [state, session] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PLAYBACK_STATE' }),
      getSessionState()
    ]);
    if (state?.isPlaying) {
      if (!textInput.value.trim() && session?.text) {
        textInput.value = session.text;
        lastConvertedText = normalizeTextForSpeech(session.text);
      }
      if (state.chunks && state.chunks.length > 0) {
        renderKaraokeChunks(state.chunks);
      }
      if (typeof state.chunkIndex === 'number' && state.chunkIndex >= 0) {
        setActiveKaraokeChunk(state.chunkIndex);
      }
      updatePlayPauseUI(state.isPlaying, state.isPaused, state.isConverting);
      updateConversionUI(state);
      return true;
    } else if (state?.isConverting) {
      if (!textInput.value.trim() && session?.text) {
        textInput.value = session.text;
        lastConvertedText = normalizeTextForSpeech(session.text);
      }
      if (state.chunks && state.chunks.length > 0) {
        currentChunks = state.chunks;
      }
      totalExpectedChunks = state.totalExpectedChunks || state.totalChunks || 0;
      updatePlayPauseUI(false, false, true);
      updateConversionUI(state);
      return true;
    } else if (state?.isConversionComplete) {
      isConversionComplete = true;
      if (state.chunks && state.chunks.length > 0) {
        currentChunks = state.chunks;
      }
      totalExpectedChunks = state.totalExpectedChunks || state.totalChunks || 0;
      updateConversionUI(state);
      return false;
    }
  } catch {
    // Engine not active or playing
  }
  return false;
}

/**
 * Restores the last completed conversion from persistent storage (IndexedDB + chrome.storage.local)
 * so that upon reopening the extension, audio can be downloaded immediately and text is preserved.
 */
async function restoreLastConversion() {
  try {
    const data = await chrome.storage.local.get('kokoro_last_conversion');
    const last = data.kokoro_last_conversion;
    const record = await getAudioBlob('latest_book_audio').catch(() => null);

    if (record?.blob && record.blob.size > 0) {
      isConversionComplete = true;
      const sizeMB = (record.blob.size / 1024 / 1024).toFixed(1);
      const savedChunks = (last?.chunks && Array.isArray(last.chunks) && last.chunks.length > 0)
        ? last.chunks
        : (Array.isArray(record.chunks) ? record.chunks : []);
      const total = last?.totalChunks || record.totalChunks || (savedChunks.length > 0 ? savedChunks.length : 1);
      totalExpectedChunks = total;

      if (last?.title || record.title) {
        currentDocumentTitle = last?.title || record.title;
      }

      // Restore text in editor if empty
      if (!textInput.value.trim() && (last?.text || record.text)) {
        textInput.value = last?.text || record.text;
        lastConvertedText = normalizeTextForSpeech(textInput.value.trim());
      } else if (textInput.value.trim()) {
        lastConvertedText = normalizeTextForSpeech(textInput.value.trim());
      }

      // Restore chunks if available
      if (savedChunks.length > 0) {
        currentChunks = savedChunks;
      }

      // Enable download button in green ready state
      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.add('btn-download-ready');
      if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
      btnDownloadAudio.title = `Descargar último audio guardado (${sizeMB} MB, ${total} frases)`;

      if (playbackStatusBar) playbackStatusBar.classList.remove('hidden');
      if (conversionProgressFill) {
        conversionProgressFill.style.width = '100%';
        conversionProgressFill.classList.add('done');
      }
      if (conversionStatusBadge) {
        conversionStatusBadge.textContent = `✓ Audio guardado (${sizeMB} MB)`;
        conversionStatusBadge.classList.add('done');
      }
      if (currentChunkBadge) {
        currentChunkBadge.textContent = `🔊 Audio listo (${total} frases)`;
      }

      console.log(`[Kokoro] Última conversión restaurada con éxito: ${sizeMB} MB, ${total} frases.`);
      return true;
    }
  } catch (err) {
    console.warn('Error restaurando última conversión:', err);
  }
  return false;
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
function updatePlayPauseUI(playing, paused, converting = false) {
  isPlaying = playing;
  isPaused = paused;

  if (playing && !paused) {
    document.body.classList.add('karaoke-active');
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
    textInput.classList.add('hidden');
    karaokeDisplay.classList.remove('hidden');
    playbackStatusBar.classList.remove('hidden');
    btnEditMode?.classList.remove('hidden');
    fontSizeControls?.classList.remove('hidden');
  } else if (playing && paused) {
    document.body.classList.add('karaoke-active');
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    textInput.classList.add('hidden');
    karaokeDisplay.classList.remove('hidden');
    playbackStatusBar.classList.remove('hidden');
    btnEditMode?.classList.remove('hidden');
    fontSizeControls?.classList.remove('hidden');
  } else {
    // Stopped
    document.body.classList.remove('karaoke-active');
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
    textInput.classList.remove('hidden');
    karaokeDisplay.classList.add('hidden');
    btnEditMode?.classList.add('hidden');
    fontSizeControls?.classList.add('hidden');
    if (isConversionComplete || converting) {
      playbackStatusBar.classList.remove('hidden');
    } else {
      playbackStatusBar.classList.add('hidden');
    }
  }
}

function updateConversionUI(info) {
  if (!info) return;

  if (typeof info.isConversionComplete === 'boolean') {
    isConversionComplete = info.isConversionComplete;
  }

  const conversionDone = Boolean(isConversionComplete || info.isConversionComplete);
  const isBgConverting = Boolean(info.isConverting && !conversionDone);
  const pct = typeof info.conversionProgress === 'number' 
    ? info.conversionProgress 
    : (conversionDone ? 100 : 0);
  const converted = info.convertedChunks || 0;
  const total = info.totalExpectedChunks || totalExpectedChunks || converted || 0;

  if (conversionProgressFill) {
    conversionProgressFill.style.width = `${pct}%`;
    if (conversionDone) {
      conversionProgressFill.classList.add('done');
    } else {
      conversionProgressFill.classList.remove('done');
    }
  }

  if (conversionStatusBadge) {
    if (conversionDone) {
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

  if (!info.isPlaying && currentChunkBadge) {
    if (conversionDone && total > 0) {
      currentChunkBadge.textContent = `🔊 Audio listo (${total} frases)`;
    } else if (isBgConverting) {
      currentChunkBadge.textContent = `🔇 Streaming detenido`;
    }
  }

  // Manage MP3 download button state: Once converted, keep ready and active!
  if (conversionDone) {
    btnDownloadAudio.disabled = false;
    btnDownloadAudio.classList.add('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = `Descargar archivo MP3 ligero (${total} frases generadas)`;
  } else if (info.isPlaying || isBgConverting) {
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = `MP3 (${pct}%)`;
    btnDownloadAudio.title = `Sintetizando audio: ${converted} de ${total} frases (${pct}%). La descarga MP3 estará lista al finalizar.`;
  } else {
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.remove('btn-download-ready');
    if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = 'Inicia la lectura para sintetizar y descargar el audio MP3';
  }
}

function renderKaraokeChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    karaokeChunksContainer.innerHTML = '';
    currentChunks = [];
    return;
  }

  // If already rendered with identical count and chunks, keep existing DOM to prevent re-render flicker
  const existingChunksCount = karaokeChunksContainer.querySelectorAll('.karaoke-chunk').length;
  if (existingChunksCount > 0 && existingChunksCount === chunks.length && currentChunks.length === chunks.length) {
    currentChunks = chunks;
    if (typeof activeChunkIndex === 'number') {
      const activeEl = karaokeChunksContainer.querySelector(`.karaoke-chunk[data-index="${activeChunkIndex}"]`);
      if (activeEl && !activeEl.classList.contains('active-chunk')) {
        activeEl.classList.add('active-chunk');
      }
    }
    return;
  }

  currentChunks = chunks;

  // Group chunks into paragraphs to preserve continuous reading flow
  const paragraphsMap = new Map();
  let currentP = 0;

  chunks.forEach((chunk, idx) => {
    const text = typeof chunk === 'string' ? chunk : (chunk?.text || '');
    let pIdx;
    if (typeof chunk === 'object' && typeof chunk.paragraphIndex === 'number') {
      pIdx = chunk.paragraphIndex;
    } else {
      pIdx = currentP;
      if (typeof chunk === 'object' && chunk.isParagraphEnd) {
        currentP++;
      }
    }

    if (!paragraphsMap.has(pIdx)) {
      paragraphsMap.set(pIdx, []);
    }
    paragraphsMap.get(pIdx).push({ text, index: idx });
  });

  karaokeChunksContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const [pIdx, chunkList] of paragraphsMap.entries()) {
    const pEl = document.createElement('p');
    pEl.className = 'karaoke-paragraph';
    pEl.dataset.paragraph = pIdx;

    chunkList.forEach(({ text, index }, i) => {
      const span = document.createElement('span');
      span.className = 'karaoke-chunk' + (index === activeChunkIndex ? ' active-chunk' : '');
      span.dataset.index = index;
      span.textContent = text;
      pEl.appendChild(span);

      // Add a single space between chunks in the same paragraph for natural continuous prose
      if (i < chunkList.length - 1) {
        pEl.appendChild(document.createTextNode(' '));
      }
    });

    fragment.appendChild(pEl);
  }

  karaokeChunksContainer.appendChild(fragment);

  const total = totalExpectedChunks || currentChunks.length || 1;
  if (currentChunkBadge) {
    currentChunkBadge.textContent = `🔊 Frase ${activeChunkIndex + 1} de ${total}`;
  }

  const activeEl = karaokeChunksContainer.querySelector(`.karaoke-chunk[data-index="${activeChunkIndex}"]`);
  if (activeEl) {
    scrollChunkIntoView(activeEl);
  }
}

function scrollChunkIntoView(el) {
  if (!el || !karaokeDisplay) return;

  const containerRect = karaokeDisplay.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pEl = el.closest('.karaoke-paragraph') || el;
  const pRect = pEl.getBoundingClientRect();

  // Generous comfort bounds inside the container
  const topComfortMargin = 35;
  const bottomComfortMargin = 45;

  // Check if active chunk is already comfortably visible
  const isChunkComfortablyVisible = (
    elRect.top >= containerRect.top + topComfortMargin &&
    elRect.bottom <= containerRect.bottom - bottomComfortMargin
  );

  if (isChunkComfortablyVisible) {
    return;
  }

  // Scroll to bring the paragraph or chunk comfortably into view near the upper portion
  const fitsEntireParagraph = (pRect.height <= containerRect.clientHeight * 0.75);
  const targetRect = fitsEntireParagraph ? pRect : elRect;

  const relativeTop = targetRect.top - containerRect.top + karaokeDisplay.scrollTop;
  const targetScrollTop = Math.max(0, relativeTop - 30); // 30px breathing room from top

  karaokeDisplay.scrollTo({
    top: targetScrollTop,
    behavior: 'smooth'
  });
}

function setActiveKaraokeChunk(index) {
  activeChunkIndex = index;

  const prevActive = karaokeChunksContainer.querySelectorAll('.karaoke-chunk.active-chunk');
  prevActive.forEach(span => span.classList.remove('active-chunk'));

  const activeEl = karaokeChunksContainer.querySelector(`.karaoke-chunk[data-index="${index}"]`);
  if (activeEl) {
    activeEl.classList.add('active-chunk');
    scrollChunkIntoView(activeEl);
  }

  const total = totalExpectedChunks || currentChunks.length || 1;
  if (currentChunkBadge) {
    currentChunkBadge.textContent = `🔊 Frase ${index + 1} de ${total}`;
  }
}

// 3. User Actions
async function startPlayback(startChunkIndex = 0) {
  const rawText = textInput.value.trim();
  if (!rawText) {
    textInput.focus();
    return;
  }

  const text = normalizeTextForSpeech(rawText);
  lastConvertedText = text;

  isConversionComplete = false;
  totalExpectedChunks = 0;

  // Pre-split text and render full structured paragraphs immediately
  const preChunks = splitTextIntoSmartChunks(text, {
    firstChunkTarget: 180,
    normalChunkTarget: 250,
    maxChunkLimit: 300
  });

  currentChunks = preChunks;
  totalExpectedChunks = preChunks.length;
  const initialIndex = Math.max(0, Math.min(startChunkIndex, Math.max(0, preChunks.length - 1)));
  activeChunkIndex = initialIndex;
  renderKaraokeChunks(preChunks);
  setActiveKaraokeChunk(initialIndex);

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
      volume: 1.0,
      title: currentDocumentTitle || 'audio_kokoro',
      startChunkIndex: initialIndex
    });

    updatePlayPauseUI(true, false);
  } catch (err) {
    console.error('Error starting playback:', err);
    modelStatusText.textContent = `Error: ${err.message}`;
    modelProgressCard.classList.remove('hidden');
  }
}

async function seekPlaybackToChunk(index, options = {}) {
  const total = totalExpectedChunks || currentChunks.length || 0;
  if (index < 0 || (total > 0 && index >= total)) return;
  setActiveKaraokeChunk(index);

  if (isPlaying) {
    updatePlayPauseUI(true, false);
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SEEK_PLAYBACK,
      chunkIndex: index,
      ...options
    }).catch(() => {});
  }
}

async function pausePlayback() {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PAUSE_PLAYBACK }).catch(() => {});
  updatePlayPauseUI(true, true);
}

async function resumePlayback() {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RESUME_PLAYBACK }).catch(() => {});
  updatePlayPauseUI(true, false);
}

async function stopPlayback(reset = false) {
  activeChunkIndex = 0;
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_PLAYBACK, reset }).catch(() => {});
  updatePlayPauseUI(false, false, !reset && !isConversionComplete);
}

function resetConversionState({ clearStorage = false } = {}) {
  isConversionComplete = false;
  totalExpectedChunks = 0;
  lastConvertedText = '';
  currentChunks = [];
  activeChunkIndex = -1;

  if (karaokeChunksContainer) {
    karaokeChunksContainer.innerHTML = '';
  }
  if (playbackStatusBar) {
    playbackStatusBar.classList.add('hidden');
  }
  if (currentChunkBadge) {
    currentChunkBadge.textContent = '🔊 Frase 0 de 0';
  }
  if (conversionStatusBadge) {
    conversionStatusBadge.textContent = '⚡ En espera';
    conversionStatusBadge.classList.remove('done');
  }
  if (conversionProgressFill) {
    conversionProgressFill.style.width = '0%';
    conversionProgressFill.classList.remove('done');
  }

  btnDownloadAudio.disabled = true;
  btnDownloadAudio.classList.remove('btn-download-ready');
  if (btnDownloadText) btnDownloadText.textContent = 'Descargar MP3';
  btnDownloadAudio.title = 'Inicia la lectura para sintetizar y descargar el audio MP3';

  if (clearStorage) {
    clearAudioBlobs().catch(() => {});
    chrome.storage.local.remove('kokoro_last_conversion').catch(() => {});
  }
  chrome.runtime.sendMessage({ type: 'RESET_STATE' }).catch(() => {});
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
        await startPlayback(activeChunkIndex > 0 ? activeChunkIndex : 0);
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

  // Previous chunk button
  if (btnPrevChunk) {
    btnPrevChunk.addEventListener('click', () => {
      if (activeChunkIndex > 0) {
        seekPlaybackToChunk(activeChunkIndex - 1);
      }
    });
  }

  // Next chunk button
  if (btnNextChunk) {
    btnNextChunk.addEventListener('click', () => {
      const total = totalExpectedChunks || currentChunks.length || 0;
      if (activeChunkIndex < total - 1) {
        seekPlaybackToChunk(activeChunkIndex + 1);
      }
    });
  }

  // Click on any karaoke chunk to highlight/jump
  if (karaokeChunksContainer) {
    karaokeChunksContainer.addEventListener('click', (e) => {
      const chunkSpan = e.target.closest('.karaoke-chunk');
      if (!chunkSpan || chunkSpan.dataset.index === undefined) return;
      const idx = parseInt(chunkSpan.dataset.index, 10);
      if (!isNaN(idx) && idx >= 0 && idx < currentChunks.length) {
        seekPlaybackToChunk(idx);
      }
    });
  }

  // Switch back to edit mode button
  if (btnEditMode) {
    btnEditMode.addEventListener('click', async () => {
      await stopPlayback();
    });
  }

  // Font size buttons
  if (btnFontSmaller) {
    btnFontSmaller.addEventListener('click', () => {
      setKaraokeFontSize(currentKaraokeFontSize - 1);
    });
  }
  if (btnFontLarger) {
    btnFontLarger.addEventListener('click', () => {
      setKaraokeFontSize(currentKaraokeFontSize + 1);
    });
  }

  // Voice selector
  voiceSelect.addEventListener('change', async (e) => {
    const newVoice = e.target.value;
    await saveSettings({ selectedVoice: newVoice });
    if (isPlaying) {
      await seekPlaybackToChunk(Math.max(0, activeChunkIndex), {
        voice: newVoice,
        forceResynthesize: true
      });
    }
  });

  // Speed slider
  let speedDebounceTimer = null;
  speedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    speedValue.textContent = `${val.toFixed(2)}x`;
    if (speedDebounceTimer) clearTimeout(speedDebounceTimer);
    speedDebounceTimer = setTimeout(async () => {
      await saveSettings({ speed: val });
      if (isPlaying) {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SPEED, speed: val }).catch(() => {});
      }
    }, 180);
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
        // Inject Readability on-demand only when extracting an article (avoids loading 92KB on every tab)
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/libs/Readability.js']
        }).catch(() => {});
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
        resetConversionState({ clearStorage: false });
        currentDocumentTitle = tab.title ? tab.title.slice(0, 40) : 'articulo_web';
        textInput.value = normalizeTextForSpeech(text);
        const originalHTML = btnExtractArticle.innerHTML;
        btnExtractArticle.textContent = '✓ Capturado';
        btnExtractArticle.style.borderColor = 'var(--border-focus)';
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
    textInput.style.borderColor = 'var(--border-focus)';
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
          resetConversionState({ clearStorage: false });
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
        resetConversionState({ clearStorage: false });
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
  btnClearText.addEventListener('click', async () => {
    await stopPlayback(true);
    textInput.value = '';
    textInput.focus();
    currentDocumentTitle = '';
    resetConversionState({ clearStorage: true });
  });

  // Reset conversion state when user types or pastes new text so stale badges don't linger
  let inputResetTimer = null;
  textInput.addEventListener('input', () => {
    if (!isConversionComplete) return;
    if (inputResetTimer) clearTimeout(inputResetTimer);
    inputResetTimer = setTimeout(() => {
      if (!isConversionComplete) return;
      const currentText = normalizeTextForSpeech(textInput.value.trim());
      if (currentText !== lastConvertedText) {
        resetConversionState({ clearStorage: false });
      }
    }, 100);
  });

  // Download MP3
  btnDownloadAudio.addEventListener('click', async () => {
    // If not marked complete in memory, verify if persistent audio exists in IndexedDB
    if (!isConversionComplete) {
      const record = await getAudioBlob('latest_book_audio').catch(() => null);
      if (record?.blob && record.blob.size > 0) {
        isConversionComplete = true;
      } else {
        modelProgressCard.classList.remove('hidden');
        modelStatusText.textContent = 'El audio aún se está procesando en WebGPU. Espera a que la conversión alcance el 100% para descargarlo completo en MP3.';
        modelPercentText.textContent = '⏳';
        return;
      }
    }

    const originalBtnText = btnDownloadText ? btnDownloadText.textContent : 'Descargar MP3';
    if (btnDownloadText) btnDownloadText.textContent = '⏳ Preparando...';
    btnDownloadAudio.disabled = true;

    try {
      let blob = null;
      let ext = 'mp3';

      // 1. Direct retrieval from IndexedDB (instant, zero IPC size restrictions, survives engine restart)
      try {
        const record = await getAudioBlob('latest_book_audio');
        if (record?.blob && record.blob.size > 0) {
          blob = record.blob;
          ext = record.format || 'mp3';
        }
      } catch (idbErr) {
        console.warn('Direct IndexedDB retrieval failed:', idbErr);
      }

      // 2. Fallback: ask offscreen engine via message
      if (!blob) {
        await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});
        const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_MP3' }).catch(() => null);

        if (res?.error) {
          throw new Error(res.error);
        }

        if (res?.storageKey) {
          const record = await getAudioBlob(res.storageKey);
          blob = record?.blob || null;
          ext = res.format || 'mp3';
        } else if (res?.dataUrl) {
          const resp = await fetch(res.dataUrl);
          blob = await resp.blob();
          ext = res.format || 'mp3';
        }
      }

      if (!blob || blob.size === 0) {
        throw new Error('No se encontró el archivo de audio para descargar.');
      }

      // Ensure proper audio Blob type
      if (!blob.type || !blob.type.startsWith('audio/')) {
        blob = new Blob([blob], { type: ext === 'wav' ? 'audio/wav' : 'audio/mp3' });
      }

      // Create clean filename based on book/document title
      const safeTitle = (currentDocumentTitle || 'kokoro-audio')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'kokoro-audio';
      const filename = `${safeTitle}.${ext}`;
      const fileSizeMB = (blob.size / 1024 / 1024).toFixed(1);

      // Create Object URL for the blob
      const blobUrl = URL.createObjectURL(blob);
      let downloadTriggered = false;

      // Primary download strategy: chrome.downloads API (Manifest V3 recommended for extension pages)
      if (chrome.downloads && chrome.downloads.download) {
        try {
          await chrome.downloads.download({
            url: blobUrl,
            filename: filename,
            saveAs: false
          });
          downloadTriggered = true;
        } catch (dlErr) {
          console.warn('chrome.downloads API fallo, probando enlace DOM:', dlErr);
        }
      }

      // Fallback strategy: DOM anchor in sidepanel
      if (!downloadTriggered) {
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
          console.warn('DOM anchor download fallo:', domErr);
        }
      }

      if (!downloadTriggered) {
        throw new Error('No se pudo iniciar la descarga del archivo en el navegador.');
      }

      // Keep object URL valid long enough for download to complete
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 120000);

      if (btnDownloadText) btnDownloadText.textContent = `✓ MP3 (${fileSizeMB} MB)`;
      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.add('btn-download-ready');
      setTimeout(() => {
        if (btnDownloadText) btnDownloadText.textContent = originalBtnText;
      }, 3500);
    } catch (err) {
      console.error('Error al descargar audio:', err);
      modelProgressCard.classList.remove('hidden');
      modelStatusText.textContent = `Error al descargar: ${err.message}`;
      modelPercentText.textContent = '❌';
      if (btnDownloadText) btnDownloadText.textContent = originalBtnText;
      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.add('btn-download-ready');
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
        if (message.isPlaying || message.isConverting) {
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
        updatePlayPauseUI(message.isPlaying, message.isPaused, message.isConverting);
        updateConversionUI(message);
        break;
      }

      case MESSAGE_TYPES.CURRENT_CHUNK_INDEX: {
        setActiveKaraokeChunk(message.chunkIndex);
        break;
      }

      case 'SELECTION_TEXT_LOADED': {
        if (message.text && textInput) {
          resetConversionState({ clearStorage: false });
          textInput.value = message.text;
        }
        break;
      }
    }
  });
}

// Start controller
document.addEventListener('DOMContentLoaded', init);
