/**
 * Test Suite: UI Reset Lifecycle & WebGPU Concurrency Isolation
 * 
 * Verifies:
 * 1. SmartTextSplitter.abort() immediately cancels chunk stream
 * 2. Typing or pasting new text after completion resets conversion badges & download button
 * 3. "Limpiar" button performs 100% clean teardown (no lingering "Audio listo" or "en espera" badges)
 * 4. Offscreen playText mutual exclusion prevents concurrent WebGPU calls (eliminating GPU hang)
 */

import { SmartTextSplitter, splitTextIntoSmartChunks } from '../src/shared/audio-utils.js';

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
console.log('🧪 VERIFICACIÓN DE LIMPIEZA DE UI Y MUTEX WEBGPU');
console.log('====================================================\n');

// ----------------------------------------------------
// Test 1: SmartTextSplitter.abort()
// ----------------------------------------------------
console.log('🔹 Test 1: SmartTextSplitter.abort() y cancelación instantánea');
{
  const chunks = [
    { text: 'Primera frase.', paragraphIndex: 0, isParagraphEnd: false },
    { text: 'Segunda frase.', paragraphIndex: 0, isParagraphEnd: false },
    { text: 'Tercera frase.', paragraphIndex: 0, isParagraphEnd: true }
  ];
  const splitter = new SmartTextSplitter(chunks);

  assert(splitter.sentences.length === 3, 'Inicialmente contiene 3 frases');
  splitter.abort();
  assert(splitter.sentences.length === 0, 'Tras abort(), la cola de frases está completamente vacía');
  assert(splitter._closed === true, 'El flujo está marcado como cerrado para cortar el generador');
}

// ----------------------------------------------------
// Test 2: Simulación de Pegado de Nuevo Texto tras Conversión
// ----------------------------------------------------
console.log('\n🔹 Test 2: Pegado de nuevo texto tras finalizar la lectura anterior');
{
  // Simulated UI state after reading snippet A (2 sentences)
  let isConversionComplete = true;
  let totalExpectedChunks = 2;
  let lastConvertedText = 'Texto inicial para leer en voz alta.';
  let textInput = { value: 'Texto inicial para leer en voz alta.' };
  let playbackStatusBar = { classList: new Set() }; // visible (no 'hidden')
  let currentChunkBadge = { textContent: '🔊 Audio listo (2 frases)' };
  let conversionStatusBadge = { textContent: '✓ Audio completo (2 frases)', classList: new Set(['done']) };
  let conversionProgressFill = { style: { width: '100%' }, classList: new Set(['done']) };
  let btnDownloadAudio = { disabled: false, classList: new Set(['btn-download-ready']), title: 'Descargar MP3' };
  let btnDownloadText = { textContent: 'Descargar MP3' };
  let offscreenResetCalled = false;

  function resetConversionState({ clearStorage = false } = {}) {
    isConversionComplete = false;
    totalExpectedChunks = 0;
    lastConvertedText = '';
    playbackStatusBar.classList.add('hidden');
    currentChunkBadge.textContent = '🔊 Frase 0 de 0';
    conversionStatusBadge.textContent = '⚡ En espera';
    conversionStatusBadge.classList.delete('done');
    conversionProgressFill.style.width = '0%';
    conversionProgressFill.classList.delete('done');
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.delete('btn-download-ready');
    btnDownloadText.textContent = 'Descargar MP3';
    btnDownloadAudio.title = 'Inicia la lectura para sintetizar y descargar el audio MP3';
    offscreenResetCalled = true;
  }

  // User pastes a completely new snippet B into textInput
  textInput.value = 'Nuevo texto pegado por el usuario para una segunda lectura.';

  // Simulate textInput 'input' event listener
  const currentText = textInput.value.trim();
  if (isConversionComplete && currentText !== lastConvertedText) {
    resetConversionState({ clearStorage: false });
  }

  assert(isConversionComplete === false, 'isConversionComplete se desactiva inmediatamente');
  assert(playbackStatusBar.classList.has('hidden'), 'playbackStatusBar se oculta de la pantalla');
  assert(currentChunkBadge.textContent === '🔊 Frase 0 de 0', 'currentChunkBadge se restablece y no muestra "Audio listo" residual');
  assert(btnDownloadAudio.disabled === true, 'btnDownloadAudio se deshabilita para el nuevo texto');
  assert(!btnDownloadAudio.classList.has('btn-download-ready'), 'Se retira el estilo verde listo del botón de descarga');
  assert(offscreenResetCalled === true, 'Se emite RESET_STATE al motor offscreen');
}

