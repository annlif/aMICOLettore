// "Ascolta": legge parole e frasi latine con la voce italiana di Azure (pronuncia scolastica),
// la stessa di aMICOLettore. L'audio generato viene salvato sul dispositivo: riascoltare è gratis
// e funziona anche senza internet. Se Azure non è disponibile, usa la voce dell'iPad.
import { db } from './store.js';
import { sysVoice } from './sysvoice.js';

export const VOCI = [
  ['it-IT-IsabellaNeural', 'Isabella (femminile) – predefinita'],
  ['it-IT-ElsaNeural', 'Elsa (femminile)'],
  ['it-IT-FiammaNeural', 'Fiamma (femminile)'],
  ['it-IT-IsabellaMultilingualNeural', 'Isabella Multilingual (femminile)'],
  ['it-IT-DiegoNeural', 'Diego (maschile)'],
  ['it-IT-GiuseppeMultilingualNeural', 'Giuseppe Multilingual (maschile)'],
  ['it-IT-BenignoNeural', 'Benigno (maschile)'],
];

// ---------- impostazioni della voce ----------
const KEY = 'amicolatino.voce';
const DEFAULTS = { key: '', region: '', voice: 'it-IT-IsabellaNeural', rate: 0.9, iPad: true };
export function loadVoce() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignora */ }
  // Prima volta: se aMICOLettore ha già salvato la chiave in questo stesso archivio (Safari, computer), la riusa.
  if (!v.key) {
    try {
      const a = JSON.parse(localStorage.getItem('amicolettore.settings') || '{}');
      if (a.key && a.region) { v = { ...v, key: a.key, region: a.region, voice: a.voice || DEFAULTS.voice, from: 'amicolettore' }; saveVoce({ ...DEFAULTS, ...v }); }
    } catch { /* ignora */ }
  }
  return { ...DEFAULTS, ...v };
}
export function saveVoce(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignora */ } }

/** Legge il codice copiato da aMICOLettore ("aMICOL-voce:…"). */
export function parseVoceCode(text) {
  const m = String(text || '').trim().match(/^aMICOL-voce:([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const o = JSON.parse(atob(m[1]));
    if (typeof o.key === 'string' && o.key && typeof o.region === 'string' && o.region) return { key: o.key, region: o.region, voice: o.voice || DEFAULTS.voice };
  } catch { /* codice non valido */ }
  return null;
}

// ---------- quota (stima dei caratteri inviati ad Azure da questa app) ----------
const USAGE = 'amicolatino.usage';
const month = () => new Date().toISOString().slice(0, 7);
export function usage() {
  try { const u = JSON.parse(localStorage.getItem(USAGE) || '{}'); return u.m === month() ? u.c : 0; } catch { return 0; }
}
function addUsage(n) { try { localStorage.setItem(USAGE, JSON.stringify({ m: month(), c: usage() + n })); } catch { /* ignora */ } }

// ---------- Azure Speech ----------
let sdkPromise = null;
function loadSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/speech-sdk.js', import.meta.url).href;
    s.onload = () => (window.SpeechSDK ? resolve(window.SpeechSDK) : reject(new Error('SDK non caricato')));
    s.onerror = () => { sdkPromise = null; reject(new Error('Non riesco a caricare la libreria di Azure.')); };
    document.head.append(s);
  });
  return sdkPromise;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function azureError(details = '') {
  const d = String(details);
  if (/401|unauthori[sz]ed|authentication|invalid subscription/i.test(d)) return 'Azure non accetta la chiave: controllala nelle impostazioni.';
  if (/429|too many|throttl/i.test(d)) return 'Troppe richieste ad Azure: riprova tra qualche secondo.';
  if (/quota|403|forbidden/i.test(d)) return 'Azure ha rifiutato la richiesta: forse la quota gratuita del mese è finita.';
  if (/websocket|network|connection|1006|timeout/i.test(d) || !navigator.onLine) return 'Non riesco a collegarmi ad Azure: controlla internet.';
  return `Errore di Azure: ${d || 'sconosciuto'}`;
}

