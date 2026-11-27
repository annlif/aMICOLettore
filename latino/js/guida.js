// GUIDA all'analisi della frase ("Aiutami"): una domanda alla volta, Micol risponde toccando le parole.
// Testi brevi; dopo ogni risposta giusta si va avanti solo con "Avanti" (c'è il tempo di leggere).
// Ordine: verbo principale → (quale verbo, se la forma è ambigua) → (con sum: predicato verbale o nominale?)
// → soggetto → complemento retto dal verbo → altri complementi, ragionati in tre passi: caso → domanda
// (elenco completo) → nome del complemento → analisi logica scritta. Non traduce mai: controlla solo che le risposte siano possibili.
import { $, esc, toast } from './ui.js';
import { lexicon, olivettiUrl } from './vocab.js';
import {
  analyzeSentence, verbLemmas, subjectCandidates, implicitSubject, complementType, complementCandidates, DOMANDA, isSum,
  COMPLEMENTI, checkComplement, agree, verbPassive, ETICHETTA_RETTO, DOMANDE, low,
  tipoPredicato, ipotesiFunzioni, formeCaso, nomeConcordato,
} from './struttura.js';
import { iaAttiva, analizzaConIA, dialogoAttivo } from './ai.js';
import { startTutor, stopTutor, tutorActive, tutorSentenceId, tutorTap, tutorClick } from './tutor.js';

let G = null; // stato della guida in corso
let cb = {};  // callback da versioni.js: { refresh(sentence), save(), focusTranslation(sentence) }

export function initGuida(callbacks) {
  cb = callbacks;
  $('guide-btns').addEventListener('click', (e) => {
    const bt = e.target.closest('[data-t]');
    if (bt && tutorActive()) return tutorClick(bt);
    const b = e.target.closest('[data-g]');
    if (!b || !G) return;
    const act = b.dataset.g;
    if (act === 'esci') return stopGuide();
    if (act === 'indizio') return hint();
    if (act === 'mostra') return show();
    if (act === 'no') return answerNo();
    if (act === 'lemma') return chooseLemma(b.dataset.id);
    if (act === 'pt') return choosePredType(b.dataset.id);
    if (act === 'comp') return chooseComplement(b.dataset.id);
    if (act === 'caso') return chooseCase(b.dataset.id);
    if (act === 'dom') return chooseQuestion(Number(b.dataset.id));
    if (act === 'avanti') return setStep(G.nextStep);
    if (act === 'fine-altri') return finish(b.dataset.force === '1');
    if (act === 'annulla-item') { G.prep = null; G.target = null; G.caso = null; G.dom = null; return setStep('altri'); }
    if (act === 'traduci') { const s = G.s; stopGuide(); cb.focusTranslation(s); }
  });
}

export const guideActive = () => !!G || tutorActive();
export const guideSentenceId = () => G?.s.id ?? tutorSentenceId();

export async function startGuide(s, modo = 'aiuto') {
  // con l'IA, la guida a dialogo: le domande le decide l'IA; se non risponde, si torna alle regole
  let notaDialogo = '';
  if (dialogoAttivo()) {
    const r = await startTutor(s, cb, modo);
    if (r.ok) return;
    if (r.msg === undefined) return; // uscita durante l'attesa
    notaDialogo = r.msg;
  }
  if (modo === 'controlla') { // senza IA non si può controllare la traduzione
    document.body.classList.remove('guiding'); $('guide-bar').hidden = true;
    toast(`${notaDialogo || 'Per controllare la traduzione serve l\'intelligenza artificiale.'} Riprova più tardi.`, 4000);
    return;
  }
  const L = await lexicon();
  const S = analyzeSentence(L, s.la);
  G = { s, S, L, step: null, errors: 0, v: null, lemmaId: null, type: null, prep: null, target: null, predType: null, caso: null, dom: null, nextStep: null };
  s.guida = { items: [] };
  document.body.classList.add('guiding');
  $('guide-bar').hidden = false;
  cb.refresh(s);
  // analisi con l'intelligenza artificiale (se attivata): una volta per frase, poi resta salvata
  let nota = '';
  if (iaAttiva() && !notaDialogo) {
    if (!(s.ia && s.iaLa === s.la && s.ia.v === IA_V)) {
      $('guide-q').innerHTML = 'Un momento: preparo la guida per questa frase…';
      $('guide-fb').innerHTML = ''; $('guide-btns').innerHTML = '';
      try { s.ia = await analizzaConIA(s.la); s.iaLa = s.la; cb.save(); } catch (e) { s.ia = null; nota = e.message; }
    }
    if (!G || G.s !== s) return;
  }
  if (s.ia && s.iaLa === s.la && s.ia.v === IA_V) applyIA(S, correggiIA(S, s.ia));
  $('guide-mode').textContent = S.ia ? '🧠 intelligenza artificiale' : 'regole dell\'app';
  setStep(S.verbs.length ? 'verb' : 'noverb');
  if (notaDialogo) nota = `${notaDialogo} Uso le regole dell'app.`;
  if (nota) feedback(esc(nota), true);
  else if (S.ia?.dubbi) feedback(`Nota: ${esc(S.ia.dubbi)}`, true);
}

const IA_V = 2; // versione delle istruzioni all'IA: le analisi salvate con istruzioni vecchie vengono richieste di nuovo

