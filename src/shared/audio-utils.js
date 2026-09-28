import { TextSplitterStream } from '../libs/kokoro.web.js';

const SPANISH_ABBREVIATIONS = [
  'Sr\\.', 'Sra\\.', 'Srta\\.', 'Dr\\.', 'Dra\\.', 'Prof\\.', 'D\\.', 'Dña\\.',
  'pág\\.', 'págs\\.', 'ej\\.', 'p\\. ej\\.', 'etc\\.', 'núm\\.', 'vol\\.', 'cap\\.', 'art\\.',
  'EE\\.UU\\.', 'EE\\. UU\\.', 'U\\.S\\.A\\.', 'a\\.C\\.', 'd\\.C\\.', 'Ud\\.', 'Uds\\.', 'Vd\\.', 'Vds\\.',
  'Gob\\.', 'Gral\\.', 'Av\\.', 'Avda\\.', 'fig\\.', 'figs\\.', 'op\\. cit\\.', 'ibid\\.'
];

/**
 * Normalizes prose text for high-fidelity speech synthesis:
 * - Unifies line breaks (\r\n -> \n)
 * - De-hyphenates words broken across line wraps (e.g. "cosmé-\nticos" -> "cosméticos")
 * - Unfolds soft line breaks within paragraphs into spaces (preserving real paragraph breaks \n\n)
 * - Normalizes excessive spacing while preserving semantic structure
 */
export function normalizeTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  let clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Join hyphenated words split across lines
  clean = clean.replace(/([\p{L}]+)-\s*\n\s*([\p{L}]+)/gu, '$1$2');

  // 2. Unfold soft linebreaks inside paragraphs while preserving paragraph breaks
  const rawParagraphs = clean.split(/\n{2,}/);
  const normalizedParagraphs = rawParagraphs.map(para => {
    const lines = para.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    let combined = lines[0];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Keep separation if line looks like a list item or heading
      if (/^[-*•\d+.)]/.test(line)) {
        combined += '\n\n' + line;
      } else if (combined.endsWith('-')) {
        combined = combined.slice(0, -1) + line;
      } else {
        combined += ' ' + line;
      }
    }
    return combined;
  }).filter(Boolean);

  return normalizedParagraphs.join('\n\n').trim();
}

/**
 * Splits prose text into complete, grammatically sound sentences.
 * Protects abbreviations, decimals, and quotation marks so no sentence is cut prematurely.
 */
export function splitTextIntoSentences(text) {
  if (!text || typeof text !== 'string') return [];

  let protectedText = text;
  const abbrevMap = new Map();
  let placeholderId = 0;

  for (const abb of SPANISH_ABBREVIATIONS) {
    const re = new RegExp('\\b' + abb, 'gi');
    protectedText = protectedText.replace(re, (match) => {
      const ph = `___ABB_${placeholderId++}___`;
      abbrevMap.set(ph, match);
      return ph;
    });
  }

  // Also protect decimal numbers (e.g. 3.14, 10.5)
  protectedText = protectedText.replace(/(\d+)\.(\d+)/g, (match) => {
    const ph = `___ABB_${placeholderId++}___`;
    abbrevMap.set(ph, match);
    return ph;
  });

  // Split on sentence boundaries: punctuation (. ! ? …) followed by space and capital/symbol/quote
  const rawSentences = protectedText.split(/(?<=[.!?…]["»\x27”)]?)\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡«"“\d])/g);

  const sentences = [];
  for (let s of rawSentences) {
    let restored = s.trim();
    if (!restored) continue;
    for (const [ph, orig] of abbrevMap) {
      restored = restored.replaceAll(ph, orig);
    }
    sentences.push(restored);
  }

  return sentences;
}

/**
 * Splits text into natural sentence-level and clause chunks optimal for Kokoro-82M TTS.
 * - Never breaks in the middle of sentences or at commas (unless sentence exceeds maxChunkLimit).
 * - Groups short sentences together up to target character length for fluent, natural neural prosody.
 * - Marks paragraph boundaries so audio playback can insert a natural paragraph pause.
 */
export function splitTextIntoSmartChunks(text, {
  firstChunkTarget = 200,
  normalChunkTarget = 350,
  maxChunkLimit = 450
} = {}) {
  const normalized = normalizeTextForSpeech(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx].trim();
    if (!para) continue;

    const sentences = splitTextIntoSentences(para);
    let currentChunk = "";

    for (const sent of sentences) {
      const s = sent.trim();
      if (!s) continue;

      const target = (chunks.length === 0 && !currentChunk) ? firstChunkTarget : normalChunkTarget;

      if (!currentChunk) {
        if (s.length > maxChunkLimit) {
          // Break oversized sentence by semicolon/colon or comma
          const subParts = s.split(/(?<=[;:\n—])\s+|(?<=[,])\s+(?=[a-záéíóúüñ])/gi);
          for (const sp of subParts) {
            if ((currentChunk + " " + sp).trim().length <= normalChunkTarget) {
              currentChunk = currentChunk ? (currentChunk + " " + sp) : sp;
            } else {
              if (currentChunk.trim()) {
                chunks.push({
                  text: currentChunk.trim(),
                  isParagraphEnd: false,
                  wordCount: currentChunk.trim().split(/\s+/).filter(Boolean).length
                });
              }
              currentChunk = sp;
            }
          }
        } else {
          currentChunk = s;
        }
      } else {
        if ((currentChunk + " " + s).length <= target) {
          currentChunk += " " + s;
        } else {
          chunks.push({
            text: currentChunk.trim(),
            isParagraphEnd: false,
            wordCount: currentChunk.trim().split(/\s+/).filter(Boolean).length
          });
          currentChunk = s;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        isParagraphEnd: true,
        wordCount: currentChunk.trim().split(/\s+/).filter(Boolean).length
      });
    }
  }

  return chunks;
}

/**
 * Backward-compatible helper for legacy chunk consumers.
 */
export function splitTextIntoChunks(text, maxWordsPerChunk = 50) {
  return splitTextIntoSmartChunks(text).map(c => ({
    text: c.text,
    wordCount: c.wordCount
  }));
}

/**
 * Custom TextSplitterStream that feeds pre-calculated smart chunks directly
 * to KokoroTTS.stream without arbitrary clause breaking.
 */
export class SmartTextSplitter extends TextSplitterStream {
  constructor(chunkItems = []) {
    super();
    this._chunkObjects = Array.isArray(chunkItems) ? chunkItems : [];
    this._sentences = this._chunkObjects.map(item => typeof item === 'string' ? item : item.text);
    this._allChunks = [...this._sentences];
    this._closed = true;
  }

  get chunkMetadata() {
    return this._chunkObjects;
  }

  get sentences() {
    return this._allChunks;
  }
}

/**
 * Trims excessive silence from neural TTS PCM waveforms to achieve seamless,
 * human-like transitions between phrases without artificial gaps.
 */
export function trimAudioSilence(pcm, sampleRate = 24000, maxLeadMs = 20, maxTrailMs = 40, threshold = 0.002) {
  if (!pcm || pcm.length === 0) return pcm;
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  if (start === pcm.length) return pcm; // entirely silent

  let end = pcm.length - 1;
  while (end > start && Math.abs(pcm[end]) < threshold) end--;

  const maxLead = Math.round((maxLeadMs * sampleRate) / 1000);
  const maxTrail = Math.round((maxTrailMs * sampleRate) / 1000);

  const finalStart = Math.max(0, start - maxLead);
  const finalEnd = Math.min(pcm.length, end + 1 + maxTrail);

  return pcm.subarray(finalStart, finalEnd);
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

