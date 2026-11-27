// GUIDA A DIALOGO CON L'INTELLIGENZA ARTIFICIALE: l'IA decide ogni domanda, come un insegnante, in base a quello che
// Micol risponde. L'app le fornisce solo le FORME delle parole (dal vocabolario controllato: sono certe) e mostra
// domanda, riscontro e pulsanti: Micol risponde toccando le parole o scegliendo un'opzione, non c'è una chat libera.
// L'IA non traduce. Se non risponde, la guida torna alle regole dell'app.
import { $, esc } from './ui.js';
import { lexicon } from './vocab.js';
import { tokenize } from './testo.js';
import { chiamaJSON, modelloIA } from './ai.js';

import { ISTRUZIONI_TUTOR, SCHEMA_TUTOR, validaTurno, schedaForme } from './tutor-ia.js';

let T = null;   // dialogo in corso
let cb = {};

export const tutorActive = () => !!T;
export const tutorSentenceId = () => T?.s.id;

const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b lang="la">$1</b>');

/** Avvia il dialogo. Restituisce true se l'IA ha risposto, false (con il motivo) se bisogna usare le regole. */
export async function startTutor(s, callbacks) {
  cb = callbacks;
  const L = await lexicon();
  const parole = tokenize(s.la).filter((p) => p.w).map((p) => p.t);
  T = { s, parole, forme: schedaForme(L, parole), storia: [], segni: [], attesa: false, ultimo: null, turno: null };
  s.guida = { items: [] };
  document.body.classList.add('guiding');
  $('guide-bar').hidden = false;
  $('guide-mode').textContent = '🧠 a dialogo con l\'IA';
  cb.refresh(s);
  $('guide-q').innerHTML = 'Un momento: leggo la frase…';
  $('guide-fb').innerHTML = ''; $('guide-fb').className = 'guide-fb';
  $('guide-btns').innerHTML = '<button type="button" class="ghost" data-t="esci">Esci</button>';
  const ok = await turno('Micol ha chiesto aiuto su questa frase: comincia.');
  if (!ok && T?.s === s && !T.turno) { const msg = T.errore; T = null; return { ok: false, msg }; }
  return { ok: !!T };
}

export function stopTutor() {
  if (!T) return;
  const s = T.s;
  T = null;
  document.body.classList.remove('guiding');
  $('guide-bar').hidden = true;
  cb.refresh(s);
  cb.save();
}

/** Un passo del dialogo: manda all'IA l'ultima azione di Micol e mostra la risposta. */
async function turno(azione) {
  if (!T || T.attesa) return false;
  const t0 = T;
  T.attesa = true;
  T.ultimo = azione;
  attesa(true);
  const storia = T.storia.map((x) => `${x.chi}: ${x.testo}`).join('\n') || '(nessuno)';
  const user = `Frase: ${T.s.la}\n\nParole numerate e FORME (certe, dal vocabolario dell'app):\n${T.forme}\n\nDialogo finora:\n${storia}\n\nUltima azione di Micol: ${azione}`;
  let r;
  try {
    r = validaTurno(await chiamaJSON(ISTRUZIONI_TUTOR, user, SCHEMA_TUTOR, 'passo_guida', 0.2), T.parole.length);
    if (!r) throw new Error('Risposta dell\'intelligenza artificiale non valida.');
  } catch (e) {
    if (T !== t0) return false;
    T.attesa = false;
    T.errore = e.message;
    if (T.turno) mostraErrore(e.message);
    return false;
  }
  if (T !== t0) return false;
  T.attesa = false;
  T.storia.push({ chi: 'Micol', testo: azione });
  T.storia.push({ chi: 'Insegnante', testo: `${r.riscontro ? `${r.riscontro} ` : ''}${r.domanda}${r.tipo === 'scegli' ? ` [opzioni: ${r.opzioni.join(' / ')}]` : ''}` });
  T.turno = r;
  applicaSegni(r.segna);
  if (r.tipo === 'fine') concludi(r);
  else mostra(r);
  return true;
}

function attesa(on) {
  for (const b of $('guide-btns').querySelectorAll('button')) if (b.dataset.t !== 'esci') b.disabled = on;
  if (on) { $('guide-fb').innerHTML = '<span class="muted">Sto pensando…</span>'; $('guide-fb').className = 'guide-fb'; }
}

