// Archivio sul dispositivo (IndexedDB) e impostazioni (localStorage).
// Tutto resta su questo iPad: nulla viene inviato altrove tranne il testo da leggere ad Azure.

const DB_NAME = 'amicolettore';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // metadati e punto di lettura di ogni documento
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      // testo estratto, pagina per pagina
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      // audio già generato da Azure, con i tempi delle parole
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

export const db = {
  getDoc: (id) => run('docs', 'readonly', (s) => s.get(id)),
  putDoc: (doc) => run('docs', 'readwrite', (s) => s.put(doc)),
  listDocs: () => run('docs', 'readonly', (s) => s.getAll()),
  getText: (id) => run('texts', 'readonly', (s) => s.get(id)),
  putText: (rec) => run('texts', 'readwrite', (s) => s.put(rec)),
  async deleteDoc(id) {
    await run('docs', 'readwrite', (s) => s.delete(id));
    await run('texts', 'readwrite', (s) => s.delete(id));
  },
  getAudio: (key) => run('audio', 'readonly', (s) => s.get(key)),
  hasAudio: async (key) => (await run('audio', 'readonly', (s) => s.count(key))) > 0,
  putAudio: (rec) => run('audio', 'readwrite', (s) => s.put(rec)),
  countAudio: () => run('audio', 'readonly', (s) => s.count()),
  clearAudio: () => run('audio', 'readwrite', (s) => s.clear()),
};

// ---------- impostazioni ----------
const SETTINGS_KEY = 'amicolettore.settings';
export const DEFAULT_SETTINGS = {
  key: '',
  region: 'westeurope',
  voice: 'it-IT-IsabellaNeural',
  rate: 1,
  fontSize: 22,
  offlineVoice: true, // usa la voce dell'iPad se manca internet
  sysVoice: '',
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* spazio non disponibile */ } }

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(safeGet(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { safeSet(SETTINGS_KEY, JSON.stringify(s)); }

// ---------- contatore caratteri inviati ad Azure (stima, per il piano F0) ----------
export const FREE_CHARS_PER_MONTH = 500_000; // piano F0: 0,5 milioni di caratteri al mese (voci neurali)
const USAGE_KEY = 'amicolettore.usage';
function monthId(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
export function getUsage() {
  try {
    const u = JSON.parse(safeGet(USAGE_KEY) || '{}');
    return u.month === monthId() ? u.chars || 0 : 0;
  } catch { return 0; }
}
export function addUsage(chars) {
  safeSet(USAGE_KEY, JSON.stringify({ month: monthId(), chars: getUsage() + chars }));
}

// ---------- utilità ----------
export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* non supportato */ }
}
