// Sezione LE MIE PAROLE: il vocabolario personale di Micol.
// Ogni parola rimanda alla scheda del vocabolario e conserva le frasi in cui l'ha incontrata.
// I significati non si modificano qui (vengono dal vocabolario): Micol può scrivere solo i suoi appunti.
import { db } from './store.js';
import { $, esc, toast, debounce, autosize } from './ui.js';
import { lexicon, entryCard, olivettiUrl, showWord } from './vocab.js';
import { normalize } from './testo.js';

const CAT = { n: 'Nomi', agg: 'Aggettivi', v: 'Verbi', pron: 'Pronomi', avv: 'Avverbi', prep: 'Preposizioni', cong: 'Congiunzioni', inter: 'Interiezioni', num: 'Numerali' };
let filter = 'tutte';

/** Aggiunge una voce del vocabolario alle mie parole (con la frase in cui è stata incontrata). */
export async function addWord(entryId, ctx = {}) {
  const L = await lexicon();
  const e = L.entries.get(entryId);
  if (!e) return;
  const id = `p-${entryId}`;
  const prev = await db.parole.get(id);
  const rec = prev || { id, entryId, lemma: e.lemma, cat: e.cat, connettivo: !!e.connettivo, createdAt: Date.now(), contesti: [], appunti: '' };
  const c = ctx.sentence ? { sentence: ctx.sentence, form: ctx.word || '', versionId: ctx.versionId || null, versionTitle: ctx.versionTitle || '' } : null;
  const nuovo = c && !rec.contesti.some((x) => x.sentence === c.sentence);
  if (nuovo) rec.contesti.push(c);
  await db.parole.put(rec);
  if (!prev) toast(`"${e.lemma}" è tra le tue parole. Brava!`);
  else toast(nuovo ? `Ho aggiunto la nuova frase a "${e.lemma}".` : `"${e.lemma}" è già tra le tue parole.`);
}

/** Dal menu della parola: se la forma corrisponde a una sola voce la aggiunge, altrimenti fa scegliere. */
export async function addFromWord(ctx) {
  const L = await lexicon();
  const res = L.analyze(ctx.word);
  if (res.length === 1) return addWord(res[0].entry.id, ctx);
  await showWord(ctx, 'cerca');
  const body = $('word-body');
  body.insertAdjacentHTML('afterbegin', res.length
    ? `<p class="hint-box">Questa forma può venire da <b>${res.length} parole diverse</b>: scegli quale aggiungere con il pulsante "Aggiungi alle mie parole".</p>`
    : '');
}