async function synthesize(text, v) {
  const S = await loadSdk();
  const cfg = S.SpeechConfig.fromSubscription(v.key.trim(), v.region.trim());
  cfg.speechSynthesisLanguage = 'it-IT';
  cfg.speechSynthesisVoiceName = v.voice;
  cfg.speechSynthesisOutputFormat = S.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  const synth = new S.SpeechSynthesizer(cfg, null); // null: l'audio lo riproduciamo noi
  const inner = /Multilingual/i.test(v.voice) ? `<lang xml:lang="it-IT">${escXml(text)}</lang>` : escXml(text);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT"><voice name="${v.voice}">${inner}</voice></speak>`;
  try {
    return await new Promise((resolve, reject) => {
      synth.speakSsmlAsync(ssml, (r) => {
        if (r.reason === S.ResultReason.SynthesizingAudioCompleted && r.audioData?.byteLength) resolve(r.audioData);
        else reject(new Error(azureError(r.errorDetails)));
      }, (e) => reject(new Error(azureError(e))));
    });
  } finally {
    try { synth.close(); } catch { /* già chiuso */ }
  }
}

// ---------- riproduzione ----------
// Stesso metodo di aMICOLettore: un solo elemento audio, "sbloccato" con un istante di silenzio
// nel momento del tocco (su iPad l'audio può partire solo da un gesto), poi caricato e avviato
// quando il file è pronto. La voce dell'iPad viene preparata solo quando serve davvero,
// perché sull'iPad può occupare l'audio e rendere muta la voce di Azure.
const el = typeof Audio !== 'undefined' ? new Audio() : null;
if (el) { el.preload = 'auto'; el.setAttribute('playsinline', ''); el.preservesPitch = true; el.webkitPreservesPitch = true; }
let blobUrl = null;
let silentUrl = null;
let unlocked = false;
function silence() {
  if (silentUrl) return silentUrl;
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}
function unlock() {
  if (!el || unlocked) return;
  unlocked = true;
  try { el.src = silence(); el.play().catch(() => {}); } catch { /* ignora */ }
}
function stop() {
  if (el) el.pause();
  sysVoice.cancel();
}
function play(audio, rate) {
  return new Promise((resolve, reject) => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }));
    const done = (ok) => { el.removeEventListener('loadedmetadata', onOk); el.removeEventListener('error', onErr); clearTimeout(t); ok ? go() : reject(new Error('L\'audio ricevuto non è valido.')); };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const t = setTimeout(() => done(el.readyState >= 1), 8000);
    const go = () => {
      sysVoice.cancel();
      el.volume = 1;
      el.defaultPlaybackRate = rate || 1;
      el.playbackRate = rate || 1;
      el.play().then(resolve, reject);
    };
    el.addEventListener('loadedmetadata', onOk);
    el.addEventListener('error', onErr);
    el.src = blobUrl;
    el.load();
  });
}

/**
 * Legge un testo latino. Restituisce 'azure' | 'cache' | 'ipad'.
 * Lancia un errore con un messaggio comprensibile se non c'è nessuna voce disponibile.
 */
export async function ascolta(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  stop();
  unlock(); // subito, prima di qualsiasi attesa
  const v = loadVoce();
  if (!v.key || !navigator.onLine) sysVoice.unlock();
  const key = await sha256(`${v.voice}\u0001${t}`);
  let audio = (await db.audio.get(key).catch(() => null))?.audio;
  let how = audio ? 'cache' : null;
  let err = null;
  if (!audio && v.key && v.region && navigator.onLine) {
    try {
      audio = await synthesize(t, v);
      addUsage(t.length);
      how = 'azure';
      db.audio.put({ key, voice: v.voice, text: t, audio, createdAt: Date.now() }).catch(() => {});
    } catch (e) { err = e; }
  }
  if (audio) {
    await play(audio, v.rate);
    return how;
  }
  if (v.iPad !== false && sysVoice.available()) {
    sysVoice.speak(t, { rate: v.rate || 1 });
    return 'ipad';
  }
  if (err) throw err;
  throw new Error(v.key ? 'Sei senza internet e questa parola non è ancora stata salvata.' : 'Per ascoltare, collega la voce di Azure nelle impostazioni (icona a forma di ingranaggio).');
}

/** Prova la voce con le impostazioni indicate (senza salvarle). */
export async function provaVoce(v) {
  stop();
  unlock();
  const audio = await synthesize('Rosa, rosae. Nauta rosas puellae dat.', { ...DEFAULTS, ...v });
  await play(audio, 1);
}

export { stop as stopAscolto };

/** Per i test automatici: lo stato del lettore audio. */
export function audioState() { return el ? { paused: el.paused, time: el.currentTime, duration: el.duration, volume: el.volume } : null; }
