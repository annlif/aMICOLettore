// Sezione VERSIONI: elenco delle versioni salvate e pagina di lavoro (frasi + traduzione di Micol).
import { db } from './store.js';
import { $, esc, toast, fmtDate, debounce, autosize, openMenu, closeMenu } from './ui.js';
import { readPdf, cleanVersion, letterCount, makeSentences, tokenize, newId } from './testo.js';
import { lexicon } from './vocab.js';
import { shareText, versionPdf, shareFile } from './esporta.js';

let go = () => {};          // navigazione, fornita da app.js
let wordActions = () => []; // azioni del menu di una parola, fornite da app.js
let speak = () => {};
export function initVersioni(opts) {
  go = opts.go;
  wordActions = opts.wordActions;
  speak = opts.speak || speak;
  $('btn-load-pdf').addEventListener('click', () => $('pdf-input').click());
  $('pdf-input').addEventListener('change', onPdfChosen);
  $('btn-paste').addEventListener('click', () => { $('paste-title').value = ''; $('paste-text').value = ''; $('paste-dialog').showModal(); });
  $('paste-dialog').addEventListener('close', onPasteClosed);
  $('scan-dialog').addEventListener('close', () => { if ($('scan-dialog').returnValue === 'paste') $('btn-paste').click(); });
  $('ver-list').addEventListener('click', onListClick);
  $('ver-back').addEventListener('click', () => go('versioni'));
  $('ver-title-input').addEventListener('change', onTitleChanged);
  $('ver-sentences').addEventListener('click', onSentencesClick);
  $('ver-sentences').addEventListener('input', onTranslationInput);
  $('ver-sentences').addEventListener('focusin', onFocusIn);
  $('ver-sentences').addEventListener('focusout', () => saveSoon.flush());
  $('ver-split-cancel').addEventListener('click', () => setSplitMode(null));
  $('edit-dialog').addEventListener('close', onEditClosed);
  $('ver-conn').addEventListener('click', () => { setConnOn(!connOn()); markConnectives(); });
  $('ver-export').addEventListener('click', () => openMenu($('ver-export'), 'Esporta la versione', [
    { label: 'Salva o condividi come PDF', icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>', action: exportPdf },
    { label: 'Condividi come testo', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>', action: () => { saveSoon.flush(); shareText(cur).catch((e) => toast(e.message)); } },
  ]));
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSoon.flush(); });
  window.addEventListener('pagehide', () => saveSoon.flush());
}

// ======================= ELENCO =======================
export async function showList() {
  saveSoon.flush();
  const list = (await db.versioni.all()).sort((a, b) => b.updatedAt - a.updatedAt);
  $('ver-empty').hidden = list.length > 0;
  $('ver-list').innerHTML = list.map((v) => {
    const done = v.sentences.filter((s) => s.it.trim()).length;
    const tot = v.sentences.length;
    const pct = tot ? Math.round((done / tot) * 100) : 0;
    return `<li class="lib-item" data-id="${esc(v.id)}">
      <button class="lib-open" type="button" data-open="${esc(v.id)}">
        <span class="lib-name">${esc(v.title)}</span>
        <span class="lib-meta">Caricata il ${fmtDate(v.createdAt)} · ${done === tot && tot ? 'tutte le frasi tradotte ✓' : `${done} di ${tot} frasi tradotte`}</span>
        <span class="lib-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </button>
      <button class="lib-del" type="button" data-del="${esc(v.id)}" aria-label="Elimina ${esc(v.title)}">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </li>`;
  }).join('');
}

async function onListClick(e) {
  const open = e.target.closest('[data-open]');
  if (open) { go(`versione/${open.dataset.open}`); return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    const v = await db.versioni.get(del.dataset.del);
    if (v && confirm(`Eliminare la versione "${v.title}" con la tua traduzione?\nNon si potrà recuperare (se non da un backup).`)) {
      await db.versioni.del(v.id);
      showList();
      toast('Versione eliminata.');
    }
  }
}

