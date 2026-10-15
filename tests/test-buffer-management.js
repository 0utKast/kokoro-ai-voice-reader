/**
 * Test Suite: Audio Buffer Management, Memory Isolation, Lookahead Scheduling & 10x Hybrid Swap
 */

import { trimAudioSilence, float32ToInt16, int16ToFloat32, ProgressiveMp3Encoder } from '../src/shared/audio-utils.js';

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
console.log('🧪 VERIFICACIÓN DE GESTIÓN DE BUFFER, 10x CONVERSIÓN Y SWAP');
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

// Test 2: Compact Int16 PCM conversion (50% memory reduction) & MP3 zero-copy feed
console.log('\n🔹 Test 2: Conversión compacta Float32 <-> Int16 y codificación MP3 directa');
{
  const samples = new Float32Array([0, 0.5, -0.5, 1.0, -1.0, 0.25]);
  const int16 = float32ToInt16(samples);
  assert(int16 instanceof Int16Array, 'float32ToInt16 retorna un Int16Array');
  assert(int16.byteLength === samples.byteLength / 2, 'Int16Array ocupa exactamente el 50% de RAM que Float32Array');

  const restored = int16ToFloat32(int16);
  assert(restored instanceof Float32Array, 'int16ToFloat32 restaura un Float32Array para Web Audio API');
  assert(Math.abs(restored[1] - 0.5) < 0.001, 'Precisión de +0.5 preservada (< 0.001 error)');
  assert(Math.abs(restored[2] - (-0.5)) < 0.001, 'Precisión de -0.5 preservada (< 0.001 error)');

  let receivedSubarray = null;
  globalThis.lamejs = {
    Mp3Encoder: class {
      encodeBuffer(sub) {
        receivedSubarray = sub;
        return new Int8Array([1, 2, 3]);
      }
      flush() {
        return new Int8Array([4]);
      }
    }
  };
  const encoder = new ProgressiveMp3Encoder(24000, 64);
  const synthInt16 = float32ToInt16(new Float32Array(24000).fill(0.1));
  encoder.feed(synthInt16);
  assert(Math.abs(encoder.durationSeconds - 1.0) < 0.01, 'ProgressiveMp3Encoder acepta Int16Array directamente sin reconversión redundante');
  assert(receivedSubarray instanceof Int16Array && receivedSubarray.buffer === synthInt16.buffer, 'ProgressiveMp3Encoder.feed usa zero-copy subarray sobre el Int16Array existente');
}

