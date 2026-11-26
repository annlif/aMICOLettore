// GUIDA all'analisi della frase ("Aiutami"): una domanda alla volta, Micol risponde toccando le parole.
// Ordine: verbo principale → (quale verbo, se la forma è ambigua) → soggetto → complemento retto dal verbo
// → preposizioni → riepilogo e traduzione. Non traduce mai: controlla solo che le risposte siano possibili.
import { $, esc, toast } from './ui.js';
import { lexicon, olivettiUrl } from './vocab.js';
import { analyzeSentence, verbLemmas, subjectCandidates, implicitSubject, complementType, complementCandidates, DOMANDA, isSum } from './struttura.js';

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
    if (act === 'fine-prep') return finish();
    if (act === 'traduci') { const s = G.s; stopGuide(); cb.focusTranslation(s); }
  });
}

export const guideActive = () => !!G;
export const guideSentenceId = () => G?.s.id;

export async function startGuide(s) {
  const L = await lexicon();
  const S = analyzeSentence(L, s.la);
  G = { s, S, L, step: null, errors: 0, v: null, lemmaId: null, subj: null, type: null, prep: null };
  s.guida = {};
  document.body.classList.add('guiding');
  $('guide-bar').hidden = false;
  cb.refresh(s);
  if (!S.verbs.length) {
    setStep('noverb');
  } else setStep('verb');
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

// ---------- domande ----------
const w = (k) => G.S.words[k];
const tw = (k) => `<b lang="la">${esc(w(k).t)}</b>`;
function verbDesc(k, lemmaId = null) {
  const r = w(k).res.filter((x) => x.entry.cat === 'v' && (!lemmaId || x.entry.id === lemmaId));
  return r.flatMap((x) => x.analisi.filter((a) => /persona/.test(a)))[0] || '';
}

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
    case 'subj': {
      const imp = implicitSubject(S, G.v, G.lemmaId);
      q = imp
        ? `Il verbo ${tw(G.v)} è alla persona di <b>"${imp}"</b>. Chi è il <b>soggetto</b>? Se non c'è una parola, tocca "È sottinteso".`
        : `Chi è il <b>soggetto</b> di ${tw(G.v)}? Toccalo. (Chi compie l'azione?)`;
      btns = [['no', 'È sottinteso'], ['indizio', 'Dammi un indizio']];
      break;
    }
    case 'compl': {
      G.type = complementType(S, G.v, G.lemmaId);
      const d = DOMANDA[G.type];
      q = d.q;
      btns = [['no', d.no], ['indizio', 'Dammi un indizio']];
      break;
    }
    case 'prep':
      q = G.s.guida.preps?.length ? 'Ci sono altre <b>preposizioni</b>? Tocca la preposizione.' : 'Ci sono <b>preposizioni</b> (in, ad, cum, ex, de…)? Tocca la preposizione.';
      btns = [['fine-prep', G.s.guida.preps?.length ? 'Ho finito' : 'Non ce ne sono']];
      break;
    case 'prep2':
      q = `Ora tocca la parola che <b>${esc(w(G.prep).t)}</b> regge.`;
      btns = [['indizio', 'Dammi un indizio']];
      break;
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
  renderButtons(btns);
}

function renderButtons(btns) {
  $('guide-btns').innerHTML = btns.map(([g, label, id]) => `<button type="button" class="${g === 'esci' ? 'ghost' : g === 'traduci' || g === 'lemma' ? 'primary' : 'secondary'}" data-g="${g}"${id ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`).join('')
    + (G.errors >= 2 && ['verb', 'subj', 'compl', 'prep2'].includes(G.step) ? '<button type="button" class="secondary" data-g="mostra">Mostrami</button>' : '');
}

function feedback(html, ok) {
  $('guide-fb').innerHTML = html;
  $('guide-fb').className = `guide-fb ${ok ? 'ok' : 'ko'}`;
}
function wrong(html) {
  G.errors++;
  feedback(html, false);
  if (G.errors === 2) { // compare "Mostrami"
    const cur = [...$('guide-btns').querySelectorAll('button')].map((b) => [b.dataset.g, b.textContent, b.dataset.id]);
    renderButtons(cur.filter(([g]) => g !== 'mostra'));
  }
}
function mark(field, k) {
  G.s.guida[field] = k;
  cb.refresh(G.s);
}
const next = (step, delay = 900) => setTimeout(() => { if (G) setStep(step); }, delay);

