/**
 * IndexedDB Cache Manager
 *
 * Tracks which models have been downloaded and cached by Transformers.js,
 * stores metadata (size, last-used timestamp) and exposes helpers for
 * the "Cache" management tab in the UI.
 *
 * Transformers.js itself uses the Cache API (or OPFS) under the hood, this
 * module wraps an IndexedDB store for our own bookkeeping on top.
 */

const DB_NAME = "zero-cost-ai-cache";
const DB_VERSION = 1;
const STORE = "models";

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Register a model as cached.
 * @param {{ id: string, name: string, task: string, sizeBytes?: number }} meta
 */
export async function registerModel(meta) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      ...meta,
      cachedAt: Date.now(),
      lastUsed: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update the lastUsed timestamp for a model.
 * @param {string} id
 */
export async function touchModel(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, lastUsed: Date.now() });
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Return all registered models, sorted by lastUsed descending.
 * @returns {Promise<Array>}
 */
export async function listModels() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = req.result.sort((a, b) => b.lastUsed - a.lastUsed);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove a single model entry from our index.
 * @param {string} id
 */
export async function removeModel(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear our entire IndexedDB store AND the Cache API storage used by
 * Transformers.js (cache name = "transformers-cache").
 */
export async function clearAll() {
  // 1. Clear our IndexedDB bookkeeping
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 2. Delete the Transformers.js Cache API cache
  if ("caches" in self) {
    const names = await caches.keys();
    for (const name of names) {
      if (name.includes("transformers")) {
        await caches.delete(name);
      }
    }
  }
}

/**
 * Format bytes into human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
