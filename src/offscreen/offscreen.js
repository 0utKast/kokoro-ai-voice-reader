/**
 * Kokoro AI Voice Reader - Offscreen Audio & WebGPU Engine
 * Runs Kokoro-82M inference on WebGPU and streams seamless audio via Web Audio API.
 */

import { KokoroTTS, TextSplitterStream, env } from '../libs/kokoro.web.js';
import { MESSAGE_TYPES, DEFAULT_MODEL_ID, DEFAULT_SETTINGS } from '../shared/constants.js';
import { encodeWAV, encodeMP3, ProgressiveMp3Encoder, normalizeTextForSpeech, splitTextIntoSmartChunks, SmartTextSplitter, trimAudioSilence } from '../shared/audio-utils.js';
import { saveAudioBlob, getAudioBlob } from '../shared/audio-storage.js';

// Configure local WASM paths for ONNX Runtime Web using static extension origin
if (env) {
  env.wasmPaths = new URL('../libs/', import.meta.url).href;
  env.numThreads = 1; // Prevent cross-origin pthread deadlock in Chrome extension
}

// --- State Variables ---
let audioCtx = null;
let gainNode = null;
let kokoroModel = null;
let isModelLoading = false;
let currentDevice = 'webgpu'; // 'webgpu' or 'wasm'

// Playback Queue State
let isPlaying = false;
let isPaused = false;
let activeSources = [];
let nextStartTime = 0;
let pendingAudioQueue = [];
const LOOKAHEAD_BUFFER_SEC = 45; // Max scheduled lookahead audio in Web Audio API (~2-3 chunks)
const MAX_PENDING_QUEUE_CHUNKS = 8; // Backpressure limit to prevent memory bloat (~3-4 min of audio)
let progressiveMp3Encoder = null;
let currentVoice = DEFAULT_SETTINGS.selectedVoice;
let currentSpeed = DEFAULT_SETTINGS.speed;
let currentVolume = DEFAULT_SETTINGS.volume;
let abortGeneration = false;
let totalScheduledChunks = 0;
let completedChunks = 0;
let isGenerationDone = false;
let activeSessionId = 0;
let activeGenerationPromise = null;
let activeSplitter = null;
let isConversionComplete = false;
let totalExpectedChunks = 0;
let convertedChunks = 0;
let currentChunkTexts = [];
let currentSmartChunks = [];
let currentSourceText = '';
let currentTitle = '';
let pcmChunkCache = new Map();
const MAX_PCM_CACHE_CHUNKS = 24;
let nextGeneratorChunkIndex = 0;
let currentActiveChunkIndex = -1;
let scheduledChunks = [];
let playbackMonitorInterval = null;

// Initialize persistent state from previous conversion if available
(async () => {
  try {
    const data = await chrome.storage.local.get('kokoro_last_conversion');
    if (data?.kokoro_last_conversion?.hasAudio && !isPlaying) {
      const last = data.kokoro_last_conversion;
      isConversionComplete = true;
      totalScheduledChunks = last.totalChunks || 0;
      totalExpectedChunks = last.totalChunks || 0;
      convertedChunks = last.totalChunks || 0;
      currentChunkTexts = Array.isArray(last.chunks) ? last.chunks : [];
      if (Array.isArray(last.chunks) && last.chunks.length > 0 && typeof last.chunks[0] === 'object') {
        currentSmartChunks = last.chunks;
      }
      if (last.text) currentSourceText = last.text;
      if (last.title) currentTitle = last.title;
    }
  } catch (err) {
    console.warn('Error recuperando estado persistente en offscreen:', err);
  }
})();

// 1. Initialize Audio Context
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ sampleRate: 24000 });
    gainNode = audioCtx.createGain();
    gainNode.gain.value = currentVolume;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended' && !isPaused) {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// 2. Hardware Capability Check: WebGPU Detection
async function verifyWebGPUSupport() {
  if (!navigator.gpu) {
    return { supported: false, reason: "navigator.gpu no está disponible en este navegador." };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: "No se encontró un adaptador GPU compatible." };
    }
    return { supported: true, name: adapter.info?.device || "WebGPU Compatible Device" };
  } catch (err) {
    return { supported: false, reason: err.message };
  }
}

