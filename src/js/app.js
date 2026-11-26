// aMICOLettore – logica principale dell'interfaccia e della lettura.
import { db, loadSettings, saveSettings, sha256Hex, getUsage, requestPersistentStorage, FREE_CHARS_PER_MONTH } from './store.js';
import { sysVoice } from './sysvoice.js';
import { extractPdfText, letterCount, pageModel, findWords, TEXT_VERSION } from './text.js';
import { Speaker, ITALIAN_VOICES, TTSError } from './tts.js';

const $ = (id) => document.getElementById(id);
const RATES = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];
const VOICES_KEY = 'amicolettore.voices';
const nf = new Intl.NumberFormat('it-IT');

let settings = loadSettings();
const speaker = new Speaker(() => settings);

const state = {
  doc: null,      // metadati del documento aperto
  pages: [],      // testo delle pagine
  page: 0,
  sentence: 0,
  playing: false,
  loading: false,
};
const models = new Map();
function model(p) {
  if (!models.has(p)) models.set(p, pageModel(state.pages[p] || ''));
  return models.get(p);
}

// =====================================================================
// Visualizzazione della pagina
// =====================================================================
const view = { page: -1, sentEls: [], words: [], wordEl: null, sentEl: null };

function renderPage(p) {
  const reader = $('reader');
  const m = model(p);
  reader.textContent = '';
  view.page = p; view.sentEls = []; view.words = []; view.wordEl = null; view.sentEl = null;

  if (!m.sentences.length) {
    const msg = document.createElement('p');
    msg.className = 'no-text';
    msg.textContent = 'Questa pagina non contiene testo da leggere (forse è un\'immagine o una scansione). Passo alla pagina successiva quando leggo.';
    reader.append(msg);
    return;
  }

  const text = m.text;
  const frag = document.createDocumentFragment();
  let para = document.createElement('p');
  let pos = m.sentences[0].start;
  m.sentences.forEach((s, i) => {
    const gap = text.slice(pos, s.start);
    if (gap.includes('\n')) { frag.append(para); para = document.createElement('p'); }
    else if (gap) para.append(gap);

    const span = document.createElement('span');
    span.className = 's';
    span.dataset.i = i;
    let wpos = s.start;
    for (const w of findWords(text, s.start, s.end)) {
      if (w.start > wpos) span.append(text.slice(wpos, w.start));
      const ws = document.createElement('span');
      ws.className = 'w';
      ws.textContent = text.slice(w.start, w.end);
      span.append(ws);
      view.words.push({ start: w.start, end: w.end, el: ws });
      wpos = w.end;
    }
    if (s.end > wpos) span.append(text.slice(wpos, s.end));
    para.append(span);
    view.sentEls[i] = span;
    pos = s.end;
  });
  frag.append(para);
  reader.append(frag);
}

function showPage(p) {
  state.page = p;
  if (view.page !== p) renderPage(p);
  $('page-select').value = String(p);
  $('btn-page-prev').disabled = p <= 0;
  $('btn-page-next').disabled = p >= state.pages.length - 1;
  updateNotice();
}

function updateNotice() {
  const n = $('notice');
  if (state.doc && (state.doc.textVersion || 1) < TEXT_VERSION) {
    n.textContent = 'Ho migliorato il modo in cui leggo i PDF. Per una lettura più scorrevole, torna alla libreria e riapri questo stesso file con “Apri un PDF”: la pagina a cui eri arrivata resta.';
    n.hidden = false;
    return;
  }
  const empty = state.doc?.emptyPages || 0;
  if (empty && !model(state.page).sentences.length) {
    n.textContent = 'Pagina senza testo: probabilmente è un\'immagine. aMICOLettore può leggere solo il testo vero del PDF.';
    n.hidden = false;
  } else n.hidden = true;
}

function setPosition(s, { scroll = true } = {}) {
  const changed = s !== state.sentence || view.sentEl !== view.sentEls[s];
  state.sentence = s;
  if (changed) {
    view.sentEl?.classList.remove('cur');
    view.sentEl = view.sentEls[s] || null;
    view.sentEl?.classList.add('cur');
    highlightWord(-1);
    if (scroll) scrollToSentence();
    saveProgressSoon();
    updateMediaSession();
  }
}

