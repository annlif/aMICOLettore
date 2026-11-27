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
  // La preposizione regge gli aggettivi che seguono e si ferma al PRIMO NOME nel caso giusto:
  // "in parva insula puella habitat" → in regge parva e insula, non puella.
  words.forEach((w, i) => {
    if (!isPrep(w)) return;
    const r = (w.res.find((x) => x.entry.cat === 'prep')?.entry.regge || '').toLowerCase();
    const cases = ['acc', 'abl'].filter((c) => r.includes(c === 'acc' ? 'accusativo' : 'ablativo'));
    const ok = (x) => (cases.length ? cases : ['acc', 'abl']).some((c) => hasCase(x, c));
    for (let j = i + 1; j <= i + 4 && j < words.length; j++) {
      const x = words[j];
      if (finite(x) || isPrep(x) || !ok(x)) break;
      governed.set(j, i);
      const noun = x.unknown || x.an.some((a) => (a.t === 'nome' || a.t === 'pron') && (cases.length ? cases : ['acc', 'abl']).includes(a.caso));
      if (noun) { // il nome chiude il gruppo, ma gli aggettivi subito dopo (ad urbem magnam) ne fanno parte
        for (let k = j + 1; k < words.length; k++) {
          const y = words[k];
          const adjOnly = y.an.length && y.an.every((a) => a.t === 'agg' || a.t === 'part');
          if (!adjOnly || !ok(y)) break;
          governed.set(k, i);
        }
        break;
      }
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
    if (type === 'pred') return w.an.some((a) => a.caso === 'nom' && nums.has(a.num));
    return w.an.some((a) => a.caso === type);
  }).map((w) => w.k);
}

export const DOMANDA = {
  acc: { q: 'C\'è un <b>complemento oggetto</b>? Toccalo.', no: 'Non c\'è', caso: 'accusativo', nome: 'complemento oggetto' },
  dat: { q: 'Il verbo regge il <b>dativo</b>: toccalo.', no: 'Non c\'è', caso: 'dativo', nome: 'complemento di termine' },
  abl: { q: 'Il verbo regge l\'<b>ablativo</b>: toccalo.', no: 'Non c\'è', caso: 'ablativo', nome: 'complemento in ablativo' },
  inf: { q: 'Il verbo regge un <b>infinito</b>: toccalo.', no: 'Non c\'è', caso: 'infinito', nome: 'infinito retto dal verbo' },
  pred: { q: 'Tocca il <b>nome del predicato</b>.', no: 'Non c\'è', caso: 'nominativo', nome: 'nome del predicato' },
};

/** Le domande che si fanno al complemento (tutte): ognuna porta a uno o più complementi. */
export const DOMANDE = [
  ['Chi? Che cosa?', ['oggetto']],
  ['Di chi? Di che cosa?', ['specificazione', 'partitivo']],
  ['A chi? A che cosa?', ['termine']],
  ['Da chi? Da che cosa? (verbo passivo)', ['agente', 'causa-efficiente']],
  ['Dove? (stato)', ['stato-luogo']],
  ['Verso dove?', ['moto-a-luogo']],
  ['Da dove?', ['moto-da-luogo', 'origine', 'allontanamento']],
  ['Attraverso dove?', ['moto-per-luogo']],
  ['Quando?', ['tempo-det']],
  ['Per quanto tempo?', ['tempo-cont']],
  ['Con chi?', ['compagnia']],
  ['Insieme a che cosa?', ['unione']],
  ['Per mezzo di che cosa?', ['mezzo']],
  ['In che modo?', ['modo']],
  ['Perché? Per quale causa?', ['causa']],
  ['A quale scopo?', ['fine']],
  ['A favore o contro chi?', ['vantaggio']],
  ['Di che cosa si parla?', ['argomento']],
  ['Fatto di che cosa?', ['materia']],
  ['Con quali qualità?', ['qualita']],
  ['Rispetto a che cosa?', ['limitazione']],
  ['Pieno o privo di che cosa?', ['abbondanza']],
  ['Più o meno di chi?', ['paragone']],
  ['Senza chi? Tranne chi?', ['esclusione']],
  ['Con quale nome?', ['denominazione']],
  ['Chiamo qualcuno (o …!)', ['vocazione']],
  ['In quale veste? (es. «eletto console»)', ['predicativo']],
  ['Accompagna un nome', ['attributo', 'apposizione']],
];
export { low };

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

