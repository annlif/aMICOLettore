// Struttura della frase per la GUIDA all'analisi: verbo principale, soggetto, complementi.
// Funziona solo con la grammatica (le forme possibili di ogni parola), non con il senso:
// quando una parola è ambigua accetta tutte le risposte grammaticalmente possibili.
import { tokenize } from './testo.js';

// congiunzioni che aprono una proposizione subordinata (fino al suo verbo)
const SUBORD = new Set(['cum', 'ut', 'uti', 'ne', 'quod', 'quia', 'quoniam', 'quamquam', 'etsi', 'si', 'nisi', 'ni', 'dum', 'donec',
  'postquam', 'antequam', 'priusquam', 'ubi', 'quasi', 'tamquam', 'sicut', 'velut', 'quin', 'simul']);
const RELATIVO = 'qui'; // pron=qui: qui, quae, quod, cuius, cui…

const isFiniteAn = (a) => a.t === 'verbo' && (a.modo === 'ind' || a.modo === 'cong' || a.modo === 'imp');
const low = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/j/g, 'i').replace(/v/g, 'u');

/** Analizza la frase. L = Lexicon. */
export function analyzeSentence(L, la) {
  const words = tokenize(la).filter((p) => p.w).map((p, k) => {
    const res = L.analyze(p.t);
    const an = res.flatMap((r) => r.an.map((a) => ({ ...a, entry: r.entry, enclitica: r.enclitica })));
    // parola che non è nel vocabolario: se ha la desinenza di un verbo, la consideriamo un verbo possibile
    if (!res.length) { const g = guessVerb(p.t); if (g) an.push(g); }
    return { t: p.t, k, res, an, unknown: !res.length };
  });
  // "forte": tutte le analisi sono forme finite; "debole": può essere anche altro (eam, pugnare, legis…)
  const strong = (w) => w.an.length > 0 && w.an.every(isFiniteAn) && !w.unknown;
  const finite = (w) => w.an.some(isFiniteAn);
  const isPrep = (w) => w.res.some((r) => r.entry.cat === 'prep');
  const hasCase = (w, c) => w.an.some((a) => a.caso === c && a.t !== 'gerundio');
  // la frase è una domanda diretta? (allora ubi, cur… all'inizio non aprono subordinate)
  const question = /\?\s*["»”']?\s*$/.test(la.trim());

  const subordinatore = (w, i) => {
    const l = low(w.t);
    if (question && i === 0 && (l === 'ubi' || l === 'cum')) return false;
    if (w.res.some((r) => r.entry.tags?.pron === RELATIVO)) return !(question && i === 0);
    if (!SUBORD.has(l)) return false;
    if (l === 'cum') { // cum + ablativo = preposizione
      const n = words[i + 1];
      if (n && hasCase(n, 'abl') && !finite(n)) return false;
    }
    if (l === 'ne' && w.res.every((r) => r.enclitica)) return false;
    return true;
  };

  // scorre la frase: ogni subordinatore apre una proposizione che si chiude con il suo verbo
  // i verbi "deboli" contano solo se nella frase non bastano quelli sicuri
  const anyStrong = words.some(strong);
  const isVerb = (w) => strong(w) || (finite(w) && (!anyStrong || w.unknown));
  const stack = [];
  const sub = new Map(); // indice del verbo → indice di chi apre la subordinata
  const spans = [];
  const main = [];
  const verbs = [];
  words.forEach((w, i) => {
    if (subordinatore(w, i)) { stack.push(i); return; }
    if (!isVerb(w)) return;
    verbs.push(i);
    if (stack.length) { const o = stack.pop(); sub.set(i, o); spans.push([o, i]); }
    else main.push(i);
  });
  const inSub = (i) => spans.some(([a, b]) => i >= a && i <= b);
  // preposizioni e parole che reggono (fino a 3 parole dopo, prima di un verbo)
  const governed = new Map(); // indice parola → indice preposizione
  words.forEach((w, i) => {
    if (!isPrep(w)) return;
    for (let j = i + 1; j <= i + 3 && j < words.length; j++) {
      if (finite(words[j])) break;
      if (hasCase(words[j], 'acc') || hasCase(words[j], 'abl')) governed.set(j, i);
    }
  });
  return { la, words, verbs, main, sub, spans, inSub, governed, isPrep, hasCase, finite, uncertain: verbs.length > 0 && main.length === 0 };
}

/** Desinenze verbali per le parole sconosciute (stima di persona e numero). */
function guessVerb(t) {
  const w = low(t);
  if (w.length < 4) return null;
  const m = [[/ntur$/, 3, 'pl'], [/(a|e|u|ba|bu|era|eri)nt$/, 3, 'pl'], [/mus$/, 1, 'pl'], [/(a|e|i)tis$/, 2, 'pl'], [/(i|a|e|ba|ra)tur$/, 3, 'sg'], [/(a|e|i|ba|ra|era|eri)t$/, 3, 'sg']]
    .find(([re]) => re.test(w));
  if (!m) return null;
  return { t: 'verbo', modo: 'ind', tempo: '?', pers: m[1], num: m[2], guess: true, entry: { lemma: t, cat: 'v', regge: '', significati: [] } };
}

/** Lemmi possibili del verbo (es. parent → pareo o paro). */
export function verbLemmas(w) {
  const seen = new Map();
  for (const a of w.an) if (isFiniteAn(a) && !a.guess && !seen.has(a.entry.id)) seen.set(a.entry.id, a.entry);
  return [...seen.values()];
}

/** Le forme finite di una parola (persona e numero). */
export function finiteForms(w) { return w.an.filter(isFiniteAn); }

/** Il verbo principale è una forma di "sum" (essere)? */
export function isSum(w) { return w.an.some((a) => isFiniteAn(a) && /^sum$/.test(low(a.entry.lemma))); }

/** Parole che possono essere il soggetto del verbo v (indice). */
export function subjectCandidates(S, v, lemmaId = null) {
  const forms = finiteForms(S.words[v]).filter((a) => !lemmaId || a.entry.id === lemmaId);
  const nums = new Set(forms.filter((a) => a.pers === 3).map((a) => a.num));
  const ok = (w, i, kinds) => i !== v && !S.inSub(i) && !S.governed.has(i) &&
    w.an.some((a) => a.caso === 'nom' && nums.has(a.num) && kinds.includes(a.t));
  const nouns = S.words.filter((w, i) => ok(w, i, ['nome', 'pron'])).map((w) => w.k);
  const adjs = S.words.filter((w, i) => ok(w, i, ['agg', 'part'])).map((w) => w.k);
  return { nouns, adjs, all: nouns.length ? nouns : adjs };
}

/** Persona del verbo, se è 1ª o 2ª (soggetto sottinteso: io, tu, noi, voi). */
export function implicitSubject(S, v, lemmaId = null) {
  const forms = finiteForms(S.words[v]).filter((a) => !lemmaId || a.entry.id === lemmaId);
  if (forms.some((a) => a.pers === 3)) return null;
  const a = forms[0];
  if (!a) return null;
  return { 1: { sg: 'io', pl: 'noi' }, 2: { sg: 'tu', pl: 'voi' } }[a.pers]?.[a.num] || null;
}

/**
 * Che cosa regge il verbo principale (dal lessico): 'acc' | 'dat' | 'abl' | 'inf' | 'pred' (con sum).
 */
export function complementType(S, v, lemmaId = null) {
  const w = S.words[v];
  if (isSum(w)) return 'pred';
  const e = w.an.find((a) => isFiniteAn(a) && (!lemmaId || a.entry.id === lemmaId))?.entry;
  const r = (e?.regge || '').toLowerCase();
  if (/infinito/.test(r)) return 'inf';
  if (/^dativo/.test(r)) return 'dat';
  if (/^ablativo/.test(r)) return 'abl';
  return 'acc';
}

/** Parole che possono essere il complemento richiesto dal verbo. */
export function complementCandidates(S, v, type, exclude = []) {
  const vf = finiteForms(S.words[v]);
  const nums = new Set(vf.map((a) => a.num));
  return S.words.filter((w, i) => {
    if (i === v || exclude.includes(i) || S.inSub(i) || S.governed.has(i)) return false;
    if (type === 'inf') return w.an.some((a) => a.t === 'inf');
    if (type === 'pred') return w.an.some((a) => a.caso === 'nom' && (nums.has(a.num) || a.t === 'nome'));
    return w.an.some((a) => a.caso === type);
  }).map((w) => w.k);
}

export const DOMANDA = {
  acc: { q: 'C\'è un complemento oggetto? Tocca la parola all\'accusativo che "subisce" l\'azione (chi? che cosa?).', no: 'Non c\'è', caso: 'accusativo', nome: 'complemento oggetto' },
  dat: { q: 'Questo verbo regge il dativo: a chi? a che cosa? Tocca la parola al dativo.', no: 'Non c\'è', caso: 'dativo', nome: 'complemento di termine' },
  abl: { q: 'Questo verbo regge l\'ablativo: tocca la parola all\'ablativo che lo completa.', no: 'Non c\'è', caso: 'ablativo', nome: 'complemento in ablativo' },
  inf: { q: 'Questo verbo regge un infinito: tocca l\'infinito che lo completa.', no: 'Non c\'è', caso: 'infinito', nome: 'infinito retto dal verbo' },
  pred: { q: 'Il verbo principale è "essere" (sum). C\'è un nome del predicato? Tocca la parola al nominativo che dice com\'è o che cos\'è il soggetto.', no: 'Non c\'è (significa "c\'è / esiste")', caso: 'nominativo', nome: 'nome del predicato' },
};

// ======================= ANALISI LOGICA: complementi =======================
// Elenco COMPLETO (Micol sceglie fra tutti); per ognuno, le forme latine con cui può comparire:
// caso senza preposizione, oppure preposizione + caso. passivo: serve un verbo passivo.
const P = (preps, caso) => ({ preps, caso });
const C = (caso) => ({ preps: null, caso });
export const COMPLEMENTI = [
  { id: 'attributo', nome: 'attributo', rif: true },
  { id: 'apposizione', nome: 'apposizione', rif: true },
  { id: 'predicativo', nome: 'complemento predicativo', forme: [C('nom'), C('acc')] },
  { id: 'specificazione', nome: 'complemento di specificazione', forme: [C('gen')] },
  { id: 'termine', nome: 'complemento di termine', forme: [C('dat')] },
  { id: 'oggetto', nome: 'complemento oggetto', forme: [C('acc')] },
  { id: 'vocazione', nome: 'complemento di vocazione', forme: [C('voc')] },
  { id: 'agente', nome: 'complemento d\'agente', forme: [P(['a', 'ab', 'abs'], 'abl')], passivo: true },
  { id: 'causa-efficiente', nome: 'complemento di causa efficiente', forme: [C('abl')], passivo: true },
  { id: 'causa', nome: 'complemento di causa', forme: [C('abl'), P(['ob', 'propter'], 'acc'), P(['de', 'e', 'ex', 'prae'], 'abl')] },
  { id: 'fine', nome: 'complemento di fine', forme: [C('dat'), P(['ad', 'in'], 'acc')] },
  { id: 'mezzo', nome: 'complemento di mezzo', forme: [C('abl'), P(['per'], 'acc')] },
  { id: 'modo', nome: 'complemento di modo', forme: [C('abl'), P(['cum'], 'abl')] },
  { id: 'compagnia', nome: 'complemento di compagnia', forme: [P(['cum'], 'abl')] },
  { id: 'unione', nome: 'complemento di unione', forme: [P(['cum'], 'abl')] },
  { id: 'stato-luogo', nome: 'complemento di stato in luogo', forme: [P(['in', 'sub'], 'abl'), C('abl'), P(['apud', 'ante', 'post', 'inter', 'prope', 'iuxta', 'circum', 'super', 'supra', 'infra', 'intra', 'extra'], 'acc')] },
  { id: 'moto-a-luogo', nome: 'complemento di moto a luogo', forme: [P(['ad', 'in', 'sub'], 'acc'), C('acc')] },
  { id: 'moto-da-luogo', nome: 'complemento di moto da luogo', forme: [P(['a', 'ab', 'abs', 'e', 'ex', 'de'], 'abl'), C('abl')] },
  { id: 'moto-per-luogo', nome: 'complemento di moto per luogo', forme: [P(['per', 'trans'], 'acc'), C('abl')] },
  { id: 'tempo-det', nome: 'complemento di tempo determinato', forme: [C('abl'), P(['in'], 'abl')] },
  { id: 'tempo-cont', nome: 'complemento di tempo continuato', forme: [C('acc'), P(['per'], 'acc')] },
  { id: 'argomento', nome: 'complemento di argomento', forme: [P(['de'], 'abl')] },
  { id: 'materia', nome: 'complemento di materia', forme: [P(['e', 'ex', 'de'], 'abl'), C('gen')] },
  { id: 'qualita', nome: 'complemento di qualità', forme: [C('gen'), C('abl')] },
  { id: 'limitazione', nome: 'complemento di limitazione', forme: [C('abl')] },
  { id: 'allontanamento', nome: 'complemento di allontanamento o separazione', forme: [C('abl'), P(['a', 'ab', 'abs', 'e', 'ex', 'de'], 'abl')] },
  { id: 'origine', nome: 'complemento di origine o provenienza', forme: [C('abl'), P(['a', 'ab', 'e', 'ex', 'de'], 'abl')] },
  { id: 'vantaggio', nome: 'complemento di vantaggio o svantaggio', forme: [C('dat'), P(['pro'], 'abl'), P(['contra', 'adversus'], 'acc')] },
  { id: 'partitivo', nome: 'complemento partitivo', forme: [C('gen'), P(['e', 'ex', 'de', 'inter'], 'abl'), P(['inter'], 'acc')] },
  { id: 'abbondanza', nome: 'complemento di abbondanza o privazione', forme: [C('abl'), C('gen'), P(['sine'], 'abl')] },
  { id: 'paragone', nome: 'complemento di paragone', forme: [C('abl')] },
  { id: 'denominazione', nome: 'complemento di denominazione', forme: [C('nom'), C('acc'), C('gen'), C('dat'), C('abl')] },
  { id: 'esclusione', nome: 'complemento di esclusione', forme: [P(['sine', 'praeter'], 'abl'), P(['praeter'], 'acc')] },
];
const CASO_IT = { nom: 'nominativo', gen: 'genitivo', dat: 'dativo', acc: 'accusativo', abl: 'ablativo', voc: 'vocativo' };

/** Il verbo principale è passivo (non deponente)? */
export function verbPassive(S, v, lemmaId = null) {
  return finiteForms(S.words[v]).some((a) => (!lemmaId || a.entry.id === lemmaId) && a.voce === 'pass' && !a.dep) ||
    S.words.some((w) => w.an.some((a) => a.t === 'part' && a.tempo === 'perf')) && isSum(S.words[v]);
}

/**
 * Controlla se la parola k (eventualmente retta dalla preposizione p) può essere il complemento scelto.
 * Restituisce { ok, msg }.
 */
export function checkComplement(S, k, p, id, { passive = false } = {}) {
  const c = COMPLEMENTI.find((x) => x.id === id);
  if (!c?.forme) return { ok: true, msg: '' };
  const w = S.words[k];
  if (w.unknown) return { ok: true, unsure: true, msg: 'Non conosco questa parola, quindi non posso controllare il caso: verifica nell\'Olivetti.' };
  const prep = p == null ? null : low(S.words[p].t);
  let cases = new Set(w.an.filter((a) => a.caso).map((a) => a.caso));
  if (p != null) { // con la preposizione contano solo i casi che regge
    const r = (S.words[p].res.find((x) => x.entry.cat === 'prep')?.entry.regge || '').toLowerCase();
    const pc = ['acc', 'abl'].filter((c) => r.includes(c === 'acc' ? 'accusativo' : 'ablativo'));
    if (pc.length) cases = new Set([...cases].filter((c) => pc.includes(c)));
  }
  const fits = c.forme.some((f) => (f.preps ? f.preps.includes(prep) : prep == null) && cases.has(f.caso));
  if (c.passivo && !passive) return { ok: false, msg: `Il ${c.nome} si usa con un verbo <b>passivo</b>, e il verbo principale qui non lo è.` };
  if (fits) return { ok: true, msg: '' };
  const vuole = c.forme.map((f) => (f.preps ? `${f.preps.join('/')} + ${CASO_IT[f.caso]}` : `${CASO_IT[f.caso]} senza preposizione`)).join(', oppure ');
  const qui = prep ? `${prep} + ${[...cases].map((x) => CASO_IT[x]).join(' o ')}` : [...cases].map((x) => CASO_IT[x]).join(' o ') || 'una parola senza caso';
  return { ok: false, msg: `Il ${c.nome} in latino si esprime con ${vuole}. Qui c'è ${qui}.` };
}

/** Attributo/apposizione: le due parole concordano? (stesso caso e numero; l'attributo anche nel genere) */
export function agree(S, a, b, gender = true) {
  const A = S.words[a].an.filter((x) => x.caso), B = S.words[b].an.filter((x) => x.caso);
  if (S.words[a].unknown || S.words[b].unknown) return true;
  return A.some((x) => B.some((y) => x.caso === y.caso && x.num === y.num && (!gender || !x.gen || !y.gen || x.gen === y.gen)));
}

/** "Che cosa regge" il verbo, come etichetta di analisi logica. */
export const ETICHETTA_RETTO = { acc: 'complemento oggetto', dat: 'complemento di termine', abl: 'complemento in ablativo retto dal verbo', inf: 'infinito retto dal verbo (proposizione infinitiva o servile)', pred: 'nome del predicato' };