function scrollToSentence() {
  const el = view.sentEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const top = $('view-reader').getBoundingClientRect().top < 0 ? 90 : 0;
  const bottomLimit = window.innerHeight - ($('controls').offsetHeight || 150) - 20;
  if (r.top < 80 + top || r.bottom > bottomLimit) {
    const target = window.scrollY + r.top - (bottomLimit - 80) * 0.35;
    window.scrollTo({ top: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

/** Evidenzia la parola che contiene la posizione `offset` del testo della pagina. */
function highlightWord(offset) {
  let el = null;
  if (offset >= 0 && view.words.length) {
    let lo = 0, hi = view.words.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (view.words[mid].start <= offset) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx >= 0 && offset < view.words[idx].end + 2) el = view.words[idx].el;
  }
  if (el === view.wordEl) return;
  view.wordEl?.classList.remove('on');
  view.wordEl = el;
  el?.classList.add('on');
}

function sentenceAt(p, offset) {
  const ss = model(p).sentences;
  let lo = 0, hi = ss.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ss[mid].start <= offset) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx;
}

// =====================================================================
// Riproduzione
// =====================================================================
const audio = new Audio();
audio.preload = 'auto';
audio.preservesPitch = true;       // la velocità cambia senza voce "da cartone animato"
audio.mozPreservesPitch = true;
audio.webkitPreservesPitch = true;
audio.setAttribute('playsinline', '');

let loaded = null;   // blocco audio attualmente caricato {page, ci, url, words, sentTimes, fromCache}
let token = 0;       // annulla operazioni superate da un comando più recente
let unlocked = false;

// Un istante di silenzio: su iPad l'audio va "sbloccato" con un tocco dell'utente.
function silentWavUrl() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  if (settings.offlineVoice) sysVoice.unlock();
  audio.src = silentWavUrl();
  audio.play().catch(() => {});
}

function chunkIndex(p, s) {
  return model(p).chunks.findIndex((c) => s >= c.s0 && s <= c.s1);
}

async function getChunkData(p, ci, opts) {
  const m = model(p);
  const c = m.chunks[ci];
  const res = await speaker.get(c.text, opts);
  if (!res) return null;
  const words = res.words.map((w) => ({ o: w.o + c.start, t: w.t })).sort((a, b) => a.t - b.t);
  const sentTimes = [];
  for (let k = c.s0; k <= c.s1; k++) {
    if (k === c.s0) { sentTimes.push(0); continue; }
    const st = m.sentences[k].start;
    const w = words.find((x) => x.o >= st);
    sentTimes.push(w ? Math.max(0, w.t - 0.12) : sentTimes[sentTimes.length - 1]);
  }
  return { page: p, ci, res, words, sentTimes, fromCache: res.fromCache };
}

function loadAudio(data) {
  return new Promise((resolve, reject) => {
    if (loaded?.url) URL.revokeObjectURL(loaded.url);
    data.url = URL.createObjectURL(new Blob([data.res.audio], { type: data.res.mime || 'audio/mpeg' }));
    loaded = data;
    const done = (ok) => { audio.removeEventListener('loadedmetadata', onOk); audio.removeEventListener('error', onErr); clearTimeout(timer); ok ? resolve() : reject(new Error('Audio non valido')); };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(audio.readyState >= 1), 8000);
    audio.addEventListener('loadedmetadata', onOk);
    audio.addEventListener('error', onErr);
    audio.src = data.url;
    audio.load();
  });
}

function nextPageWithText(p, dir) {
  for (let q = p + dir; q >= 0 && q < state.pages.length; q += dir) if (model(q).sentences.length) return q;
  return -1;
}

async function playFrom(p, s) {
  const my = ++token;
  if (p !== state.page) showPage(p);
  const m = model(p);
  if (!m.sentences.length) {
    const np = nextPageWithText(p, 1);
    if (np < 0) { stopPlayback('Fine del documento.'); return; }
    return playFrom(np, 0);
  }
  setPosition(s);
  const ci = chunkIndex(p, s);
  const c = m.chunks[ci];

  sysVoice.cancel();
  sysPlaying = null;
  let data = loaded && loaded.page === p && loaded.ci === ci && loaded.res.voice === settings.voice ? loaded : null;
  if (!data) {
    setLoading(true);
    audio.pause();
    // Mentre Azure non è raggiungibile non perdiamo tempo a riprovare a ogni frase
    const skipAzure = canFallback() && (!navigator.onLine || Date.now() < fallbackUntil);
    if (!skipAzure) setStatus('Preparo la voce…');
    try {
      data = await getChunkData(p, ci, { cacheOnly: skipAzure });
      if (my !== token) return;
      if (!data) { playSystem(p, s, my); return; }
      if (!data.fromCache) { fallbackUntil = 0; checkUsage(); }
      await loadAudio(data);
    } catch (e) {
      if (my !== token) return;
      if (canFallback() && e instanceof TTSError && ['network', 'quota', 'throttle'].includes(e.kind)) {
        fallbackUntil = Date.now() + 60_000;
        fallbackReason = e.kind;
        playSystem(p, s, my);
        return;
      }
      handleError(e);
      return;
    }
    if (my !== token) return;
  }

  try {
    audio.currentTime = data.sentTimes[s - c.s0] || 0;
  } catch { /* alcuni browser non permettono il salto prima del caricamento */ }
  audio.defaultPlaybackRate = settings.rate;
  audio.playbackRate = settings.rate;
  try {
    await audio.play();
  } catch (e) {
    if (my !== token) return;
    setLoading(false);
    setPlaying(false);
    setStatus('Tocca ▶ per ascoltare.');
    return;
  }
  if (my !== token) return;
  setLoading(false);
  setPlaying(true);
  setStatus(data.fromCache ? 'Audio già salvato sul dispositivo: nessun consumo.' : 'Audio nuovo: ora è salvato sul dispositivo.');
  prefetchAfter(p, ci);
}

function prefetchAfter(p, ci) {
  if (!navigator.onLine) return;
  const m = model(p);
  let tp = p, tci = ci + 1;
  if (tci >= m.chunks.length) { tp = nextPageWithText(p, 1); tci = 0; }
  if (tp < 0) return;
  getChunkData(tp, tci).catch(() => {});
}

// ---------- riserva: voce dell'iPad ----------
let sysPlaying = null;      // {p, s} mentre legge la voce dell'iPad
let fallbackUntil = 0;      // fino a quando evitare Azure dopo un errore di rete
let fallbackReason = 'network';

function canFallback() { return settings.offlineVoice !== false && sysVoice.available(); }

function playSystem(p, s, my) {
  const m = model(p);
  const sent = m.sentences[s];
  audio.pause();
  sysPlaying = { p, s };
  setLoading(false);
  setPlaying(true);
  setStatus(fallbackReason === 'quota' || fallbackReason === 'throttle'
    ? 'Azure non risponde (quota?): leggo con la voce dell\'iPad.'
    : 'Senza internet: leggo con la voce dell\'iPad. Le parti già salvate restano con la voce di Azure.');
  sysVoice.speak(m.text.slice(sent.start, sent.end), {
    voiceName: settings.sysVoice,
    rate: settings.rate,
    onWord: (ci) => { if (my === token) highlightWord(sent.start + ci); },
    onEnd: () => {
      if (my !== token) return;
      sysPlaying = null;
      const next = nextSentence(p, s);
      if (!next) { stopPlayback('Fine del documento. 🎉'); return; }
      playFrom(next.p, next.s);
    },
    onError: (e) => {
      if (my !== token) return;
      sysPlaying = null;
      handleError(new Error(`La voce dell'iPad non è disponibile (${e.error || 'errore'}).`));
    },
  });
}

