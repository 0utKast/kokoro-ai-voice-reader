/**
 * Kokoro AI Voice Reader - Offscreen Audio & WebGPU Engine
 * Runs Kokoro-82M inference on WebGPU and streams seamless audio via Web Audio API.
 */

import { KokoroTTS, TextSplitterStream, env } from '../libs/kokoro.web.js';
import { MESSAGE_TYPES, DEFAULT_MODEL_ID, DEFAULT_SETTINGS } from '../shared/constants.js';
import { encodeWAV } from '../shared/audio-utils.js';

// Configure local WASM paths for ONNX Runtime Web
if (env) {
  env.wasmPaths = chrome.runtime.getURL('src/libs/');
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
let accumulatedBuffers = [];
let currentVoice = DEFAULT_SETTINGS.selectedVoice;
let currentSpeed = DEFAULT_SETTINGS.speed;
let currentVolume = DEFAULT_SETTINGS.volume;
let abortGeneration = false;
let totalScheduledChunks = 0;
let completedChunks = 0;
let isGenerationDone = false;
let activeSessionId = 0;
let isConversionComplete = false;
let totalExpectedChunks = 0;
let convertedChunks = 0;

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
    audioCtx.resume();
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

// 4. Playback Controls
function stopAudioPlayback() {
  abortGeneration = true;
  isPlaying = false;
  isPaused = false;
  isGenerationDone = false;
  if (!isConversionComplete) {
    accumulatedBuffers = [];
  }
  nextStartTime = 0;
  totalScheduledChunks = 0;
  completedChunks = 0;

  for (const src of activeSources) {
    try {
      src.stop(0);
      src.disconnect();
    } catch {}
  }
  activeSources = [];

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: false,
    isPaused: false,
    isConversionComplete: isConversionComplete,
    conversionProgress: isConversionComplete ? 100 : 0
  }).catch(() => {});
}

async function playText(text, options = {}) {
  stopAudioPlayback();
  abortGeneration = false;
  isGenerationDone = false;
  isConversionComplete = false;
  const sessionId = ++activeSessionId;

  currentVoice = options.voice || currentVoice;
  currentSpeed = options.speed || currentSpeed;
  currentVolume = options.volume ?? currentVolume;

  const ctx = getAudioContext();
  if (gainNode) {
    gainNode.gain.value = currentVolume;
  }

  isPlaying = true;
  isPaused = false;
  accumulatedBuffers = [];
  nextStartTime = ctx.currentTime + 0.05;
  totalScheduledChunks = 0;
  completedChunks = 0;
  convertedChunks = 0;

  // Pre-split text using TextSplitterStream to determine exact sentence count
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  totalExpectedChunks = splitter.sentences.length;

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: true,
    isPaused: false,
    conversionProgress: 0,
    convertedChunks: 0,
    totalExpectedChunks: totalExpectedChunks,
    isConversionComplete: false
  }).catch(() => {});

  try {
    const model = await initKokoroEngine(options.device || currentDevice);

    let chunkIndex = 0;
    const chunkTexts = [];

    // Stream chunks continuously with KokoroTTS using the pre-split stream
    for await (const chunk of model.stream(splitter, { voice: currentVoice, speed: currentSpeed })) {
      if (abortGeneration || activeSessionId !== sessionId) break;

      const rawPcm = chunk.audio?.audio;
      if (!rawPcm || rawPcm.length === 0) {
        continue;
      }

      accumulatedBuffers.push(rawPcm);
      chunkTexts.push(chunk.text);

      totalScheduledChunks++;
      convertedChunks++;
      const conversionPct = totalExpectedChunks > 0 
        ? Math.min(100, Math.round((convertedChunks / totalExpectedChunks) * 100)) 
        : 100;

      // Update side panel with streaming audio and live conversion progress
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: true,
        isPaused: false,
        totalChunks: totalScheduledChunks,
        chunks: chunkTexts,
        conversionProgress: conversionPct,
        convertedChunks: convertedChunks,
        totalExpectedChunks: totalExpectedChunks,
        isConversionComplete: false
      }).catch(() => {});

      const audioBuffer = ctx.createBuffer(1, rawPcm.length, chunk.audio.sampling_rate || 24000);
      audioBuffer.copyToChannel(rawPcm, 0);

      scheduleChunkPlayback(audioBuffer, chunkIndex++, chunk.text);
    }

    if (!abortGeneration && activeSessionId === sessionId) {
      isGenerationDone = true;
      isConversionComplete = true;

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: isPlaying,
        isPaused: isPaused,
        totalChunks: totalScheduledChunks,
        chunks: chunkTexts,
        conversionProgress: 100,
        convertedChunks: totalScheduledChunks,
        totalExpectedChunks: totalScheduledChunks,
        isConversionComplete: true
      }).catch(() => {});
    }

    // If all audio already finished playing before generation loop concluded
    if (completedChunks >= totalScheduledChunks && activeSources.length === 0) {
      isPlaying = false;
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: false,
        isPaused: false,
        finished: true,
        isConversionComplete: true
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Synthesis error during streaming:', err);
    stopAudioPlayback();
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_ERROR,
      error: `Error durante la síntesis: ${err.message}`
    }).catch(() => {});
  }
}

