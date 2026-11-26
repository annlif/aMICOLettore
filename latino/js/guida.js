// GUIDA all'analisi della frase ("Aiutami"): una domanda alla volta, Micol risponde toccando le parole.
// Ordine: verbo principale → (quale verbo, se la forma è ambigua) → (con sum: predicato verbale o nominale?)
// → soggetto → complemento retto dal verbo → altri complementi, attributi e apposizioni (scelti dall'elenco
// completo) → analisi logica scritta. Non traduce mai: controlla solo che le risposte siano possibili.
import { $, esc, toast } from './ui.js';
import { lexicon, olivettiUrl } from './vocab.js';
import {
  analyzeSentence, verbLemmas, subjectCandidates, implicitSubject, complementType, complementCandidates, DOMANDA, isSum,
  COMPLEMENTI, checkComplement, agree, verbPassive, ETICHETTA_RETTO,
} from './struttura.js';

let G = null; // stato della guida in corso
let cb = {};  // callback da versioni.js: { refresh(sentence), save(), focusTranslation(sentence) }

export function initGuida(callbacks) {
  cb = callbacks;
  $('guide-btns').addEventListener('click', (e) => {
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
    if (act === 'fine-altri') return finish(b.dataset.force === '1');
    if (act === 'annulla-item') { G.prep = null; G.target = null; return setStep('altri'); }
    if (act === 'traduci') { const s = G.s; stopGuide(); cb.focusTranslation(s); }
  });
}

export const guideActive = () => !!G;
export const guideSentenceId = () => G?.s.id;

export async function startGuide(s) {
  const L = await lexicon();
  const S = analyzeSentence(L, s.la);
  G = { s, S, L, step: null, errors: 0, v: null, lemmaId: null, type: null, prep: null, target: null, predType: null, warnedPrep: false };
  s.guida = { items: [] };
  document.body.classList.add('guiding');
  $('guide-bar').hidden = false;
  cb.refresh(s);
  setStep(S.verbs.length ? 'verb' : 'noverb');
}