function nextSentence(p, s) {
  if (s + 1 < model(p).sentences.length) return { p, s: s + 1 };
  const np = nextPageWithText(p, 1);
  return np < 0 ? null : { p: np, s: 0 };
}

function onEnded() {
  if (!loaded || !state.playing) return;
  const { page: p, ci } = loaded;
  const m = model(p);
  if (ci + 1 < m.chunks.length) { playFrom(p, m.chunks[ci + 1].s0); return; }
  const np = nextPageWithText(p, 1);
  if (np < 0) { stopPlayback('Fine del documento. 🎉'); setPosition(m.sentences.length - 1, { scroll: false }); return; }
  playFrom(np, 0);
}

function stopPlayback(msg) {
  token++;
  sysVoice.cancel();
  sysPlaying = null;
  audio.pause();
  setLoading(false);
  setPlaying(false);
  highlightWord(-1);
  if (msg) setStatus(msg);
}

function togglePlay() {
  if (!state.doc) return;
  if (state.playing || state.loading) { stopPlayback('In pausa.'); saveProgressNow(); return; }
  unlockAudio();
  const ci = chunkIndex(state.page, state.sentence);
  if (loaded && loaded.page === state.page && loaded.ci === ci && loaded.res.voice === settings.voice && !audio.ended && audio.currentTime > 0) {
    // riprendi esattamente dal punto in cui era in pausa, se la frase è la stessa
    const t = audio.currentTime;
    const w = wordAtTime(t);
    const sNow = w ? sentenceAt(state.page, w.o) : state.sentence;
    if (sNow === state.sentence) {
      const my = ++token;
      audio.playbackRate = settings.rate;
      audio.play().then(() => { if (my === token) { setPlaying(true); setStatus('Riprendo la lettura.'); } })
        .catch(() => playFrom(state.page, state.sentence));
      return;
    }
  }
  playFrom(state.page, state.sentence);
}

function wordAtTime(t) {
  const ws = loaded?.words;
  if (!ws?.length) return null;
  let lo = 0, hi = ws.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ws[mid].t <= t + 0.03) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx >= 0 ? ws[idx] : null;
}

function tick() {
  if (state.playing && loaded && loaded.page === state.page && !audio.paused) {
    const w = wordAtTime(audio.currentTime);
    if (w) {
      const s = sentenceAt(state.page, w.o);
      if (s !== state.sentence) setPosition(s);
      highlightWord(w.o);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function step(delta) {
  if (!state.doc) return;
  let p = state.page;
  let s = state.sentence + delta;
  const m = model(p);
  if (!m.sentences.length) { p = nextPageWithText(p, delta); if (p < 0) return; s = delta > 0 ? 0 : model(p).sentences.length - 1; }
  else if (s < 0) { p = nextPageWithText(p, -1); if (p < 0) return; s = model(p).sentences.length - 1; }
  else if (s >= m.sentences.length) { p = nextPageWithText(p, 1); if (p < 0) return; s = 0; }

  if (state.playing || state.loading) { playFrom(p, s); return; }
  if (p !== state.page) showPage(p);
  setPosition(s);
  // in pausa: se la frase è nel blocco già caricato, sposta lì il punto di ripresa
  const ci = chunkIndex(p, s);
  if (loaded && loaded.page === p && loaded.ci === ci) {
    try { audio.currentTime = loaded.sentTimes[s - model(p).chunks[ci].s0] || 0; } catch { /* ignora */ }
  }
}

function goPage(p) {
  if (!state.doc || p < 0 || p >= state.pages.length) return;
  if (state.playing || state.loading) { playFrom(p, 0); return; }
  showPage(p);
  setPosition(0, { scroll: false });
  window.scrollTo({ top: 0 });
}

function setPlaying(v) {
  state.playing = v;
  const b = $('btn-play');
  b.classList.toggle('playing', v);
  b.setAttribute('aria-label', v ? 'Pausa' : 'Leggi');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = v ? 'playing' : 'paused';
  v ? keepAwake() : releaseAwake();
}
function setLoading(v) {
  state.loading = v;
  $('btn-play').classList.toggle('loading', v);
}
function setStatus(msg, isErr = false) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('err', isErr);
}

function handleError(e) {
  setLoading(false);
  setPlaying(false);
  let msg = e?.message || String(e);
  if (!(e instanceof TTSError) && !navigator.onLine) msg = 'Sei senza internet e questa parte non è ancora stata salvata sul dispositivo.';
  if (e instanceof TTSError && e.kind === 'network' && !navigator.onLine) msg = 'Sei senza internet e questa parte non è ancora stata salvata sul dispositivo.';
  setStatus(msg, true);
  toast(msg);
  if (e instanceof TTSError && (e.kind === 'nokey' || e.kind === 'auth' || e.kind === 'voice')) openSettings();
}

audio.addEventListener('ended', onEnded);
audio.addEventListener('pause', () => {
  // pausa decisa dal sistema (es. telefonata, Centro di Controllo)
  if (state.playing && !state.loading && !audio.ended && !sysPlaying) { setPlaying(false); setStatus('In pausa.'); saveProgressNow(); }
});
audio.addEventListener('play', () => {
  if (!state.playing && !state.loading && loaded && audio.src === loaded.url) setPlaying(true);
});

// =====================================================================
// Punto di lettura (ripresa)
// =====================================================================
let saveTimer = null;
function saveProgressSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgressNow, 700);
}
function saveProgressNow() {
  clearTimeout(saveTimer);
  if (!state.doc) return;
  state.doc.page = state.page;
  state.doc.sentence = state.sentence;
  state.doc.updatedAt = Date.now();
  db.putDoc(state.doc).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveProgressNow();
  else if (state.playing) keepAwake();
});
window.addEventListener('pagehide', saveProgressNow);

