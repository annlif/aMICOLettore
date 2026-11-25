// aMICOLettore – logica principale dell'interfaccia e della lettura.
import { db, loadSettings, saveSettings, sha256Hex, getUsage, requestPersistentStorage } from './store.js';
import { extractPdfText, letterCount, pageModel, findWords } from './text.js';
import { Speaker, ITALIAN_VOICES, TTSError } from './tts.js';

const $ = (id) => document.getElementById(id);
const FREE_CHARS_PER_MONTH = 500_000; // piano F0: 0,5 milioni di caratteri al mese per le voci neurali
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

  let data = loaded && loaded.page === p && loaded.ci === ci && loaded.res.voice === settings.voice ? loaded : null;
  if (!data) {
    setLoading(true);
    audio.pause();
    setStatus('Preparo la voce…');
    try {
      data = await getChunkData(p, ci);
      if (my !== token) return;
      await loadAudio(data);
    } catch (e) {
      if (my !== token) return;
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
  if (state.playing && !state.loading && !audio.ended) { setPlaying(false); setStatus('In pausa.'); saveProgressNow(); }
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
    if (await db.getDoc(id)) { hideToast(); await openDoc(id); return; }

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
    const doc = {
      id, name, title, numPages: pages.length, emptyPages,
      page: firstPage, sentence: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
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
    open.setAttribute('aria-label', `Apri ${d.name}`);
    open.addEventListener('click', () => openDoc(d.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'lib-del';
    del.setAttribute('aria-label', `Togli ${d.name} dalla libreria`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    del.addEventListener('click', async () => {
      if (!confirm(`Togliere "${d.name}" dalla libreria?\n(L'audio già salvato resta disponibile.)`)) return;
      await db.deleteDoc(d.id);
      renderLibrary();
    });
    li.append(open, del);
    list.append(li);
  }
  $('key-hint').hidden = !!settings.key;
}

function showView(name) {
  $('view-home').hidden = name !== 'home';
  $('view-reader').hidden = name !== 'reader';
  $('controls').hidden = name !== 'reader';
  if (name === 'home') { stopPlayback(); saveProgressNow(); state.doc = null; renderLibrary(); window.scrollTo({ top: 0 }); }
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
function formSettings() {
  return {
    ...settings,
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
  const used = getUsage();
  $('quota-info').textContent = `Caratteri inviati ad Azure questo mese da questo iPad: ${nf.format(used)} su ${nf.format(FREE_CHARS_PER_MONTH)} gratuiti (stima).`;
}

function openSettings() {
  const dlg = $('settings');
  if (dlg.open) return;
  $('set-key').value = settings.key;
  $('set-key').type = 'password';
  $('btn-toggle-key').textContent = 'Mostra';
  $('set-region').value = settings.region;
  fillVoices(settings.voice);
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
  toast('Impostazioni salvate.');
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
