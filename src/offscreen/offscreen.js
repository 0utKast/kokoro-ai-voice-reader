/**
 * Kokoro AI Voice Reader - Offscreen Audio & WebGPU Engine
 * Runs Kokoro-82M inference on WebGPU and streams seamless audio via Web Audio API.
 */

import { MESSAGE_TYPES, DEFAULT_MODEL_ID, DEFAULT_SETTINGS } from '../shared/constants.js';
import { splitTextIntoChunks, encodeWAV } from '../shared/audio-utils.js';

// --- State Variables ---
let audioCtx = null;
let gainNode = null;
let kokoroModel = null;
let isModelLoading = false;
let currentDevice = 'webgpu'; // 'webgpu' or 'cpu'

// Playback Queue State
let isPlaying = false;
let isPaused = false;
let activeSources = [];
let nextStartTime = 0;
let playbackStartTime = 0;
let pauseOffset = 0;
let currentChunks = [];
let currentChunkIndex = 0;
let accumulatedBuffers = [];
let currentVoice = DEFAULT_SETTINGS.selectedVoice;
let currentSpeed = DEFAULT_SETTINGS.speed;
let currentVolume = DEFAULT_SETTINGS.volume;
let abortGeneration = false;

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
    return { supported: false, reason: "navigator.gpu is not available in this browser" };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: "No compatible WebGPU adapter found" };
    }
    return { supported: true, name: adapter.info?.device || "WebGPU Compatible Device" };
  } catch (err) {
    return { supported: false, reason: err.message };
  }
}

// 3. Lazy Load Transformers.js / Kokoro Engine
async function initKokoroEngine(preferredDevice = 'webgpu') {
  if (kokoroModel) return kokoroModel;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return kokoroModel;
  }

  isModelLoading = true;
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.MODEL_PROGRESS,
    status: 'initializing',
    message: 'Verificando aceleración WebGPU...'
  }).catch(() => {});

  const gpuCheck = await verifyWebGPUSupport();
  currentDevice = (preferredDevice === 'webgpu' && gpuCheck.supported) ? 'webgpu' : 'cpu';

  try {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MODEL_PROGRESS,
      status: 'loading',
      device: currentDevice,
      message: `Cargando modelo Kokoro-82M (${currentDevice.toUpperCase()})...`
    }).catch(() => {});

    // Import transformers from vendor or CDN fallback
    let transformers;
    try {
      transformers = await import('../libs/transformers.js');
    } catch {
      // Dynamic fallback for browser environments
      transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3');
    }

    const { KokoroTTS } = transformers;
    if (KokoroTTS) {
      kokoroModel = await KokoroTTS.from_pretrained(DEFAULT_MODEL_ID, {
        dtype: currentDevice === 'webgpu' ? 'fp32' : 'q8',
        device: currentDevice,
        progress_callback: (progress) => {
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.MODEL_PROGRESS,
            status: 'downloading',
            progress: progress
          }).catch(() => {});
        }
      });
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
      error: err.message
    }).catch(() => {});
    throw err;
  } finally {
    isModelLoading = false;
  }
}

// 4. Playback Management
function stopAudioPlayback() {
  abortGeneration = true;
  isPlaying = false;
  isPaused = false;
  nextStartTime = 0;
  pauseOffset = 0;
  currentChunkIndex = 0;
  currentChunks = [];

  // Stop and disconnect all scheduled audio nodes
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
    isPaused: false
  }).catch(() => {});
}

async function playText(text, options = {}) {
  stopAudioPlayback();
  abortGeneration = false;

  currentVoice = options.voice || currentVoice;
  currentSpeed = options.speed || currentSpeed;
  currentVolume = options.volume ?? currentVolume;

  const ctx = getAudioContext();
  if (gainNode) {
    gainNode.gain.value = currentVolume;
  }

  // Split text into natural chunks for fast streaming
  currentChunks = splitTextIntoChunks(text);
  if (currentChunks.length === 0) return;

  isPlaying = true;
  isPaused = false;
  accumulatedBuffers = [];
  nextStartTime = ctx.currentTime + 0.05; // Short lead-in
  playbackStartTime = ctx.currentTime;

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    isPlaying: true,
    isPaused: false,
    totalChunks: currentChunks.length,
    chunks: currentChunks.map(c => c.text)
  }).catch(() => {});

  try {
    // Ensure engine is ready
    await initKokoroEngine(options.device || currentDevice);

    // Process and synthesize chunks in background pipeline
    for (let i = 0; i < currentChunks.length; i++) {
      if (abortGeneration) break;

      const chunk = currentChunks[i];
      currentChunkIndex = i;

      // Synthesize chunk audio
      let audioResult;
      if (kokoroModel?.generate) {
        audioResult = await kokoroModel.generate(chunk.text, {
          voice: currentVoice
        });
      } else {
        // Fallback simulation for testing pipeline
        audioResult = {
          audio: new Float32Array(Math.floor(24000 * Math.max(1, chunk.wordCount * 0.35))),
          sampling_rate: 24000
        };
      }

      if (abortGeneration) break;

      const rawPcm = audioResult.audio || audioResult;
      accumulatedBuffers.push(rawPcm);

      // Create Web Audio Buffer
      const audioBuffer = ctx.createBuffer(1, rawPcm.length, 24000);
      audioBuffer.copyToChannel(rawPcm, 0);

      // Schedule seamless gapless playback
      scheduleChunkPlayback(audioBuffer, i, chunk.text);
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
  const startTime = Math.max(ctx.currentTime, nextStartTime);
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
    const idx = activeSources.indexOf(source);
    if (idx !== -1) activeSources.splice(idx, 1);

    // If last chunk ended, finalize playback
    if (chunkIndex === currentChunks.length - 1 && activeSources.length === 0) {
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
        sendResponse({ success: true, chunkCount: currentChunks.length });
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
        if (accumulatedBuffers.length === 0) {
          sendResponse({ error: "No audio generated yet." });
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
        sendResponse({ received: true });
        break;
    }
  })();

  return true; // Keep channel open
});

console.log('Kokoro Offscreen Audio Engine Initialized.');