export async function showParole() {
  const L = await lexicon();
  const parole = (await db.parole.all()).filter((p) => L.entries.has(p.entryId));
  const attesa = (await db.voci.all()).filter((v) => v.tipo === 'dacompletare');
  const counts = {};
  for (const p of parole) counts[p.cat] = (counts[p.cat] || 0) + 1;
  const conn = parole.filter((p) => p.connettivo).length;
  $('parole-count').textContent = parole.length
    ? `${parole.length} ${parole.length === 1 ? 'parola' : 'parole'}${attesa.length ? ` · ${attesa.length} in attesa della scheda` : ''}`
    : '';
  $('parole-empty').hidden = parole.length + attesa.length > 0;
  const chips = [['tutte', 'Tutte', parole.length], ['connettivi', 'Connettivi', conn],
    ...Object.entries(CAT).filter(([k]) => counts[k]).map(([k, v]) => [k, v, counts[k]])];
  $('parole-chips').hidden = !parole.length;
  $('parole-chips').innerHTML = chips.map(([k, label, n]) => `<button type="button" class="chip${filter === k ? ' on' : ''}" data-f="${k}">${label} <span>${n}</span></button>`).join('');

  const shown = parole
    .filter((p) => filter === 'tutte' || (filter === 'connettivi' ? p.connettivo : p.cat === filter))
    .sort((a, b) => normalize(a.lemma).replace(/^-/, '').localeCompare(normalize(b.lemma).replace(/^-/, '')));
  // i connettivi in una sezione a parte (quando si guardano tutte le parole)
  const groups = filter === 'tutte' ? [['Connettivi', shown.filter((p) => p.connettivo)], ['Altre parole', shown.filter((p) => !p.connettivo)]] : [[null, shown]];
  let html = '';
  for (const [title, list] of groups) {
    if (!list.length) continue;
    if (title && groups.some(([, l]) => l.length && l !== list)) html += `<h2 class="res-h">${title}</h2>`;
    html += list.map((p) => wordBlock(p, L.entries.get(p.entryId))).join('');
  }
  if (attesa.length && filter === 'tutte') {
    html += '<h2 class="res-h">In attesa della scheda</h2>';
    html += attesa.map((v) => `<article class="card wait"><div class="card-h"><h3 class="card-lemma" lang="la">${esc(v.parola)}</h3><span class="badge warn">da completare</span></div>
      <p class="muted">Non è ancora nel vocabolario: la scheda verrà compilata seguendo l'Olivetti. Intanto puoi cercarla lì.</p>
      ${v.contesti.map((c) => `<p class="ctx">Nella frase: <span lang="la">${esc(c.sentence)}</span></p>`).join('')}
      <div class="card-actions"><a class="pill" href="${olivettiUrl(v.parola)}" target="_blank" rel="noopener">Apri nell'Olivetti</a></div></article>`).join('');
  }
  $('parole-list').innerHTML = html;
  for (const ta of $('parole-list').querySelectorAll('textarea')) autosize(ta);
}

function wordBlock(p, e) {
  const ctx = p.contesti.map((c, i) => `<li><span lang="la">${esc(c.sentence)}</span>
      ${c.versionId ? `<a class="ctx-link" href="#versione/${esc(c.versionId)}">${esc(c.versionTitle || 'apri la versione')}</a>` : ''}
      <button class="mini" type="button" data-ctx-del="${i}" aria-label="Togli questa frase">×</button></li>`).join('');
  return `<section class="pword" data-pid="${esc(p.id)}">
    ${entryCard(e, { compact: false }).replace(/<button class="pill coral"[^]*?<\/button>/, '')}
    <div class="pword-extra">
      <h4>Dove l'hai incontrata</h4>
      ${ctx ? `<ul class="ctx-list">${ctx}</ul>` : '<p class="muted small">Aggiunta dal vocabolario.</p>'}
      <label class="notes-l">I miei appunti <span class="muted small">(non cambiano la scheda del vocabolario)</span>
        <textarea data-notes rows="2" placeholder="Un trucco per ricordarla, una frase che ti piace…">${esc(p.appunti || '')}</textarea></label>
      <button class="danger small-btn" type="button" data-pdel>Togli dalle mie parole</button>
    </div>
  </section>`;
}

const saveNotes = debounce(async (id, text) => {
  const p = await db.parole.get(id);
  if (p) { p.appunti = text; await db.parole.put(p); }
}, 500);

export function initParole() {
  $('parole-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    showParole();
  });
  $('parole-list').addEventListener('input', (e) => {
    if (!e.target.matches('[data-notes]')) return;
    autosize(e.target);
    saveNotes(e.target.closest('[data-pid]').dataset.pid, e.target.value);
  });
  $('parole-list').addEventListener('focusout', () => saveNotes.flush());
  $('parole-list').addEventListener('click', async (e) => {
    const sec = e.target.closest('[data-pid]');
    if (!sec) return;
    const id = sec.dataset.pid;
    if (e.target.closest('[data-pdel]')) {
      const p = await db.parole.get(id);
      if (p && confirm(`Togliere "${p.lemma}" dalle tue parole?`)) { await db.parole.del(id); showParole(); toast('Parola tolta.'); }
      return;
    }
    const c = e.target.closest('[data-ctx-del]');
    if (c) {
      const p = await db.parole.get(id);
      p.contesti.splice(Number(c.dataset.ctxDel), 1);
      await db.parole.put(p);
      showParole();
    }
  });
}
