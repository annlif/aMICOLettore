// Archivio di aMICOLatino sul dispositivo (IndexedDB). Nulla viene inviato altrove.

const DB_NAME = 'amicolatino';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // versioni: testo latino diviso in frasi, con la traduzione di Micol per ogni frase
      if (!db.objectStoreNames.contains('versioni')) db.createObjectStore('versioni', { keyPath: 'id' });
      // le mie parole (vocabolario personale)
      if (!db.objectStoreNames.contains('parole')) db.createObjectStore('parole', { keyPath: 'id' });
      // voci aggiunte al vocabolario e parole "da completare"
      if (!db.objectStoreNames.contains('voci')) db.createObjectStore('voci', { keyPath: 'id' });
      // audio di "Ascolta" già generato
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operazione annullata'));
  });
}

const crud = (store) => ({
  get: (id) => run(store, 'readonly', (s) => s.get(id)),
  put: (rec) => run(store, 'readwrite', (s) => s.put(rec)),
  all: () => run(store, 'readonly', (s) => s.getAll()),
  del: (id) => run(store, 'readwrite', (s) => s.delete(id)),
  clear: () => run(store, 'readwrite', (s) => s.clear()),
});

export const db = {
  versioni: crud('versioni'),
  parole: crud('parole'),
  voci: crud('voci'),
  audio: crud('audio'),
};

/** Chiede al sistema di non cancellare i dati quando c'è poco spazio (iPad/Safari). */
export async function askPersistence() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* non disponibile */ }
}

// ---------- impostazioni (localStorage) ----------
const SETTINGS_KEY = 'amicolatino.settings';
const DEFAULTS = { latinSize: 24, lastView: 'versioni' };
export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* spazio non disponibile */ } }
