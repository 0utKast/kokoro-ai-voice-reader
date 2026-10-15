/**
 * Kokoro AI Voice Reader - Offscreen Audio & WebGPU Engine
 * Runs Kokoro-82M inference on WebGPU and streams seamless audio via Web Audio API.
 */

import { KokoroTTS, TextSplitterStream, env } from '../libs/kokoro.web.js';
import { MESSAGE_TYPES, DEFAULT_MODEL_ID, DEFAULT_SETTINGS } from '../shared/constants.js';
import { encodeWAV, encodeMP3, ProgressiveMp3Encoder, normalizeTextForSpeech, splitTextIntoSmartChunks, SmartTextSplitter, trimAudioSilence, float32ToInt16, int16ToFloat32 } from '../shared/audio-utils.js';
import { saveAudioBlob, getAudioBlob, saveSpilledPcmChunk, getSpilledPcmChunk, deleteSpilledPcmChunk, clearSpilledPcmChunks } from '../shared/audio-storage.js';

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
const MAX_RAM_QUEUE_CHUNKS = 64; // Max unplayed Int16 PCM chunks kept in JS RAM (~20 min of audio, ~30 MB)
const HYDRATE_RAM_THRESHOLD = 32; // Prefetch spilled chunks from IndexedDB when in-RAM queue drops below this
let isHydratingQueue = false;
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

function countInRamQueueChunks() {
  let count = 0;
  for (let i = 0; i < pendingAudioQueue.length; i++) {
    if (pendingAudioQueue[i].pcm) count++;
  }
  return count;
}

function hasSpilledQueueChunks() {
  for (let i = 0; i < pendingAudioQueue.length; i++) {
    if (!pendingAudioQueue[i].pcm && pendingAudioQueue[i].spilledKey) return true;
  }
  return false;
}

function cachePlayedChunkInRam(item) {
  if (!item || !item.pcm) return;
  pcmChunkCache.set(item.chunkIndex, {
    pcm: item.pcm,
    spilledKey: null,
    chunkIndex: item.chunkIndex,
    text: item.text,
    isParagraphEnd: item.isParagraphEnd,
    sampleRate: item.sampleRate || 24000
  });
  while (pcmChunkCache.size > MAX_PCM_CACHE_CHUNKS) {
    const oldestKey = pcmChunkCache.keys().next().value;
    pcmChunkCache.delete(oldestKey);
  }
}

let activeHydrationPromise = null;

async function hydratePendingQueueFromSwap(sessionId = activeSessionId, batchSize = 16) {
  if (activeHydrationPromise) {
    return activeHydrationPromise;
  }
  isHydratingQueue = true;
  activeHydrationPromise = (async () => {
    try {
      let hydrated = 0;
      while (hydrated < batchSize) {
        if (activeSessionId !== sessionId || !isPlaying) break;
        // Always locate the first unhydrated chunk from the front of the queue.
        // Using .find() instead of a fixed loop index `i` prevents skipping chunks when
        // schedulePendingAudioChunks() calls pendingAudioQueue.shift() while awaiting IndexedDB.
        const item = pendingAudioQueue.find(it => !it.pcm && it.spilledKey);
        if (!item) break;
        const key = item.spilledKey;
        const pcm = await getSpilledPcmChunk(key);
        if (activeSessionId !== sessionId || !isPlaying) break;
        if (pcm) {
          item.pcm = pcm;
          item.spilledKey = null;
          deleteSpilledPcmChunk(key).catch(() => {});
          hydrated++;
          // If the front of the queue was waiting on this exact chunk, schedule it immediately
          if (pendingAudioQueue[0] === item && isPlaying && !isPaused) {
            schedulePendingAudioChunks();
          }
        } else {
          item.spilledKey = null;
          break;
        }
      }
      if (hydrated > 0 && isPlaying && !isPaused && activeSessionId === sessionId) {
        schedulePendingAudioChunks();
      }
    } finally {
      isHydratingQueue = false;
      activeHydrationPromise = null;
    }
  })();

  await activeHydrationPromise;

  if (
    isPlaying &&
    !isPaused &&
    activeSessionId === sessionId &&
    pendingAudioQueue.length > 0 &&
    !pendingAudioQueue[0].pcm &&
    pendingAudioQueue[0].spilledKey
  ) {
    return hydratePendingQueueFromSwap(sessionId, batchSize);
  }
}