// 3. Initialize Kokoro Engine with Automatic WASM Fallback
async function initKokoroEngine(preferredDevice = 'webgpu') {
  if (kokoroModel) return kokoroModel;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (kokoroModel) return kokoroModel;
  }

  isModelLoading = true;
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.MODEL_PROGRESS,
    status: 'initializing',
    message: 'Verificando aceleración WebGPU...'
  }).catch(() => {});

  const gpuCheck = await verifyWebGPUSupport();
  currentDevice = (preferredDevice === 'webgpu' && gpuCheck.supported) ? 'webgpu' : 'wasm';
  const dtype = 'fp32';

  const progressCallback = (progress) => {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_PROGRESS,
      status: 'downloading',
      progress: progress
    }).catch(() => {});
  };

  try {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_PROGRESS,
      status: 'loading',
      device: currentDevice,
      message: `Cargando modelo Kokoro-82M (${currentDevice.toUpperCase()})...`
    }).catch(() => {});

    try {
      kokoroModel = await KokoroTTS.from_pretrained(DEFAULT_MODEL_ID, {
        dtype: dtype,
        device: currentDevice,
        progress_callback: progressCallback
      });
    } catch (gpuErr) {
      if (currentDevice === 'webgpu') {
        console.warn('WebGPU execution provider failed. Falling back to WASM:', gpuErr);
        currentDevice = 'wasm';
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.MODEL_PROGRESS,
          status: 'loading',
          device: 'wasm',
          message: 'WebGPU no disponible, cargando modo seguro WASM...'
        }).catch(() => {});

        kokoroModel = await KokoroTTS.from_pretrained(DEFAULT_MODEL_ID, {
          dtype: 'fp32',
          device: 'wasm',
          progress_callback: progressCallback
        });
      } else {
        throw gpuErr;
      }
    }

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_LOADED,
      device: currentDevice,
      success: true
    }).catch(() => {});

    return kokoroModel;
  } catch (err) {
    console.error('Failed to load Kokoro TTS engine:', err);
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_ERROR,
      error: `Error cargando motor: ${err.message}`
    }).catch(() => {});
    throw err;
  } finally {
    isModelLoading = false;
  }
}

function disconnectActiveSources() {
  for (const src of activeSources) {
    try {
      src.onended = null;
      src.stop(0);
      src.disconnect();
      src.buffer = null;
    } catch {}
  }
  activeSources = [];
}

// 4. Playback Controls
function stopAudioPlayback(resetConversion = false) {
  abortGeneration = true;
  isPlaying = false;
  isPaused = false;
  isGenerationDone = false;
  if (activeSplitter) {
    activeSplitter.abort();
  }
  pendingAudioQueue = [];
  progressiveMp3Encoder = null;
  nextStartTime = 0;
  totalScheduledChunks = 0;
  completedChunks = 0;
  currentActiveChunkIndex = -1;
  scheduledChunks = [];
  stopPlaybackMonitor();
  disconnectActiveSources();

  if (resetConversion) {
    isConversionComplete = false;
    convertedChunks = 0;
    totalExpectedChunks = 0;
    currentSmartChunks = [];
    currentChunkTexts = [];
    currentSourceText = '';
    currentTitle = '';
    pcmChunkCache.clear();
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: false,
    isPaused: false,
    chunkIndex: -1,
    isConversionComplete: isConversionComplete,
    conversionProgress: isConversionComplete ? 100 : 0
  }).catch(() => {});
}