// ---------- risposte ----------
/** Micol ha toccato la parola k della frase guidata. */
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
        return next(verbLemmas(x).length > 1 ? 'lemma' : 'subj', 1400);
      }
      if (S.sub.has(k)) return wrong(`${tw(k)} è un verbo, ma sta nella proposizione introdotta da ${tw(S.sub.get(k))}: è una <b>subordinata</b>. Il verbo principale è fuori dalle subordinate.`);
      if (S.verbs.includes(k)) return wrong(`${tw(k)} è un verbo, ma non sembra il principale. Guarda bene come è costruita la frase.`);
      if (unk) return wrong(`${tw(k)} non è nel vocabolario e non ha la desinenza di un verbo. Cercala nell'<a href="${olivettiUrl(x.t)}" target="_blank" rel="noopener">Olivetti</a> se non sei sicura.`);
      const cat = x.res[0]?.entry.categoria || 'parola';
      return wrong(`${tw(k)} non è un verbo: è ${cat === 'preposizione' || cat === 'congiunzione' || cat === 'interiezione' ? 'una' : 'un'} ${esc(cat)}. Cerca una parola con la desinenza di un verbo (-t, -nt, -mus, -tur…).`);
    }
    case 'subj': {
      const c = subjectCandidates(S, G.v, G.lemmaId);
      if (c.nouns.includes(k) || (!c.nouns.length && c.adjs.includes(k))) {
        mark('subj', k);
        feedback(`Sì! ${tw(k)} può essere il soggetto: è al <b>nominativo</b> e concorda con il verbo.`, true);
        return next('compl', 1300);
      }
      if (c.adjs.includes(k)) return wrong(`${tw(k)} è un aggettivo al nominativo: di solito accompagna il soggetto o è il nome del predicato. Cerca un nome o un pronome.`);
      if (unk) { mark('subj', k); feedback(`${tw(k)} non è nel vocabolario, quindi non posso controllarla: se è al nominativo, va bene. Controlla nell'<a href="${olivettiUrl(x.t)}" target="_blank" rel="noopener">Olivetti</a>.`, true); return next('compl', 2200); }
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
        feedback(`Sì! ${tw(k)} è ${G.type === 'inf' ? 'l\'infinito' : `il <b>${d.nome}</b> (${d.caso})`}.`, true);
        return next('prep', 1300);
      }
      if (unk) { mark(field, k); feedback(`${tw(k)} non è nel vocabolario: se è al caso giusto (${d.caso}), va bene. Controlla nell'Olivetti.`, true); return next('prep', 2000); }
      if (S.governed.has(k)) return wrong(`${tw(k)} dipende dalla preposizione ${tw(S.governed.get(k))}: non è il ${d.nome}.`);
      return wrong(`${tw(k)} non può essere il ${d.nome}: cerca una parola al <b>${d.caso}</b>.`);
    }
    case 'prep': {
      if (S.isPrep(x)) { G.prep = k; feedback(`${tw(k)} è una preposizione: regge ${esc(x.res.find((r) => r.entry.cat === 'prep').entry.regge || '')}.`, true); return next('prep2', 900); }
      return wrong(`${tw(k)} non è una preposizione.`);
    }
    case 'prep2': {
      const p = w(G.prep);
      const pe = p.res.find((r) => r.entry.cat === 'prep').entry;
      const cases = [/accusativo/.test(pe.regge) && 'acc', /ablativo/.test(pe.regge) && 'abl'].filter(Boolean);
      const okCase = cases.find((c) => S.hasCase(x, c));
      if (k > G.prep && (okCase || unk)) {
        G.s.guida.preps = [...(G.s.guida.preps || []), [G.prep, k]];
        cb.refresh(G.s);
        let senso = '';
        if (['in', 'sub'].includes(pe.lemma)) senso = okCase === 'abl' ? ' (stato in luogo: dove?)' : ' (moto a luogo: verso dove?)';
        feedback(`Sì! <b lang="la">${esc(p.t)} ${esc(x.t)}</b>: ${esc(pe.lemma)} + ${okCase === 'abl' ? 'ablativo' : okCase === 'acc' ? 'accusativo' : 'caso da controllare'}${senso}.`, true);
        return next('prep', 1500);
      }
      return wrong(`${tw(k)} non può dipendere da ${tw(G.prep)}: cerca una parola dopo la preposizione, al ${cases.map((c) => (c === 'acc' ? 'accusativo' : 'ablativo')).join(' o ')}.`);
    }
    default:
      toast('Usa i pulsanti della guida qui sotto.');
  }
}

