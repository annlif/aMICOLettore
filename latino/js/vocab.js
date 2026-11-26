// Sezione VOCABOLARIO: lessico di base (offline), schede delle voci, analisi delle forme, ricerca.
import { Lexicon, parseLexicon, classeOf } from './morfo.js';
import { db } from './store.js';
import { $, esc, toast } from './ui.js';
import { normalize } from './testo.js';

let lexPromise = null;
/** Il lessico, caricato una sola volta (dal file nell'app: funziona anche offline). */
export function lexicon() {
  lexPromise ??= (async () => {
    const res = await fetch(new URL('../data/lessico.txt', import.meta.url));
    if (!res.ok) throw new Error('Lessico non disponibile');
    const L = new Lexicon(parseLexicon(await res.text()));
    return L;
  })();
  lexPromise.catch(() => { lexPromise = null; });
  return lexPromise;
}

export const olivettiUrl = (w) => `https://www.dizionario-latino.com/dizionario-latino-italiano.php?parola=${encodeURIComponent(normalize(w).replace(/^-/, ''))}`;

const STATO = {
  'da verificare': ['da verificare', 'warn'],
  controllata: ['controllata sull\'Olivetti', 'ok'],
  verificata: ['verificata dalla professoressa', 'ok'],
};
const PLURALE_CAT = { n: 'Nomi', agg: 'Aggettivi', v: 'Verbi', pron: 'Pronomi', avv: 'Avverbi', prep: 'Preposizioni', cong: 'Congiunzioni', inter: 'Interiezioni', num: 'Numerali' };

const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9a3.5 3.5 0 0 1 0 6"/></svg>';

/** Scheda completa di una voce. opts: { analisi, enclitica, form, compact } */
export function entryCard(e, opts = {}) {
  const [st, stCls] = STATO[e.stato] || STATO['da verificare'];
  const classe = classeOf(e);
  const an = opts.analisi?.length
    ? `<div class="an"><div class="an-h">${opts.form ? `<span lang="la">${esc(opts.form)}</span> può essere:` : 'Forma:'}</div><ul>${opts.analisi.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${opts.enclitica ? `<p class="an-enc">+ l'enclitica <b lang="la">-${esc(opts.enclitica)}</b> (${{ que: '“e”, unisce questa parola alla precedente', ne: 'segnala una domanda', ve: '“o”' }[opts.enclitica]})</p>` : ''}</div>`
    : '';
  return `<article class="card" data-id="${esc(e.id)}">
    <header class="card-h">
      <div>
        <h3 class="card-lemma" lang="la">${esc(e.paradigma)}</h3>
        <p class="card-cat">${esc(e.categoria)}${classe ? ` · ${esc(classe)}` : ''}${e.regge ? ` · regge: <b>${esc(e.regge)}</b>` : ''}</p>
      </div>
      <span class="badge ${stCls}">${esc(st)}</span>
    </header>
    ${an}
    ${e.connettivo ? `<p class="card-conn">Connettivo: ${esc(e.connettivo)}</p>` : ''}
    <ol class="card-sig">${e.significati.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${e.esempio && !opts.compact ? `<p class="card-ex" lang="la">${esc(e.esempio)}</p>` : ''}
    <div class="card-actions">
      <a class="pill" href="${olivettiUrl(e.lemma)}" target="_blank" rel="noopener">${ICON_EXT}Apri nell'Olivetti</a>
      <button class="pill" type="button" data-act="ascolta" data-text="${esc(e.lemma)}">${ICON_SOUND}Ascolta</button>
      <button class="pill coral" type="button" data-act="aggiungi" data-entry="${esc(e.id)}">${ICON_HEART}Aggiungi alle mie parole</button>
    </div>
  </article>`;
}

/** Riquadro "non trovata". */
function notFound(word, extra = '') {
  return `<div class="notfound">
    <p><b lang="la">${esc(word)}</b> non è ancora nel tuo vocabolario.</p>
    ${extra}
    <div class="card-actions">
      <a class="pill" href="${olivettiUrl(word)}" target="_blank" rel="noopener">${ICON_EXT}Cerca nell'Olivetti</a>
      <button class="pill coral" type="button" data-act="dacompletare" data-word="${esc(word)}">${ICON_HEART}Aggiungi al vocabolario</button>
    </div>
    <p class="muted small">"Aggiungi al vocabolario" la mette nella lista <b>da completare</b>: la scheda verrà compilata seguendo l'Olivetti.</p>
  </div>`;
}

