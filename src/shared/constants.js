/**
 * Constants & Voice Definitions for Kokoro AI Voice Reader
 */

export const DEFAULT_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export const KOKORO_VOICES = [
  // Spanish Voices
  { id: "ef_dora", name: "Dora", lang: "es", langLabel: "Español", gender: "Femenino", desc: "Cálida, expresiva y narrativa" },
  { id: "em_alex", name: "Alex", lang: "es", langLabel: "Español", gender: "Masculino", desc: "Claro, profesional y didáctico" },
  { id: "em_santa", name: "Santa", lang: "es", langLabel: "Español", gender: "Masculino", desc: "Profundo y sosegado" },
  
  // English Voices (US)
  { id: "af_sky", name: "Sky", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Expressive & energetic" },
  { id: "af_bella", name: "Bella", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Smooth & melodic" },
  { id: "af_nicole", name: "Nicole", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Soft & intimate" },
  { id: "af_sarah", name: "Sarah", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Casual & conversational" },
  { id: "am_adam", name: "Adam", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Direct & focused" },
  { id: "am_michael", name: "Michael", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Neutral & documentary" },

  // English Voices (UK)
  { id: "bf_emma", name: "Emma", lang: "en-gb", langLabel: "English (UK)", gender: "Female", desc: "Refined & articulate" },
  { id: "bm_george", name: "George", lang: "en-gb", langLabel: "English (UK)", gender: "Male", desc: "Warm & classical" }
];

export const MESSAGE_TYPES = {
  // Offscreen lifecycle
  CHECK_ENGINE: "CHECK_ENGINE",
  ENGINE_READY: "ENGINE_READY",
  
  // Model state
  LOAD_MODEL: "LOAD_MODEL",
  MODEL_PROGRESS: "MODEL_PROGRESS",
  MODEL_LOADED: "MODEL_LOADED",
  MODEL_ERROR: "MODEL_ERROR",

  // Playback control
  PLAY_TEXT: "PLAY_TEXT",
  PAUSE_PLAYBACK: "PAUSE_PLAYBACK",
  RESUME_PLAYBACK: "RESUME_PLAYBACK",
  STOP_PLAYBACK: "STOP_PLAYBACK",
  SEEK_PLAYBACK: "SEEK_PLAYBACK",
  SET_SPEED: "SET_SPEED",
  SET_VOLUME: "SET_VOLUME",

  // Playback & Karaoke feedback
  PLAYBACK_STATE: "PLAYBACK_STATE",
  PLAYBACK_PROGRESS: "PLAYBACK_PROGRESS",
  CURRENT_CHUNK_INDEX: "CURRENT_CHUNK_INDEX",
  AUDIO_READY: "AUDIO_READY",

  // Content script
  EXTRACT_ARTICLE: "EXTRACT_ARTICLE",
  ARTICLE_EXTRACTED: "ARTICLE_EXTRACTED",
  READ_SELECTION: "READ_SELECTION",
  HIGHLIGHT_CHUNK: "HIGHLIGHT_CHUNK",
  CLEAR_HIGHLIGHTS: "CLEAR_HIGHLIGHTS"
};

export const DEFAULT_SETTINGS = {
  selectedVoice: "ef_dora",
  speed: 1.0,
  volume: 1.0,
  preferredDevice: "webgpu", // 'webgpu' or 'cpu' (WASM)
  dtype: "fp32",
  autoOpenSidePanel: true,
  karaokeHighlight: true
};
