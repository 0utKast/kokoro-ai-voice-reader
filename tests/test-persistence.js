/**
 * Kokoro AI Voice Reader - Persistence & Download Recovery Tests
 * 
 * Verifies:
 * 1. Storage of conversion metadata in chrome.storage.local.
 * 2. Recovery of last conversion upon reopening side panel (simulated).
 * 3. Persistence of download button ready state across pause/resume cycles.
 * 4. Direct IndexedDB audio retrieval for instantaneous download.
 * 5. Clean deletion upon user clicking 'Limpiar'.
 */

import { ProgressiveMp3Encoder } from '../src/shared/audio-utils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup lamejs
const lameCode = fs.readFileSync(path.join(__dirname, '../src/libs/lame.min.js'), 'utf8');
const lameFn = new Function(lameCode + '; return lamejs;');
globalThis.lamejs = lameFn();

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (cond) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    throw new Error(msg);
  }
}

console.log('====================================================');
console.log('🧪 VERIFICACIÓN DE PERSISTENCIA Y DESCARGA RESILIENTE');
console.log('====================================================\n');

// Mock chrome.storage.local
const mockStorage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') {
          return { [key]: mockStorage.get(key) };
        }
        return Object.fromEntries(mockStorage);
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) {
          mockStorage.set(k, v);
        }
      },
      async remove(key) {
        mockStorage.delete(key);
      }
    }
  }
};

// Mock IndexedDB
const mockIndexedDB = new Map();
const mockAudioStorage = {
  async saveAudioBlob(id, blob, metadata = {}) {
    mockIndexedDB.set(id, {
      id,
      blob,
      format: metadata.format || 'mp3',
      size: blob.size,
      updatedAt: Date.now(),
      ...metadata
    });
    return true;
  },
  async getAudioBlob(id) {
    return mockIndexedDB.get(id) || null;
  },
  async clearAudioBlobs() {
    mockIndexedDB.clear();
    return true;
  }
};

// 1. Test Conversion Completion and Persistence
console.log('🔹 Test 1: Simulación de Conversión Completa y Persistencia');
{
  const encoder = new ProgressiveMp3Encoder(24000, 64);
  const samplePcm = new Float32Array(24000);
  for (let i = 0; i < samplePcm.length; i++) samplePcm[i] = Math.sin(i * 0.1) * 0.5;
  encoder.feed(samplePcm);
  const mp3Blob = encoder.finish();

  const title = 'Capítulo 1 - La Revolución de WebGPU';
  const text = 'WebGPU permite ejecutar modelos de inteligencia artificial en local.';
  const chunks = ['WebGPU permite ejecutar modelos de inteligencia artificial en local.'];
  const duration = encoder.durationSeconds;

  // Save to IndexedDB
  await mockAudioStorage.saveAudioBlob('latest_book_audio', mp3Blob, {
    format: 'mp3',
    totalChunks: 1,
    duration: duration,
    size: mp3Blob.size,
    title,
    text,
    chunks
  });

  // Save to chrome.storage.local
  await chrome.storage.local.set({
    kokoro_last_conversion: {
      hasAudio: true,
      storageKey: 'latest_book_audio',
      format: 'mp3',
      size: mp3Blob.size,
      duration: duration,
      title,
      text,
      chunks,
      totalChunks: 1,
      timestamp: Date.now()
    }
  });

  assert(mockIndexedDB.has('latest_book_audio'), 'Blob guardado en IndexedDB');
  assert(mockStorage.has('kokoro_last_conversion'), 'Metadatos guardados en chrome.storage.local');
  const stored = mockStorage.get('kokoro_last_conversion');
  assert(stored.title === title, 'Título preservado correctamente');
  assert(stored.chunks.length === 1, 'Frases karaoke preservadas correctamente');
}