// ======================= CONTESTO: forma sicura, funzione ipotizzata =======================
const NOMI = ['nome', 'pron'];
const AGG = ['agg', 'part'];
/** Analisi di caso utili: se la parola è un nome, si ignora il participio omografo (casa ≠ part. di cado). */
const anCasi = (w) => { const c = w.an.filter((a) => a.caso && a.caso !== 'loc'); return c.some((a) => a.t === 'nome') ? c.filter((a) => a.t !== 'part') : c; };
const isNoun = (w) => anCasi(w).some((a) => NOMI.includes(a.t));
const isAdj = (w) => anCasi(w).some((a) => AGG.includes(a.t));
const LUOGO_ACC = ['prope', 'apud', 'ante', 'post', 'inter', 'iuxta', 'circum', 'super', 'supra', 'infra', 'intra', 'extra'];

/** Forme (sicure) di una parola: "genitivo singolare", ... senza ripetizioni. */
export function formeCaso(w) {
  const N = { sg: 'singolare', pl: 'plurale' };
  const seen = new Set();
  return anCasi(w).map((a) => `${CASO_IT[a.caso] || a.caso} ${N[a.num] || ''}`.trim()).filter((x) => !seen.has(x) && seen.add(x));
}

/** Nome vicino (±2, senza saltare il verbo) che concorda con l'aggettivo k; null se non c'è. */
export function nomeConcordato(S, k) {
  for (const d of [1, -1, 2, -2]) {
    const j = k + d;
    if (j < 0 || j >= S.words.length) continue;
    if (Math.abs(d) === 2 && finite(S, k + d / 2)) continue;
    if (isNoun(S.words[j]) && !finite(S, j) && agree(S, k, j, true)) return j;
  }
  return null;
}
function finite(S, i) { return S.words[i] && S.finite(S.words[i]); }

/** C'è un complemento di luogo con preposizione (in/sub + ablativo, prope/apud... + accusativo)? */
function haLuogo(S) {
  for (const [k, p] of S.governed) {
    const pr = low(S.words[p].t);
    if ((['in', 'sub'].includes(pr) && S.hasCase(S.words[k], 'abl')) || (LUOGO_ACC.includes(pr) && S.hasCase(S.words[k], 'acc'))) return true;
  }
  return false;
}

/**
 * Con sum: predicato verbale ("c'è, si trova") o nominale (copula + nome del predicato)?
 * Restituisce { tipo: 'verbale' | 'nominale' | null (incerto), perche, pred: indice del nome del predicato o null }.
 */
export function tipoPredicato(S, v, subj = null) {
  const nums = new Set(finiteForms(S.words[v]).map((a) => a.num));
  const nom = (i) => i !== v && i !== subj && !S.inSub(i) && !S.governed.has(i) && anCasi(S.words[i]).some((a) => a.caso === 'nom' && nums.has(a.num));
  const cand = S.words.map((_, i) => i).filter(nom);
  const subjK = subj ?? subjectCandidates(S, v).all[0] ?? null;
  // aggettivi liberi: al nominativo, non attaccati a un nome vicino (dura in "Vita nautae dura est")
  const liberi = cand.filter((i) => isAdj(S.words[i]) && !isNoun(S.words[i]) && (nomeConcordato(S, i) == null || (subjK != null && nomeConcordato(S, i) === subjK && i > subjK && i + 1 === v)));
  const attaccati = cand.filter((i) => isAdj(S.words[i]) && !liberi.includes(i));
  const nomiN = cand.filter((i) => isNoun(S.words[i]) && i !== subjK);
  if (liberi.length) return { tipo: 'nominale', pred: liberi[0], perche: `${S.words[liberi[0]].t} è al nominativo e dice com'è il soggetto` };
  if (haLuogo(S)) return { tipo: 'verbale', pred: null, perche: `c'è un complemento di luogo${attaccati.length ? ` e ${attaccati.map((i) => S.words[i].t).join(', ')} accompagna il soggetto` : ''}` };
  if (nomiN.length && subjK != null) return { tipo: null, pred: nomiN[0], perche: `${S.words[nomiN[0]].t} può essere il nome del predicato (che cos'è il soggetto?) oppure stare con il soggetto` };
  if (attaccati.length) return { tipo: null, pred: attaccati[0], perche: `${S.words[attaccati[0]].t} può accompagnare il soggetto ("c'è una … ") oppure dire com'è ("… è …")` };
  return { tipo: 'verbale', pred: null, perche: 'non c\'è un nome o aggettivo al nominativo che dica com\'è il soggetto' };
}