function mostra(r) {
  $('guide-q').innerHTML = md(r.domanda);
  $('guide-fb').innerHTML = r.riscontro ? `${r.esito === 'giusto' ? '✓ ' : r.esito === 'sbagliato' ? '✗ ' : ''}${md(r.riscontro)}` : '';
  $('guide-fb').className = `guide-fb ${{ giusto: 'ok', sbagliato: 'ko', parziale: 'hint' }[r.esito] || (r.riscontro ? 'hint' : '')}`;
  const opz = r.opzioni.map((o, i) => `<button type="button" class="chip-btn" data-t="opz" data-i="${i}">${md(o)}</button>`).join('');
  $('guide-btns').className = `guide-btns${r.opzioni.length ? ' chips-list' : ''}`;
  $('guide-btns').innerHTML = `${opz}<button type="button" class="secondary" data-t="capito">Non ho capito</button><button type="button" class="secondary" data-t="mostra">Mostrami</button><button type="button" class="ghost" data-t="esci">Esci</button>`;
}

function mostraErrore(msg) {
  $('guide-fb').innerHTML = `${esc(msg)} Riprova tra poco.`;
  $('guide-fb').className = 'guide-fb ko';
  for (const b of $('guide-btns').querySelectorAll('button')) b.disabled = false;
  if (!$('guide-btns').querySelector('[data-t="riprova"]')) $('guide-btns').insertAdjacentHTML('afterbegin', '<button type="button" class="primary" data-t="riprova">Riprova</button>');
}

/** I ruoli stabiliti colorano le parole come nella guida con le regole. */
function applicaSegni(segna) {
  const g = T.s.guida;
  for (const { parole, ruolo } of segna) {
    if (ruolo === 'verbo' && g.verb == null) g.verb = parole[0];
    else if (ruolo === 'soggetto') g.subj = parole[0];
    else if (ruolo === 'nome-predicato') g.pred = parole[0];
    else if (ruolo === 'oggetto') g.obj = parole[0];
    else if (ruolo !== 'verbo' && !g.items.some((it) => it.ks.join() === parole.join())) g.items.push({ ks: parole, id: ruolo, nome: ruolo });
  }
  cb.refresh(T.s);
}

function concludi(r) {
  const rows = r.analisi.map((x) => ({ testo: x.parole.map((k) => T.parole[k]).join(' '), ruolo: x.funzione, nota: x.caso }));
  T.s.guida.rows = rows;
  T.s.guida.modello = modelloIA();
  cb.save();
  const chip = (ruolo) => (/predicato/.test(ruolo) ? 'g-verb' : /soggetto/.test(ruolo) ? 'g-subj' : /attributo|apposizione/.test(ruolo) ? 'g-attr' : /subordinata/.test(ruolo) ? 'g-sub' : /oggetto|nome del predicato/.test(ruolo) ? 'g-obj' : 'g-prep');
  $('guide-q').innerHTML = `${r.riscontro ? `${md(r.riscontro)} ` : ''}Ecco l'<b>analisi logica</b> <span class="muted">(tra parentesi la forma; la funzione è da verificare sul senso)</span>:<ul class="g-sum">${rows.map((x) => `<li><span class="g-chip ${chip(x.ruolo)}">${esc(x.ruolo)}</span> <b lang="la">${esc(x.testo)}</b>${x.nota ? ` <span class="muted">(${esc(x.nota)})</span>` : ''}</li>`).join('')}</ul>${md(r.domanda)}`;
  $('guide-fb').innerHTML = ''; $('guide-fb').className = 'guide-fb';
  $('guide-btns').className = 'guide-btns';
  $('guide-btns').innerHTML = '<button type="button" class="primary" data-t="traduci">Ora scrivi la traduzione</button><button type="button" class="ghost" data-t="esci">Chiudi la guida</button>';
}

/** Micol ha toccato una parola della frase. */
export function tutorTap(k) {
  if (!T || T.attesa || !T.turno || T.turno.tipo === 'fine') return;
  turno(`ha toccato [${k}] ${T.parole[k]}`);
}

/** Pulsanti della barra della guida. */
export function tutorClick(b) {
  if (!T) return;
  const t = b.dataset.t;
  if (t === 'esci') return stopTutor();
  if (t === 'traduci') { const s = T.s; stopTutor(); cb.focusTranslation(s); return; }
  if (T.attesa) return;
  if (t === 'opz') turno(`ha scelto «${T.turno.opzioni[Number(b.dataset.i)]}»`);
  else if (t === 'capito') turno('non ha capito la domanda: riformulala più semplice');
  else if (t === 'mostra') turno('chiede di vedere la risposta (Mostrami): dagliela spiegandola in breve, poi vai avanti');
  else if (t === 'riprova') turno(T.ultimo);
}