// =====================================================================
// Apertura dei PDF e libreria
// =====================================================================
async function openFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Questo file non è un PDF.'); return; }
  stopPlayback();
  toast('Sto leggendo il PDF…', 0);
  try {
    const buf = await file.arrayBuffer();
    const id = await sha256Hex(buf);
    const existing = await db.getDoc(id);
    if (existing && (existing.textVersion || 1) >= TEXT_VERSION) { hideToast(); await openDoc(id); return; }

    const { pages, title } = await extractPdfText(buf, {
      onProgress: (i, n) => toast(`Estraggo il testo… pagina ${i} di ${n}`, 0),
      askPassword: (wrong) => window.prompt(wrong ? 'Password errata. Riprova:' : 'Questo PDF è protetto. Inserisci la password:'),
    });
    const counts = pages.map(letterCount);
    const total = counts.reduce((a, b) => a + b, 0);
    const emptyPages = counts.filter((c) => c < 15).length;

    if (total < 40 || emptyPages === pages.length) {
      hideToast();
      alert('Questo PDF sembra una scansione: le pagine sono immagini e non contengono testo da leggere.\n\n' +
        'Per usarlo con aMICOLettore bisogna prima trasformarlo in testo con un\'app di riconoscimento del testo (OCR), ' +
        'per esempio Adobe Scan o Microsoft Lens, e poi riaprire qui il nuovo PDF.');
      return;
    }

    const name = file.name.replace(/\.pdf$/i, '');
    const firstPage = Math.max(0, counts.findIndex((c) => c >= 15));
    const doc = existing
      // stesso PDF già in libreria con il testo estratto da una versione precedente: lo rielaboro e tengo la pagina
      ? { ...existing, title, numPages: pages.length, emptyPages, sentence: 0, offlineVoice: null, textVersion: TEXT_VERSION, updatedAt: Date.now() }
      : { id, name, title, numPages: pages.length, emptyPages, textVersion: TEXT_VERSION,
          page: firstPage, sentence: 0, createdAt: Date.now(), updatedAt: Date.now() };
    await db.putText({ id, pages });
    await db.putDoc(doc);
    requestPersistentStorage();
    hideToast();
    await openDoc(id);
    if (emptyPages > pages.length * 0.3) {
      toast(`Attenzione: ${emptyPages} pagine su ${pages.length} sembrano scansioni senza testo e verranno saltate.`, 7000);
    } else if (emptyPages) {
      toast(`${emptyPages} ${emptyPages === 1 ? 'pagina non contiene' : 'pagine non contengono'} testo e ${emptyPages === 1 ? 'verrà saltata' : 'verranno saltate'}.`, 5000);
    }
  } catch (e) {
    hideToast();
    console.error(e);
    if (e?.name === 'PasswordException') toast('PDF protetto da password: non è stato possibile aprirlo.');
    else if (e?.name === 'InvalidPDFException') toast('Il file sembra danneggiato o non è un PDF valido.');
    else toast('Non sono riuscita ad aprire il PDF: ' + (e?.message || e));
  }
}

async function openDoc(id) {
  const [doc, text] = await Promise.all([db.getDoc(id), db.getText(id)]);
  if (!doc || !text) { toast('Documento non trovato sul dispositivo.'); return renderLibrary(); }
  cancelPrepare();
  stopPlayback();
  if (loaded?.url) URL.revokeObjectURL(loaded.url);
  loaded = null;
  models.clear();
  view.page = -1;
  state.doc = doc;
  state.pages = text.pages;
  doc.lastOpenedAt = Date.now();
  db.putDoc(doc).catch(() => {});

  $('doc-title').textContent = doc.title && doc.title.length < 120 ? doc.title : doc.name;
  const sel = $('page-select');
  sel.textContent = '';
  state.pages.forEach((_, i) => sel.add(new Option(String(i + 1), String(i))));
  $('page-total').textContent = `di ${state.pages.length}`;

  showView('reader');
  const page = Math.min(doc.page || 0, state.pages.length - 1);
  showPage(page);
  const ns = model(page).sentences.length;
  const sentence = Math.min(doc.sentence || 0, Math.max(0, ns - 1));
  view.sentEl = null;
  setPosition(sentence, { scroll: false });
  requestAnimationFrame(() => { if (sentence > 0) scrollToSentence(); else window.scrollTo({ top: 0 }); });
  updatePrepareButton();
  setStatus(doc.page || doc.sentence ? 'Tocca ▶ per riprendere da dove eri arrivata.' : 'Tocca ▶ per iniziare, oppure tocca una frase.');
  updateMediaSession();
}

