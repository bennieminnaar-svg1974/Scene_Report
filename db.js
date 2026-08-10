/* IndexedDB storage for captures. Photos are stored as Blobs (not base64)
   to avoid burning ~33% extra storage quota for the whole draft lifetime;
   base64 encoding only happens once, at export time. Signatures are small
   PNG data URIs and are kept as plain strings for simplicity. */

const DB_NAME = "scene_capture_db";
const DB_VERSION = 1;
const STORE = "captures";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("status", "status");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveCapture(capture) {
  return withStore("readwrite", (store) => {
    const req = capture.id ? store.put(capture) : store.add(capture);
    return reqToPromise(req);
  }).then((res) => res);
}

async function getCapture(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return reqToPromise(tx.objectStore(STORE).get(id));
}

async function listCaptures() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqToPromise(tx.objectStore(STORE).getAll());
  return all.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

async function deleteCapture(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
}

async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return null;
}