/**
 * Controlla l'analisi dell'IA con la morfologia (che è sicura): toglie dai complementi le parole che non hanno il caso
 * giusto (es. un genitivo infilato in "prope oram insulae") e corregge il tipo di predicato con sum quando le regole sono sicure.
 */
function correggiIA(S, ia0) {
  const ia = JSON.parse(JSON.stringify(ia0));
  const extra = [];
  ia.complementi = ia.complementi.map((c) => {
    const def = COMPLEMENTI.find((x) => x.id === c.tipo);
    if (!def?.forme) return c;
    const pk = c.parole.find((k) => S.isPrep(S.words[k]));
    const prep = pk != null ? low(S.words[pk].t) : null;
    const fit = (k) => S.words[k].unknown || S.words[k].an.some((a) => def.forme.some((f) => (f.preps ? f.preps.includes(prep) : prep == null) && f.caso === a.caso));
    const keep = c.parole.filter((k) => k === pk || fit(k));
    const head = keep.filter((k) => k !== pk);
    const ok = keep.concat(c.parole.filter((k) => !keep.includes(k) && head.some((h) => agree(S, k, h, true))));
    for (const k of c.parole.filter((x) => !ok.includes(x))) {
      if (S.words[k].an.some((a) => a.caso === 'gen')) extra.push({ parole: [k], tipo: 'specificazione', dipendeDa: head[0] ?? -1 });
    }
    return { ...c, parole: c.parole.filter((k) => ok.includes(k)) };
  }).filter((c) => c.parole.some((k) => !S.isPrep(S.words[k])));
  ia.complementi.push(...extra);
  const v = ia.principale.verbo;
  if (v >= 0 && isSum(S.words[v])) {
    const tp = tipoPredicato(S, v, ia.soggetto >= 0 ? ia.soggetto : null);
    if (tp.tipo && tp.tipo !== ia.principale.tipo) ia.principale = { ...ia.principale, tipo: tp.tipo, nomePredicato: tp.tipo === 'nominale' ? (tp.pred ?? -1) : -1 };
  }
  if (ia.principale.nomePredicato >= 0 && ia.principale.nomePredicato === ia.soggetto) ia.principale = { ...ia.principale, tipo: 'verbale', nomePredicato: -1 };
  return ia;
}

/** Sostituisce le "ipotesi" delle regole con l'analisi dell'IA (verbo principale, subordinate). */
function applyIA(S, ia) {
  S.ia = ia;
  const v = ia.principale.verbo;
  S.main = v >= 0 ? [v] : [];
  S.sub = new Map();
  S.spans = [];
  for (const sb of ia.subordinate) {
    const a = Math.min(...sb.parole), b = Math.max(...sb.parole);
    S.spans.push([sb.introduttore >= 0 ? sb.introduttore : a, b]);
    S.sub.set(sb.verbo, sb.introduttore >= 0 ? sb.introduttore : a);
  }
  S.verbs = [...new Set([...S.main, ...S.sub.keys()])].sort((x, y) => x - y);
  S.uncertain = false;
  S.inSub = (i) => S.spans.some(([a, b]) => i >= a && i <= b);
}
const IA = () => G.S.ia;
/** Soggetti possibili: dall'IA se c'è, altrimenti dalle regole. */
function subjC() {
  if (IA()) { const k = IA().soggetto; return k >= 0 ? { nouns: [k], adjs: [], all: [k] } : { nouns: [], adjs: [], all: [] }; }
  return subjectCandidates(G.S, G.v, G.lemmaId);
}
/** Parole del complemento retto dal verbo: dall'IA se c'è. */
function complC() {
  if (IA()) {
    if (G.type === 'pred') { const k = IA().principale.nomePredicato; return k >= 0 ? [k] : []; }
    const tipo = { acc: 'oggetto', dat: 'termine' }[G.type];
    if (tipo) return IA().complementi.filter((c) => c.tipo === tipo).flatMap((c) => c.parole).filter((k) => !G.S.isPrep(G.S.words[k]));
  }
  return complementCandidates(G.S, G.v, G.type, [G.s.guida.subj]);
}
/** Che cosa dice l'IA della parola k (complemento, attributo, apposizione), se lo sa. */
function iaInfo(k) {
  const a = IA();
  if (!a) return null;
  const c = a.complementi.find((x) => x.parole.includes(k));
  if (c) return { id: c.tipo, parole: c.parole, dip: c.dipendeDa };
  const at = a.attributi.find((x) => x.parola === k);
  if (at) return { id: 'attributo', rif: at.riferito };
  const ap = a.apposizioni.find((x) => x.parola === k);
  if (ap) return { id: 'apposizione', rif: ap.riferito };
  return null;
}

export function stopGuide() {
  if (tutorActive()) return stopTutor();
  if (!G) return;
  const s = G.s;
  G = null;
  document.body.classList.remove('guiding');
  $('guide-bar').hidden = true;
  cb.refresh(s);
  cb.save();
}