// 4. Playback Controls
function stopAudioPlayback(resetConversion = false, keepBackgroundConversion = false) {
  if (!keepBackgroundConversion) {
    abortGeneration = true;
    isGenerationDone = false;
    if (activeSplitter) {
      activeSplitter.abort();
    }
    progressiveMp3Encoder = null;
  }
  isPlaying = false;
  isPaused = false;
  pendingAudioQueue = [];
  nextStartTime = 0;
  if (!keepBackgroundConversion) {
    totalScheduledChunks = 0;
  }
  completedChunks = 0;
  currentActiveChunkIndex = -1;
  scheduledChunks = [];
  stopPlaybackMonitor();
  disconnectActiveSources();
  clearSpilledPcmChunks().catch(() => {});

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

  const conversionPct = isConversionComplete
    ? 100
    : (keepBackgroundConversion && totalExpectedChunks > 0
        ? Math.min(100, Math.round((convertedChunks / totalExpectedChunks) * 100))
        : 0);

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: false,
    isPaused: false,
    isConverting: Boolean(keepBackgroundConversion && !isConversionComplete),
    chunkIndex: -1,
    convertedChunks: convertedChunks,
    totalExpectedChunks: totalExpectedChunks,
    isConversionComplete: isConversionComplete,
    conversionProgress: conversionPct
  }).catch(() => {});
}