// ======================= CARICAMENTO =======================
async function onPdfChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const busy = $('ver-busy');
  busy.hidden = false;
  try {
    const { pages, title } = await readPdf(await file.arrayBuffer(), {
      askPassword: (wrong) => prompt(wrong ? 'Password sbagliata. Riprova:' : 'Questo PDF è protetto da una password:'),
    });
    const all = pages.map((p) => p.lines.join('\n'));
    const letters = all.reduce((n, t) => n + letterCount(t), 0);
    if (letters < 30) { showScanned(file.name); return; }
    const empty = all.filter((t) => letterCount(t) < 10).length;
    const { latin, notes, titleGuess } = cleanVersion(pages);
    if (!latin) { showScanned(file.name); return; }
    const v = await createVersion({
      title: titleGuess || title || file.name.replace(/\.pdf$/i, ''),
      fileName: file.name, source: 'pdf', notes, latin,
    });
    go(`versione/${v.id}`);
    if (empty) toast(`Attenzione: ${empty} ${empty === 1 ? 'pagina sembra una scansione' : 'pagine sembrano scansioni'} senza testo e non ${empty === 1 ? 'è stata letta' : 'sono state lette'}.`, 7000);
    else toast(`Ho diviso la versione in ${v.sentences.length} frasi. Buon lavoro!`);
  } catch (err) {
    console.error(err);
    if (err?.name === 'PasswordException') return;
    alert('Non riesco ad aprire questo PDF. Forse è danneggiato o non è un PDF.\n\n(' + (err?.message || err) + ')');
  } finally {
    busy.hidden = true;
  }
}

function showScanned(name) {
  $('scan-name').textContent = name;
  $('scan-dialog').showModal();
}

async function onPasteClosed() {
  const d = $('paste-dialog');
  if (d.returnValue !== 'ok') return;
  const raw = $('paste-text').value;
  const { latin, notes, titleGuess } = cleanVersion([{ lines: raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) }]);
  if (!latin) { toast('Non ho trovato testo da dividere in frasi.'); return; }
  const v = await createVersion({ title: $('paste-title').value.trim() || titleGuess || 'Versione senza titolo', source: 'testo', notes, latin });
  go(`versione/${v.id}`);
  toast(`Ho diviso la versione in ${v.sentences.length} frasi. Buon lavoro!`);
}

async function createVersion({ title, fileName = null, source, notes, latin }) {
  const now = Date.now();
  const v = { id: newId('v'), title, fileName, source, notes, createdAt: now, updatedAt: now, lastIndex: 0, sentences: makeSentences(latin) };
  await db.versioni.put(v);
  return v;
}

// ======================= PAGINA DELLA VERSIONE =======================
let cur = null; // versione aperta
let splitFor = null; // id della frase da dividere

export async function showVersion(id) {
  saveSoon.flush();
  setSplitMode(null);
  cur = await db.versioni.get(id);
  if (!cur) { toast('Questa versione non esiste più.'); go('versioni'); return false; }
  $('ver-title-input').value = cur.title;
  const notes = cur.notes?.filter(Boolean) || [];
  $('ver-notes').hidden = !notes.length;
  $('ver-notes-text').innerHTML = notes.map((n) => `<p>${esc(n)}</p>`).join('');
  renderSentences();
  updateProgress();
  // riprendi dal punto in cui era arrivata
  const li = $('ver-sentences').children[cur.lastIndex || 0];
  if (li && cur.lastIndex) requestAnimationFrame(() => li.scrollIntoView({ block: 'center' }));
  return true;
}