// ---------- utilità ----------
const w = (k) => G.S.words[k];
const tw = (k) => `<b lang="la">${esc(w(k).t)}</b>`;
function verbDesc(k, lemmaId = null) {
  const r = w(k).res.filter((x) => x.entry.cat === 'v' && (!lemmaId || x.entry.id === lemmaId));
  return r.flatMap((x) => x.analisi.filter((a) => /persona/.test(a)))[0] || '';
}
const usedWords = () => {
  const g = G.s.guida;
  return new Set([g.verb, g.subj, g.pred, g.obj, ...(g.items || []).flatMap((it) => it.ks)].filter((x) => x != null));
};
const afterVerb = () => (isSum(w(G.v)) ? 'predtype' : 'subj');
const afterSubj = () => (G.predType === 'verbale' ? 'altri' : 'compl');
const CASI = [['nom', 'nominativo'], ['gen', 'genitivo'], ['dat', 'dativo'], ['acc', 'accusativo'], ['abl', 'ablativo'], ['voc', 'vocativo']];
const casoIt = (c) => CASI.find((x) => x[0] === c)?.[1] || c;
const alCaso = (c) => (/^[aeiou]/.test(casoIt(c)) ? `all'${casoIt(c)}` : `al ${casoIt(c)}`);
/** Il pezzo che si sta analizzando (preposizione + parola). */
const pezzo = () => (G.prep != null ? `<b lang="la">${esc(w(G.prep).t)} ${esc(w(G.target).t)}</b>` : tw(G.target));
/** Riga con il ragionamento fatto finora sul pezzo: "in horto → ablativo → Dove?". */
const traccia = () => `<span class="g-trail">${[pezzo(), G.caso && casoIt(G.caso), G.dom != null && esc(DOMANDE[G.dom][0])].filter(Boolean).join(' → ')}</span>`;

// ---------- domande ----------
function setStep(step) {
  G.step = step;
  G.errors = 0;
  const S = G.S;
  let q = '', btns = [], chips = false;
  switch (step) {
    case 'noverb':
      q = 'Non trovo il verbo: forse è sottinteso <b>est</b> o <b>sunt</b>.';
      btns = [['avanti-noverb', 'Avanti →']];
      break;
    case 'verb':
      q = `Tocca il <b>verbo principale</b>.${S.verbs.length > 1 ? ` <span class="muted">(ci sono ${S.verbs.length} verbi)</span>` : ''}`;
      btns = [['indizio', 'Indizio']];
      break;
    case 'lemma': {
      const ls = verbLemmas(w(G.v));
      q = `${tw(G.v)} viene da <b>${ls.length} verbi diversi</b>: quale ha senso qui?`;
      btns = ls.map((e) => ['lemma', `${e.paradigma} – ${e.significati[0]}`, e.id]);
      break;
    }
    case 'predtype':
      q = `${tw(G.v)} è <b>essere</b>: predicato verbale o nominale?`;
      btns = [['pt', 'Predicato verbale', 'verbale'], ['pt', 'Predicato nominale', 'nominale'], ['indizio', 'Indizio']];
      break;
    case 'subj': {
      const imp = implicitSubject(S, G.v, G.lemmaId);
      q = `Tocca il <b>soggetto</b>${imp ? ` <span class="muted">(il verbo è alla persona di "${imp}")</span>` : ''}.`;
      btns = [['no', 'È sottinteso'], ['indizio', 'Indizio']];
      break;
    }
    case 'compl': {
      G.type = G.predType === 'nominale' ? 'pred' : complementType(S, G.v, G.lemmaId);
      const d = DOMANDA[G.type];
      q = d.q;
      btns = [['no', d.no], ['indizio', 'Indizio']];
      break;
    }
    case 'altri':
      q = G.s.guida.items.length
        ? 'Altri pezzi? Tocca una parola.'
        : 'Ora gli <b>altri pezzi</b>: tocca una parola <span class="muted">(prima la preposizione, se c\'è)</span>.';
      btns = [['fine-altri', G.s.guida.items.length ? 'Ho finito' : 'Non ce ne sono']];
      break;
    case 'altri-reg':
      q = `Tocca la parola retta da ${tw(G.prep)}.`;
      btns = [['indizio', 'Indizio'], ['annulla-item', 'Annulla']];
      break;
    case 'caso':
      q = `${traccia()}In che <b>caso</b> è?`;
      btns = [...CASI.map(([id, n]) => ['caso', n, id]), ['indizio', 'Indizio'], ['annulla-item', 'Annulla']];
      break;
    case 'domanda':
      q = `${traccia()}A quale <b>domanda</b> risponde?`;
      btns = [...DOMANDE.map(([d], i) => ['dom', d, String(i)]).filter(([, , i]) => G.prep == null || !DOMANDE[i][1].every((id) => COMPLEMENTI.find((c) => c.id === id).rif)), ['indizio', 'Indizio'], ['annulla-item', 'Annulla']];
      chips = true;
      break;
    case 'nome':
      q = `${traccia()}Allora che cos'è?`;
      btns = [...DOMANDE[G.dom][1].map((id) => ['comp', COMPLEMENTI.find((c) => c.id === id).nome, id]), ['annulla-item', 'Annulla']];
      chips = true;
      break;
    case 'dip':
      q = `${traccia()}Da quale <b>nome</b> dipende? Toccalo.`;
      btns = [['indizio', 'Indizio'], ['annulla-item', 'Annulla']];
      break;
    case 'rif':
      q = `Tocca il nome a cui si riferisce ${tw(G.target)}.`;
      btns = [['annulla-item', 'Annulla']];
      break;
    case 'fine':
      q = summary();
      btns = [['traduci', 'Ora scrivi la traduzione']];
      break;
    default: break;
  }
  btns.push(['esci', step === 'fine' ? 'Chiudi la guida' : 'Esci']);
  $('guide-q').innerHTML = q;
  $('guide-fb').innerHTML = '';
  $('guide-fb').className = 'guide-fb';
  renderButtons(btns, chips);
}