/**
 * Funzioni possibili di una parola nel contesto (IPOTESI, da verificare): per ogni forma, che cosa può fare e la domanda-guida.
 * Restituisce [{ forma, funzioni: [{ nome, domanda }], no: motivo se la forma è esclusa dal contesto }].
 */
export function ipotesiFunzioni(S, k, v = S.main[0]) {
  const w = S.words[k];
  const p = S.governed.get(k);
  const vNums = v != null ? new Set(finiteForms(S.words[v]).map((a) => a.num)) : new Set();
  const sum = v != null && isSum(S.words[v]);
  const vType = v != null ? complementType(S, v) : null;
  const tp = sum ? tipoPredicato(S, v) : null;
  const N = { sg: 'singolare', pl: 'plurale' };
  const forme = [];
  const seen = new Set();
  for (const a of anCasi(w)) {
    const key = `${a.caso} ${a.num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const forma = `${CASO_IT[a.caso]} ${N[a.num] || ''}`.trim();
    const f = [];
    let no = '';
    if (p != null) {
      const pr = low(S.words[p].t);
      const r = (S.words[p].res.find((x) => x.entry.cat === 'prep')?.entry.regge || '').toLowerCase();
      if (!r.includes(CASO_IT[a.caso])) no = `${S.words[p].t} non regge il ${CASO_IT[a.caso]}`;
      else for (const c of COMPLEMENTI) if (c.forme?.some((x) => x.preps?.includes(pr) && x.caso === a.caso)) f.push({ nome: c.nome, domanda: DOMANDE.find(([, ids]) => ids.includes(c.id))?.[0] || '' });
    } else if (a.caso === 'voc') {
      if (!(k > 0 && low(S.words[k - 1].t) === 'o')) no = 'il vocativo è raro: di solito è tra virgole o dopo "o"';
      else f.push({ nome: 'complemento di vocazione', domanda: 'Chi chiamo?' });
    } else if (a.caso === 'nom') {
      if (v != null && !vNums.has(a.num)) no = `il verbo è ${[...vNums].map((n) => N[n]).join('/')}: non concorda`;
      else {
        const n = isAdj(w) ? nomeConcordato(S, k) : null;
        if (n != null) f.push({ nome: `attributo di ${S.words[n].t}`, domanda: 'Com\'è? Quale?' });
        if (isNoun(w)) f.push({ nome: 'soggetto', domanda: 'Chi compie l\'azione? Di chi si parla?' });
        if (sum && tp.tipo !== 'verbale') f.push({ nome: 'nome del predicato', domanda: 'Che cos\'è / com\'è il soggetto?' });
      }
    } else if (a.caso === 'gen') {
      const near = [k - 1, k + 1, k - 2, k + 2].filter((j) => j >= 0 && j < S.words.length && j !== v && isNoun(S.words[j]));
      if (near.length) f.push({ nome: 'complemento di specificazione', domanda: `Di chi? Di che cosa? Da quale nome dipende (forse ${near.map((j) => S.words[j].t).join(' o ')})?` });
      else f.push({ nome: 'complemento di specificazione (o partitivo)', domanda: 'Di chi? Di che cosa? Da quale nome dipende?' });
    } else if (a.caso === 'dat') {
      f.push({ nome: 'complemento di termine', domanda: `A chi? A che cosa?${vType === 'dat' || /dativo/.test(verbRegge(S, v)) ? ` (${S.words[v].t} regge il dativo)` : ''}` });
      f.push({ nome: 'complemento di vantaggio', domanda: 'Per chi? A favore di chi?' });
    } else if (a.caso === 'acc') {
      if (sum) no = 'con essere non c\'è complemento oggetto';
      else f.push({ nome: 'complemento oggetto', domanda: 'Chi? Che cosa? (subisce l\'azione)' });
      f.push({ nome: 'complemento di tempo continuato', domanda: 'Per quanto tempo?' });
    } else if (a.caso === 'abl') {
      f.push({ nome: 'complemento di mezzo / causa / modo', domanda: 'Con che cosa? Perché? Come?' });
      f.push({ nome: 'complemento di tempo determinato', domanda: 'Quando?' });
    }
    if (isAdj(w) && !isNoun(w) && a.caso !== 'nom' && !no) {
      const n = nomeConcordato(S, k);
      if (n != null) f.unshift({ nome: `attributo di ${S.words[n].t}`, domanda: 'Com\'è? Quale?' });
    }
    forme.push({ forma, funzioni: f, no });
  }
  return forme;
}
function verbRegge(S, v) {
  if (v == null) return '';
  return (S.words[v].an.find((a) => isFiniteAn(a))?.entry.regge || '').toLowerCase();
}