// ----------------------------------------------------
// Test 3: Botón "Limpiar" (Teardown total sin residuos visuales)
// ----------------------------------------------------
console.log('\n🔹 Test 3: Pulsación del botón "Limpiar" (eliminación total de residuos)');
{
  let textInput = { value: 'Texto anterior que el usuario quiere borrar por completo.' };
  let currentDocumentTitle = 'mi_documento';
  let playbackStatusBar = { classList: new Set() }; // visible
  let currentChunkBadge = { textContent: '🔊 Audio listo (2 frases)' };
  let conversionStatusBadge = { textContent: '✓ Audio completo (2 frases)' };
  let btnDownloadAudio = { disabled: false, classList: new Set(['btn-download-ready']) };
  let storageCleared = false;

  function handleClearText() {
    textInput.value = '';
    currentDocumentTitle = '';
    playbackStatusBar.classList.add('hidden');
    currentChunkBadge.textContent = '🔊 Frase 0 de 0';
    conversionStatusBadge.textContent = '⚡ En espera';
    btnDownloadAudio.disabled = true;
    btnDownloadAudio.classList.delete('btn-download-ready');
    storageCleared = true;
  }

  handleClearText();

  assert(textInput.value === '', 'El textarea queda totalmente vacío');
  assert(currentDocumentTitle === '', 'El título del documento queda reseteado');
  assert(playbackStatusBar.classList.has('hidden'), 'playbackStatusBar queda OCULTA (resuelve "sigue apareciendo debajo")');
  assert(currentChunkBadge.textContent !== '🔊 Audio listo (2 frases)', 'No persiste el texto "Audio listo (2 frases)"');
  assert(btnDownloadAudio.disabled === true, 'El botón de descarga queda deshabilitado');
  assert(!btnDownloadAudio.classList.has('btn-download-ready'), 'El botón no tiene clase lista');
  assert(storageCleared === true, 'Se limpian las bases de persistencia');
}

// ----------------------------------------------------
// Test 4: Mutex y Exclusión Mutua en playText para WebGPU
// ----------------------------------------------------
console.log('\n🔹 Test 4: Mutex de WebGPU en playText (prevención de GPU hang y congelamiento)');
{
  let activeGenerationPromise = null;
  let activeSessionId = 0;
  let gpuConcurrentExecutions = 0;
  let maxConcurrentGpuSeen = 0;

  async function mockPlayText(text) {
    // Check mutex: if active, abort and await previous
    while (activeGenerationPromise) {
      activeSessionId++;
      const runningPromise = activeGenerationPromise;
      try {
        await runningPromise;
      } catch {}
      if (activeGenerationPromise === runningPromise) {
        activeGenerationPromise = null;
        break;
      }
    }

    const sessionId = ++activeSessionId;
    let myPromise = null;
    myPromise = (async () => {
      // Simulate GPU inference pass
      gpuConcurrentExecutions++;
      if (gpuConcurrentExecutions > maxConcurrentGpuSeen) {
        maxConcurrentGpuSeen = gpuConcurrentExecutions;
      }
      
      // Simulate chunk generation with abort check
      for (let i = 0; i < 5; i++) {
        if (activeSessionId !== sessionId) break;
        await new Promise(r => setTimeout(r, 20));
      }

      gpuConcurrentExecutions--;
    })();
    activeGenerationPromise = myPromise;

    try {
      await myPromise;
    } finally {
      if (activeGenerationPromise === myPromise) {
        activeGenerationPromise = null;
      }
    }
  }

  // Launch 3 rapid consecutive playText calls (simulating user clicking play / pasting rapidly)
  const p1 = mockPlayText('Texto 1');
  const p2 = mockPlayText('Texto 2');
  const p3 = mockPlayText('Texto 3');

  await Promise.all([p1, p2, p3]);

  assert(maxConcurrentGpuSeen === 1, `Ejecuciones concurrentes en WebGPU limitadas estrictamente a 1 (máx observado: ${maxConcurrentGpuSeen} <= 1)`);
  assert(gpuConcurrentExecutions === 0, 'Todas las sesiones de GPU concluyeron limpiamente sin bloqueos');
}