function renderButtons(btns, chips = false) {
  const cls = (g) => (g === 'esci' || g === 'annulla-item' ? 'ghost' : ['traduci', 'lemma', 'avanti', 'avanti-noverb'].includes(g) ? 'primary' : ['comp', 'dom', 'caso'].includes(g) ? 'chip-btn' : 'secondary');
  const html = btns.map(([g, label, id]) => `<button type="button" class="${cls(g)}" data-g="${g === 'avanti-noverb' ? 'no' : g}"${id ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`).join('');
  $('guide-btns').className = `guide-btns${chips ? ' chips-list' : ''}`;
  $('guide-btns').innerHTML = html + (G.errors >= 2 && ['verb', 'subj', 'compl', 'altri-reg', 'caso', 'domanda', 'nome', 'dip'].includes(G.step) ? '<button type="button" class="secondary" data-g="mostra">Mostrami</button>' : '');
}

function feedback(html, ok) {
  $('guide-fb').innerHTML = html;
  $('guide-fb').className = `guide-fb ${ok ? 'ok' : 'ko'}`;
}
function wrong(html) {
  G.errors++;
  feedback(`✗ ${html}`, false);
  if (G.errors === 2) {
    const cur = [...$('guide-btns').querySelectorAll('button')].filter((b) => b.dataset.g !== 'mostra').map((b) => [b.dataset.g, b.textContent, b.dataset.id]);
    renderButtons(cur, ['domanda', 'nome'].includes(G.step));
  }
}
function mark(field, k) {
  G.s.guida[field] = k;
  cb.refresh(G.s);
}
/** Risposta giusta: resta scritta finché Micol non tocca "Avanti". */
function done(html, nextStep) {
  G.step = 'ok';
  G.nextStep = nextStep;
  $('guide-q').innerHTML = '';
  feedback(html.startsWith('<span class="g-trail">') ? html.replace('</span>', '</span>✓ ') : `✓ ${html}`, true);
  renderButtons([['avanti', 'Avanti →'], ['esci', 'Esci']]);
  $('guide-btns').querySelector('[data-g="avanti"]')?.focus({ preventScroll: true });
}