async function seekToChunk(targetIndex, options = {}) {
  if (currentSmartChunks.length === 0 && !currentSourceText) return false;

  const total = currentSmartChunks.length;
  const clampedIndex = Math.max(0, Math.min(targetIndex, Math.max(0, total - 1)));
  const forceResynth = Boolean(options.forceResynthesize);

  // Fast Path: Check if targetIndex..endOfGeneratedWindow is completely in pcmChunkCache
  if (!forceResynth && total > 0) {
    const endBound = isGenerationDone ? total : nextGeneratorChunkIndex;
    if (clampedIndex < endBound && endBound > clampedIndex) {
      let allCached = true;
      for (let k = clampedIndex; k < endBound; k++) {
        if (!pcmChunkCache.has(k)) {
          allCached = false;
          break;
        }
      }

      if (allCached) {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        disconnectActiveSources();
        scheduledChunks = [];
        pendingAudioQueue = [];
        for (let k = clampedIndex; k < endBound; k++) {
          pendingAudioQueue.push(pcmChunkCache.get(k));
        }
        nextStartTime = ctx.currentTime + 0.03;
        currentActiveChunkIndex = -1;
        isPlaying = true;
        isPaused = false;
        completedChunks = clampedIndex;
        totalScheduledChunks = endBound;

        schedulePendingAudioChunks();

        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: true,
          isPaused: false,
          chunkIndex: clampedIndex,
          isConversionComplete: isConversionComplete,
          totalExpectedChunks: totalExpectedChunks,
          convertedChunks: convertedChunks,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100)
        }).catch(() => {});
        return true;
      }
    }
  }

  // Resynthesis Path: Restart neural stream directly at clampedIndex
  const sourceText = currentSourceText || currentSmartChunks.map(c => typeof c === 'string' ? c : c.text).join('\n\n');
  await playText(sourceText, {
    voice: options.voice || currentVoice,
    speed: options.speed || currentSpeed,
    volume: currentVolume,
    title: currentTitle,
    startChunkIndex: clampedIndex,
    reuseSmartChunks: currentSmartChunks.length > 0,
    clearCache: forceResynth,
    preserveConversionComplete: isConversionComplete && !forceResynth
  });
  return true;
}