function answerNo() {
  const S = G.S;
  switch (G.step) {
    case 'noverb': return setStep('prep');
    case 'subj': {
      const c = subjectCandidates(S, G.v, G.lemmaId);
      if (c.all.length) return wrong(`Guarda meglio: nella frase c'è una parola al <b>nominativo</b> che concorda con ${tw(G.v)}.`);
      const imp = implicitSubject(S, G.v, G.lemmaId);
      G.s.guida.subj = null;
      feedback(`Giusto: il soggetto è sottinteso${imp ? ` (<b>${imp}</b>)` : ' (egli, ella o essi: lo capisci dal contesto)'}.`, true);
      return next('compl', 1500);
    }
    case 'compl': {
      const c = complementCandidates(S, G.v, G.type, [G.s.guida.subj]);
      if (c.length && G.type !== 'acc') return wrong(`Guarda meglio: c'è una parola al <b>${DOMANDA[G.type].caso}</b> che completa il verbo.`);
      if (c.length && G.type === 'acc') { feedback('Va bene. Però c\'è una parola all\'accusativo: controlla se è proprio un oggetto o fa altro.', true); return next('prep', 2200); }
      feedback('Giusto, non c\'è.', true);
      return next('prep', 1000);
    }
    default: return null;
  }
}

function chooseLemma(id) {
  G.lemmaId = id;
  const e = G.L.entries.get(id);
  feedback(`Va bene: ${esc(e.lemma)}${e.regge ? `, che regge <b>${esc(e.regge)}</b>` : ''}.`, true);
  next('subj', 1200);
}

function finish() {
  const preps = G.S.words.filter((x, i) => G.S.isPrep(x) && !(G.s.guida.preps || []).some(([p]) => p === i));
  if (!G.s.guida.preps?.length && preps.length) return wrong(`Guarda meglio: nella frase c'è almeno una preposizione.`);
  setStep('fine');
}

function hint() {
  const S = G.S;
  const H = {
    verb: () => (S.spans.length
      ? `Le parole come ${S.spans.map(([o]) => tw(o)).join(', ')} aprono una <b>subordinata</b>, che arriva fino al suo verbo: il verbo principale è fuori.`
      : 'Il verbo di solito è alla fine della frase. Cerca le desinenze dei verbi: -o, -s, -t, -mus, -tis, -nt, -tur, -ntur.'),
    subj: () => {
      const f = verbDesc(G.v, G.lemmaId);
      return `Il verbo è ${esc(f.replace(/^.*?, /, ''))}: cerca una parola al <b>nominativo ${/plurale/.test(f) ? 'plurale' : 'singolare'}</b>.`;
    },
    compl: () => ({
      acc: 'Cerca una parola all\'accusativo (-am, -um, -em, -as, -os, -es, -a) che <b>non</b> sia dopo una preposizione.',
      dat: 'Il dativo finisce spesso in -ae, -o, -i, -is, -ibus.',
      abl: 'L\'ablativo finisce spesso in -a, -o, -e, -i, -is, -ibus.',
      inf: 'L\'infinito presente finisce in -are, -ere, -ire (passivo: -ari, -eri, -i, -iri).',
      pred: 'Con "essere", il nome del predicato è al nominativo, come il soggetto: dice com\'è o che cos\'è.',
    }[G.type]),
    prep2: () => 'La parola retta di solito viene subito dopo la preposizione (a volte c\'è un aggettivo in mezzo).',
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
  if (G.step === 'prep2') k = S.words.findIndex((x, i) => S.governed.get(i) === G.prep);
  if (k == null || k < 0) { feedback('Qui non riesco a mostrartelo con sicurezza: ragiona sul senso della frase.', true); return; }
  const el = document.querySelector(`.sent[data-id="${G.s.id}"] .w[data-k="${k}"]`);
  el?.classList.add('g-hint');
  feedback(`Eccolo: ${tw(k)}. Toccalo per andare avanti.`, true);
}

function summary() {
  const g = G.s.guida;
  const rows = [];
  if (g.verb != null) rows.push(`<span class="g-chip g-verb">verbo principale</span> ${tw(g.verb)}`);
  if (g.subj != null) rows.push(`<span class="g-chip g-subj">soggetto</span> ${tw(g.subj)}`);
  else if (g.verb != null) rows.push(`<span class="g-chip g-subj">soggetto</span> sottinteso${implicitSubject(G.S, g.verb, G.lemmaId) ? ` (${implicitSubject(G.S, g.verb, G.lemmaId)})` : ''}`);
  if (g.pred != null) rows.push(`<span class="g-chip g-pred">nome del predicato</span> ${tw(g.pred)}`);
  if (g.obj != null) rows.push(`<span class="g-chip g-obj">${esc(DOMANDA[G.type]?.nome || 'complemento')}</span> ${tw(g.obj)}`);
  for (const [p, k] of g.preps || []) rows.push(`<span class="g-chip g-prep">preposizione</span> <b lang="la">${esc(w(p).t)} … ${esc(w(k).t)}</b>`);
  return `<b>Brava!</b> Ecco la struttura della frase:<ul class="g-sum">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>Ora prova a tradurre: parti dal verbo e dal soggetto, poi aggiungi il resto.`;
}

export { isSum };