// ---------- risposte: parole toccate ----------
export function tapWord(k) {
  if (tutorActive()) return tutorTap(k);
  if (!G) return;
  const S = G.S, x = w(k);
  const unk = x.unknown;
  switch (G.step) {
    case 'verb': {
      if (S.main.includes(k) || (S.uncertain && S.verbs.includes(k))) {
        mark('verb', k);
        G.v = k;
        const d = verbDesc(k);
        return done(`Sì! ${tw(k)} è il verbo principale${d ? `: ${esc(d)}` : ''}.${unk ? ' Controllalo nell\'Olivetti.' : ''}`, verbLemmas(x).length > 1 ? 'lemma' : afterVerb());
      }
      if (S.sub.has(k)) return wrong(`${tw(k)} sta in una <b>subordinata</b> (aperta da ${tw(S.sub.get(k))}).`);
      if (S.verbs.includes(k)) return wrong(`${tw(k)} è un verbo, ma non il principale.`);
      if (unk) return wrong(`${tw(k)} non sembra un verbo. Nel dubbio: <a href="${olivettiUrl(x.t)}" target="_blank" rel="noopener">Olivetti</a>.`);
      return wrong(`${tw(k)} non è un verbo: è ${esc(x.res[0]?.entry.categoria || 'un\'altra parola')}.`);
    }
    case 'subj': {
      const c = subjC();
      if (c.nouns.includes(k) || (!c.nouns.length && c.adjs.includes(k))) {
        mark('subj', k);
        return done(`Sì! ${tw(k)}: <b>nominativo</b>, concorda con il verbo.`, afterSubj());
      }
      if (c.adjs.includes(k)) return wrong(`${tw(k)} è un aggettivo: cerca un nome o un pronome.`);
      if (unk) { mark('subj', k); return done(`${tw(k)} non è nel vocabolario: va bene se è al nominativo.`, afterSubj()); }
      if (k === G.v) return wrong('Questo è il verbo.');
      if (S.inSub(k)) return wrong(`${tw(k)} sta in una subordinata.`);
      if (x.an.some((a) => a.caso === 'nom')) return wrong(`${tw(k)} è al nominativo, ma non concorda con il verbo.`);
      return wrong(`${tw(k)} non è al nominativo.`);
    }
    case 'compl': {
      const d = DOMANDA[G.type];
      const c = complC();
      const field = G.type === 'pred' ? 'pred' : 'obj';
      if (c.includes(k)) {
        mark(field, k);
        return done(`Sì! ${tw(k)} è ${G.type === 'inf' ? 'l\'infinito retto dal verbo' : `il <b>${d.nome}</b> (${d.caso})`}.`, 'altri');
      }
      if (unk) { mark(field, k); return done(`${tw(k)} non è nel vocabolario: va bene se è al ${d.caso}.`, 'altri'); }
      if (S.governed.has(k)) return wrong(`${tw(k)} dipende da ${tw(S.governed.get(k))}.`);
      return wrong(`${tw(k)} non è al <b>${d.caso}</b>.`);
    }
    case 'altri': {
      if (usedWords().has(k)) return wrong(`${tw(k)} l'hai già analizzata.`);
      if (k === G.v) return wrong('È il verbo principale: già fatto.');
      G.caso = null; G.dom = null;
      if (S.isPrep(x)) { G.prep = k; return setStep('altri-reg'); }
      G.prep = null; G.target = k;
      return setStep('caso');
    }
    case 'altri-reg': {
      const pe = w(G.prep).res.find((r) => r.entry.cat === 'prep').entry;
      const cases = [/accusativo/.test(pe.regge) && 'acc', /ablativo/.test(pe.regge) && 'abl'].filter(Boolean);
      if (k > G.prep && (cases.some((c) => S.hasCase(x, c)) || unk)) { G.target = k; return setStep('caso'); }
      return wrong(`${tw(k)} non dipende da ${tw(G.prep)}.`);
    }
    case 'dip': {
      const c = COMPLEMENTI.find((y) => y.id === G.compId);
      const inf = iaInfo(G.target);
      const nome = x.an.some((a) => (a.t === 'nome' || a.t === 'pron') && a.caso);
      if (k === G.target) return wrong('Tocca il nome da cui dipende, non la stessa parola.');
      if (!nome || k === G.v) return wrong(`${tw(k)} non è un nome: il genitivo dipende da un nome.`);
      if (inf?.dip != null && inf.dip >= 0 && inf.dip !== k) return wrong(`Grammaticalmente si può, ma nel senso della frase ${tw(G.target)} non dipende da ${tw(k)}.`);
      if (Math.abs(k - G.target) > 3) return wrong(`${tw(k)} è lontano: di solito il genitivo sta vicino al nome da cui dipende.`);
      const t0 = G.target, tr = traccia();
      const avviso = avvisoDativo(t0);
      addItem([t0], c, k);
      return done(`${tr}È un <b>${esc(c.nome)}</b> di ${tw(k)}.${avviso}`, 'altri');
    }
    case 'rif': {
      const c = COMPLEMENTI.find((y) => y.id === G.compId);
      if (k === G.target) return wrong('Tocca un\'altra parola: il nome.');
      const inf = iaInfo(G.target);
      if (inf?.rif != null && inf.rif !== k && agree(S, G.target, k, c.id === 'attributo')) return wrong('Concordano, ma nel senso della frase si riferisce a un altro nome.');
      if (agree(S, G.target, k, c.id === 'attributo')) {
        const t0 = G.target;
        addItem([t0], c, k);
        return done(`Sì! ${tw(t0)} è ${c.id === 'apposizione' ? 'apposizione' : 'attributo'} di ${tw(k)}.`, 'altri');
      }
      return wrong(`${tw(G.target)} e ${tw(k)} non concordano.`);
    }
    case 'ok':
      toast('Tocca "Avanti".');
      return null;
    default:
      toast('Usa i pulsanti della guida.');
  }
  return null;
}

function addItem(ks, c, rif = null) {
  G.s.guida.items.push({ ks: G.prep != null ? [G.prep, ...ks] : ks, id: c.id, nome: c.nome, rif, caso: G.caso ? casoIt(G.caso) : '' });
  G.prep = null; G.target = null; G.caso = null; G.dom = null;
  cb.refresh(G.s);
}

// ---------- complementi: caso → domanda → nome ----------
/** Casi possibili per il pezzo (con la preposizione: solo quelli che regge; con l'IA: solo quelli del complemento giusto). */
function casiPossibili() {
  const x = w(G.target);
  let cs = [...new Set(x.an.filter((a) => a.caso).map((a) => a.caso))];
  const prep = G.prep != null ? low(w(G.prep).t) : null;
  if (G.prep != null) {
    const r = (w(G.prep).res.find((y) => y.entry.cat === 'prep')?.entry.regge || '').toLowerCase();
    const pc = ['acc', 'abl'].filter((c) => r.includes(casoIt(c)));
    if (pc.length) cs = cs.filter((c) => pc.includes(c));
  }
  const inf = iaInfo(G.target);
  let fit = null;
  if (inf?.rif != null) fit = new Set(w(inf.rif).an.map((a) => a.caso));
  else if (inf) { const c = COMPLEMENTI.find((y) => y.id === inf.id); if (c?.forme) fit = new Set(c.forme.filter((f) => (f.preps ? f.preps.includes(prep) : prep == null)).map((f) => f.caso)); }
  if (fit) { const both = cs.filter((c) => fit.has(c)); if (both.length) cs = both; }
  return cs;
}

/** Motivo per cui una forma possibile è esclusa dal contesto (verbo non concordato, vocativo senza "o"...). */
function esclusa(c) {
  const ip = ipotesiFunzioni(G.S, G.target, G.v ?? G.S.main[0]).filter((x) => x.forma.startsWith(casoIt(c)));
  return ip.length && ip.every((x) => x.no) ? ip[0].no : '';
}

