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

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Error al guardar audio Blob en IndexedDB'));

    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error('Transacción fallida al guardar audio'));
  });
}

/**
 * Retrieves an audio record from IndexedDB by id.
 * @param {string} id
 * @returns {Promise<{ id: string, blob: Blob, format: string, size: number, updatedAt: number } | null>}
 */
export async function getAudioBlob(id) {
  if (!id) return null;

  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Error al recuperar audio Blob de IndexedDB'));

    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error('Transacción fallida al leer audio'));
  });
}

/**
 * Deletes an audio record from IndexedDB.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteAudioBlob(id) {
  if (!id) return true;

  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const req = store.delete(id);

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Error al eliminar audio Blob de IndexedDB'));

    tx.oncomplete = () => db.close();
  });
}

/**
 * Clears all audio records from IndexedDB to free space.
 * @returns {Promise<boolean>}
 */
export async function clearAudioBlobs() {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const req = store.clear();

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Error al limpiar almacén de audio IndexedDB'));

    tx.oncomplete = () => db.close();
  });
}