async function renderLibrary() {
  const list = $('lib-list');
  let docs = [];
  try { docs = await db.listDocs(); } catch { /* archivio non disponibile */ }
  docs.sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
  list.textContent = '';
  $('lib-empty').hidden = docs.length > 0;
  for (const d of docs) {
    const li = document.createElement('li');
    li.className = 'lib-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lib-open';
    const pct = d.numPages > 1 ? Math.round((d.page / (d.numPages - 1)) * 100) : 0;
    const when = new Date(d.updatedAt || d.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    open.innerHTML = `<span class="lib-name"></span><span class="lib-meta"></span><span class="lib-bar"><span style="width:${pct}%"></span></span>`;
    open.querySelector('.lib-name').textContent = d.title && d.title.length < 120 ? d.title : d.name;
    open.querySelector('.lib-meta').textContent = `${d.page || d.sentence ? `Riprendi da pagina ${d.page + 1}` : 'Da iniziare'} · ${d.numPages} pagine · ${when}`;
    if (d.offlineVoice && d.offlineVoice === settings.voice) {
      const r = document.createElement('span');
      r.className = 'lib-ready';
      r.textContent = '✓ Pronto anche senza internet';
      open.querySelector('.lib-meta').after(r);
    }
    open.setAttribute('aria-label', `Apri ${d.name}`);
    open.addEventListener('click', () => openDoc(d.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'lib-del';
    del.setAttribute('aria-label', `Togli ${d.name} dalla libreria`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    del.addEventListener('click', async () => {
      if (!confirm(`Togliere "${d.name}" dalla libreria?`)) return;
      // l'audio salvato del documento: chiedi se cancellarlo (prima di togliere il testo, che serve a trovarlo)
      try {
        const r = (await audioByDoc()).rows.find((x) => x.doc.id === d.id);
        if (r && confirm(`Cancellare anche l'audio salvato di questo documento (${mb(r.bytes)})?\n"Annulla" lo tiene sul dispositivo.`)) await deleteDocAudio(null, r.keys);
      } catch { /* ignora */ }
      await db.deleteDoc(d.id);
      renderLibrary();
    });
    li.append(open, del);
    list.append(li);
  }
  $('key-hint').hidden = !!settings.key;
  renderUsage();
}

function showView(name) {
  $('view-home').hidden = name !== 'home';
  $('view-reader').hidden = name !== 'reader';
  $('controls').hidden = name !== 'reader';
  if (name === 'home') { cancelPrepare(); stopPlayback(); saveProgressNow(); state.doc = null; renderLibrary(); window.scrollTo({ top: 0 }); }
}

// =====================================================================
// Impostazioni
// =====================================================================
function voiceList() {
  try { const v = JSON.parse(localStorage.getItem(VOICES_KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch { /* ignora */ }
  return ITALIAN_VOICES;
}
function fillVoices(selected) {
  const sel = $('set-voice');
  sel.textContent = '';
  const voices = voiceList();
  for (const v of voices) sel.add(new Option(v.label, v.id));
  if (!voices.some((v) => v.id === selected)) sel.add(new Option(selected, selected));
  sel.value = selected;
}
function fillSysVoices() {
  const sel = $('set-sysvoice');
  sel.textContent = '';
  const voices = sysVoice.voices();
  if (!voices.length) {
    sel.add(new Option('Nessuna voce italiana trovata su questo dispositivo', ''));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const best = sysVoice.pick('');
  sel.add(new Option(`Automatica (${best?.name || 'migliore disponibile'})`, ''));
  for (const v of voices) sel.add(new Option(`${v.name}${v.localService ? '' : ' (online)'}`, v.name));
  sel.value = voices.some((v) => v.name === settings.sysVoice) ? settings.sysVoice : '';
}
sysVoice.onVoicesChanged(() => { if ($('settings').open) fillSysVoices(); });

function formSettings() {
  return {
    ...settings,
    offlineVoice: $('set-fallback').checked,
    sysVoice: $('set-sysvoice').value,
    key: $('set-key').value.trim(),
    region: $('set-region').value.trim().toLowerCase().replace(/\s+/g, ''),
    voice: $('set-voice').value,
  };
}

async function refreshCacheInfo() {
  let n = 0;
  try { n = await db.countAudio(); } catch { /* ignora */ }
  let size = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) size = ` · spazio usato dall'app: ${nf.format(Math.round(est.usage / 1048576))} MB`;
  } catch { /* ignora */ }
  $('cache-info').textContent = `${nf.format(n)} ${n === 1 ? 'blocco' : 'blocchi'} di frasi salvati${size}`;
  renderUsage();
  renderAudioList();
}

// ---------- audio salvato, documento per documento ----------
const mb = (bytes) => `${nf.format(Math.max(0.1, Math.round(bytes / 104857.6) / 10))} MB`;
/**
 * Raggruppa l'audio salvato per documento: per ogni documento ricalcola i blocchi di testo
 * e le loro chiavi (per tutte le voci usate). L'audio che non appartiene a nessun documento
 * della libreria (documenti tolti) finisce in "altro".
 */
async function audioByDoc() {
  const idx = await db.audioIndex();
  const byKey = new Map(idx.map((a) => [a.key, a]));
  const voices = [...new Set(idx.map((a) => a.voice).filter(Boolean))];
  const used = new Set();
  const rows = [];
  for (const d of await db.listDocs()) {
    const t = await db.getText(d.id).catch(() => null);
    if (!t?.pages) continue;
    const keys = [];
    let bytes = 0;
    for (const page of t.pages) {
      for (const c of pageModel(page || '').chunks) {
        for (const v of voices) {
          const k = await speaker.cacheKey(c.text, v);
          const a = byKey.get(k);
          if (a && !used.has(k)) { used.add(k); keys.push(k); bytes += a.bytes; }
        }
      }
    }
    if (keys.length) rows.push({ doc: d, keys, bytes });
  }
  const rest = idx.filter((a) => !used.has(a.key));
  return { rows, rest: { keys: rest.map((a) => a.key), bytes: rest.reduce((n, a) => n + a.bytes, 0) } };
}

async function deleteDocAudio(doc, keys) {
  await db.deleteAudio(keys);
  if (loaded?.url) URL.revokeObjectURL(loaded.url);
  loaded = null;
  stopPlayback();
  if (doc?.offlineVoice) { doc.offlineVoice = null; await db.putDoc(doc).catch(() => {}); if (state.doc?.id === doc.id) state.doc.offlineVoice = null; updatePrepareButton(); }
}

async function renderAudioList() {
  const ul = $('audio-list');
  ul.innerHTML = '<li class="muted">Calcolo lo spazio occupato…</li>';
  let res;
  try { res = await audioByDoc(); } catch { ul.textContent = ''; return; }
  ul.textContent = '';
  const add = (label, info, onDelete) => {
    const li = document.createElement('li');
    const txt = document.createElement('span');
    txt.className = 'audio-name';
    txt.textContent = label;
    const meta = document.createElement('span');
    meta.className = 'audio-meta';
    meta.textContent = info;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ghost small-btn'; b.textContent = 'Cancella';
    b.addEventListener('click', onDelete);
    li.append(txt, meta, b);
    ul.append(li);
  };
  for (const r of res.rows.sort((a, b) => b.bytes - a.bytes)) {
    const name = r.doc.title && r.doc.title.length < 120 ? r.doc.title : r.doc.name;
    add(name, `${nf.format(r.keys.length)} ${r.keys.length === 1 ? 'blocco' : 'blocchi'} · ${mb(r.bytes)}`, async () => {
      if (!confirm(`Cancellare l'audio salvato di "${name}" (${mb(r.bytes)})?\nIl documento resta nella libreria; rileggerlo consumerà di nuovo la quota di Azure.`)) return;
      await deleteDocAudio(r.doc, r.keys);
      toast('Audio del documento cancellato.');
      refreshCacheInfo();
    });
  }
  if (res.rest.keys.length) {
    add('Documenti tolti dalla libreria e altro', `${nf.format(res.rest.keys.length)} ${res.rest.keys.length === 1 ? 'blocco' : 'blocchi'} · ${mb(res.rest.bytes)}`, async () => {
      if (!confirm(`Cancellare l'audio che non appartiene a nessun documento della libreria (${mb(res.rest.bytes)})?`)) return;
      await deleteDocAudio(null, res.rest.keys);
      toast('Audio cancellato.');
      refreshCacheInfo();
    });
  }
}

function openSettings() {
  const dlg = $('settings');
  if (dlg.open) return;
  $('set-key').value = settings.key;
  $('set-key').type = 'password';
  $('btn-toggle-key').textContent = 'Mostra';
  $('set-region').value = settings.region;
  fillVoices(settings.voice);
  $('set-fallback').checked = settings.offlineVoice !== false;
  fillSysVoices();
  $('voice-msg').textContent = '';
  refreshCacheInfo();
  dlg.showModal();
}

$('settings-form').addEventListener('submit', (ev) => {
  const action = ev.submitter?.value;
  if (action !== 'save') return;
  const next = formSettings();
  if (next.key && !next.region) { ev.preventDefault(); $('voice-msg').textContent = 'Indica anche la regione (es. westeurope).'; return; }
  const voiceChanged = next.voice !== settings.voice;
  settings = next;
  saveSettings(settings);
  speaker.reset();
  if (voiceChanged && (state.playing || state.loading)) { stopPlayback(); playFrom(state.page, state.sentence); }
  $('key-hint').hidden = !!settings.key;
  updatePrepareButton();
  toast('Impostazioni salvate.');
});

// Copia la voce di Azure per aMICOLatino: sull'iPad le app della schermata Home hanno archivi separati,
// quindi la chiave passa attraverso gli appunti (resta comunque solo su questo dispositivo).
$('btn-copy-latino').addEventListener('click', async () => {
  const s = formSettings();
  if (!s.key || !s.region) { $('voice-msg').textContent = 'Inserisci prima chiave e regione.'; return; }
  const code = 'aMICOL-voce:' + btoa(JSON.stringify({ key: s.key, region: s.region, voice: s.voice }));
  try {
    await navigator.clipboard.writeText(code);
    toast('Voce copiata! Ora apri aMICOLatino → Impostazioni → Incolla da aMICOLettore.', 6000);
  } catch {
    toast('Non riesco a copiare negli appunti da qui.');
  }
});

$('btn-toggle-key').addEventListener('click', () => {
  const k = $('set-key');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('btn-toggle-key').textContent = k.type === 'password' ? 'Mostra' : 'Nascondi';
});

$('btn-test-voice').addEventListener('click', async () => {
  const s = formSettings();
  if (!s.key || !s.region) { $('voice-msg').textContent = 'Inserisci prima chiave e regione.'; return; }
  stopPlayback();
  unlockAudio();
  const msg = $('voice-msg');
  msg.textContent = 'Provo la voce…';
  const tester = new Speaker(() => s);
  try {
    const res = await tester.get('Ciao! Sono aMICOLettore. Apri un PDF e lo leggo insieme a te.');
    tester.reset();
    if (loaded?.url) URL.revokeObjectURL(loaded.url);
    loaded = null;
    audio.src = URL.createObjectURL(new Blob([res.audio], { type: res.mime }));
    audio.playbackRate = 1;
    await audio.play();
    msg.textContent = res.fromCache ? 'Funziona! (audio già salvato)' : 'Funziona! Chiave e voce sono corrette.';
    refreshCacheInfo();
  } catch (e) {
    tester.reset();
    msg.textContent = e?.message || String(e);
  }
});

$('btn-test-sys').addEventListener('click', () => {
  const msg = $('voice-msg');
  if (!sysVoice.available()) { msg.textContent = 'Su questo dispositivo non ci sono voci italiane di sistema.'; return; }
  stopPlayback();
  sysVoice.speak('Ciao! Questa è la voce dell\'iPad, la uso quando manca internet.', {
    voiceName: $('set-sysvoice').value,
    rate: settings.rate,
    onError: (e) => { msg.textContent = `Errore della voce dell'iPad: ${e.error || 'sconosciuto'}`; },
  });
  msg.textContent = 'Senti la voce dell\'iPad?';
});

$('btn-load-voices').addEventListener('click', async () => {
  const s = formSettings();
  const msg = $('voice-msg');
  if (!s.key || !s.region) { msg.textContent = 'Inserisci prima chiave e regione.'; return; }
  msg.textContent = 'Chiedo ad Azure l\'elenco delle voci…';
  const tmp = new Speaker(() => s);
  try {
    const voices = await tmp.listVoices();
    if (!voices.length) throw new Error('Nessuna voce italiana trovata in questa regione.');
    voices.sort((a, b) => (a.id === 'it-IT-IsabellaNeural' ? -1 : b.id === 'it-IT-IsabellaNeural' ? 1 : a.label.localeCompare(b.label, 'it')));
    localStorage.setItem(VOICES_KEY, JSON.stringify(voices));
    fillVoices(s.voice);
    msg.textContent = `Trovate ${voices.length} voci italiane disponibili nella tua regione.`;
  } catch (e) {
    msg.textContent = e?.message || String(e);
  } finally {
    tmp.reset();
  }
});

$('btn-clear-cache').addEventListener('click', async () => {
  if (!confirm('Cancellare tutto l\'audio salvato?\nRileggere le pagine consumerà di nuovo la quota di Azure.')) return;
  await db.clearAudio();
  if (loaded?.url) URL.revokeObjectURL(loaded.url);
  loaded = null;
  stopPlayback();
  refreshCacheInfo();
  toast('Audio salvato cancellato.');
});

// =====================================================================
// Contatore dei caratteri (quota gratuita F0)
// =====================================================================
const WARN_KEY = 'amicolettore.usageWarned';
function usageLevel(used) {
  const pct = used / FREE_CHARS_PER_MONTH;
  return pct >= 0.95 ? 'danger' : pct >= 0.8 ? 'warn' : '';
}
function renderUsage() {
  const used = getUsage();
  const pct = Math.min(100, (used / FREE_CHARS_PER_MONTH) * 100);
  const left = Math.max(0, FREE_CHARS_PER_MONTH - used);
  const pctTxt = pct > 0 && pct < 1 ? '<1' : nf.format(Math.round(pct));
  for (const id of ['usage-home', 'usage-settings']) {
    const el = $(id);
    if (!el) continue;
    el.className = `usage ${usageLevel(used)}`;
    el.innerHTML = `<div class="usage-text"><span>Caratteri Azure usati questo mese: <strong></strong></span><span></span></div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${FREE_CHARS_PER_MONTH}" aria-valuenow="${used}"><span style="width:${pct}%"></span></div>`;
    el.querySelector('strong').textContent = `${nf.format(used)} su ${nf.format(FREE_CHARS_PER_MONTH)} (${pctTxt}%)`;
    el.querySelector('.usage-text > span:last-child').textContent = left ? `ne restano ${nf.format(left)}` : 'quota esaurita (stima)';
  }
}
function checkUsage() {
  renderUsage();
  const used = getUsage();
  const month = new Date().toISOString().slice(0, 7);
  let warned = {};
  try { warned = JSON.parse(localStorage.getItem(WARN_KEY) || '{}'); } catch { /* ignora */ }
  if (warned.month !== month) warned = { month, level: 0 };
  const pct = used / FREE_CHARS_PER_MONTH;
  const level = pct >= 1 ? 100 : pct >= 0.95 ? 95 : pct >= 0.8 ? 80 : 0;
  if (level > warned.level) {
    warned.level = level;
    try { localStorage.setItem(WARN_KEY, JSON.stringify(warned)); } catch { /* ignora */ }
    const msg = level === 100
      ? 'Quota gratuita di Azure probabilmente esaurita per questo mese. Le parti già salvate si leggono comunque; per il resto userò la voce dell\'iPad.'
      : `Attenzione: hai usato circa il ${level}% dei caratteri gratuiti di Azure di questo mese.`;
    toast(msg, 8000);
  }
}

// =====================================================================
// Prepara per offline: genera e salva l'audio di tutto il documento
// =====================================================================
const MIN_REQUEST_GAP = 3200; // ms: resta sotto il limite di richieste al minuto del piano F0
let prep = null;

function updatePrepareButton() {
  const ready = state.doc?.offlineVoice && state.doc.offlineVoice === settings.voice;
  $('btn-prepare').classList.toggle('ready', !!ready);
  $('prepare-label').textContent = ready ? 'Pronto offline ✓' : 'Prepara per offline';
}

function cancelPrepare() {
  if (prep) prep.cancel = true;
}

async function prepareDocument() {
  if (!state.doc || prep) return;
  if (!settings.key || !settings.region) { toast('Prima inserisci la chiave di Azure nelle impostazioni.'); openSettings(); return; }
  if (!navigator.onLine) { toast('Per preparare l\'audio serve internet (meglio il Wi-Fi).'); return; }

  const doc = state.doc;
  const job = { cancel: false, doc };
  prep = job;
  toast('Controllo cosa è già salvato…', 0);
  const todo = [];
  let missing = 0;
  for (let p = 0; p < state.pages.length; p++) {
    for (let ci = 0; ci < model(p).chunks.length; ci++) {
      const c = model(p).chunks[ci];
      if (!(await speaker.isCached(c.text))) { todo.push({ p, ci }); missing += c.text.length; }
    }
  }
  hideToast();
  if (job.cancel || state.doc !== doc) { prep = null; return; }

  const markReady = () => { doc.offlineVoice = settings.voice; db.putDoc(doc).catch(() => {}); updatePrepareButton(); };
  if (!todo.length) {
    prep = null;
    markReady();
    toast('Tutto il documento è già salvato: puoi leggerlo anche senza internet. ✓', 6000);
    return;
  }

  const used = getUsage();
  const left = Math.max(0, FREE_CHARS_PER_MONTH - used);
  const minutes = Math.max(1, Math.ceil((todo.length * MIN_REQUEST_GAP) / 60000));
  const ok = confirm(
    `Per salvare tutto il documento servono circa ${nf.format(missing)} caratteri ` +
    `(${todo.length} richieste ad Azure, circa ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}).\n\n` +
    `Questo mese ne hai usati circa ${nf.format(used)} su ${nf.format(FREE_CHARS_PER_MONTH)}: ne restano ${nf.format(left)}.` +
    (missing > left ? '\n\nAttenzione: probabilmente non bastano, verrà salvata solo una parte.' : '') +
    '\n\nTieni l\'app aperta e l\'iPad acceso finché non ha finito. Vuoi continuare?');
  if (!ok) { prep = null; return; }

  const box = $('prep');
  box.hidden = false;
  keepAwake();
  let done = 0;
  let lastStart = 0;
  let error = null;
  const show = () => {
    $('prep-text').textContent = `Salvo l'audio: ${done} di ${todo.length} (pagina ${todo[Math.min(done, todo.length - 1)].p + 1})`;
    $('prep-bar').style.width = `${(done / todo.length) * 100}%`;
  };
  show();
  for (const { p, ci } of todo) {
    if (job.cancel) break;
    const wait = lastStart + MIN_REQUEST_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (job.cancel) break;
    lastStart = Date.now();
    try {
      const text = model(p).chunks[ci].text;
      const res = await speaker.get(text);
      if (!res.fromCache) checkUsage();
    } catch (e) {
      error = e;
      break;
    }
    done++;
    show();
  }
  prep = null;
  box.hidden = true;
  if (!state.playing) releaseAwake();
  if (done === todo.length) {
    markReady();
    toast('Fatto! Tutto il documento è salvato: ora puoi leggerlo anche senza internet. ✓', 8000);
  } else if (error) {
    toast(`Mi sono fermata a ${done} di ${todo.length}: ${error.message || error}. Quello già salvato resta; puoi riprendere più tardi.`, 10000);
  } else {
    toast(`Interrotto: salvati ${done} di ${todo.length}. Puoi riprendere quando vuoi.`, 6000);
  }
}

// =====================================================================
// Velocità, dimensione del testo
// =====================================================================
function fmtRate(r) { return `${nf.format(r)}×`; }
function applyRate() {
  $('speed-val').textContent = fmtRate(settings.rate);
  audio.defaultPlaybackRate = settings.rate;
  audio.playbackRate = settings.rate;
}
function changeRate(dir) {
  let i = RATES.findIndex((r) => Math.abs(r - settings.rate) < 0.001);
  if (i < 0) i = RATES.indexOf(1);
  i = Math.max(0, Math.min(RATES.length - 1, i + dir));
  settings.rate = RATES[i];
  saveSettings(settings);
  applyRate();
}
function applyFont() {
  document.documentElement.style.setProperty('--reader-size', `${settings.fontSize}px`);
}
function changeFont(d) {
  settings.fontSize = Math.max(16, Math.min(44, settings.fontSize + d));
  saveSettings(settings);
  applyFont();
  scrollToSentence();
}

// =====================================================================
// Schermo acceso, comandi della schermata di blocco, messaggi
// =====================================================================
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* non supportato */ }
}
function releaseAwake() { try { wakeLock?.release(); } catch { /* ignora */ } wakeLock = null; }

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.doc) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.doc.title || state.doc.name,
      artist: `aMICOLettore · pagina ${state.page + 1}`,
      artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  } catch { /* ignora */ }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* non supportato */ } };
  set('play', () => { if (!state.playing) togglePlay(); });
  set('pause', () => { if (state.playing || state.loading) togglePlay(); });
  set('previoustrack', () => step(-1));
  set('nexttrack', () => step(1));
}