async function playText(text, options = {}) {
  // 1. Mutual exclusion: If another generation is currently running on the GPU, abort it and await completion
  while (activeGenerationPromise) {
    abortGeneration = true;
    activeSessionId++;
    if (activeSplitter) {
      activeSplitter.abort();
    }
    const running = activeGenerationPromise;
    try {
      await Promise.race([
        running,
        new Promise(r => setTimeout(r, 1500)) // 1.5s timeout guard to prevent deadlocks
      ]);
    } catch (e) {
      console.warn('[Kokoro Engine] Advertencia esperando limpieza de sesión anterior:', e);
    }
    if (activeGenerationPromise === running) {
      activeGenerationPromise = null;
      activeSplitter = null;
      break;
    }
  }

  const startChunkIndex = Math.max(0, options.startChunkIndex || 0);
  const preserveConversion = Boolean(options.preserveConversionComplete && isConversionComplete);
  const savedConversionComplete = preserveConversion;

  // Pre-split text using smart sentence- and paragraph-aware chunking (or reuse on seek)
  const smartChunks = (options.reuseSmartChunks && currentSmartChunks.length > 0)
    ? currentSmartChunks
    : splitTextIntoSmartChunks(text, {
        firstChunkTarget: 200,
        normalChunkTarget: 350,
        maxChunkLimit: 450
      });

  stopAudioPlayback();
  abortGeneration = false;
  isGenerationDone = false;
  isConversionComplete = savedConversionComplete;
  const sessionId = ++activeSessionId;

  currentSourceText = text || currentSourceText;
  if (options.title !== undefined) currentTitle = options.title;
  const voiceChanged = options.voice && options.voice !== currentVoice;
  const speedChanged = options.speed && options.speed !== currentSpeed;
  if (startChunkIndex === 0 || options.clearCache || voiceChanged || speedChanged) {
    pcmChunkCache.clear();
  }

  currentVoice = options.voice || currentVoice;
  currentSpeed = options.speed || currentSpeed;
  currentVolume = options.volume ?? currentVolume;

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  if (gainNode) {
    gainNode.gain.value = currentVolume;
  }

  isPlaying = true;
  isPaused = false;
  pendingAudioQueue = [];
  // Only overwrite full MP3 when starting from beginning or when not preserving a completed conversion
  progressiveMp3Encoder = (!savedConversionComplete && startChunkIndex === 0)
    ? new ProgressiveMp3Encoder(24000, 64)
    : null;
  currentChunkTexts = [];
  currentActiveChunkIndex = -1;
  scheduledChunks = [];
  nextStartTime = ctx.currentTime + 0.05;
  totalScheduledChunks = startChunkIndex;
  completedChunks = startChunkIndex;
  convertedChunks = savedConversionComplete ? smartChunks.length : startChunkIndex;
  nextGeneratorChunkIndex = startChunkIndex;
  currentSmartChunks = smartChunks;

  const chunksToSynthesize = smartChunks.slice(startChunkIndex);
  const splitter = new SmartTextSplitter(chunksToSynthesize);
  activeSplitter = splitter;
  totalExpectedChunks = smartChunks.length;

  const initialPct = savedConversionComplete
    ? 100
    : (totalExpectedChunks > 0 ? Math.round((startChunkIndex / totalExpectedChunks) * 100) : 0);

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: true,
    isPaused: false,
    chunkIndex: startChunkIndex,
    conversionProgress: initialPct,
    convertedChunks: convertedChunks,
    totalExpectedChunks: totalExpectedChunks,
    chunks: currentSmartChunks,
    isConversionComplete: isConversionComplete
  }).catch(() => {});

  let myGenerationPromise = null;
  myGenerationPromise = (async () => {
    try {
      const model = await initKokoroEngine(options.device || currentDevice);

      let localIndex = 0;
      const chunkTexts = [];

      // Stream chunks continuously with KokoroTTS using the pre-split stream
      for await (const chunk of model.stream(splitter, { voice: currentVoice, speed: currentSpeed })) {
        if (abortGeneration || activeSessionId !== sessionId) break;

        const rawPcm = chunk.audio?.audio;
        if (!rawPcm || rawPcm.length === 0) {
          continue;
        }

        const globalChunkIndex = startChunkIndex + localIndex;
        localIndex++;
        nextGeneratorChunkIndex = globalChunkIndex + 1;

        // Trim excessive silence padding from neural vocoder output for seamless streaming
        const cleanPcm = trimAudioSilence(rawPcm, chunk.audio.sampling_rate || 24000, 20, 40);

        // Feed directly into incremental MP3 encoder (low memory, instant readiness)
        if (progressiveMp3Encoder) {
          try {
            progressiveMp3Encoder.feed(cleanPcm);
          } catch (encErr) {
            console.warn('Error en codificador progresivo MP3:', encErr);
          }
        }

        chunkTexts.push(chunk.text);
        currentChunkTexts = chunkTexts;

        totalScheduledChunks++;
        if (!savedConversionComplete) {
          convertedChunks = globalChunkIndex + 1;
        }
        const conversionPct = savedConversionComplete
          ? 100
          : (totalExpectedChunks > 0
              ? Math.min(100, Math.round((convertedChunks / totalExpectedChunks) * 100))
              : 100);

        // Update side panel with streaming audio and live conversion progress.
        // Only send full chunks array on the first chunk to avoid serializing large arrays on every step.
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: isPlaying,
          isPaused: isPaused,
          totalChunks: totalScheduledChunks,
          ...(localIndex === 1 ? { chunks: currentSmartChunks.length > 0 ? currentSmartChunks : chunkTexts } : {}),
          conversionProgress: conversionPct,
          convertedChunks: convertedChunks,
          totalExpectedChunks: totalExpectedChunks,
          isConversionComplete: isConversionComplete
        }).catch(() => {});

        const isParagraphEnd = splitter.chunkMetadata[localIndex - 1]?.isParagraphEnd ?? false;

        const queueItem = {
          pcm: cleanPcm,
          chunkIndex: globalChunkIndex,
          text: chunk.text,
          isParagraphEnd,
          sampleRate: chunk.audio.sampling_rate || 24000
        };

        // Store in bounded sliding PCM cache for 0ms Prev/Next seeking
        pcmChunkCache.set(globalChunkIndex, queueItem);
        if (pcmChunkCache.size > MAX_PCM_CACHE_CHUNKS) {
          const oldestKey = pcmChunkCache.keys().next().value;
          pcmChunkCache.delete(oldestKey);
        }

        // Enqueue chunk in pendingAudioQueue for just-in-time Web Audio allocation
        pendingAudioQueue.push(queueItem);

        // Schedule into Web Audio API if lookahead buffer needs filling
        schedulePendingAudioChunks();

        // Backpressure: If queue is already ahead by several minutes, pause generator to keep memory flat
        while (pendingAudioQueue.length >= MAX_PENDING_QUEUE_CHUNKS && !abortGeneration && activeSessionId === sessionId) {
          await new Promise(r => setTimeout(r, isPaused ? 300 : 150));
        }
      }

      if (!abortGeneration && activeSessionId === sessionId) {
        isGenerationDone = true;
        if (startChunkIndex === 0 || savedConversionComplete) {
          isConversionComplete = true;
        }

        // Finalize MP3 and store into IndexedDB immediately (instant download ready)
        let mp3Blob = null;
        if (progressiveMp3Encoder) {
          try {
            mp3Blob = progressiveMp3Encoder.finish();
          } catch (encErr) {
            console.error('Error finalizando codificador progresivo MP3:', encErr);
          }
        }

        if (mp3Blob && mp3Blob.size > 0) {
          const duration = progressiveMp3Encoder?.durationSeconds || 0;
          const finalChunks = currentSmartChunks.length > 0 ? currentSmartChunks : chunkTexts;
          const metadata = {
            format: 'mp3',
            totalChunks: totalExpectedChunks,
            duration: duration,
            size: mp3Blob.size,
            updatedAt: Date.now(),
            title: currentTitle || options.title || '',
            text: currentSourceText,
            chunks: finalChunks,
            voice: currentVoice,
            speed: currentSpeed
          };

          try {
            await saveAudioBlob('latest_book_audio', mp3Blob, metadata);
            console.log(`[Kokoro] Audio MP3 persistente guardado en IndexedDB: ${(mp3Blob.size / 1024 / 1024).toFixed(2)} MB (${duration.toFixed(1)}s)`);
          } catch (storageErr) {
            console.error('Error guardando audio MP3 en IndexedDB:', storageErr);
          }

          // Save lightweight persistent metadata in chrome.storage.local for instantaneous recovery.
          // For very large books (>50k chars), omit duplicating full text/chunks here since IndexedDB already holds them.
          const isCompactText = currentSourceText.length <= 50000;
          try {
            await chrome.storage.local.set({
              kokoro_last_conversion: {
                hasAudio: true,
                storageKey: 'latest_book_audio',
                format: 'mp3',
                size: mp3Blob.size,
                duration: duration,
                title: metadata.title,
                ...(isCompactText ? { text: currentSourceText, chunks: finalChunks } : {}),
                totalChunks: totalExpectedChunks,
                voice: currentVoice,
                speed: currentSpeed,
                timestamp: metadata.updatedAt
              }
            });
          } catch (metaErr) {
            console.warn('Error guardando metadatos en chrome.storage.local:', metaErr);
          }
        }

        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: isPlaying,
          isPaused: isPaused,
          totalChunks: totalExpectedChunks,
          chunks: currentSmartChunks.length > 0 ? currentSmartChunks : chunkTexts,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100),
          convertedChunks: isConversionComplete ? totalExpectedChunks : convertedChunks,
          totalExpectedChunks: totalExpectedChunks,
          isConversionComplete: isConversionComplete
        }).catch(() => {});
      }

      // If all audio already finished playing before generation loop concluded
      if (completedChunks >= totalScheduledChunks && activeSources.length === 0 && pendingAudioQueue.length === 0) {
        isPlaying = false;
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: false,
          isPaused: false,
          finished: true,
          isConversionComplete: isConversionComplete
        }).catch(() => {});
      }
    } catch (err) {
      if (activeSessionId === sessionId) {
        console.error('Synthesis error during streaming:', err);
        stopAudioPlayback();
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.MODEL_ERROR,
          error: `Error durante la síntesis: ${err.message}`
        }).catch(() => {});
      }
    } finally {
      if (activeGenerationPromise === myGenerationPromise) {
        activeGenerationPromise = null;
        activeSplitter = null;
      }
    }
  })();
  activeGenerationPromise = myGenerationPromise;

  return myGenerationPromise;
}