function chooseCase(c) {
  const x = w(G.target);
  if (x.unknown) { G.caso = c; return setStep('domanda'); }
  if (!x.an.some((a) => a.caso === c)) return wrong(`${tw(G.target)} non è ${alCaso(c)}: guarda la desinenza.`);
  if (G.prep != null) {
    const r = (w(G.prep).res.find((y) => y.entry.cat === 'prep')?.entry.regge || '').toLowerCase();
    if (r && !r.includes(casoIt(c))) return wrong(`${tw(G.prep)} non regge ${/^[aeiou]/.test(casoIt(c)) ? 'l\'' : 'il '}${casoIt(c)}.`);
  }
  const no = esclusa(c);
  if (no) return wrong(`Come <b>forma</b> può essere ${casoIt(c)}, ma qui no: ${esc(no)}.`);
  const cs = casiPossibili();
  if (cs.length && !cs.includes(c)) return wrong(`Come <b>forma</b> può essere ${casoIt(c)}, ma nel senso della frase no.`);
  G.caso = c;
  return setStep('domanda');
}

/** Complementi della domanda i che funzionano con il caso scelto (e la preposizione). */
function complementiValidi(i) {
  const prep = G.prep != null ? low(w(G.prep).t) : null;
  const passive = verbPassive(G.S, G.v ?? 0, G.lemmaId);
  return DOMANDE[i][1].filter((id) => {
    const c = COMPLEMENTI.find((y) => y.id === id);
    if (c.rif) return G.prep == null;
    if (c.passivo && !passive) return false;
    return w(G.target).unknown || c.forme.some((f) => (f.preps ? f.preps.includes(prep) : prep == null) && f.caso === G.caso);
  });
}

function chooseQuestion(i) {
  const inf = iaInfo(G.target);
  const ids = DOMANDE[i][1];
  if (inf) {
    if (!ids.includes(inf.id)) return wrong('No: nel senso di questa frase risponde a un\'altra domanda.');
  } else if (!complementiValidi(i).length) {
    return wrong(`Con ${G.prep != null ? `${tw(G.prep)} + ` : ''}${casoIt(G.caso)} non risponde a «${esc(DOMANDE[i][0])}».`);
  }
  G.dom = i;
  const validi = inf ? [inf.id] : complementiValidi(i);
  if (ids.length === 1) return chooseComplement(ids[0]);
  if (validi.length === 1 && !COMPLEMENTI.find((c) => c.id === validi[0]).rif) return chooseComplement(validi[0]);
  return setStep('nome');
}

/** Senza IA: se con lo stesso caso la domanda poteva portare ad altro, lo dice (ipotesi da verificare). */
function altreIpotesi(id) {
  const altri = DOMANDE.map((_, j) => j).filter((j) => j !== G.dom && complementiValidi(j).some((x) => x !== id && !COMPLEMENTI.find((c) => c.id === x).rif));
  return altri.length ? `<br><span class="muted">È un'ipotesi: con ${casoIt(G.caso)} potrebbe anche rispondere a ${altri.slice(0, 3).map((j) => `«${esc(DOMANDE[j][0])}»`).join(', ')}. Controlla il senso.</span>` : '';
}
/** Genitivo che potrebbe essere dativo con un verbo che regge il dativo (puellae con donat). */
function avvisoDativo(k) {
  const v = G.v ?? G.S.main[0];
  if (v == null || iaInfo(k)) return '';
  const r = (w(v).an.find((a) => a.entry?.regge)?.entry.regge || '').toLowerCase();
  return /dativo/.test(r) && w(k).an.some((a) => a.caso === 'dat')
    ? `<br><span class="muted">⚠ Attenzione: ${tw(k)} può essere anche dativo e ${tw(v)} regge il dativo. «A chi?» ha più senso?</span>` : '';
}

// ---------- risposte: pulsanti ----------
function answerNo() {
  const S = G.S;
  switch (G.step) {
    case 'noverb': return setStep('altri');
    case 'subj': {
      const c = subjC();
      if (c.all.length) return wrong(`C'è una parola al <b>nominativo</b> che concorda con ${tw(G.v)}.`);
      const imp = IA()?.soggettoSottinteso || implicitSubject(S, G.v, G.lemmaId);
      G.s.guida.subj = null;
      G.s.guida.subjImp = imp || 'egli/ella/essi';
      return done(`Giusto: soggetto sottinteso${imp ? ` (<b>${imp}</b>)` : ''}.`, afterSubj());
    }
    case 'compl': {
      const c = complC();
      if (c.length && G.type !== 'acc') return wrong(`C'è una parola al <b>${DOMANDA[G.type].caso}</b> che completa il verbo.`);
      if (c.length && G.type === 'acc') return wrong('Guarda meglio: c\'è una parola all\'<b>accusativo</b> che subisce l\'azione.');
      return done('Giusto, non c\'è.', 'altri');
    }
    default: return null;
  }
}

function chooseLemma(id) {
  G.lemmaId = id;
  const e = G.L.entries.get(id);
  done(`<b>${esc(e.lemma)}</b>${e.regge ? `, regge <b>${esc(e.regge)}</b>` : ''}.`, afterVerb());
}

