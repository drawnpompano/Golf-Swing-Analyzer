/* IndexedDB wrapper for storing swing sessions (video blob + annotations). */
const SwingDB = (() => {
  const DB_NAME = 'swing-analyzer';
  const DB_VERSION = 1;
  const STORE = 'sessions';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function makeId() {
    return `swing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function createSession({ videoBlob, fps, thumbnail, name }) {
    const now = Date.now();
    const session = {
      id: makeId(),
      name: name || `Swing ${new Date(now).toLocaleDateString()}`,
      createdAt: now,
      updatedAt: now,
      fps: fps || 30,
      videoBlob,
      thumbnail: thumbnail || null,
      annotations: {} // frameIndex (string) -> array of shapes
    };
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.add(session);
      req.onsuccess = () => resolve(session);
      req.onerror = () => reject(req.error);
    });
  }

  async function getSession(id) {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllSessions() {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function updateSession(id, patch) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) return resolve(null);
        const updated = Object.assign(existing, patch, { updatedAt: Date.now() });
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async function deleteSession(id) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { createSession, getSession, getAllSessions, updateSession, deleteSession };
})();