function renderSentences() {
  $('ver-sentences').innerHTML = cur.sentences.map((s, i) => `
    <li class="sent" data-id="${esc(s.id)}">
      <span class="sent-num" aria-hidden="true">${i + 1}</span>
      <div class="sent-la" lang="la">${tokenize(s.la).map((p) => (p.w ? `<span class="w" role="button" tabindex="0" data-w="${esc(p.t)}">${esc(p.t)}</span>` : esc(p.t))).join('')}</div>
      <div class="sent-it">
        <textarea rows="2" lang="it" aria-label="La tua traduzione della frase ${i + 1}" placeholder="La tua traduzione…">${esc(s.it)}</textarea>
      </div>
      <button class="sent-more" type="button" data-more aria-label="Altre azioni per la frase ${i + 1}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
      </button>
    </li>`).join('');
  for (const ta of $('ver-sentences').querySelectorAll('textarea')) autosize(ta);
  markConnectives();
}

// ---------- connettivi ----------
const CONN_KEY = 'amicolatino.connettivi';
const connOn = () => { try { return localStorage.getItem(CONN_KEY) === '1'; } catch { return false; } };
const setConnOn = (on) => { try { localStorage.setItem(CONN_KEY, on ? '1' : '0'); } catch { /* ignora */ } };
// connettivi che possono avere valori diversi a seconda della frase
const MULTI = new Set(['cum', 'ut', 'ne', 'quod', 'ubi', 'dum', 'quam', 'si', 'an', 'num', 'quoque', 'vel']);
async function markConnectives() {
  const on = connOn();
  $('ver-conn').setAttribute('aria-pressed', String(on));
  $('conn-legend').hidden = !on;
  const words = $('ver-sentences').querySelectorAll('.w');
  if (!on) { for (const w of words) w.classList.remove('conn', 'amb'); return; }
  const L = await lexicon();
  for (const w of words) {
    const res = L.analyze(w.dataset.w).filter((r) => !r.enclitica);
    const conn = res.filter((r) => r.entry.connettivo);
    w.classList.toggle('conn', conn.length > 0);
    const amb = conn.length > 0 && (res.length > conn.length || conn.length > 1 || conn.some((r) => MULTI.has(r.entry.lemma)));
    w.classList.toggle('amb', amb);
    if (conn.length) w.title = amb ? 'Connettivo con più valori possibili: ragionaci!' : `Connettivo: ${conn[0].entry.connettivo}`;
    else w.removeAttribute('title');
  }
}

// ---------- esportazione ----------
async function exportPdf() {
  saveSoon.flush();
  try {
    toast('Preparo il PDF…', 1500);
    const file = await versionPdf(cur);
    const how = await shareFile(file, cur.title);
    if (how === 'download') toast('PDF salvato.');
  } catch (e) { toast(e.message || String(e), 5000); }
}

function updateProgress() {
  const done = cur.sentences.filter((s) => s.it.trim()).length;
  const tot = cur.sentences.length;
  $('ver-meta').textContent = `Caricata il ${fmtDate(cur.createdAt)} · ${done} di ${tot} frasi tradotte`;
  $('ver-progress').style.width = `${tot ? (done / tot) * 100 : 0}%`;
  if (done === tot && tot && !cur.completedAt) {
    cur.completedAt = Date.now();
    toast('Bravissima! Hai tradotto tutte le frasi. Rileggi tutto con calma 🎉', 5000);
    saveSoon();
  }
}

// ---------- salvataggio automatico ----------
async function save() {
  if (!cur) return;
  cur.updatedAt = Date.now();
  try {
    await db.versioni.put(cur);
    const s = $('ver-saved');
    s.textContent = 'Salvato ✓';
    s.classList.add('on');
    clearTimeout(save.t);
    save.t = setTimeout(() => s.classList.remove('on'), 1500);
  } catch (e) {
    console.error(e);
    toast('Non riesco a salvare: forse lo spazio sull\'iPad è finito.', 6000);
  }
}
const saveSoon = debounce(save, 500);

function sentenceOf(el) {
  const li = el.closest('.sent');
  return li ? cur.sentences.find((s) => s.id === li.dataset.id) : null;
}

function onTranslationInput(e) {
  if (e.target.tagName !== 'TEXTAREA' || !cur) return;
  const s = sentenceOf(e.target);
  if (!s) return;
  s.it = e.target.value;
  autosize(e.target);
  updateProgress();
  saveSoon();
}