function choosePredType(t) {
  const S = G.S;
  const tp = tipoPredicato(S, G.v);
  const sicuro = tp.tipo ?? IA()?.principale.tipo ?? null;
  if (!sicuro) { // incerto: due letture possibili, Micol sceglie ragionando sul senso
    G.predType = t;
    G.s.guida.predType = t;
    return done(`Può andare: ${esc(tp.perche)}. Scegli la lettura che ha senso: "${t === 'nominale' ? 'il soggetto è …' : 'c\'è …'}".`, 'subj');
  }
  if ((t === 'nominale') === (sicuro === 'nominale')) {
    G.predType = t;
    G.s.guida.predType = t;
    return done(t === 'nominale'
      ? `Sì! <b>Predicato nominale</b>: essere è la copula.${tp.tipo ? ` <span class="muted">(${esc(tp.perche)})</span>` : ''}`
      : `Sì! <b>Predicato verbale</b>: essere vuol dire "c'è, si trova".${tp.tipo ? ` <span class="muted">(${esc(tp.perche)})</span>` : ''}`, 'subj');
  }
  return wrong(t === 'nominale'
    ? `Qui essere vuol dire "c'è, si trova"${tp.tipo === 'verbale' ? `: ${esc(tp.perche)}` : ''}.`
    : `Guarda meglio: ${tp.tipo === 'nominale' ? esc(tp.perche) : 'c\'è una parola al nominativo che dice com\'è il soggetto'}.`);
}

function chooseComplement(id) {
  const c = COMPLEMENTI.find((x) => x.id === id);
  const inf = iaInfo(G.target);
  if (inf && inf.id !== id) return wrong(`No: nel senso della frase non è un ${esc(c.nome)}.`);
  if (c.rif) { G.compId = id; return setStep('rif'); }
  if (['specificazione', 'partitivo'].includes(id) && G.prep == null) { G.compId = id; G.dom ??= DOMANDE.findIndex(([, ids]) => ids.includes(id)); return setStep('dip'); }
  const r = checkComplement(G.S, G.target, G.prep, id, { passive: verbPassive(G.S, G.v ?? 0, G.lemmaId) });
  if (!r.ok) return wrong(r.msg);
  const tr = traccia();
  const alt = !inf ? altreIpotesi(id) : '';
  addItem([G.target], c);
  return done(`${tr}È un <b>${esc(c.nome)}</b>.${r.unsure ? ' (Parola non nel vocabolario: controlla il caso.)' : ''}${alt}`, 'altri');
}

function finish(force) {
  const preps = G.S.words.filter((x, i) => G.S.isPrep(x) && !G.S.inSub(i) && !usedWords().has(i));
  if (preps.length && !force) {
    feedback(`C'è ancora una preposizione: ${preps.map((x) => `<b lang="la">${esc(x.t)}</b>`).join(', ')}.`, false);
    $('guide-btns').insertAdjacentHTML('afterbegin', '<button type="button" class="ghost" data-g="fine-altri" data-force="1">Ho finito lo stesso</button>');
    return;
  }
  G.s.guida.rows = analysisRows();
  setStep('fine');
}

// ---------- indizi e "Mostrami" ----------
function hint() {
  const S = G.S;
  const H = {
    verb: () => (S.spans.length
      ? `${S.spans.map(([o]) => tw(o)).join(', ')} apre una subordinata: il principale è fuori.`
      : 'Cerca le desinenze -o, -s, -t, -mus, -tis, -nt, -tur, -ntur. Spesso è in fondo.'),
    predtype: () => 'C\'è un nome o aggettivo al nominativo che dice com\'è il soggetto? Allora è nominale.',
    subj: () => {
      const f = verbDesc(G.v, G.lemmaId);
      return `Cerca un <b>nominativo ${/plurale/.test(f) ? 'plurale' : 'singolare'}</b>.`;
    },
    compl: () => ({
      acc: 'Accusativo: -am, -um, -em, -as, -os, -es, -a. Non dopo una preposizione.',
      dat: 'Dativo: -ae, -o, -i, -is, -ibus.',
      abl: 'Ablativo: -a, -o, -e, -i, -is, -ibus.',
      inf: 'Infinito: -are, -ere, -ire.',
      pred: 'È al nominativo e dice com\'è o che cos\'è il soggetto.',
    }[G.type]),
    'altri-reg': () => 'Di solito viene subito dopo la preposizione.',
    caso: () => `<b>Forma</b> (sicura): ${tw(G.target)} può essere ${esc(formeCaso(w(G.target)).join(' · ') || '?')}.${G.prep != null ? ` ${tw(G.prep)} regge: ${esc(w(G.prep).res.find((r) => r.entry.cat === 'prep')?.entry.regge || '?')}.` : ''}`,
    domanda: () => ipotesiHtml(),
    dip: () => 'Il genitivo dipende di solito dal nome che gli sta vicino: «la riva <i>dell\'isola</i>».',
  };
  const f = H[G.step];
  if (f) { feedback(`💡 ${f()}`, true); $('guide-fb').className = 'guide-fb hint'; }
}