// ---------- finestra della parola (dal menu nella versione) ----------
let wordCtx = null; // { word, sentence, versionId, versionTitle }
export function wordContext() { return wordCtx; }

export async function showWord(ctx, mode) {
  wordCtx = ctx;
  const sheet = $('word-sheet');
  $('word-title').textContent = ctx.word;
  $('word-mode').textContent = mode === 'analizza' ? 'Analisi della forma' : 'Vocabolario';
  $('word-body').innerHTML = '<p class="muted">Un momento…</p>';
  if (!sheet.open) sheet.showModal();
  const L = await lexicon();
  const res = L.analyze(ctx.word);
  let html = '';
  if (!res.length) {
    html = notFound(ctx.word);
  } else if (mode === 'analizza') {
    html += res.length > 1
      ? `<p class="hint-box">Questa forma può venire da <b>${res.length} parole diverse</b>. Guarda la frase e chiediti quale ha senso qui.</p>`
      : res[0].analisi.length > 1
        ? '<p class="hint-box">Questa forma ha <b>più analisi possibili</b>. Quale funziona nella frase? Cerca il verbo, il soggetto, le concordanze.</p>'
        : '';
    html += res.map((r) => entryCard(r.entry, { analisi: r.analisi, enclitica: r.enclitica, form: ctx.word, compact: true })).join('');
  } else {
    html += res.map((r) => entryCard(r.entry, { analisi: r.analisi, enclitica: r.enclitica, form: ctx.word })).join('');
  }
  if (ctx.sentence) html += `<p class="ctx">Nella frase: <span lang="la">${esc(ctx.sentence)}</span></p>`;
  $('word-body').innerHTML = html;
}

// ---------- sezione Vocabolario ----------
let filter = 'tutti';
let vocabQuery = '';
export async function showVocab() {
  const L = await lexicon();
  const counts = {};
  let conn = 0, prof = 0;
  for (const e of L.entries.values()) {
    counts[e.cat] = (counts[e.cat] || 0) + 1;
    if (e.connettivo) conn++;
    if (e.stato === 'verificata') prof++;
  }
  $('vocab-count').textContent = `${L.size} voci del primo anno · controllate sull'Olivetti · ${prof === L.size ? 'tutte verificate dalla professoressa' : `verificate dalla professoressa: ${prof}`}`;
  const chips = [['tutti', 'Tutte', L.size], ['connettivi', 'Connettivi', conn],
    ...Object.entries(PLURALE_CAT).filter(([k]) => counts[k]).map(([k, v]) => [k, v, counts[k]])];
  $('vocab-chips').innerHTML = chips.map(([k, label, n]) => `<button type="button" class="chip${filter === k ? ' on' : ''}" data-f="${k}">${label} <span>${n}</span></button>`).join('');
  renderVocabList(L);
}

function renderVocabList(L) {
  let list;
  if (vocabQuery) list = L.search(vocabQuery, 60).map((r) => r.entry);
  else list = [...L.entries.values()].sort((a, b) => normalize(a.lemma).replace(/^-/, '').localeCompare(normalize(b.lemma).replace(/^-/, '')));
  list = list.filter((e) => filter === 'tutti' || (filter === 'connettivi' ? !!e.connettivo : e.cat === filter));
  $('vocab-list').innerHTML = list.length
    ? list.map((e) => `<li><button type="button" class="vrow" data-open="${esc(e.id)}"><span class="vrow-l" lang="la">${esc(e.paradigma)}</span><span class="vrow-s">${esc(e.significati.slice(0, 2).join('; '))}</span></button></li>`).join('')
    : '<li class="muted">Nessuna voce trovata. Prova con un\'altra parola, oppure cercala nell\'Olivetti.</li>';
}

export function initVocab() {
  $('vocab-pdf').addEventListener('click', async () => {
    try {
      toast('Preparo l\'elenco…', 1500);
      const { lexiconPdf, shareFile } = await import('./esporta.js');
      const L = await lexicon();
      const list = [...L.entries.values()].sort((a, b) => normalize(a.lemma).replace(/^-/, '').localeCompare(normalize(b.lemma).replace(/^-/, '')));
      await shareFile(await lexiconPdf(list, classeOf), 'Lessico da verificare');
    } catch (e) { toast(e.message || String(e), 5000); }
  });
  $('word-sheet').addEventListener('close', () => { wordCtx = null; });
  $('vocab-chips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    for (const c of $('vocab-chips').children) c.classList.toggle('on', c === b);
    renderVocabList(await lexicon());
  });
  let t;
  $('vocab-search').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => { vocabQuery = $('vocab-search').value.trim(); renderVocabList(await lexicon()); }, 200);
  });
  $('vocab-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    const li = b.parentNode;
    const open = li.querySelector('.card');
    if (open) { open.remove(); b.classList.remove('open'); return; }
    const L = await lexicon();
    b.classList.add('open');
    b.insertAdjacentHTML('afterend', entryCard(L.entries.get(b.dataset.open)));
  });
}

