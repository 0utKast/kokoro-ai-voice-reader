/**
 * Constants & Voice Definitions for Kokoro AI Voice Reader
 */

export const DEFAULT_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export const KOKORO_VOICES = [
  // Español
  { id: "ef_dora", name: "Dora", lang: "es", langLabel: "Español", gender: "Femenina", desc: "Voz en español — Natural, expresiva y fluida" },
  { id: "em_alex", name: "Alex", lang: "es", langLabel: "Español", gender: "Masculino", desc: "Voz en español — Articulada y equilibrada" },
  { id: "em_santa", name: "Santa", lang: "es", langLabel: "Español", gender: "Masculino", desc: "Voz en español — Cálida y reposada" },

  // American English - Female
  { id: "af_heart", name: "Heart", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Voz principal - Máxima calidad y calidez" },
  { id: "af_sky", name: "Sky", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Expresiva, natural y dinámica" },
  { id: "af_bella", name: "Bella", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Suave, melódica y agradable" },
  { id: "af_nicole", name: "Nicole", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Íntima, clara y relajada" },
  { id: "af_sarah", name: "Sarah", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Conversacional y fluida" },
  { id: "af_nova", name: "Nova", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Moderna y ágil" },
  { id: "af_alloy", name: "Alloy", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Neutra y profesional" },
  { id: "af_aoede", name: "Aoede", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Estilo narrativo" },
  { id: "af_jessica", name: "Jessica", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Casual y cercana" },
  { id: "af_kore", name: "Kore", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Sosegada y calmada" },
  { id: "af_river", name: "River", lang: "en-us", langLabel: "English (US)", gender: "Female", desc: "Tranquila y pausada" },

  // American English - Male
  { id: "am_adam", name: "Adam", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Enérgico, directo y seguro" },
  { id: "am_michael", name: "Michael", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Neutro, estilo documental" },
  { id: "am_eric", name: "Eric", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Firme y articulado" },
  { id: "am_fenrir", name: "Fenrir", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Grave y rotundo" },
  { id: "am_liam", name: "Liam", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Cálido y expresivo" },
  { id: "am_echo", name: "Echo", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Resonante y profundo" },
  { id: "am_onyx", name: "Onyx", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Voz profunda y formal" },
  { id: "am_puck", name: "Puck", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Juvenil y animado" },
  { id: "am_santa", name: "Santa", lang: "en-us", langLabel: "English (US)", gender: "Male", desc: "Afable y reposado" },

  // British English - Female
  { id: "bf_emma", name: "Emma", lang: "en-gb", langLabel: "English (UK)", gender: "Female", desc: "Británica refinada y elocuente" },
  { id: "bf_isabella", name: "Isabella", lang: "en-gb", langLabel: "English (UK)", gender: "Female", desc: "Británica elegante" },
  { id: "bf_alice", name: "Alice", lang: "en-gb", langLabel: "English (UK)", gender: "Female", desc: "Británica clara y nítida" },
  { id: "bf_lily", name: "Lily", lang: "en-gb", langLabel: "English (UK)", gender: "Female", desc: "Británica dulce" },

  // British English - Male
  { id: "bm_george", name: "George", lang: "en-gb", langLabel: "English (UK)", gender: "Male", desc: "Británico clásico y solemne" },
  { id: "bm_lewis", name: "Lewis", lang: "en-gb", langLabel: "English (UK)", gender: "Male", desc: "Británico formal y pausado" },
  { id: "bm_daniel", name: "Daniel", lang: "en-gb", langLabel: "English (UK)", gender: "Male", desc: "Británico profesional" },
  { id: "bm_fable", name: "Fable", lang: "en-gb", langLabel: "English (UK)", gender: "Male", desc: "Británico narrador" }
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
  preferredDevice: "webgpu",
  dtype: "fp32",
  autoOpenSidePanel: true,
  karaokeHighlight: true,
  showSelectionPill: false
};