async function seekToChunk(targetIndex, options = {}) {
  if (currentSmartChunks.length === 0 && !currentSourceText) return false;

  const total = currentSmartChunks.length;
  const clampedIndex = Math.max(0, Math.min(targetIndex, Math.max(0, total - 1)));
  const forceResynth = Boolean(options.forceResynthesize);

  // Fast In-Place Queue Seek: If targetIndex has already been synthesized in the current session,
  // reposition pendingAudioQueue using pcmChunkCache + pendingAudioQueue WITHOUT aborting the 10x background MP3 generator!
  if (!forceResynth && total > 0) {
    const endBound = isGenerationDone ? total : nextGeneratorChunkIndex;
    if (clampedIndex < endBound) {
      const firstPendingIdx = pendingAudioQueue.length > 0 ? pendingAudioQueue[0].chunkIndex : endBound;
      let canSeekInPlace = false;

      if (clampedIndex < firstPendingIdx) {
        // Backward or within currently-scheduled Web Audio window: verify clampedIndex..firstPendingIdx-1 are in pcmChunkCache
        let allInCache = true;
        for (let k = clampedIndex; k < firstPendingIdx; k++) {
          if (!pcmChunkCache.has(k)) {
            allInCache = false;
            break;
          }
        }
        if (allInCache) {
          const toPrepend = [];
          for (let k = clampedIndex; k < firstPendingIdx; k++) {
            toPrepend.push({ ...pcmChunkCache.get(k) });
          }
          pendingAudioQueue.unshift(...toPrepend);
          canSeekInPlace = true;
        }
      } else {
        // Forward into pendingAudioQueue (clampedIndex >= firstPendingIdx && clampedIndex < endBound)
        while (pendingAudioQueue.length > 0 && pendingAudioQueue[0].chunkIndex < clampedIndex) {
          const skipped = pendingAudioQueue.shift();
          if (skipped.pcm) {
            cachePlayedChunkInRam(skipped);
          } else if (skipped.spilledKey) {
            deleteSpilledPcmChunk(skipped.spilledKey).catch(() => {});
          }
        }
        canSeekInPlace = pendingAudioQueue.length > 0 && pendingAudioQueue[0].chunkIndex === clampedIndex;
      }

      if (canSeekInPlace) {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        disconnectActiveSources();
        scheduledChunks = [];
        nextStartTime = ctx.currentTime + 0.03;
        currentActiveChunkIndex = -1;
        isPlaying = true;
        isPaused = false;
        completedChunks = clampedIndex;

        // If the target chunk at the front of the queue was spilled to IndexedDB, hydrate the front batch immediately
        if (pendingAudioQueue[0] && !pendingAudioQueue[0].pcm && pendingAudioQueue[0].spilledKey) {
          await hydratePendingQueueFromSwap(activeSessionId, 8);
        }

        schedulePendingAudioChunks();

        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: true,
          isPaused: false,
          isConverting: Boolean(activeGenerationPromise && !isConversionComplete),
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
  const voiceChanged = options.voice && options.voice !== currentVoice;
  const speedChanged = options.speed && options.speed !== currentSpeed;
  const sameCompletedBook = Boolean(
    isConversionComplete &&
    text &&
    text === currentSourceText &&
    !voiceChanged &&
    !speedChanged &&
    !options.clearCache
  );
  const preserveConversion = Boolean((options.preserveConversionComplete && isConversionComplete) || sameCompletedBook);
  const savedConversionComplete = preserveConversion;

  // Pre-split text using smart sentence- and paragraph-aware chunking (or reuse on seek)
  const smartChunks = (options.reuseSmartChunks && currentSmartChunks.length > 0)
    ? currentSmartChunks
    : splitTextIntoSmartChunks(text, {
        firstChunkTarget: 180,
        normalChunkTarget: 250,
        maxChunkLimit: 300
      });

  stopAudioPlayback(false, false);
  abortGeneration = false;
  isGenerationDone = false;
  isConversionComplete = savedConversionComplete;
  const sessionId = ++activeSessionId;

  currentSourceText = text || currentSourceText;
  if (options.title !== undefined) currentTitle = options.title;
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
    isConverting: !savedConversionComplete,
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

      // Stream chunks continuously at full ~10x WebGPU speed using the pre-split stream
      for await (const chunk of model.stream(splitter, { voice: currentVoice, speed: currentSpeed })) {
        if (abortGeneration || activeSessionId !== sessionId) break;

        const rawPcm = chunk.audio?.audio;
        if (!rawPcm || rawPcm.length === 0) {
          continue;
        }

        const globalChunkIndex = startChunkIndex + localIndex;
        localIndex++;
        nextGeneratorChunkIndex = globalChunkIndex + 1;

        const sampleRate = chunk.audio.sampling_rate || 24000;
        const isParagraphEnd = splitter.chunkMetadata[localIndex - 1]?.isParagraphEnd ?? false;

        // 1. Trim excessive silence padding from neural vocoder output for seamless streaming
        const cleanPcm = trimAudioSilence(rawPcm, sampleRate, 20, 40);
        // Convert once to compact 16-bit PCM (cuts RAM footprint by 50% and accelerates MP3 encoding)
        const int16Pcm = float32ToInt16(cleanPcm);

        totalScheduledChunks++;

        // 2. PRIORITY #1: Enqueue and schedule into Web Audio API IMMEDIATELY if streaming is active
        if (isPlaying) {
          const inRamCount = countInRamQueueChunks();
          let queueItem;
          if (!hasSpilledQueueChunks() && inRamCount < MAX_RAM_QUEUE_CHUNKS) {
            queueItem = {
              pcm: int16Pcm,
              spilledKey: null,
              chunkIndex: globalChunkIndex,
              text: chunk.text,
              isParagraphEnd,
              sampleRate
            };
          } else {
            // Spill overflow chunks (>64 sentences ahead) to IndexedDB swap so JS RAM stays flat (~30MB)
            const swapKey = `swap_${sessionId}_${globalChunkIndex}`;
            const saved = await saveSpilledPcmChunk(swapKey, int16Pcm);
            queueItem = {
              pcm: saved ? null : int16Pcm,
              spilledKey: saved ? swapKey : null,
              chunkIndex: globalChunkIndex,
              text: chunk.text,
              isParagraphEnd,
              sampleRate
            };
          }

          pendingAudioQueue.push(queueItem);

          // Seed initial chunks into pcmChunkCache for instant backward seeking right from the start
          if (pcmChunkCache.size < MAX_PCM_CACHE_CHUNKS && queueItem.pcm) {
            pcmChunkCache.set(globalChunkIndex, { ...queueItem });
          }

          // Schedule into Web Audio API if lookahead buffer (<45s) needs filling
          schedulePendingAudioChunks();
        }

        // 3. Yield briefly to macrotask queue once Web Audio lookahead is buffered,
        // guaranteeing 0ms latency for the 40ms karaoke monitor and user controls before MP3 encoding
        if (!isPlaying || isPaused || activeSources.length >= 2) {
          await new Promise(r => setTimeout(r, 12));
          if (abortGeneration || activeSessionId !== sessionId) break;
        }

        // 4. Feed compact Int16 PCM directly into incremental MP3 encoder
        if (progressiveMp3Encoder) {
          try {
            progressiveMp3Encoder.feed(int16Pcm);
          } catch (encErr) {
            console.warn('Error en codificador progresivo MP3:', encErr);
          }
        }

        chunkTexts.push(chunk.text);
        currentChunkTexts = chunkTexts;

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
          isConverting: !savedConversionComplete,
          totalChunks: totalScheduledChunks,
          ...(localIndex === 1 ? { chunks: currentSmartChunks.length > 0 ? currentSmartChunks : chunkTexts } : {}),
          conversionProgress: conversionPct,
          convertedChunks: convertedChunks,
          totalExpectedChunks: totalExpectedChunks,
          isConversionComplete: isConversionComplete
        }).catch(() => {});

        // If user stopped streaming AND there is no background MP3 conversion to finish, exit loop
        if (!isPlaying && !progressiveMp3Encoder) {
          break;
        }

        // Macrotask yield between chunks to keep karaoke and audio callbacks 100% responsive
        await new Promise(r => setTimeout(r, 10));
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
          isConverting: false,
          totalChunks: totalExpectedChunks,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100),
          convertedChunks: isConversionComplete ? totalExpectedChunks : convertedChunks,
          totalExpectedChunks: totalExpectedChunks,
          isConversionComplete: isConversionComplete
        }).catch(() => {});
      }

      // If all audio already finished playing before generation loop concluded (and not paused)
      if (isPlaying && !isPaused && completedChunks >= totalScheduledChunks && activeSources.length === 0 && pendingAudioQueue.length === 0) {
        isPlaying = false;
        clearSpilledPcmChunks().catch(() => {});
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAYBACK_STATE,
          isPlaying: false,
          isPaused: false,
          isConverting: false,
          finished: true,
          isConversionComplete: isConversionComplete
        }).catch(() => {});
      }
    } catch (err) {
      if (activeSessionId === sessionId) {
        console.error('Synthesis error during streaming:', err);
        stopAudioPlayback(false, false);
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

    // If the front chunk was spilled to IndexedDB and not yet hydrated in RAM, trigger hydration and wait
    if (!pendingAudioQueue[0].pcm && pendingAudioQueue[0].spilledKey) {
      hydratePendingQueueFromSwap(activeSessionId, 16);
      break;
    }

    const item = pendingAudioQueue.shift();
    if (!item || !item.pcm) break;

    // Cache recently scheduled chunk in sliding RAM cache for 0ms Prev/Next seeking
    cachePlayedChunkInRam(item);

    const float32Pcm = int16ToFloat32(item.pcm);
    const audioBuffer = safeCreateAudioBuffer(ctx, 1, float32Pcm.length, item.sampleRate || 24000);
    audioBuffer.copyToChannel(float32Pcm, 0);

    scheduleChunkPlayback(audioBuffer, item.chunkIndex, item.text, item.isParagraphEnd);
  }

  // Proactively prefetch spilled chunks from IndexedDB when in-RAM queue drops below threshold (32 chunks ~10 min)
  if (countInRamQueueChunks() < HYDRATE_RAM_THRESHOLD) {
    hydratePendingQueueFromSwap(activeSessionId, 16);
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

    if (isGenerationDone && pendingAudioQueue.length === 0 && activeSources.length === 0) {
      isPlaying = false;
      isPaused = false;
      stopPlaybackMonitor();
      clearSpilledPcmChunks().catch(() => {});
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: false,
        isPaused: false,
        isConverting: false,
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
        const isConverting = Boolean(activeGenerationPromise && !isConversionComplete);
        sendResponse({
          isPlaying: isPlaying,
          isPaused: isPaused,
          isConverting: isConverting,
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
        stopAudioPlayback(true, false);
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
          isConverting: Boolean(activeGenerationPromise && !isConversionComplete),
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
          isConverting: Boolean(activeGenerationPromise && !isConversionComplete),
          isConversionComplete: isConversionComplete,
          totalExpectedChunks: totalExpectedChunks,
          convertedChunks: convertedChunks,
          conversionProgress: isConversionComplete ? 100 : Math.round((convertedChunks / (totalExpectedChunks || 1)) * 100)
        }).catch(() => {});
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.STOP_PLAYBACK: {
        const shouldReset = Boolean(message.reset);
        const keepBackgroundConversion = !shouldReset && Boolean(activeGenerationPromise && progressiveMp3Encoder && !isConversionComplete);
        stopAudioPlayback(shouldReset, keepBackgroundConversion);
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