/** Ipotesi sulla funzione (da verificare) per il caso scelto, con la domanda-guida. */
function ipotesiHtml() {
  const ip = ipotesiFunzioni(G.S, G.target, G.v ?? G.S.main[0]).filter((x) => !G.caso || x.forma.startsWith(casoIt(G.caso)));
  const righe = ip.filter((x) => !x.no && x.funzioni.length).map((x) => `${esc(x.forma)}: ${x.funzioni.map((f) => `${esc(f.nome)} → <i>${esc(f.domanda)}</i>`).join('; ')}`);
  return righe.length ? `<b>Ipotesi</b> (da verificare sul senso):<br>${righe.join('<br>')}` : 'Rileggi la frase con il verbo e prova le domande: dove? quando? con chi? come? perché?';
}

function show() {
  const S = G.S;
  let k = null;
  if (G.step === 'verb') k = S.main[0] ?? S.verbs[0];
  if (G.step === 'subj') k = subjC().all[0];
  if (G.step === 'compl') k = complC()[0];
  if (G.step === 'altri-reg') k = S.words.findIndex((x, i) => S.governed.get(i) === G.prep);
  if (G.step === 'caso') { feedback(`Può essere: <b>${casiPossibili().map(casoIt).join(' o ')}</b>.`, true); return; }
  const inf = iaInfo(G.target);
  if (G.step === 'domanda') {
    const i = inf ? DOMANDE.findIndex(([, ids]) => ids.includes(inf.id)) : -1;
    if (i >= 0) feedback(`Risponde a: <b>${esc(DOMANDE[i][0])}</b>`, true);
    else feedback(ipotesiHtml(), true);
    return;
  }
  if (G.step === 'dip') { const d = inf?.dip >= 0 ? inf.dip : [G.target - 1, G.target + 1, G.target - 2].find((j) => j >= 0 && j < S.words.length && j !== G.v && w(j).an.some((a) => a.t === 'nome' && a.caso)); k = d ?? null; }
  if (G.step === 'nome' && inf) { feedback(`È un <b>${esc(COMPLEMENTI.find((x) => x.id === inf.id).nome)}</b>.`, true); return; }
  if (k == null || k < 0) { feedback('Qui non riesco a mostrartelo: ragiona sul senso.', true); return; }
  const el = document.querySelector(`.sent[data-id="${G.s.id}"] .w[data-k="${k}"]`);
  el?.classList.add('g-hint');
  feedback(`Eccolo: ${tw(k)}. Toccalo.`, true);
}

// ---------- analisi logica scritta ----------
/** Righe dell'analisi logica: [{ testo, ruolo, nota }] (salvate con la frase, anche per il PDF). */
function analysisRows() {
  const g = G.s.guida, S = G.S;
  const t = (k) => w(k).t;
  const rows = [];
  if (g.verb != null) {
    const d = verbDesc(g.verb, G.lemmaId);
    if (g.predType === 'nominale' && g.pred != null) rows.push({ testo: `${t(g.pred)} … ${t(g.verb)}`, ruolo: 'predicato nominale', nota: `copula ${t(g.verb)} + nome del predicato ${t(g.pred)}` });
    else rows.push({ testo: t(g.verb), ruolo: 'predicato verbale', nota: d });
  }
  if (g.subj != null) rows.push({ testo: t(g.subj), ruolo: 'soggetto', nota: '' });
  else if (g.verb != null) rows.push({ testo: '—', ruolo: 'soggetto sottinteso', nota: g.subjImp || '' });
  if (g.obj != null) rows.push({ testo: t(g.obj), ruolo: ETICHETTA_RETTO[G.type] || 'complemento', nota: '' });
  for (const it of g.items || []) {
    rows.push({ testo: it.ks.map(t).join(' '), ruolo: it.rif != null ? `${it.nome} di ${t(it.rif)}` : it.nome, nota: it.caso || '' });
  }
  if (S.ia) for (const sb of S.ia.subordinate) rows.push({ testo: `${t(Math.min(...sb.parole))} … ${t(Math.max(...sb.parole))}`, ruolo: `proposizione subordinata ${sb.tipo}`.trim(), nota: '' });
  else if (S.spans.length) rows.push({ testo: S.spans.map(([a, b]) => `${t(a)} … ${t(b)}`).join('; '), ruolo: 'proposizione subordinata', nota: 'non analizzata dalla guida' });
  return rows;
}

function summary() {
  const rows = G.s.guida.rows || [];
  const chip = (r) => (/predicato/.test(r.ruolo) ? 'g-verb' : /soggetto/.test(r.ruolo) ? 'g-subj' : /attributo|apposizione/.test(r.ruolo) ? 'g-attr' : /subordinata/.test(r.ruolo) ? 'g-sub' : /oggetto|termine|retto|nome del predicato/.test(r.ruolo) ? 'g-obj' : 'g-prep');
  return `<b>Brava!</b> Ecco l'<b>analisi logica</b> <span class="muted">(tra parentesi la forma, che è sicura; la funzione è da verificare sul senso)</span>:<ul class="g-sum">${rows.map((r) => `<li><span class="g-chip ${chip(r)}">${esc(r.ruolo)}</span> <b lang="la">${esc(r.testo)}</b>${r.nota ? ` <span class="muted">(${esc(r.nota)})</span>` : ''}</li>`).join('')}</ul>Ora traduci: parti da predicato e soggetto.`;
}

export { isSum };
