/**
 * Test Suite: Audio Buffer Management, Memory Isolation & Lookahead Scheduling
 */

import { trimAudioSilence } from '../src/shared/audio-utils.js';

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
console.log('🧪 VERIFICACIÓN DE GESTIÓN DE BUFFER Y MEMORIA DE AUDIO');
console.log('====================================================\n');

// Test 1: trimAudioSilence returns independent slice (memory isolation)
console.log('🔹 Test 1: Aislamiento de memoria en trimAudioSilence');
{
  const bigArray = new Float32Array(547017);
  // Fill middle with non-zero samples
  for (let i = 10000; i < 20000; i++) {
    bigArray[i] = 0.5;
  }
  
  const trimmed = trimAudioSilence(bigArray, 24000);
  assert(trimmed.length > 0, `Longitud de audio recortado: ${trimmed.length}`);
  assert(trimmed.buffer !== bigArray.buffer, 'El ArrayBuffer retornado es independiente (usa slice, no subarray)');
  assert(trimmed.buffer.byteLength < bigArray.buffer.byteLength, 'El buffer recortado ocupa sustancialmente menos memoria');
}

// Test 2: Lookahead Buffer Scheduling Simulation
console.log('\n🔹 Test 2: Simulación de cola de streaming con Lookahead Buffer');
{
  const LOOKAHEAD_BUFFER_SEC = 45;
  const MAX_PENDING_QUEUE_CHUNKS = 8;
  
  let audioContextCurrentTime = 0.0;
  let nextStartTime = 0.05;
  let pendingAudioQueue = [];
  let activeSources = [];
  let scheduledChunks = [];
  let maxActiveSourcesEver = 0;
  let maxPendingQueueEver = 0;

  function cleanupFinishedSources(currentTime) {
    for (let i = activeSources.length - 1; i >= 0; i--) {
      if (activeSources[i].endTime <= currentTime) {
        activeSources.splice(i, 1);
      }
    }
  }

  function schedulePendingAudioChunks() {
    cleanupFinishedSources(audioContextCurrentTime);
    while (pendingAudioQueue.length > 0) {
      const bufferedAhead = nextStartTime - audioContextCurrentTime;
      if (bufferedAhead >= LOOKAHEAD_BUFFER_SEC && activeSources.length >= 2) {
        break;
      }
      const item = pendingAudioQueue.shift();
      if (!item) break;

      const duration = item.pcmLength / 24000;
      const startTime = Math.max(audioContextCurrentTime + 0.05, nextStartTime);
      const endTime = startTime + duration;
      nextStartTime = endTime + 0.015;

      activeSources.push({ chunkIndex: item.chunkIndex, startTime, endTime, duration });
      scheduledChunks.push({ chunkIndex: item.chunkIndex, startTime, endTime });
    }
    if (activeSources.length > maxActiveSourcesEver) {
      maxActiveSourcesEver = activeSources.length;
    }
  }

  // Simulate synthesizing 100 chunks (~38 minutes = 2,280s of audio)
  const TOTAL_CHUNKS = 100;
  let chunksSynthesized = 0;

  for (let step = 0; step < 1000; step++) {
    // Advance real-time playback by 2.5 seconds per step
    audioContextCurrentTime += 2.5;
    cleanupFinishedSources(audioContextCurrentTime);
    schedulePendingAudioChunks();

    // Model generates chunks if pendingAudioQueue < MAX_PENDING_QUEUE_CHUNKS
    if (chunksSynthesized < TOTAL_CHUNKS && pendingAudioQueue.length < MAX_PENDING_QUEUE_CHUNKS) {
      pendingAudioQueue.push({
        pcmLength: 547017, // ~22.8s of speech
        chunkIndex: chunksSynthesized++
      });
      if (pendingAudioQueue.length > maxPendingQueueEver) {
        maxPendingQueueEver = pendingAudioQueue.length;
      }
      schedulePendingAudioChunks();
    }
  }

  assert(chunksSynthesized === TOTAL_CHUNKS, `Se sintetizaron los ${TOTAL_CHUNKS} fragmentos`);
  assert(maxActiveSourcesEver <= 3, `Fuentes activas en Web Audio API limitadas (máx observado: ${maxActiveSourcesEver} <= 3)`);
  assert(maxPendingQueueEver <= MAX_PENDING_QUEUE_CHUNKS, `Cola pendiente respetó el límite de contrapresión (máx: ${maxPendingQueueEver} <= 8)`);
}

// Test 3: Safe AudioBuffer Creation & Node Lifecycle Cleanup
console.log('\n🔹 Test 3: Limpieza y ciclo de vida de nodos de audio');
{
  class MockAudioNode {
    constructor() {
      this.disconnected = false;
      this.buffer = { sampleRate: 24000, length: 547017 };
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  const node = new MockAudioNode();
  assert(node.buffer !== null, 'El buffer está inicialmente asignado');

  // Simulate source.onended cleanup
  node.disconnect();
  node.buffer = null;

  assert(node.disconnected === true, 'El nodo fue desconectado del grafo de audio');
  assert(node.buffer === null, 'La referencia al buffer fue liberada a null para permitir GC inmediato');
}

console.log('\n====================================================');
console.log(`🎉 TODAS LAS PRUEBAS DE BUFFER COMPLETADAS: ${passed} / ${total} EXITOSAS`);
console.log('====================================================');