// ---------- ricerca unica (barra in alto) ----------
export async function showSearch(q) {
  wordCtx = null;
  $('search-query').textContent = q;
  const out = $('search-results');
  out.innerHTML = '<p class="muted">Cerco…</p>';
  const L = await lexicon();
  const lex = L.search(q, 20);
  // versioni che contengono la parola
  const nq = normalize(q);
  const vers = [];
  if (nq.length >= 2) {
    for (const v of await db.versioni.all()) {
      const hits = v.sentences.map((s, i) => ({ s, i })).filter(({ s }) => normalize(s.la).includes(nq) || normalize(s.it).includes(nq));
      if (hits.length || normalize(v.title).includes(nq)) vers.push({ v, hits });
    }
  }
  let html = '';
  html += `<h2 class="res-h">Nel vocabolario</h2>`;
  html += lex.length
    ? lex.map((r) => entryCard(r.entry, { analisi: r.analisi, enclitica: r.enclitica, form: r.how === 'forma' ? q : null, compact: true })).join('')
    : notFound(q);
  if (vers.length) {
    html += `<h2 class="res-h">Nelle tue versioni</h2><ul class="res-vers">`;
    html += vers.map(({ v, hits }) => `<li><a href="#versione/${esc(v.id)}"><b>${esc(v.title)}</b>${hits.slice(0, 2).map(({ s, i }) => `<span class="res-sent"><span class="sent-n">${i + 1}</span> <span lang="la">${esc(s.la)}</span></span>`).join('')}</a></li>`).join('');
    html += '</ul>';
  }
  out.innerHTML = html;
}

// ---------- parole da completare ----------
export async function addToComplete(word, ctx = {}) {
  const id = `dc-${normalize(word)}`;
  const prev = await db.voci.get(id);
  const rec = prev || { id, tipo: 'dacompletare', parola: word, createdAt: Date.now(), contesti: [] };
  if (ctx.sentence && !rec.contesti.some((c) => c.sentence === ctx.sentence)) {
    rec.contesti.push({ sentence: ctx.sentence, versionId: ctx.versionId || null, versionTitle: ctx.versionTitle || '' });
  }
  await db.voci.put(rec);
  toast(prev ? `"${word}" era già nella lista da completare.` : `"${word}" aggiunta alla lista da completare. Brava!`);
}

export { STATO };

/** Lista delle parole da completare (nella sezione Vocabolario). */
export async function renderDaCompletare() {
  const list = (await db.voci.all()).filter((v) => v.tipo === 'dacompletare').sort((a, b) => b.createdAt - a.createdAt);
  $('dc-box').hidden = !list.length;
  $('dc-n').textContent = list.length;
  $('dc-list').innerHTML = list.map((v) => `<li>
    <span class="dc-word" lang="la">${esc(v.parola)}</span>
    <a class="pill" href="${olivettiUrl(v.parola)}" target="_blank" rel="noopener">${ICON_EXT}Olivetti</a>
    <button class="pill" type="button" data-dc-del="${esc(v.id)}">Togli</button>
    ${v.contesti[0] ? `<span class="dc-ctx">${esc(v.contesti[0].sentence)}</span>` : ''}
  </li>`).join('');
}

export function daCompletareText(list) {
  return 'aMICOLatino – parole da completare\n\n' + list.map((v) =>
    `• ${v.parola}${v.contesti.length ? '\n  ' + v.contesti.map((c) => `«${c.sentence}»${c.versionTitle ? ` (${c.versionTitle})` : ''}`).join('\n  ') : ''}`).join('\n');
}

export function initDaCompletare() {
  $('dc-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dc-del]');
    if (!b) return;
    await db.voci.del(b.dataset.dcDel);
    renderDaCompletare();
  });
  $('dc-export').addEventListener('click', async () => {
    const list = (await db.voci.all()).filter((v) => v.tipo === 'dacompletare');
    const text = daCompletareText(list);
    try {
      if (navigator.share) { await navigator.share({ title: 'Parole da completare', text }); return; }
    } catch (err) { if (err?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Lista copiata: incollala dove vuoi.'); }
    catch { toast('Non riesco a condividere la lista da qui.'); }
  });
}