export function stopGuide() {
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

// ---------- domande ----------
function setStep(step) {
  G.step = step;
  G.errors = 0;
  const S = G.S;
  let q = '', btns = [];
  switch (step) {
    case 'noverb':
      q = 'In questa frase non trovo un verbo di modo finito. Forse è sottinteso <b>est</b> o <b>sunt</b> (frase nominale): prova a leggerla aggiungendo "è" o "sono".';
      btns = [['no', 'Va bene, avanti']];
      break;
    case 'verb':
      q = S.verbs.length > 1
        ? `In questa frase ci sono <b>${S.verbs.length} verbi</b>. Qual è il <b>verbo principale</b>? Toccalo.`
        : 'Qual è il <b>verbo principale</b>? Toccalo.';
      btns = [['indizio', 'Dammi un indizio']];
      break;
    case 'lemma': {
      const ls = verbLemmas(w(G.v));
      q = `${tw(G.v)} può venire da <b>${ls.length} verbi diversi</b>. Quale ha senso in questa frase? (Se non sei sicura, guarda il vocabolario.)`;
      btns = ls.map((e) => ['lemma', `${e.paradigma} – ${e.significati[0]}`, e.id]);
      break;
    }
    case 'predtype':
      q = `Il verbo principale ${tw(G.v)} è una forma di <b>essere</b> (sum). È un <b>predicato verbale</b> o un <b>predicato nominale</b>?`;
      btns = [['pt', 'Predicato verbale', 'verbale'], ['pt', 'Predicato nominale', 'nominale'], ['indizio', 'Dammi un indizio']];
      break;
    case 'subj': {
      const imp = implicitSubject(S, G.v, G.lemmaId);
      q = imp
        ? `Il verbo ${tw(G.v)} è alla persona di <b>"${imp}"</b>. Chi è il <b>soggetto</b>? Se non c'è una parola, tocca "È sottinteso".`
        : `Chi è il <b>soggetto</b> di ${tw(G.v)}? Toccalo. (Chi compie l'azione${G.predType === 'nominale' ? ' o di chi si dice qualcosa' : ''}?)`;
      btns = [['no', 'È sottinteso'], ['indizio', 'Dammi un indizio']];
      break;
    }
    case 'compl': {
      G.type = G.predType === 'nominale' ? 'pred' : complementType(S, G.v, G.lemmaId);
      const d = DOMANDA[G.type];
      q = d.q;
      btns = [['no', d.no], ['indizio', 'Dammi un indizio']];
      break;
    }
    case 'altri': {
      const n = G.s.guida.items.length;
      q = n
        ? 'Ci sono <b>altri complementi</b>, attributi o apposizioni? Tocca la parola (se c\'è una preposizione, tocca prima la preposizione).'
        : 'Ora gli <b>altri elementi</b> della frase: complementi, attributi, apposizioni. Tocca una parola (se c\'è una preposizione, tocca prima la preposizione).';
      btns = [['fine-altri', n ? 'Ho finito' : 'Non ce ne sono']];
      break;
    }
    case 'altri-reg':
      q = `Ora tocca la parola che <b>${esc(w(G.prep).t)}</b> regge.`;
      btns = [['indizio', 'Dammi un indizio'], ['annulla-item', 'Annulla']];
      break;
    case 'scegli': {
      const lbl = G.prep != null ? `<b lang="la">${esc(w(G.prep).t)} ${esc(w(G.target).t)}</b>` : tw(G.target);
      q = `Che cos'è ${lbl}? Scegli dall'elenco.`;
      btns = [...COMPLEMENTI.filter((c) => G.prep == null || !c.rif).map((c) => ['comp', c.nome.replace(/^complemento /, 'c. '), c.id]), ['annulla-item', 'Annulla']];
      break;
    }
    case 'rif': {
      const c = COMPLEMENTI.find((x) => x.id === G.compId);
      q = `${tw(G.target)} è un${c.id === 'apposizione' ? '\'apposizione' : ' attributo'}: tocca il <b>nome</b> a cui si riferisce.`;
      btns = [['annulla-item', 'Annulla']];
      break;
    }
    case 'fine':
      q = summary();
      btns = [['traduci', 'Ora scrivi la traduzione']];
      break;
    default: break;
  }
  btns.push(['esci', step === 'fine' ? 'Chiudi la guida' : 'Esci dalla guida']);
  $('guide-q').innerHTML = q;
  $('guide-fb').innerHTML = '';
  $('guide-fb').className = 'guide-fb';
  renderButtons(btns, step === 'scegli');
}

function renderButtons(btns, chips = false) {
  const cls = (g) => (g === 'esci' || g === 'annulla-item' ? 'ghost' : g === 'traduci' || g === 'lemma' ? 'primary' : g === 'comp' ? 'chip-btn' : 'secondary');
  const html = btns.map(([g, label, id]) => `<button type="button" class="${cls(g)}" data-g="${g}"${id ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`).join('');
  $('guide-btns').className = `guide-btns${chips ? ' chips-list' : ''}`;
  $('guide-btns').innerHTML = html + (G.errors >= 2 && ['verb', 'subj', 'compl', 'altri-reg'].includes(G.step) ? '<button type="button" class="secondary" data-g="mostra">Mostrami</button>' : '');
}

function feedback(html, ok) {
  $('guide-fb').innerHTML = html;
  $('guide-fb').className = `guide-fb ${ok ? 'ok' : 'ko'}`;
}
function wrong(html) {
  G.errors++;
  feedback(html, false);
  if (G.errors === 2) {
    const cur = [...$('guide-btns').querySelectorAll('button')].filter((b) => b.dataset.g !== 'mostra').map((b) => [b.dataset.g, b.textContent, b.dataset.id]);
    renderButtons(cur, G.step === 'scegli');
  }
}
function mark(field, k) {
  G.s.guida[field] = k;
  cb.refresh(G.s);
}
const next = (step, delay = 900) => setTimeout(() => { if (G) setStep(step); }, delay);

// ---------- risposte: parole toccate ----------
export function tapWord(k) {
  if (!G) return;
  const S = G.S, x = w(k);
  const unk = x.unknown;
  switch (G.step) {
    case 'verb': {
      if (S.main.includes(k) || (S.uncertain && S.verbs.includes(k))) {
        mark('verb', k);
        G.v = k;
        const d = verbDesc(k);
        feedback(`Sì! ${tw(k)} è il verbo principale${d ? `: ${esc(d)}` : ''}.${unk ? ' (Non è nel vocabolario: controllalo nell\'Olivetti.)' : ''}`, true);
        return next(verbLemmas(x).length > 1 ? 'lemma' : afterVerb(), 1400);
      }
      if (S.sub.has(k)) return wrong(`${tw(k)} è un verbo, ma sta nella proposizione introdotta da ${tw(S.sub.get(k))}: è una <b>subordinata</b>. Il verbo principale è fuori dalle subordinate.`);
      if (S.verbs.includes(k)) return wrong(`${tw(k)} è un verbo, ma non sembra il principale. Guarda bene come è costruita la frase.`);
      if (unk) return wrong(`${tw(k)} non è nel vocabolario e non ha la desinenza di un verbo. Cercala nell'<a href="${olivettiUrl(x.t)}" target="_blank" rel="noopener">Olivetti</a> se non sei sicura.`);
      const cat = x.res[0]?.entry.categoria || 'parola';
      return wrong(`${tw(k)} non è un verbo: è ${['preposizione', 'congiunzione', 'interiezione'].includes(cat) ? 'una' : 'un'} ${esc(cat)}. Cerca una parola con la desinenza di un verbo (-t, -nt, -mus, -tur…).`);
    }
    case 'subj': {
      const c = subjectCandidates(S, G.v, G.lemmaId);
      if (c.nouns.includes(k) || (!c.nouns.length && c.adjs.includes(k))) {
        mark('subj', k);
        feedback(`Sì! ${tw(k)} può essere il soggetto: è al <b>nominativo</b> e concorda con il verbo.`, true);
        return next(G.predType === 'verbale' ? 'altri' : 'compl', 1300);
      }
      if (c.adjs.includes(k)) return wrong(`${tw(k)} è un aggettivo al nominativo: di solito accompagna il soggetto o è il nome del predicato. Cerca un nome o un pronome.`);
      if (unk) { mark('subj', k); feedback(`${tw(k)} non è nel vocabolario, quindi non posso controllarla: se è al nominativo, va bene. Controlla nell'<a href="${olivettiUrl(x.t)}" target="_blank" rel="noopener">Olivetti</a>.`, true); return next(G.predType === 'verbale' ? 'altri' : 'compl', 2200); }
      if (k === G.v) return wrong('Questo è il verbo: il soggetto è chi compie l\'azione.');
      if (S.inSub(k)) return wrong(`${tw(k)} sta in una subordinata: il soggetto del verbo principale va cercato fuori.`);
      if (x.an.some((a) => a.caso === 'nom')) return wrong(`${tw(k)} è al nominativo, ma non concorda con il verbo nel numero (singolare/plurale).`);
      return wrong(`${tw(k)} non è al nominativo, quindi non può essere il soggetto.`);
    }
    case 'compl': {
      const d = DOMANDA[G.type];
      const c = complementCandidates(S, G.v, G.type, [G.s.guida.subj]);
      const field = G.type === 'pred' ? 'pred' : 'obj';
      if (c.includes(k)) {
        mark(field, k);
        feedback(`Sì! ${tw(k)} è ${G.type === 'inf' ? 'l\'infinito retto dal verbo' : `il <b>${d.nome}</b> (${d.caso})`}.`, true);
        return next('altri', 1300);
      }
      if (unk) { mark(field, k); feedback(`${tw(k)} non è nel vocabolario: se è al caso giusto (${d.caso}), va bene. Controlla nell'Olivetti.`, true); return next('altri', 2000); }
      if (S.governed.has(k)) return wrong(`${tw(k)} dipende dalla preposizione ${tw(S.governed.get(k))}: non è il ${d.nome}.`);
      return wrong(`${tw(k)} non può essere il ${d.nome}: cerca una parola al <b>${d.caso}</b>.`);
    }
    case 'altri': {
      if (usedWords().has(k)) return wrong(`${tw(k)} l'hai già analizzata.`);
      if (S.isPrep(x)) { G.prep = k; return setStep('altri-reg'); }
      if (k === G.v) return wrong('Questo è il verbo principale: l\'hai già trovato.');
      G.prep = null; G.target = k;
      return setStep('scegli');
    }
    case 'altri-reg': {
      const pe = w(G.prep).res.find((r) => r.entry.cat === 'prep').entry;
      const cases = [/accusativo/.test(pe.regge) && 'acc', /ablativo/.test(pe.regge) && 'abl'].filter(Boolean);
      if (k > G.prep && (cases.some((c) => S.hasCase(x, c)) || unk)) { G.target = k; return setStep('scegli'); }
      return wrong(`${tw(k)} non può dipendere da ${tw(G.prep)}: cerca una parola dopo la preposizione, al ${cases.map((c) => (c === 'acc' ? 'accusativo' : 'ablativo')).join(' o ')}.`);
    }
    case 'rif': {
      const c = COMPLEMENTI.find((y) => y.id === G.compId);
      if (k === G.target) return wrong('Tocca il nome a cui si riferisce, non la stessa parola.');
      if (agree(S, G.target, k, c.id === 'attributo')) {
        addItem([G.target], c, k);
        feedback(`Sì! ${tw(G.target)} è ${c.id === 'apposizione' ? 'apposizione' : 'attributo'} di ${tw(k)}: ${c.id === 'apposizione' ? 'sono nello stesso caso' : 'concordano in genere, numero e caso'}.`, true);
        return next('altri', 1500);
      }
      return wrong(`${tw(G.target)} e ${tw(k)} non concordano (${c.id === 'apposizione' ? 'caso e numero' : 'genere, numero e caso'}): cerca un altro nome.`);
    }
    default:
      toast('Usa i pulsanti della guida qui sotto.');
  }
}

function addItem(ks, c, rif = null) {
  G.s.guida.items.push({ ks: G.prep != null ? [G.prep, ...ks] : ks, id: c.id, nome: c.nome, rif });
  G.prep = null; G.target = null;
  cb.refresh(G.s);
}

// ---------- risposte: pulsanti ----------
function answerNo() {
  const S = G.S;
  switch (G.step) {
    case 'noverb': return setStep('altri');
    case 'subj': {
      const c = subjectCandidates(S, G.v, G.lemmaId);
      if (c.all.length) return wrong(`Guarda meglio: nella frase c'è una parola al <b>nominativo</b> che concorda con ${tw(G.v)}.`);
      const imp = implicitSubject(S, G.v, G.lemmaId);
      G.s.guida.subj = null;
      G.s.guida.subjImp = imp || 'egli/ella/essi';
      feedback(`Giusto: il soggetto è sottinteso${imp ? ` (<b>${imp}</b>)` : ' (egli, ella o essi: lo capisci dal contesto)'}.`, true);
      return next(G.predType === 'verbale' ? 'altri' : 'compl', 1500);
    }
    case 'compl': {
      const c = complementCandidates(S, G.v, G.type, [G.s.guida.subj]);
      if (c.length && G.type !== 'acc') return wrong(`Guarda meglio: c'è una parola al <b>${DOMANDA[G.type].caso}</b> che completa il verbo.`);
      if (c.length && G.type === 'acc') { feedback('Va bene. Però c\'è una parola all\'accusativo: controlla se è proprio un oggetto o fa altro.', true); return next('altri', 2200); }
      feedback('Giusto, non c\'è.', true);
      return next('altri', 1000);
    }
    default: return null;
  }
}

function chooseLemma(id) {
  G.lemmaId = id;
  const e = G.L.entries.get(id);
  feedback(`Va bene: ${esc(e.lemma)}${e.regge ? `, che regge <b>${esc(e.regge)}</b>` : ''}.`, true);
  next(afterVerb(), 1200);
}

function choosePredType(t) {
  const S = G.S;
  const noms = complementCandidates(S, G.v, 'pred', []);
  const adj = noms.some((k) => w(k).an.some((a) => a.caso === 'nom' && (a.t === 'agg' || a.t === 'part')));
  const nominale = adj || noms.length >= 2 || (noms.length >= 1 && implicitSubject(S, G.v, G.lemmaId));
  if ((t === 'nominale') === !!nominale) {
    G.predType = t;
    G.s.guida.predType = t;
    feedback(t === 'nominale'
      ? 'Sì! <b>Predicato nominale</b>: il verbo essere fa da <b>copula</b> e c\'è un nome del predicato che dice com\'è o che cos\'è il soggetto.'
      : 'Sì! <b>Predicato verbale</b>: qui essere significa "esserci, trovarsi, esistere" (oppure, con il dativo, "avere").', true);
    return next('subj', 1800);
  }
  return wrong(t === 'nominale'
    ? 'Non trovo un nome o un aggettivo al nominativo che possa fare da nome del predicato: qui essere vuol dire "esserci, trovarsi".'
    : 'Guarda meglio: c\'è una parola al nominativo (un aggettivo o un nome) che dice com\'è o che cos\'è il soggetto.');
}

function chooseComplement(id) {
  const c = COMPLEMENTI.find((x) => x.id === id);
  if (c.rif) { G.compId = id; return setStep('rif'); }
  const r = checkComplement(G.S, G.target, G.prep, id, { passive: verbPassive(G.S, G.v ?? 0, G.lemmaId) });
  if (!r.ok) return wrong(r.msg);
  const lbl = G.prep != null ? `<b lang="la">${esc(w(G.prep).t)} ${esc(w(G.target).t)}</b>` : tw(G.target);
  addItem([G.target], c);
  feedback(`Va bene: ${lbl} può essere un <b>${esc(c.nome)}</b>.${r.unsure ? ` ${esc(r.msg)}` : ' Controlla che abbia senso nella frase.'}`, true);
  return next('altri', 1700);
}

function finish(force) {
  const preps = G.S.words.filter((x, i) => G.S.isPrep(x) && !G.S.inSub(i) && !usedWords().has(i));
  if (preps.length && !force) {
    feedback(`Guarda: c'è ancora una preposizione da analizzare (${preps.map((x) => `<b lang="la">${esc(x.t)}</b>`).join(', ')}).`, false);
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
      ? `Le parole come ${S.spans.map(([o]) => tw(o)).join(', ')} aprono una <b>subordinata</b>, che arriva fino al suo verbo: il verbo principale è fuori.`
      : 'Il verbo di solito è alla fine della frase. Cerca le desinenze dei verbi: -o, -s, -t, -mus, -tis, -nt, -tur, -ntur.'),
    predtype: () => 'Se nella frase c\'è un nome o un aggettivo al nominativo che dice com\'è o che cos\'è il soggetto (es. "puella <i>laeta</i> est"), il predicato è nominale. Se "essere" vuol dire "esserci, trovarsi", è verbale.',
    subj: () => {
      const f = verbDesc(G.v, G.lemmaId);
      return `Il verbo è ${esc(f.replace(/^.*?, /, ''))}: cerca una parola al <b>nominativo ${/plurale/.test(f) ? 'plurale' : 'singolare'}</b>.`;
    },
    compl: () => ({
      acc: 'Cerca una parola all\'accusativo (-am, -um, -em, -as, -os, -es, -a) che <b>non</b> sia dopo una preposizione.',
      dat: 'Il dativo finisce spesso in -ae, -o, -i, -is, -ibus.',
      abl: 'L\'ablativo finisce spesso in -a, -o, -e, -i, -is, -ibus.',
      inf: 'L\'infinito presente finisce in -are, -ere, -ire (passivo: -ari, -eri, -i, -iri).',
      pred: 'Il nome del predicato è al nominativo, come il soggetto: dice com\'è o che cos\'è.',
    }[G.type]),
    'altri-reg': () => 'La parola retta di solito viene subito dopo la preposizione (a volte c\'è un aggettivo in mezzo).',
  };
  const f = H[G.step];
  if (f) { feedback(`💡 ${f()}`, true); $('guide-fb').className = 'guide-fb hint'; }
}

