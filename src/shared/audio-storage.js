/**
 * Kokoro AI Voice Reader - Audio Storage (IndexedDB)
 * 
 * Provides high-capacity, zero-copy binary storage for synthesized audio Blobs.
 * Shared seamlessly across Extension Pages (Side Panel, Offscreen Document, Service Worker)
 * within the chrome-extension:// origin.
 * 
 * Completely bypasses Chrome IPC (chrome.runtime.sendMessage) payload size limits (64MB)
 * and avoids base64 memory inflation, enabling effortless saving of multi-hour audiobooks.
 */

const DB_NAME = 'KokoroAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audioBlobs';

/**
 * Opens or initializes the KokoroAudioDB IndexedDB instance.
 * @returns {Promise<IDBDatabase>}
 */
function openAudioDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB no está disponible en este entorno.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(request.error || new Error('Error abriendo IndexedDB de audio'));
    };
  });
}

/**
 * Saves an audio Blob with metadata into IndexedDB.
 * @param {string} id - Unique identifier (e.g. 'latest_book_audio')
 * @param {Blob} blob - The audio Blob (MP3 or WAV)
 * @param {Object} metadata - Optional extra fields (format, totalChunks, duration, title)
 * @returns {Promise<boolean>}
 */
export async function saveAudioBlob(id, blob, metadata = {}) {
  if (!id || !blob) {
    throw new Error('saveAudioBlob: se requiere id y blob válidos.');
  }

  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      id,
      blob,
      format: metadata.format || 'mp3',
      size: blob.size,
      updatedAt: Date.now(),
      ...metadata
    };

    const req = store.put(record);

    req.onerror = () => reject(req.error || new Error('Error al guardar audio Blob en IndexedDB'));

    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Transacción fallida al guardar audio'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Transacción abortada al guardar audio'));
    };
  });
}

/**
 * Retrieves an audio record from IndexedDB by id.
 * @param {string} id
 * @returns {Promise<{ id: string, blob: Blob, format: string, size: number, updatedAt: number } | null>}
 */
export async function getAudioBlob(id) {
  if (!id) return null;

  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Error al recuperar audio Blob de IndexedDB'));

      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Transacción fallida al leer audio'));
      };
    });
  } catch (err) {
    console.warn('getAudioBlob error:', err);
    return null;
  }
}

/**
 * Deletes an audio record from IndexedDB.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteAudioBlob(id) {
  if (!id) return true;

  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Error al eliminar audio Blob de IndexedDB'));

      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Error al eliminar audio'));
      };
    });
  } catch {
    return false;
  }
}

/**
 * Clears all audio records from IndexedDB to free space.
 * @returns {Promise<boolean>}
 */
export async function clearAudioBlobs() {
  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const req = store.clear();

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Error al limpiar almacén de audio IndexedDB'));

      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Error limpiando almacén'));
      };
    });
  } catch {
    return false;
  }
}

// ============================================================================
// High-Speed Ephemeral PCM Swap Store (KokoroPcmSwapDB)
// Allows 10x WebGPU full-book transcription without accumulating GBs of PCM in RAM.
// Chunks beyond the active 64-chunk RAM window are spilled here and prefetched
// back into RAM well ahead of Web Audio playback.
// ============================================================================

const SWAP_DB_NAME = 'KokoroPcmSwapDB';
const SWAP_DB_VERSION = 1;
const SWAP_STORE_NAME = 'pcmChunks';
let cachedSwapDb = null;

function openSwapDB() {
  if (cachedSwapDb) {
    return Promise.resolve(cachedSwapDb);
  }
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB no disponible'));
    }
    const req = indexedDB.open(SWAP_DB_NAME, SWAP_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SWAP_STORE_NAME)) {
        db.createObjectStore(SWAP_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      cachedSwapDb = e.target.result;
      cachedSwapDb.onclose = () => { cachedSwapDb = null; };
      cachedSwapDb.onversionchange = () => {
        cachedSwapDb.close();
        cachedSwapDb = null;
      };
      resolve(cachedSwapDb);
    };
    req.onerror = (e) => reject(e.target.error || new Error('Error abriendo KokoroPcmSwapDB'));
  });
}

export async function saveSpilledPcmChunk(id, pcm) {
  if (!id || !pcm) return false;
  try {
    const db = await openSwapDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SWAP_STORE_NAME, 'readwrite');
      tx.objectStore(SWAP_STORE_NAME).put({ id, pcm });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getSpilledPcmChunk(id) {
  if (!id) return null;
  try {
    const db = await openSwapDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SWAP_STORE_NAME, 'readonly');
      const req = tx.objectStore(SWAP_STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result?.pcm || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteSpilledPcmChunk(id) {
  if (!id) return false;
  try {
    const db = await openSwapDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SWAP_STORE_NAME, 'readwrite');
      tx.objectStore(SWAP_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function clearSpilledPcmChunks() {
  try {
    const db = await openSwapDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SWAP_STORE_NAME, 'readwrite');
      tx.objectStore(SWAP_STORE_NAME).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

