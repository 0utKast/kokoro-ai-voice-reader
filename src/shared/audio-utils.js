/**
 * Audio Utilities: Text Chunking & WAV Encoding
 */

/**
 * Splits text into natural sentence and clause chunks optimal for Kokoro-82M TTS.
 * Kokoro works best with 10-35 words per chunk for instant streaming response.
 */
export function splitTextIntoChunks(text, maxWordsPerChunk = 25) {
  if (!text || typeof text !== 'string') return [];

  // Normalize whitespace
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  if (!cleanText) return [];

  // Split into rough sentences using regex that respects punctuation and quotation
  const rawSentences = cleanText.match(/[^.!?\n]+[.!?]+|\S[^\n.!?]+$/g) || [cleanText];
  const chunks = [];

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const words = trimmed.split(/\s+/);
    if (words.length <= maxWordsPerChunk) {
      chunks.push({
        text: trimmed,
        wordCount: words.length
      });
    } else {
      // Split large sentence by commas, colons or semicolons
      const subParts = trimmed.split(/([,;:]\s+)/);
      let currentChunk = "";
      let currentWords = 0;

      for (let i = 0; i < subParts.length; i++) {
        const part = subParts[i];
        const partWordCount = part.trim().split(/\s+/).filter(Boolean).length;

        if (currentWords + partWordCount > maxWordsPerChunk && currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            wordCount: currentWords
          });
          currentChunk = part;
          currentWords = partWordCount;
        } else {
          currentChunk += part;
          currentWords += partWordCount;
        }
      }

      if (currentChunk.trim().length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          wordCount: currentWords
        });
      }
    }
  }

  return chunks;
}

/**
 * Encodes Float32Array PCM audio chunks into a valid 16-bit Mono WAV Blob.
 * Default sample rate for Kokoro is 24000 Hz.
 */
export function encodeWAV(audioBuffers, sampleRate = 24000) {
  // Calculate total length
  let totalLength = 0;
  for (const buf of audioBuffers) {
    totalLength += buf.length;
  }

  // Merge into single Float32Array
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const buf of audioBuffers) {
    merged.set(buf, offset);
    offset += buf.length;
  }

  // Create WAV header & 16-bit PCM buffer
  const buffer = new ArrayBuffer(44 + merged.length * 2);
  const view = new DataView(buffer);

  // Helper to write ASCII string
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + merged.length * 2, true); // File length - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, merged.length * 2, true); // Subchunk2Size

  // Write 16-bit PCM samples
  let sampleIndex = 44;
  for (let i = 0; i < merged.length; i++) {
    // Clamp to [-1.0, 1.0]
    let s = Math.max(-1, Math.min(1, merged[i]));
    // Convert to 16-bit signed integer
    view.setInt16(sampleIndex, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    sampleIndex += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Encodes Float32Array PCM audio chunks into a valid MP3 Blob using lamejs.
 * Kokoro default sample rate is 24000 Hz. Mono speech at 64kbps provides
 * stellar acoustic clarity with ~82% smaller file size than uncompressed WAV,
 * ideal for long books and full audio documents.
 */
export function encodeMP3(audioBuffers, sampleRate = 24000, kbps = 64) {
  const lame = globalThis.lamejs || (typeof window !== 'undefined' ? window.lamejs : null);
  if (!lame || !lame.Mp3Encoder) {
    throw new Error('El codificador MP3 (lamejs) no está disponible en este entorno.');
  }

  // Calculate total length
  let totalLength = 0;
  for (const buf of audioBuffers) {
    totalLength += buf.length;
  }

  if (totalLength === 0) {
    throw new Error('No hay muestras de audio para codificar a MP3.');
  }

  // Merge into single Int16Array
  const samples = new Int16Array(totalLength);
  let offset = 0;
  for (const buf of audioBuffers) {
    for (let i = 0; i < buf.length; i++) {
      let s = Math.max(-1, Math.min(1, buf[i]));
      samples[offset + i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    offset += buf.length;
  }

  // MP3 encoder for mono channel
  const mp3encoder = new lame.Mp3Encoder(1, sampleRate, kbps);
  const mp3Data = [];
  const blockSize = 1152;

  for (let i = 0; i < samples.length; i += blockSize) {
    const chunk = samples.subarray(i, i + blockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const flushBuf = mp3encoder.flush();
  if (flushBuf.length > 0) {
    mp3Data.push(flushBuf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