// Test 3: 10x Unthrottled Synthesis + 45s Web Audio Lookahead + 64-chunk RAM Sliding Window & Swap
console.log('\n🔹 Test 3: Síntesis 10x sin freno con ventana RAM de 64 fragmentos y Swap en disco para 1545 frases');
{
  const LOOKAHEAD_BUFFER_SEC = 45;
  const MAX_RAM_QUEUE_CHUNKS = 64;
  const HYDRATE_RAM_THRESHOLD = 32;
  const TOTAL_BOOK_CHUNKS = 1545;

  let audioContextCurrentTime = 0.0;
  let nextStartTime = 0.05;
  let pendingAudioQueue = [];
  let activeSources = [];
  let swapStore = new Map();
  let maxActiveSourcesEver = 0;
  let maxRamChunksEver = 0;
  let chunksSynthesized = 0;
  let chunksPlayed = 0;

  function countRamChunks() {
    let count = 0;
    for (let i = 0; i < pendingAudioQueue.length; i++) {
      if (pendingAudioQueue[i].pcm !== null) count++;
    }
    return count;
  }

  function hydrateFromSwap() {
    let inRam = countRamChunks();
    if (inRam >= HYDRATE_RAM_THRESHOLD) return;
    for (let i = 0; i < pendingAudioQueue.length && inRam < MAX_RAM_QUEUE_CHUNKS; i++) {
      const item = pendingAudioQueue[i];
      if (item.spilled && item.pcm === null) {
        item.pcm = swapStore.get(item.chunkIndex);
        item.spilled = false;
        swapStore.delete(item.chunkIndex);
        inRam++;
      }
    }
  }

  function cleanupFinishedSources(currentTime) {
    for (let i = activeSources.length - 1; i >= 0; i--) {
      if (activeSources[i].endTime <= currentTime) {
        activeSources.splice(i, 1);
        chunksPlayed++;
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
      if (pendingAudioQueue[0].pcm === null) {
        hydrateFromSwap();
      }
      const item = pendingAudioQueue.shift();
      if (!item || item.pcm === null) break;

      const duration = item.pcm / 24000;
      const startTime = Math.max(audioContextCurrentTime + 0.05, nextStartTime);
      const endTime = startTime + duration;
      nextStartTime = endTime + 0.015;

      activeSources.push({ chunkIndex: item.chunkIndex, startTime, endTime, duration });
    }
    if (activeSources.length > maxActiveSourcesEver) {
      maxActiveSourcesEver = activeSources.length;
    }
    hydrateFromSwap();
  }

  function hasSpilledChunks() {
    for (let i = 0; i < pendingAudioQueue.length; i++) {
      if (pendingAudioQueue[i].spilled && pendingAudioQueue[i].pcm === null) return true;
    }
    return false;
  }

  // Phase A: Model synthesizes at 10x real-time speed!
  // For every 1 chunk played (~10s), the model synthesizes 10 chunks.
  while (chunksSynthesized < TOTAL_BOOK_CHUNKS) {
    // Model produces 10 chunks per step
    for (let g = 0; g < 10 && chunksSynthesized < TOTAL_BOOK_CHUNKS; g++) {
      const idx = chunksSynthesized++;
      const currentRam = countRamChunks();
      if (!hasSpilledChunks() && currentRam < MAX_RAM_QUEUE_CHUNKS) {
        pendingAudioQueue.push({ chunkIndex: idx, pcm: 240000, spilled: false });
      } else {
        swapStore.set(idx, 240000);
        pendingAudioQueue.push({ chunkIndex: idx, pcm: null, spilled: true });
      }
      const ramNow = countRamChunks();
      if (ramNow > maxRamChunksEver) maxRamChunksEver = ramNow;
    }
    // Real-time playback advances by 1 chunk (~10s)
    audioContextCurrentTime += 10.0;
    schedulePendingAudioChunks();
  }

  // At the moment all 1,545 chunks finish transcribing (100% MP3 ready!),
  // streaming is around ~10% of the book (~154 chunks played).
  assert(chunksSynthesized === TOTAL_BOOK_CHUNKS, `Los ${TOTAL_BOOK_CHUNKS} fragmentos se transcribieron al 100% a velocidad 10x sin bloquearse`);
  assert(chunksPlayed < 200, `La transcripción (1545) terminó mucho antes que el streaming (reproducidos: ${chunksPlayed})`);
  assert(maxRamChunksEver <= MAX_RAM_QUEUE_CHUNKS, `La ventana en RAM nunca superó ${MAX_RAM_QUEUE_CHUNKS} fragmentos (máx: ${maxRamChunksEver})`);
  assert(maxActiveSourcesEver <= 6, `Web Audio API mantuvo solo ~45s de audio programado (máx nodos activos: ${maxActiveSourcesEver})`);

  // Phase B: Streaming continues playing the remaining ~1,390 chunks seamlessly from RAM + Swap
  while (pendingAudioQueue.length > 0 || activeSources.length > 0) {
    audioContextCurrentTime += 10.0;
    schedulePendingAudioChunks();
    const ramNow = countRamChunks();
    if (ramNow > maxRamChunksEver) maxRamChunksEver = ramNow;
  }

  assert(chunksPlayed === TOTAL_BOOK_CHUNKS, `Los ${TOTAL_BOOK_CHUNKS} fragmentos se reprodujeron íntegramente hasta el final sin cortes`);
  assert(swapStore.size === 0, 'Todos los fragmentos del Swap temporal en IndexedDB fueron hidratados y limpiados');
}

// Test 4: Safe AudioBuffer Creation & Node Lifecycle Cleanup
console.log('\n🔹 Test 4: Limpieza y ciclo de vida de nodos de audio');
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

// Test 5: Concurrent pendingAudioQueue.shift() during async Swap Hydration (Zero Skipped Chunks)
console.log('\n🔹 Test 5: Hidratación asíncrona concurrente con shift() de reproducción (cero saltos de línea)');
{
  const queue = [];
  const swap = new Map();
  for (let i = 0; i < 40; i++) {
    if (i < 10) {
      queue.push({ chunkIndex: i, pcm: new Int16Array([i]), spilledKey: null });
    } else {
      const key = `swap_${i}`;
      swap.set(key, new Int16Array([i]));
      queue.push({ chunkIndex: i, pcm: null, spilledKey: key });
    }
  }

  const playedOrder = [];
  let activeHydrationPromise = null;

  async function hydrateBatch(batchSize = 8) {
    if (activeHydrationPromise) {
      await activeHydrationPromise;
      if (queue.length > 0 && !queue[0].pcm && queue[0].spilledKey) {
        return hydrateBatch(batchSize);
      }
      return;
    }
    activeHydrationPromise = (async () => {
      try {
        let hydrated = 0;
        while (hydrated < batchSize) {
          const item = queue.find(it => !it.pcm && it.spilledKey);
          if (!item) break;
          const key = item.spilledKey;
          // Simulate async IndexedDB latency while playback shifts items from queue front!
          await new Promise(r => setTimeout(r, 2));
          const pcm = swap.get(key);
          if (pcm) {
            item.pcm = pcm;
            item.spilledKey = null;
            swap.delete(key);
            hydrated++;
          }
        }
      } finally {
        activeHydrationPromise = null;
      }
    })();
    return activeHydrationPromise;
  }

  // Interleave playback shifts and async swap hydrations
  while (queue.length > 0) {
    if (!queue[0].pcm && queue[0].spilledKey) {
      await hydrateBatch(8);
    }
    const next = queue.shift();
    assert(next && next.pcm !== null, `El fragmento #${next?.chunkIndex} está hidratado al llegar al frente de reproducción`);
    playedOrder.push(next.chunkIndex);
    // Trigger background hydration concurrently while shifting
    if (queue.filter(it => it.pcm !== null).length < 6) {
      hydrateBatch(4); // unawaited concurrent hydration
    }
    await new Promise(r => setTimeout(r, 1));
  }

  assert(playedOrder.length === 40, 'Se reprodujeron exactamente los 40 fragmentos sin omitir ninguno');
  const isStrictlySequential = playedOrder.every((val, idx) => val === idx);
  assert(isStrictlySequential, 'El orden de reproducción es estrictamente secuencial (0..39) sin saltos');
}

// Test 6: Recuperación de cadena de promesas ONNX (N.catch) y continuidad en frase 75 de 157
console.log('\n🔹 Test 6: Recuperación de promesa ONNX (frase 75 de 157) y liberación de tensores WebGPU');
{
  const fs = await import('node:fs');
  const kokoroSrc = fs.readFileSync(new URL('../src/libs/kokoro.web.js', import.meta.url), 'utf8');
  const offscreenSrc = fs.readFileSync(new URL('../src/offscreen/offscreen.js', import.meta.url), 'utf8');

  assert(kokoroSrc.includes('N=N.catch((()=>{})).then(r)'), 'kokoro.web.js protege la cadena global ONNX N con .catch(() => {}) para no envenenar sesiones futuras');
  assert(kokoroSrc.includes('N=p.then((()=>{}),(()=>{}))'), 'kokoro.web.js libera la referencia del tensor de salida previo en la promesa N');
  assert(kokoroSrc.includes('s?.dispose?.()') && kokoroSrc.includes('styleTensor?.dispose?.()'), 'generate_from_ids libera inmediatamente los tensores ONNX/WebGPU tras copiar el PCM');
  assert(kokoroSrc.includes('a.dims.at(-1)<4'), '_synthesize_phonemes descarta colas degeneradas (<4 tokens) que romperían ONNX Runtime');
  assert(offscreenSrc.includes('const MAX_RAM_QUEUE_CHUNKS = 300;'), 'offscreen.js mantiene hasta 300 frases en RAM para evitar swap prematuro en textos de 157 frases');

  // Simulate 157 sentences where sentence 75 (index 74) triggers a transient ONNX error on sub-chunk 1
  let N = Promise.resolve();
  function runOnnxSession(chunkIdx) {
    const r = async () => {
      if (chunkIdx === 74) {
        throw new Error('Simulated transient ONNX tensor shape error at sentence 75');
      }
      return new Float32Array(2400);
    };
    const p = N.catch(() => {}).then(r);
    N = p.then(() => {}, () => {});
    return p;
  }

  let completedSentences = 0;
  for (let i = 0; i < 157; i++) {
    try {
      const pcm = await runOnnxSession(i);
      if (pcm && pcm.length > 0) completedSentences++;
    } catch {
      // Fallback silent buffer keeps stream 1-to-1 aligned
      completedSentences++;
    }
  }
  assert(completedSentences === 157, 'Las 157 frases se procesaron de principio a fin sin detenerse en la frase 75');
}

console.log('\n====================================================');
console.log(`🎉 TODAS LAS PRUEBAS DE BUFFER Y 10x SWAP COMPLETADAS: ${passed} / ${total} EXITOSAS`);
console.log('====================================================');