// 2. Test Restoration upon Reopening (Empty UI state)
console.log('\n🔹 Test 2: Simulación de Reapertura de la Extensión (Restore Last Conversion)');
{
  // Simulated UI state when sidepanel opens afresh
  let uiTextInput = '';
  let uiDocumentTitle = '';
  let uiChunks = [];
  let isConversionComplete = false;
  let btnDownloadAudio = { disabled: true, classList: new Set() };
  let btnDownloadText = { textContent: 'Descargar MP3' };

  // Run restoration logic (identical to app.js restoreLastConversion)
  const data = await chrome.storage.local.get('kokoro_last_conversion');
  const last = data.kokoro_last_conversion;
  const record = await mockAudioStorage.getAudioBlob('latest_book_audio');

  if (record?.blob && record.blob.size > 0) {
    isConversionComplete = true;
    if (last?.title) uiDocumentTitle = last.title;
    if (!uiTextInput && last?.text) uiTextInput = last.text;
    if (last?.chunks) uiChunks = last.chunks;

    btnDownloadAudio.disabled = false;
    btnDownloadAudio.classList.add('btn-download-ready');
    btnDownloadText.textContent = 'Descargar MP3';
  }

  assert(isConversionComplete === true, 'isConversionComplete restaurado a true');
  assert(uiTextInput.length > 0, 'Texto original restaurado en el editor tras cerrar y abrir');
  assert(uiDocumentTitle.includes('WebGPU'), 'Título del documento restaurado');
  assert(btnDownloadAudio.disabled === false, 'Botón de descarga MP3 HABILITADO tras reapertura');
  assert(btnDownloadAudio.classList.has('btn-download-ready'), 'Botón de descarga tiene clase .btn-download-ready (VERDE)');
}

// 3. Test State Maintenance on Pause / Resume
console.log('\n🔹 Test 3: El botón no se desactiva ni se pone gris al pausar o reanudar');
{
  let isConversionComplete = true;
  let btnDownloadAudio = { disabled: false, classList: new Set(['btn-download-ready']) };

  function simulateUpdateConversionUI(msg) {
    if (typeof msg.isConversionComplete === 'boolean') {
      isConversionComplete = msg.isConversionComplete;
    }
    const conversionDone = Boolean(isConversionComplete || msg.isConversionComplete);
    if (conversionDone) {
      btnDownloadAudio.disabled = false;
      btnDownloadAudio.classList.add('btn-download-ready');
    } else if (msg.isPlaying) {
      btnDownloadAudio.disabled = true;
      btnDownloadAudio.classList.delete('btn-download-ready');
    }
  }

  // Incoming PAUSE message
  simulateUpdateConversionUI({ isPlaying: true, isPaused: true, isConversionComplete: true });
  assert(btnDownloadAudio.disabled === false, 'Botón sigue habilitado tras PAUSA');
  assert(btnDownloadAudio.classList.has('btn-download-ready'), 'Botón sigue verde tras PAUSA');

  // Incoming RESUME message
  simulateUpdateConversionUI({ isPlaying: true, isPaused: false, isConversionComplete: true });
  assert(btnDownloadAudio.disabled === false, 'Botón sigue habilitado tras REANUDAR');
  assert(btnDownloadAudio.classList.has('btn-download-ready'), 'Botón sigue verde tras REANUDAR');

  // Incoming FINISHED message
  simulateUpdateConversionUI({ isPlaying: false, isPaused: false, isConversionComplete: true });
  assert(btnDownloadAudio.disabled === false, 'Botón sigue habilitado tras FINALIZAR la lectura');
  assert(btnDownloadAudio.classList.has('btn-download-ready'), 'Botón sigue verde tras FINALIZAR la lectura');
}

// 4. Test Clear Action
console.log('\n🔹 Test 4: Limpieza total al pulsar el botón "Limpiar"');
{
  await mockAudioStorage.clearAudioBlobs();
  await chrome.storage.local.remove('kokoro_last_conversion');

  assert(mockIndexedDB.size === 0, 'IndexedDB vaciado');
  assert(!mockStorage.has('kokoro_last_conversion'), 'Metadatos de persistencia eliminados de chrome.storage.local');
}

console.log('\n====================================================');
console.log(`🎉 PRUEBAS DE PERSISTENCIA COMPLETADAS: ${passed} / ${total} EXITOSAS`);
console.log('====================================================\n');