function safeCreateAudioBuffer(ctx, channels, length, sampleRate = 24000) {
  try {
    return ctx.createBuffer(channels, length, sampleRate);
  } catch (err) {
    console.warn(`[Kokoro Audio] Falló createBuffer(${channels}, ${length}, ${sampleRate}). Intentando recuperación de memoria...`, err);
    cleanupFinishedSources();

    try {
      return ctx.createBuffer(channels, length, sampleRate);
    } catch (err2) {
      console.error(`[Kokoro Audio] Reintento de createBuffer falló:`, err2);
      if (ctx.state === 'closed') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass({ sampleRate: 24000 });
        gainNode = audioCtx.createGain();
        gainNode.gain.value = currentVolume;
        gainNode.connect(audioCtx.destination);
        return audioCtx.createBuffer(channels, length, sampleRate);
      }
      throw err2;
    }
  }
}

function cleanupFinishedSources() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = activeSources.length - 1; i >= 0; i--) {
    const src = activeSources[i];
    // Only clean up nodes that finished more than 1 second ago and somehow missed onended
    if (src._endTime && src._endTime + 1.0 <= now) {
      try {
        src.onended = null;
        src.disconnect();
        src.buffer = null;
      } catch {}
      activeSources.splice(i, 1);
      completedChunks++;
    }
  }
  // Prune past scheduledChunks so the array remains bounded to active/upcoming chunks
  while (scheduledChunks.length > 1 && scheduledChunks[0].endTime + 0.5 <= now) {
    scheduledChunks.shift();
  }
}