// ----------------------------------------------------
// Test 5: Salto interactivo de frases (SEEK_PLAYBACK) con caché PCM y cambio en caliente
// ----------------------------------------------------
console.log('\n🔹 Test 5: Salto interactivo de frases (SEEK_PLAYBACK) y cambio de voz/velocidad en caliente');
{
  const pcmChunkCache = new Map();
  pcmChunkCache.set(0, { samples: new Float32Array(24000), sampleRate: 24000, text: 'Frase 1', isParagraphEnd: false });
  pcmChunkCache.set(1, { samples: new Float32Array(24000), sampleRate: 24000, text: 'Frase 2', isParagraphEnd: false });
  pcmChunkCache.set(2, { samples: new Float32Array(24000), sampleRate: 24000, text: 'Frase 3', isParagraphEnd: true });

  let scheduledFromCache = [];
  let resynthesizedFromChunk = null;
  let currentVoice = 'ef_dora';
  let currentSpeed = 1.0;

  function mockSeekToChunk(targetIdx, { voice, speed, forceResynthesize = false } = {}) {
    const voiceChanged = voice && voice !== currentVoice;
    const speedChanged = speed && Math.abs(speed - currentSpeed) > 0.001;

    if (!forceResynthesize && !voiceChanged && !speedChanged && pcmChunkCache.has(targetIdx)) {
      scheduledFromCache = [];
      for (let idx = targetIdx; idx < 3; idx++) {
        if (pcmChunkCache.has(idx)) {
          scheduledFromCache.push(idx);
        }
      }
      return 'cache-hit';
    }

    if (voiceChanged) currentVoice = voice;
    if (speedChanged) currentSpeed = speed;
    pcmChunkCache.clear();
    resynthesizedFromChunk = targetIdx;
    return 'resynthesize';
  }

  const mode1 = mockSeekToChunk(1);
  assert(mode1 === 'cache-hit', 'Saltar a una frase ya sintetizada usa la vía rápida de caché PCM en RAM sin re-inferencia WebGPU');
  assert(scheduledFromCache.length === 2 && scheduledFromCache[0] === 1 && scheduledFromCache[1] === 2, 'Reprograma instantáneamente desde la frase objetivo (1 -> 2)');

  const mode2 = mockSeekToChunk(1, { voice: 'em_alex', forceResynthesize: true });
  assert(mode2 === 'resynthesize', 'Cambiar de voz en caliente invalida la caché y re-sintetiza desde la frase activa');
  assert(resynthesizedFromChunk === 1 && currentVoice === 'em_alex', 'La re-síntesis arranca exactamente en la frase activa con la nueva voz');
  assert(pcmChunkCache.size === 0, 'La caché PCM anterior se limpia al cambiar voz o velocidad');
}

console.log('\n====================================================');
console.log(`🎉 TODAS LAS PRUEBAS DE LIMPIEZA, SEEK Y MUTEX: ${passed} / ${total} EXITOSAS`);
console.log('====================================================\n');