function scheduleChunkPlayback(audioBuffer, chunkIndex, text) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = currentSpeed;
  source.connect(gainNode);

  const duration = audioBuffer.duration / currentSpeed;
  const startTime = Math.max(ctx.currentTime + 0.05, nextStartTime);
  source.start(startTime);
  nextStartTime = startTime + duration;

  activeSources.push(source);

  // Notify UI when this specific chunk starts playing
  const delayMs = Math.max(0, (startTime - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (isPlaying && !abortGeneration) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.CURRENT_CHUNK_INDEX,
        chunkIndex: chunkIndex,
        text: text,
        duration: duration
      }).catch(() => {});
    }
  }, delayMs);

  source.onended = () => {
    completedChunks++;
    const idx = activeSources.indexOf(source);
    if (idx !== -1) activeSources.splice(idx, 1);

    if (isGenerationDone && completedChunks >= totalScheduledChunks && activeSources.length === 0) {
      isPlaying = false;
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PLAYBACK_STATE,
        isPlaying: false,
        isPaused: false,
        finished: true
      }).catch(() => {});
    }
  };
}

// 5. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
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

      case MESSAGE_TYPES.PLAY_TEXT: {
        await playText(message.text, {
          voice: message.voice,
          speed: message.speed,
          volume: message.volume,
          device: message.device
        });
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.PAUSE_PLAYBACK: {
        if (audioCtx && audioCtx.state === 'running') {
          await audioCtx.suspend();
          isPaused = true;
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.PLAYBACK_STATE,
            isPlaying: true,
            isPaused: true
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.RESUME_PLAYBACK: {
        if (audioCtx && audioCtx.state === 'suspended') {
          await audioCtx.resume();
          isPaused = false;
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.PLAYBACK_STATE,
            isPlaying: true,
            isPaused: false
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      case MESSAGE_TYPES.STOP_PLAYBACK: {
        stopAudioPlayback();
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
        currentSpeed = message.speed;
        for (const s of activeSources) {
          try { s.playbackRate.value = currentSpeed; } catch {}
        }
        sendResponse({ success: true });
        break;
      }

      case "DOWNLOAD_WAV": {
        if (!isConversionComplete) {
          sendResponse({
            error: `La conversión no ha finalizado todavía (${convertedChunks} de ${totalExpectedChunks} frases sintetizadas). Podrás descargar el archivo WAV cuando se complete el 100%.`
          });
          return;
        }
        if (accumulatedBuffers.length === 0) {
          sendResponse({ error: "No hay audio generado todavía." });
          return;
        }
        const wavBlob = encodeWAV(accumulatedBuffers, 24000);
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ dataUrl: reader.result });
        };
        reader.readAsDataURL(wavBlob);
        break;
      }

      default:
        break;
    }
  })();

  return true;
});

console.log('Kokoro Offscreen Engine (WebGPU + Local WASM & Fallback) Ready.');