function onFocusIn(e) {
  const li = e.target.closest('.sent');
  if (!li || !cur) return;
  const i = [...li.parentNode.children].indexOf(li);
  if (i !== cur.lastIndex) { cur.lastIndex = i; saveSoon(); }
}

async function onTitleChanged() {
  const t = $('ver-title-input').value.trim();
  if (!cur) return;
  if (!t) { $('ver-title-input').value = cur.title; return; }
  cur.title = t;
  await save();
}

// ---------- parole e menu delle frasi ----------
function onSentencesClick(e) {
  const w = e.target.closest('.w');
  if (w) {
    const s = sentenceOf(w);
    if (splitFor) { splitAt(w); return; }
    openMenu(w, `<span lang="la">${esc(w.dataset.w)}</span>`, wordActions({ word: w.dataset.w, sentence: s.la, versionId: cur.id, versionTitle: cur.title }));
    return;
  }
  const more = e.target.closest('[data-more]');
  if (more) {
    const s = sentenceOf(more);
    const i = cur.sentences.indexOf(s);
    openMenu(more, `Frase ${i + 1}`, [
      { label: 'Ascolta la frase', action: () => speak(s.la),
        icon: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9a3.5 3.5 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"/>' },
      { label: 'Unisci con la frase successiva', action: () => merge(i), disabled: i >= cur.sentences.length - 1,
        icon: '<path d="M8 4v6a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4V4M12 14v6"/>' },
      { label: 'Dividi in due frasi', action: () => setSplitMode(s.id), disabled: tokenize(s.la).filter((p) => p.w).length < 2,
        icon: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>' },
      { label: 'Correggi il testo latino', action: () => editLatin(s),
        icon: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/>' },
    ]);
  }
}

function merge(i) {
  const a = cur.sentences[i], b = cur.sentences[i + 1];
  if (!b) return;
  a.la = `${a.la} ${b.la}`;
  a.it = [a.it.trim(), b.it.trim()].filter(Boolean).join(' ');
  cur.sentences.splice(i + 1, 1);
  renderSentences(); updateProgress(); save();
  toast('Frasi unite.');
}

function setSplitMode(id) {
  splitFor = id;
  document.body.classList.toggle('splitting', !!id);
  $('ver-split-bar').hidden = !id;
  for (const li of $('ver-sentences').children) {
    li.classList.toggle('split-target', li.dataset.id === id);
    if (li.dataset.id === id) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function splitAt(w) {
  const li = w.closest('.sent');
  if (li.dataset.id !== splitFor) { toast('Tocca una parola della frase evidenziata.'); return; }
  const s = cur.sentences.find((x) => x.id === splitFor);
  const words = [...li.querySelectorAll('.w')];
  const k = words.indexOf(w);
  if (k <= 0) { toast('La nuova frase deve cominciare dopo la prima parola.'); return; }
  // posizione della parola nel testo latino
  let pos = 0, n = 0;
  for (const p of tokenize(s.la)) { if (p.w) { if (n === k) break; n++; } pos += p.t.length; }
  const first = s.la.slice(0, pos).trim(), second = s.la.slice(pos).trim();
  const i = cur.sentences.indexOf(s);
  cur.sentences.splice(i, 1, { ...s, la: first }, { id: newId(), la: second, it: '' });
  setSplitMode(null);
  renderSentences(); updateProgress(); save();
  toast('Frase divisa. La traduzione è rimasta nella prima parte.');
}

let editing = null;
function editLatin(s) {
  editing = s;
  $('edit-text').value = s.la;
  $('edit-dialog').showModal();
}
function onEditClosed() {
  if ($('edit-dialog').returnValue !== 'ok' || !editing) return;
  const t = $('edit-text').value.replace(/\s+/g, ' ').trim();
  if (t && t !== editing.la) { editing.la = t; renderSentences(); save(); toast('Testo corretto.'); }
  editing = null;
}

export function currentVersion() { return cur; }
export function leaveVersion() { saveSoon.flush(); setSplitMode(null); closeMenu(); }