function schedulePendingAudioChunks() {
  if (!isPlaying || isPaused || !audioCtx) return;
  const ctx = getAudioContext();
  cleanupFinishedSources();

  while (pendingAudioQueue.length > 0) {
    const bufferedAhead = nextStartTime - ctx.currentTime;
    // Keep enough audio buffered in Web Audio API (~45s), but do not schedule far in advance to save memory
    if (bufferedAhead >= LOOKAHEAD_BUFFER_SEC && activeSources.length >= 2) {
      break;
    }

    const item = pendingAudioQueue.shift();
    if (!item) break;

    const audioBuffer = safeCreateAudioBuffer(ctx, 1, item.pcm.length, item.sampleRate || 24000);
    audioBuffer.copyToChannel(item.pcm, 0);

    scheduleChunkPlayback(audioBuffer, item.chunkIndex, item.text, item.isParagraphEnd);
  }
}

function startPlaybackMonitor() {
  if (playbackMonitorInterval) return;

  playbackMonitorInterval = setInterval(() => {
    if (!isPlaying) {
      stopPlaybackMonitor();
      return;
    }

    if (isPaused || !audioCtx || audioCtx.state !== 'running') {
      return;
    }

    const t = audioCtx.currentTime;

    // Check if we need to schedule more audio chunks from pendingAudioQueue
    if (pendingAudioQueue.length > 0 && (nextStartTime - t) < LOOKAHEAD_BUFFER_SEC) {
      schedulePendingAudioChunks();
    }

    for (let i = 0; i < scheduledChunks.length; i++) {
      const chunk = scheduledChunks[i];
      if (t >= chunk.startTime && t < chunk.endTime) {
        if (currentActiveChunkIndex !== chunk.chunkIndex) {
          currentActiveChunkIndex = chunk.chunkIndex;
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.CURRENT_CHUNK_INDEX,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            duration: chunk.duration
          }).catch(() => {});
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

function scheduleChunkPlayback(audioBuffer, chunkIndex, text, isParagraphEnd = false) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  // Kokoro already synthesizes at currentSpeed during model inference
  source.playbackRate.value = 1.0;
  source.connect(gainNode);

  const duration = audioBuffer.duration;
  const startTime = Math.max(ctx.currentTime + 0.05, nextStartTime);
  source.start(startTime);
  const endTime = startTime + duration;
  // Add a slight natural paragraph breath (200ms) only when paragraph ends; within paragraphs keep it seamless (15ms)
  nextStartTime = endTime + (isParagraphEnd ? 0.20 : 0.015);

  source._endTime = endTime;
  activeSources.push(source);

  scheduledChunks.push({
    chunkIndex,
    startTime,
    endTime,
    duration,
    text
  });

  // Highlight initial chunk immediately if playback is just starting
  if (currentActiveChunkIndex === -1) {
    currentActiveChunkIndex = chunkIndex;
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.CURRENT_CHUNK_INDEX,
      chunkIndex: chunkIndex,
      text: text,
      duration: duration
    }).catch(() => {});
  }

  startPlaybackMonitor();

  source.onended = () => {
    try {
      source.disconnect();
      source.buffer = null;
    } catch {}
    completedChunks++;
    const idx = activeSources.indexOf(source);
    if (idx !== -1) activeSources.splice(idx, 1);

    // Keep filling audio lookahead buffer from the queue as chunks finish playing
    schedulePendingAudioChunks();

    if (isGenerationDone && pendingAudioQueue.length === 0 && completedChunks >= totalScheduledChunks && activeSources.length === 0) {
      isPlaying = false;
      isPaused = false;
      stopPlaybackMonitor();
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: false,
        isPaused: false,
        finished: true,
        isConversionComplete: true
      }).catch(() => {});
    }
  };
}