let toastTimer = null;
function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('toast').hidden = true; }

// =====================================================================
// Collegamento dei comandi
// =====================================================================
$('file-input').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; openFile(f); });
$('btn-home').addEventListener('click', () => showView('home'));
$('btn-settings').addEventListener('click', openSettings);
$('btn-hint-settings').addEventListener('click', openSettings);
$('btn-font-up').addEventListener('click', () => changeFont(2));
$('btn-font-down').addEventListener('click', () => changeFont(-2));
$('btn-play').addEventListener('click', togglePlay);
$('btn-prepare').addEventListener('click', prepareDocument);
$('btn-prep-cancel').addEventListener('click', cancelPrepare);
$('btn-prev').addEventListener('click', () => step(-1));
$('btn-next').addEventListener('click', () => step(1));
$('btn-slower').addEventListener('click', () => changeRate(-1));
$('btn-faster').addEventListener('click', () => changeRate(1));
$('btn-page-prev').addEventListener('click', () => goPage(state.page - 1));
$('btn-page-next').addEventListener('click', () => goPage(state.page + 1));
$('page-select').addEventListener('change', (e) => goPage(Number(e.target.value)));
$('reader').addEventListener('click', (e) => {
  const s = e.target.closest('.s');
  if (!s || window.getSelection()?.toString()) return;
  unlockAudio();
  playFrom(state.page, Number(s.dataset.i));
});
document.addEventListener('keydown', (e) => {
  if ($('settings').open || !state.doc || e.target.closest('input, select, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});
// Trascina un PDF sulla finestra (utile su computer)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); openFile(e.dataTransfer?.files?.[0]); });

// =====================================================================
// Avvio
// =====================================================================
applyFont();
applyRate();
renderUsage();
renderLibrary().then(async () => {
  // riapre l'ultimo documento letto, così si riprende subito da dove si era rimasti
  const docs = await db.listDocs().catch(() => []);
  const last = docs.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
  if (last?.lastOpenedAt) openDoc(last.id);
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
}

// per i test automatici
window.__amicol = { state, model, get loaded() { return loaded; }, audio };