function show() {
  const S = G.S;
  let k = null;
  if (G.step === 'verb') k = S.main[0] ?? S.verbs[0];
  if (G.step === 'subj') k = subjectCandidates(S, G.v, G.lemmaId).all[0];
  if (G.step === 'compl') k = complementCandidates(S, G.v, G.type, [G.s.guida.subj])[0];
  if (G.step === 'altri-reg') k = S.words.findIndex((x, i) => S.governed.get(i) === G.prep);
  if (k == null || k < 0) { feedback('Qui non riesco a mostrartelo con sicurezza: ragiona sul senso della frase.', true); return; }
  const el = document.querySelector(`.sent[data-id="${G.s.id}"] .w[data-k="${k}"]`);
  el?.classList.add('g-hint');
  feedback(`Eccolo: ${tw(k)}. Toccalo per andare avanti.`, true);
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
    rows.push({ testo: it.ks.map(t).join(' '), ruolo: it.rif != null ? `${it.nome} di ${t(it.rif)}` : it.nome, nota: '' });
  }
  if (S.spans.length) rows.push({ testo: S.spans.map(([a, b]) => `${t(a)} … ${t(b)}`).join('; '), ruolo: 'proposizione subordinata', nota: 'non analizzata dalla guida' });
  return rows;
}

function summary() {
  const rows = G.s.guida.rows || [];
  const chip = (r) => (/predicato/.test(r.ruolo) ? 'g-verb' : /soggetto/.test(r.ruolo) ? 'g-subj' : /attributo|apposizione/.test(r.ruolo) ? 'g-attr' : /subordinata/.test(r.ruolo) ? 'g-sub' : /oggetto|termine|retto|nome del predicato/.test(r.ruolo) ? 'g-obj' : 'g-prep');
  return `<b>Brava!</b> Ecco l'<b>analisi logica</b> della frase:<ul class="g-sum">${rows.map((r) => `<li><span class="g-chip ${chip(r)}">${esc(r.ruolo)}</span> <b lang="la">${esc(r.testo)}</b>${r.nota ? ` <span class="muted">(${esc(r.nota)})</span>` : ''}</li>`).join('')}</ul>Ora prova a tradurre: parti dal predicato e dal soggetto, poi aggiungi il resto.`;
}

export { isSum };