const OFFSCREEN_HANDLED_TYPES = new Set([
  "GET_PLAYBACK_STATE",
  MESSAGE_TYPES.CHECK_ENGINE,
  MESSAGE_TYPES.LOAD_MODEL,
  "RESET_STATE",
  MESSAGE_TYPES.PLAY_TEXT,
  MESSAGE_TYPES.PAUSE_PLAYBACK,
  MESSAGE_TYPES.RESUME_PLAYBACK,
  MESSAGE_TYPES.STOP_PLAYBACK,
  MESSAGE_TYPES.SEEK_PLAYBACK,
  MESSAGE_TYPES.SET_VOLUME,
  MESSAGE_TYPES.SET_SPEED,
  "DOWNLOAD_MP3",
  "DOWNLOAD_AUDIO",
  "DOWNLOAD_WAV"
]);

// 5. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type || !OFFSCREEN_HANDLED_TYPES.has(message.type)) {
    return false;
  }
  // Ignore PLAY_TEXT originating from content script (Service Worker orchestrates it first)
  if (message.type === MESSAGE_TYPES.PLAY_TEXT && sender?.tab?.id && message.origin !== 'sidepanel') {
    return false;
  }

  (async () => {
    switch (message.type) {
      case "GET_PLAYBACK_STATE": {
        const conversionPct = totalExpectedChunks > 0 
          ? Math.min(100, Math.round((convertedChunks / totalExpectedChunks) * 100)) 
          : (isConversionComplete ? 100 : 0);
        sendResponse({
          isPlaying: isPlaying,
          isPaused: isPaused,
          totalChunks: totalScheduledChunks,
          chunks: currentSmartChunks.length > 0 ? currentSmartChunks : currentChunkTexts,
          chunkIndex: currentActiveChunkIndex,
          totalExpectedChunks: totalExpectedChunks,
          convertedChunks: convertedChunks,
          isConversionComplete: isConversionComplete,
          conversionProgress: conversionPct
        });
        break;
      }

      case MESSAGE_TYPES.CHECK_ENGINE: {
        const gpu = await verifyWebGPUSupport();
        sendResponse({
          ready: true,
          webgpuSupported: gpu.supported,
          adapterName: gpu.name || null,
          device: currentDevice,
          isModelLoaded: !!kokoroModel
        });
        break;
      }

      case MESSAGE_TYPES.LOAD_MODEL: {
        try {
          await initKokoroEngine(message.device);
          sendResponse({ success: true, device: currentDevice });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case "RESET_STATE": {
        stopAudioPlayback(true);
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.PLAY_TEXT: {
        playText(message.text, {
          voice: message.voice,
          speed: message.speed,
          volume: message.volume,
          device: message.device,
          title: message.title,
          startChunkIndex: message.startChunkIndex || 0
        }).catch((err) => {
          console.error('[Kokoro Engine] playText error:', err);
        });
        sendResponse({ success: true, started: true });
        break;
      }

      case MESSAGE_TYPES.SEEK_PLAYBACK: {
        seekToChunk(message.chunkIndex, {
          voice: message.voice,
          speed: message.speed,
          forceResynthesize: Boolean(message.forceResynthesize)
        }).catch((err) => {
          console.error('[Kokoro Engine] seekToChunk error:', err);
        });
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.PAUSE_PLAYBACK: {
        isPaused = true;
        if (audioCtx && audioCtx.state === 'running') {
          await audioCtx.suspend();
        }
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: isPlaying,
          isPaused: true,
          isConversionComplete: isConversionComplete,
          totalExpectedChunks: totalExpectedChunks,
          convertedChunks: convertedChunks,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100)
        }).catch(() => {});
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.RESUME_PLAYBACK: {
        isPaused = false;
        if (audioCtx && audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        schedulePendingAudioChunks();
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: isPlaying,
          isPaused: false,
          isConversionComplete: isConversionComplete,
          totalExpectedChunks: totalExpectedChunks,
          convertedChunks: convertedChunks,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100)
        }).catch(() => {});
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.STOP_PLAYBACK: {
        stopAudioPlayback(Boolean(message.reset));
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.SET_VOLUME: {
        currentVolume = message.volume;
        if (gainNode) gainNode.gain.value = currentVolume;
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.SET_SPEED: {
        const newSpeed = Number(message.speed) || 1.0;
        const speedChanged = Math.abs(newSpeed - currentSpeed) > 0.001;
        currentSpeed = newSpeed;
        if (isPlaying && speedChanged) {
          seekToChunk(Math.max(0, currentActiveChunkIndex), {
            speed: currentSpeed,
            forceResynthesize: true
          }).catch((err) => {
            console.error('[Kokoro Engine] speed change resynthesis error:', err);
          });
        }
        sendResponse({ success: true });
        break;
      }

      case "DOWNLOAD_MP3":
      case "DOWNLOAD_AUDIO": {
        try {
          // 1. Check if already finalized and saved in IndexedDB
          let record = await getAudioBlob('latest_book_audio');
          let blob = record?.blob;
          let format = record?.format || 'mp3';

          if (!blob) {
            // Finalize on-the-fly if progressive encoder has data
            if (progressiveMp3Encoder && progressiveMp3Encoder.totalSamples > 0) {
              blob = progressiveMp3Encoder.finish();
              format = 'mp3';
            }

            if (blob && blob.size > 0) {
              await saveAudioBlob('latest_book_audio', blob, {
                format,
                duration: progressiveMp3Encoder?.durationSeconds || 0
              });
              record = { blob, format, size: blob.size };
            }
          }

          if (!blob || blob.size === 0) {
            if (!isConversionComplete) {
              sendResponse({
                error: `La conversión aún no ha finalizado (${convertedChunks} de ${totalExpectedChunks} frases sintetizadas). Podrás descargar el archivo MP3 cuando se complete el 100%.`
              });
            } else {
              sendResponse({ error: "No hay audio generado todavía para descargar." });
            }
            return;
          }

          // Return lightweight metadata with IndexedDB storageKey.
          // Zero IPC size limit issues (message is <100 bytes, avoiding the 64MB Mojo limit!).
          sendResponse({
            success: true,
            storageKey: 'latest_book_audio',
            format: format,
            size: blob.size,
            duration: record?.duration || 0
          });
        } catch (err) {
          console.error('Error preparando archivo de audio:', err);
          sendResponse({ error: `Error preparando archivo de audio: ${err.message}` });
        }
        break;
      }

      case "DOWNLOAD_WAV": {
        sendResponse({
          error: "El formato de alta eficiencia predeterminado es MP3 para garantizar un consumo mínimo de memoria."
        });
        break;
      }

      default:
        break;
    }
  })();

  return true;
});

console.log('Kokoro Offscreen Engine (WebGPU + Local WASM & Fallback) Ready.');
