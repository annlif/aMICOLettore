// Motore morfologico di aMICOLatino.
// Dal paradigma di una voce ("rosa, rosae, f.", "amo, amas, amavi, amatum, amare") ricava
// tutte le forme flesse con la loro analisi, e costruisce un indice forma → analisi.
// Nessun dato esterno: funziona offline, anche per le voci aggiunte in seguito.

import { normalize } from './testo.js';

// ======================= ETICHETTE IN ITALIANO =======================
export const CASI = { nom: 'nominativo', gen: 'genitivo', dat: 'dativo', acc: 'accusativo', abl: 'ablativo', voc: 'vocativo' };
const CASES = ['nom', 'gen', 'dat', 'acc', 'abl', 'voc'];
const NUM = { sg: 'singolare', pl: 'plurale' };
const GEN = { m: 'maschile', f: 'femminile', n: 'neutro' };
const PERS = ['1ª', '2ª', '3ª'];
const MODI = { ind: 'indicativo', cong: 'congiuntivo', imp: 'imperativo' };
const TEMPI = {
  pres: 'presente', impf: 'imperfetto', fut: 'futuro semplice', perf: 'perfetto', ppf: 'piuccheperfetto', futp: 'futuro anteriore',
};
const TEMPI_CONG = { pres: 'presente', impf: 'imperfetto', perf: 'perfetto', ppf: 'piuccheperfetto' };
const TEMPI_IMP = { pres: 'presente', fut: 'futuro' };
const GRADI = { comp: 'comparativo', sup: 'superlativo' };

/** Descrizione in italiano di un'analisi. */
export function describe(a) {
  const nominal = () => {
    const parts = [CASI[a.caso], NUM[a.num]];
    if (a.gen && a.showGen !== false) parts.push(GEN[a.gen]);
    return parts.join(' ');
  };
  switch (a.t) {
    case 'nome': return nominal();
    case 'agg': return (a.grado ? `${GRADI[a.grado]}, ` : '') + nominal();
    case 'pron': return nominal();
    case 'verbo': {
      const voce = a.dep ? '' : a.voce === 'pass' ? ' passivo' : ' attivo';
      if (a.modo === 'imp') return `imperativo ${TEMPI_IMP[a.tempo]}${voce}, ${PERS[a.pers - 1]} persona ${NUM[a.num]}`;
      const t = a.modo === 'cong' ? TEMPI_CONG[a.tempo] : TEMPI[a.tempo];
      return `${MODI[a.modo]} ${t}${voce}, ${PERS[a.pers - 1]} persona ${NUM[a.num]}`;
    }
    case 'inf': {
      const voce = a.dep ? '' : a.voce === 'pass' ? ' passivo' : ' attivo';
      return `infinito ${a.tempo === 'pres' ? 'presente' : a.tempo === 'perf' ? 'perfetto' : 'futuro'}${voce}`;
    }
    case 'part': return `participio ${a.tempo === 'pres' ? 'presente' : a.tempo === 'perf' ? 'perfetto' : 'futuro'}, ${nominal()}`;
    case 'gerundio': return `gerundio, ${CASI[a.caso]}`;
    case 'gerundivo': return `gerundivo, ${nominal()}`;
    case 'supino': return `supino ${a.caso === 'acc' ? 'attivo (in -um)' : 'passivo (in -u)'}`;
    case 'avv': return a.grado ? `avverbio ${GRADI[a.grado]}` : 'avverbio';
    case 'inv': return a.label || 'forma invariabile';
    default: return '';
  }
}

// ======================= UTILITÀ =======================
const VOWELS = /[aeiouy]/;
/** Numero di sillabe (approssimato: dittonghi ae, au, oe contano una volta). */
export function syllables(w) {
  const s = normalize(w).replace(/ae|au|oe|eu/g, 'a');
  return (s.match(/[aeiouy]+/g) || []).length;
}
const strip = (w) => normalize(w).replace(/[^a-z]/g, '');

function splitParadigm(p) {
  return p.split(',').map((x) => x.trim()).filter(Boolean);
}
function genderOf(tokens) {
  const g = tokens.join(' ').toLowerCase();
  const out = [];
  if (/\bm\b|m\.|maschile/.test(g)) out.push('m');
  if (/\bf\b|f\.|femminile/.test(g)) out.push('f');
  if (/\bn\b|n\.|neutro/.test(g)) out.push('n');
  if (/\bc\b|c\./.test(g)) out.push('m', 'f');
  return [...new Set(out)];
}

// ======================= NOMI =======================
const D1 = { sg: ['a', 'ae', 'ae', 'am', 'a', 'a'], pl: ['ae', 'arum', 'is', 'as', 'is', 'ae'] };
const D2M = { sg: ['us', 'i', 'o', 'um', 'o', 'e'], pl: ['i', 'orum', 'is', 'os', 'is', 'i'] };
const D2N = { sg: ['um', 'i', 'o', 'um', 'o', 'um'], pl: ['a', 'orum', 'is', 'a', 'is', 'a'] };
const D4 = { sg: ['us', 'us', 'ui', 'um', 'u', 'us'], pl: ['us', 'uum', 'ibus', 'us', 'ibus', 'us'] };
const D4N = { sg: ['u', 'us', 'u', 'u', 'u', 'u'], pl: ['ua', 'uum', 'ibus', 'ua', 'ibus', 'ua'] };
const D5 = { sg: ['es', 'ei', 'ei', 'em', 'e', 'es'], pl: ['es', 'erum', 'ebus', 'es', 'ebus', 'es'] };

/**
 * Analizza il paradigma di un nome: declinazione, genere, tema.
 * Restituisce { decl, gen, stem, nom, errors[] }.
 */
export function parseNoun(paradigm, tags = {}) {
  const t = splitParadigm(paradigm);
  const errors = [];
  const nom = strip(t[0] || '');
  let gen = strip(t[1] || '');
  const genders = genderOf(t.slice(2));
  if (!genders.length) errors.push('Manca il genere (m., f., n.).');
  if (tags.pl) { // plurale tantum: "castra, castrorum, n. pl."
    if (/arum$/.test(gen)) return { decl: 1, gen: genders, stem: gen.slice(0, -4), nom, pl: true, errors };
    if (/orum$/.test(gen)) return { decl: 2, gen: genders, stem: gen.slice(0, -4), nom, pl: true, neut: genders.includes('n'), errors };
    if (/(i)?um$/.test(gen)) return { decl: 3, gen: genders, stem: gen.replace(/i?um$/, ''), nom, pl: true, gpl: /ium$/.test(gen) ? 'ium' : 'um', neut: genders.includes('n'), errors };
    if (/uum$/.test(gen)) return { decl: 4, gen: genders, stem: gen.slice(0, -3), nom, pl: true, errors };
    if (/erum$/.test(gen)) return { decl: 5, gen: genders, stem: gen.slice(0, -4), nom, pl: true, errors };
  }
  if (gen.startsWith('-')) gen = gen.slice(1);
  let decl = null, stem = null;
  if (/ae$/.test(gen)) { decl = 1; stem = gen.slice(0, -2); if (!/a$/.test(nom) && !/(es|e|as)$/.test(nom)) errors.push('Il genitivo in -ae vuole un nominativo in -a (1ª declinazione).'); }
  else if (/ei$/.test(gen) && /es$/.test(nom)) { decl = 5; stem = gen.slice(0, -2); }
  else if (/i$/.test(gen) && !/is$/.test(gen)) {
    decl = 2; stem = gen.slice(0, -1);
    if (!/(us|um|er|ir|os|on)$/.test(nom)) errors.push('Il genitivo in -i vuole un nominativo in -us, -um, -er (2ª declinazione).');
    if (/um$/.test(nom) && !genders.includes('n')) errors.push('I nomi in -um della 2ª declinazione sono neutri.');
  } else if (/is$/.test(gen)) { decl = 3; stem = gen.slice(0, -2); }
  else if (/us$/.test(gen)) { decl = 4; stem = gen.slice(0, -2); if (!/(us|u)$/.test(nom)) errors.push('Il genitivo in -us vuole un nominativo in -us o -u (4ª declinazione).'); }
  else errors.push('Non riconosco la declinazione dal genitivo: controlla il paradigma.');
  const out = { decl, gen: genders, stem, nom, errors, neut: genders.length === 1 && genders[0] === 'n' };
  if (decl === 3) {
    // genitivo plurale in -ium? (parisillabi, neutri in -e/-al/-ar, monosillabi con due consonanti)
    const pari = /(is|es)$/.test(nom) && syllables(nom) === syllables(gen);
    const neutI = out.neut && /(e|al|ar)$/.test(nom);
    const mono = syllables(nom) === 1 && /[^aeiouy][^aeiouy]$/.test(stem);
    out.gpl = tags.gpl || (pari || neutI || mono ? 'ium' : 'um');
    out.ablI = tags.abl === 'i' || neutI;
  }
  return out;
}

function nounForms(p, tags = {}) {
  const forms = [];
  const g = p.gen.length === 1 ? p.gen[0] : null;
  const add = (form, caso, num) => { if (form) forms.push({ form, an: { t: 'nome', caso, num, gen: g, showGen: false } }); };
  const nums = p.pl ? ['pl'] : tags.sg ? ['sg'] : ['sg', 'pl'];
  const table = (tab, stem, nomSg, vocSg) => {
    for (const num of nums) tab[num].forEach((e, i) => {
      const caso = CASES[i];
      let f = stem + e;
      if (num === 'sg' && caso === 'nom' && nomSg) f = nomSg;
      if (num === 'sg' && caso === 'voc' && vocSg) f = vocSg;
      add(f, caso, num);
    });
  };
  switch (p.decl) {
    case 1:
      table(D1, p.stem);
      if (tags.abus) { add(p.stem + 'abus', 'dat', 'pl'); add(p.stem + 'abus', 'abl', 'pl'); }
      break;
    case 2:
      if (p.neut || /um$/.test(p.nom)) table(D2N, p.stem);
      else if (/us$/.test(p.nom)) table(D2M, p.stem);
      else table(D2M, p.stem, p.nom, p.nom); // puer, ager
      if (/ius$/.test(p.nom) && !p.pl) { // filius → voc. fili
        const i = forms.findIndex((f) => f.an.caso === 'voc' && f.an.num === 'sg');
        if (i >= 0) forms[i].form = p.stem;
      }
      if (/ius$/.test(p.nom)) add(p.stem.slice(0, -1) + 'i', 'gen', 'sg'); // fili (genitivo contratto)
      break;
    case 3: {
      const n = p.neut;
      const sg = ['', 'is', 'i', n ? '' : 'em', p.ablI ? 'i' : 'e', ''];
      const ia = p.gpl === 'ium' && n;
      const pl = [n ? (ia ? 'ia' : 'a') : 'es', p.gpl, 'ibus', n ? (ia ? 'ia' : 'a') : 'es', 'ibus', n ? (ia ? 'ia' : 'a') : 'es'];
      for (const num of nums) (num === 'sg' ? sg : pl).forEach((e, i) => {
        const caso = CASES[i];
        let f = p.stem + e;
        if (num === 'sg' && (caso === 'nom' || caso === 'voc' || (n && caso === 'acc'))) f = p.nom;
        add(f, caso, num);
      });
      if (p.gpl === 'ium' && !n && !p.pl) add(p.stem + 'is', 'acc', 'pl'); // civis (acc. pl. arcaico)
      if (tags.acc === 'im') add(p.stem + 'im', 'acc', 'sg');
      if (tags.abl === 'i' && !n) add(p.stem + 'i', 'abl', 'sg');
      break;
    }
    case 4: table(p.neut ? D4N : D4, p.stem); break;
    case 5: table(D5, p.stem); break;
    default: break;
  }
  return forms;
}

// ======================= AGGETTIVI =======================
/**
 * Analizza il paradigma di un aggettivo.
 * 1ª classe: "bonus, bona, bonum"; "pulcher, pulchra, pulchrum"; "liber, libera, liberum".
 * 2ª classe: "acer, acris, acre"; "fortis, forte"; "felix, felicis" (oppure "felix, -icis").
 */
export function parseAdj(paradigm) {
  const t = splitParadigm(paradigm).map(strip);
  const errors = [];
  if (t.length >= 3 && /a$/.test(t[1]) && /(um|ud)$/.test(t[2])) {
    return { cls: 1, m: t[0], stem: t[1].slice(0, -1), errors };
  }
  if (t.length >= 3 && /is$/.test(t[1]) && /e$/.test(t[2])) return { cls: 2, n3: true, m: t[0], f: t[1], stem: t[1].slice(0, -2), errors };
  if (t.length === 2 && /is$/.test(t[0]) && /e$/.test(t[1])) return { cls: 2, m: t[0], stem: t[0].slice(0, -2), errors };
  if (t.length === 2 && /is$/.test(t[1])) return { cls: 2, one: true, m: t[0], stem: t[1].slice(0, -2), errors };
  errors.push('Non riconosco la classe dell\'aggettivo: scrivi il paradigma come "bonus, bona, bonum", "fortis, forte" o "felix, felicis".');
  return { cls: null, errors };
}

function adj1Forms(stem, mNom, { pronominale = false, neutUd = false, grado = null } = {}) {
  const forms = [];
  const add = (form, caso, num, gen) => forms.push({ form, an: { t: 'agg', caso, num, gen, grado } });
  for (const num of ['sg', 'pl']) {
    D2M[num].forEach((e, i) => {
      let f = stem + e;
      if (num === 'sg' && (CASES[i] === 'nom' || CASES[i] === 'voc') && !/us$/.test(mNom)) f = mNom; // pulcher, liber
      if (num === 'sg' && CASES[i] === 'voc' && /us$/.test(mNom) && stem === 'me') f = 'mi'; // meus → mi
      add(f, CASES[i], num, 'm');
    });
    D1[num].forEach((e, i) => add(stem + e, CASES[i], num, 'f'));
    D2N[num].forEach((e, i) => add(stem + e, CASES[i], num, 'n'));
  }
  if (pronominale) { // unus, solus, totus, nullus, ullus, alius, alter, uter: gen. -ius, dat. -i
    for (let k = forms.length - 1; k >= 0; k--) {
      const a = forms[k].an;
      if (a.num === 'sg' && (a.caso === 'gen' || a.caso === 'dat')) forms.splice(k, 1);
    }
    for (const g of ['m', 'f', 'n']) {
      add(stem + 'ius', 'gen', 'sg', g);
      add(stem + 'i', 'dat', 'sg', g);
    }
    if (neutUd) for (const f of forms) if (f.an.gen === 'n' && f.an.num === 'sg' && (f.an.caso === 'nom' || f.an.caso === 'acc' || f.an.caso === 'voc')) f.form = stem + 'ud';
  }
  return forms;
}

/** Aggettivi (e participi presenti) della 2ª classe. */
function adj3Forms(p, { abl = 'i', gpl = 'ium', nplI = true, grado = null, t = 'agg', tempo } = {}) {
  const forms = [];
  const add = (form, caso, num, gen) => forms.push({ form, an: { t, caso, num, gen, grado, tempo } });
  const s = p.stem;
  for (const g of ['m', 'f', 'n']) {
    const nomSg = p.n3 ? (g === 'm' ? p.m : g === 'f' ? p.f : s + 'e') : p.one ? p.m : (g === 'n' ? s + 'e' : p.m);
    const sg = { nom: nomSg, gen: s + 'is', dat: s + 'i', acc: g === 'n' ? nomSg : s + 'em', abl: s + abl, voc: nomSg };
    for (const c of CASES) add(sg[c], c, 'sg', g);
    if (abl === 'i' && t === 'part') add(s + 'e', 'abl', 'sg', g);
    if (abl === 'e' && t === 'part') add(s + 'i', 'abl', 'sg', g);
    const nPl = nplI ? s + 'ia' : s + 'a';
    const pl = { nom: g === 'n' ? nPl : s + 'es', gen: s + gpl, dat: s + 'ibus', acc: g === 'n' ? nPl : s + 'es', abl: s + 'ibus', voc: g === 'n' ? nPl : s + 'es' };
    for (const c of CASES) add(pl[c], c, 'pl', g);
  }
  return forms;
}

/** Comparativo regolare in -ior, -ius. */
function comparative(stem) {
  const forms = [];
  const s = stem + 'ior';
  for (const g of ['m', 'f', 'n']) {
    const nom = g === 'n' ? stem + 'ius' : s;
    const sg = { nom, gen: s + 'is', dat: s + 'i', acc: g === 'n' ? nom : s + 'em', abl: s + 'e', voc: nom };
    for (const c of CASES) forms.push({ form: sg[c], an: { t: 'agg', caso: c, num: 'sg', gen: g, grado: 'comp' } });
    const nPl = s + 'a';
    const pl = { nom: g === 'n' ? nPl : s + 'es', gen: s + 'um', dat: s + 'ibus', acc: g === 'n' ? nPl : s + 'es', abl: s + 'ibus', voc: g === 'n' ? nPl : s + 'es' };
    for (const c of CASES) forms.push({ form: pl[c], an: { t: 'agg', caso: c, num: 'pl', gen: g, grado: 'comp' } });
  }
  return forms;
}

function adjForms(entry, p, tags) {
  let forms = [];
  if (p.cls === 1) forms = adj1Forms(p.stem, p.m, { pronominale: !!tags.pronominale, neutUd: !!tags.ud });
  else if (p.cls === 2) forms = adj3Forms(p, { abl: tags.abl || 'i', gpl: tags.gpl || 'ium', nplI: tags.gpl !== 'um' });
  if (p.cls && !tags.nocomp && !tags.pronominale) {
    // comparativo e superlativo (regolari, oppure indicati nella voce: comp=melior, sup=optimus; comp=- se manca)
    const comp = tags.comp && tags.comp !== '-' ? strip(tags.comp).replace(/ior$/, '') : p.stem;
    if (tags.comp !== '-') forms = forms.concat(comparative(comp));
    let sup;
    if (tags.sup) sup = strip(tags.sup).replace(/us$/, '');
    else if (/er$/.test(p.m)) sup = p.m + 'rim';
    else if (/^(facil|difficil|simil|dissimil|gracil|humil)is$/.test(p.m)) sup = p.m.slice(0, -2) + 'lim';
    else sup = p.stem + 'issim';
    forms = forms.concat(adj1Forms(sup, sup + 'us', { grado: 'sup' }));
    // avverbi: regolare (-e / -iter) e comparativo (-ius)
    if (!tags.noavv) {
      const avv = tags.avv ? strip(tags.avv) : p.cls === 1 ? p.stem + 'e' : (/nt$/.test(p.stem) ? p.stem + 'er' : p.stem + 'iter');
      forms.push({ form: avv, an: { t: 'avv' } });
      if (tags.comp !== '-') forms.push({ form: comp + 'ius', an: { t: 'avv', grado: 'comp' } });
      forms.push({ form: sup + 'e', an: { t: 'avv', grado: 'sup' } });
    }
  }
  return forms;
}

// ======================= VERBI =======================
/**
 * Analizza il paradigma di un verbo.
 * Attivi: "amo, amas, amavi, amatum, amare". Deponenti: "hortor, hortaris, hortatus sum, hortari".
 * Semideponenti: "audeo, audes, ausus sum, audere". Difettivi: "memini, meministi, meminisse".
 */
export function parseVerb(paradigm) {
  const raw = splitParadigm(paradigm);
  const t = raw.map((x) => normalize(x).replace(/[^a-z ]/g, '').trim());
  const errors = [];
  const first = t[0] || '';
  const inf = t[t.length - 1] || '';
  // difettivi al perfetto (memini, odi, coepi)
  if (/i$/.test(first) && /isse$/.test(inf)) return { conj: 'perf', perf: first.slice(0, -1), sup: t.length > 3 ? t[2].replace(/um$/, '') : null, errors };
  const dep = /or$/.test(first);
  let conj = null, root = null;
  if (dep) {
    if (/ari$/.test(inf)) { conj = 1; root = inf.slice(0, -3); }
    else if (/eri$/.test(inf)) { conj = 2; root = inf.slice(0, -3); }
    else if (/iri$/.test(inf)) { conj = 4; root = inf.slice(0, -3); }
    else if (/i$/.test(inf)) { conj = /ior$/.test(first) ? '3io' : 3; root = inf.slice(0, -1); }
    else errors.push('L\'infinito di un verbo deponente finisce in -ari, -eri, -i, -iri.');
    const pp = t.find((x) => / sum$/.test(x));
    return { conj, root, dep: true, sup: pp ? pp.replace(/ sum$/, '').replace(/us$/, '') : null, perf: null, errors };
  }
  const second = t[1] || '';
  const impers = /[^aeiou]?(et|it|at)$/.test(first) && !/o$/.test(first) && t.length <= 3;
  if (impers && /ere$/.test(inf)) {
    const perfPart = t.find((x, i) => i > 0 && /it$/.test(x));
    return { conj: /et$/.test(first) ? 2 : 3, root: inf.slice(0, -3), perf: perfPart ? perfPart.slice(0, -2) : null, sup: null, impers: true, errors };
  }
  if (/are$/.test(inf)) { conj = 1; root = inf.slice(0, -3); }
  else if (/ire$/.test(inf)) { conj = 4; root = inf.slice(0, -3); }
  else if (/ere$/.test(inf)) {
    root = inf.slice(0, -3);
    if (/eo$/.test(first) || /es$/.test(second)) conj = 2;
    else conj = /io$/.test(first) ? '3io' : 3;
  } else if (/(ere|eri)$/.test(inf) === false) errors.push('Non riconosco la coniugazione dall\'infinito (-are, -ere, -ire).');
  // perfetto e supino
  let perf = null, sup = null, semidep = false;
  for (const x of t.slice(1, -1)) {
    if (/ sum$/.test(x)) { semidep = true; sup = x.replace(/ sum$/, '').replace(/us$/, ''); }
    else if (/i$/.test(x) && x !== second) perf = x.slice(0, -1);
    else if (/um$/.test(x)) sup = x.slice(0, -2);
  }
  if (conj === 1 && perf === null && t.length >= 4) errors.push('Manca il perfetto (es. amavi).');
  return { conj, root, perf, sup, semidep, errors };
}

// desinenze personali
const ACT = ['m', 's', 't', 'mus', 'tis', 'nt'];
const PASS = ['r', 'ris', 'tur', 'mur', 'mini', 'ntur'];
const TH = { 1: 'a', 2: 'e', 3: 'e', '3io': 'e', 4: 'i' }; // vocale dell'infinito

function presentSystem(c, r) {
  const T = {};
  const io = c === '3io' || c === 4;
  T.presAct = { 1: ['o', 'as', 'at', 'amus', 'atis', 'ant'], 2: ['eo', 'es', 'et', 'emus', 'etis', 'ent'], 3: ['o', 'is', 'it', 'imus', 'itis', 'unt'], '3io': ['io', 'is', 'it', 'imus', 'itis', 'iunt'], 4: ['io', 'is', 'it', 'imus', 'itis', 'iunt'] }[c];
  T.presPass = { 1: ['or', 'aris', 'atur', 'amur', 'amini', 'antur'], 2: ['eor', 'eris', 'etur', 'emur', 'emini', 'entur'], 3: ['or', 'eris', 'itur', 'imur', 'imini', 'untur'], '3io': ['ior', 'eris', 'itur', 'imur', 'imini', 'iuntur'], 4: ['ior', 'iris', 'itur', 'imur', 'imini', 'iuntur'] }[c];
  const impf = { 1: 'aba', 2: 'eba', 3: 'eba', '3io': 'ieba', 4: 'ieba' }[c];
  T.impfAct = ACT.map((e) => impf + e); T.impfPass = PASS.map((e) => impf + e);
  if (c === 1 || c === 2) {
    const b = c === 1 ? 'ab' : 'eb';
    T.futAct = ['o', 'is', 'it', 'imus', 'itis', 'unt'].map((e) => b + e);
    T.futPass = ['or', 'eris', 'itur', 'imur', 'imini', 'untur'].map((e) => b + e);
  } else {
    const p = io ? 'i' : '';
    T.futAct = ['am', 'es', 'et', 'emus', 'etis', 'ent'].map((e) => p + e);
    T.futPass = ['ar', 'eris', 'etur', 'emur', 'emini', 'entur'].map((e) => p + e);
  }
  const sv = { 1: 'e', 2: 'ea', 3: 'a', '3io': 'ia', 4: 'ia' }[c];
  T.congAct = ACT.map((e, i) => sv + (i === 0 && sv === 'e' ? 'm' : e));
  T.congPass = PASS.map((e) => sv + e);
  const inf = TH[c] + 're';
  T.cimpAct = ACT.map((e) => inf + e); T.cimpPass = PASS.map((e) => inf + e);
  T.infAct = inf;
  T.infPass = { 1: 'ari', 2: 'eri', 3: 'i', '3io': 'i', 4: 'iri' }[c];
  T.impAct = { 1: ['a', 'ate'], 2: ['e', 'ete'], 3: ['e', 'ite'], '3io': ['e', 'ite'], 4: ['i', 'ite'] }[c];
  T.impPass = { 1: ['are', 'amini'], 2: ['ere', 'emini'], 3: ['ere', 'imini'], '3io': ['ere', 'imini'], 4: ['ire', 'imini'] }[c];
  T.impFut = { 1: ['ato', 'atote', 'anto'], 2: ['eto', 'etote', 'ento'], 3: ['ito', 'itote', 'unto'], '3io': ['ito', 'itote', 'iunto'], 4: ['ito', 'itote', 'iunto'] }[c];
  T.part = { 1: 'ant', 2: 'ent', 3: 'ent', '3io': 'ient', 4: 'ient' }[c];
  T.partNom = { 1: 'ans', 2: 'ens', 3: 'ens', '3io': 'iens', 4: 'iens' }[c];
  T.ger = { 1: 'and', 2: 'end', 3: 'end', '3io': 'iend', 4: 'iend' }[c];
  return T;
}

const PN = [[1, 'sg'], [2, 'sg'], [3, 'sg'], [1, 'pl'], [2, 'pl'], [3, 'pl']];

/** Tutte le forme di un verbo regolare. */
function verbForms(p, tags = {}) {
  const forms = [];
  const dep = !!p.dep;
  const add = (form, an) => forms.push({ form, an: { ...an, dep: dep || undefined } });
  const fin = (endings, root, modo, tempo, voce) => endings.forEach((e, i) => {
    const [pers, num] = PN[i];
    add(root + e, { t: 'verbo', modo, tempo, voce, pers, num });
    if (voce === 'pass' && i === 1 && /ris$/.test(e)) add(root + e.replace(/ris$/, 're'), { t: 'verbo', modo, tempo, voce, pers, num });
  });
  const r = p.root;
  if (p.conj && p.conj !== 'perf' && r != null) {
    const T = presentSystem(p.conj, r);
    if (!dep) {
      fin(T.presAct, r, 'ind', 'pres', 'att');
      fin(T.impfAct, r, 'ind', 'impf', 'att');
      fin(T.futAct, r, 'ind', 'fut', 'att');
      fin(T.congAct, r, 'cong', 'pres', 'att');
      fin(T.cimpAct, r, 'cong', 'impf', 'att');
      add(r + T.infAct, { t: 'inf', tempo: 'pres', voce: 'att' });
      add(r + T.impAct[0], { t: 'verbo', modo: 'imp', tempo: 'pres', voce: 'att', pers: 2, num: 'sg' });
      add(r + T.impAct[1], { t: 'verbo', modo: 'imp', tempo: 'pres', voce: 'att', pers: 2, num: 'pl' });
      add(r + T.impFut[0], { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 2, num: 'sg' });
      add(r + T.impFut[0], { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 3, num: 'sg' });
      add(r + T.impFut[1], { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 2, num: 'pl' });
      add(r + T.impFut[2], { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 3, num: 'pl' });
    }
    if (!tags.nopass || dep) {
      const voce = 'pass';
      fin(T.presPass, r, 'ind', 'pres', voce);
      fin(T.impfPass, r, 'ind', 'impf', voce);
      fin(T.futPass, r, 'ind', 'fut', voce);
      fin(T.congPass, r, 'cong', 'pres', voce);
      fin(T.cimpPass, r, 'cong', 'impf', voce);
      add(r + T.infPass, { t: 'inf', tempo: 'pres', voce });
      add(r + T.impPass[0], { t: 'verbo', modo: 'imp', tempo: 'pres', voce, pers: 2, num: 'sg' });
      add(r + T.impPass[1], { t: 'verbo', modo: 'imp', tempo: 'pres', voce, pers: 2, num: 'pl' });
    }
    // participio presente, gerundio, gerundivo
    for (const f of adj3Forms({ one: true, m: r + T.partNom, stem: r + T.part }, { abl: 'e', gpl: 'ium', t: 'part', tempo: 'pres' })) add(f.form, f.an);
    for (const [c, e] of [['gen', 'i'], ['dat', 'o'], ['acc', 'um'], ['abl', 'o']]) add(r + T.ger + e, { t: 'gerundio', caso: c });
    for (const f of adj1Forms(r + T.ger, r + T.ger + 'us')) add(f.form, { ...f.an, t: 'gerundivo' });
    // irregolari: dic, duc, fac, fer
    if (tags.imp) add(strip(tags.imp), { t: 'verbo', modo: 'imp', tempo: 'pres', voce: 'att', pers: 2, num: 'sg' });
  }
  // sistema del perfetto (attivo)
  if (p.perf && !dep) {
    const s = p.perf;
    fin(['i', 'isti', 'it', 'imus', 'istis', 'erunt'], s, 'ind', 'perf', 'att');
    add(s + 'ere', { t: 'verbo', modo: 'ind', tempo: 'perf', voce: 'att', pers: 3, num: 'pl' });
    fin(['eram', 'eras', 'erat', 'eramus', 'eratis', 'erant'], s, 'ind', 'ppf', 'att');
    fin(['ero', 'eris', 'erit', 'erimus', 'eritis', 'erint'], s, 'ind', 'futp', 'att');
    fin(['erim', 'eris', 'erit', 'erimus', 'eritis', 'erint'], s, 'cong', 'perf', 'att');
    fin(['issem', 'isses', 'isset', 'issemus', 'issetis', 'issent'], s, 'cong', 'ppf', 'att');
    add(s + 'isse', { t: 'inf', tempo: 'perf', voce: 'att' });
    // forme sincopate: amavisti → amasti, amaverunt → amarunt, audivisse → audisse
    // (i temi sono normalizzati: la v è scritta u)
    if ((p.conj === 1 && /au$/.test(s)) || /iu$/.test(s) || /[^aeiou]eu$/.test(s)) {
      const k = s.slice(0, -1);
      add(k + 'sti', { t: 'verbo', modo: 'ind', tempo: 'perf', voce: 'att', pers: 2, num: 'sg' });
      add(k + 'stis', { t: 'verbo', modo: 'ind', tempo: 'perf', voce: 'att', pers: 2, num: 'pl' });
      add(k + 'runt', { t: 'verbo', modo: 'ind', tempo: 'perf', voce: 'att', pers: 3, num: 'pl' });
      add(k + 'sse', { t: 'inf', tempo: 'perf', voce: 'att' });
      fin(['ssem', 'sses', 'sset', 'ssemus', 'ssetis', 'ssent'], k, 'cong', 'ppf', 'att');
      if (/iu$/.test(s)) { // audiit, audierunt
        fin(['i', 'isti', 'it', 'imus', 'istis', 'erunt'], k, 'ind', 'perf', 'att');
        fin(['eram', 'eras', 'erat', 'eramus', 'eratis', 'erant'], k, 'ind', 'ppf', 'att');
      }
    }
  }
  // participio perfetto e futuro, supino, infiniti perifrastici
  if (p.sup) {
    const s = p.sup;
    for (const f of adj1Forms(s, s + 'us')) add(f.form, { ...f.an, t: 'part', tempo: 'perf' });
    // participio futuro: regolare, oppure indicato nella voce (futpart=moriturus)
    const fu = tags.futpart ? strip(tags.futpart).replace(/us$/, '') : s + 'ur';
    if (!tags.nofut) for (const f of adj1Forms(fu, fu + 'us')) add(f.form, { ...f.an, t: 'part', tempo: 'fut' });
    if (!dep && !p.semidep) { add(s + 'um', { t: 'supino', caso: 'acc' }); add(s + 'u', { t: 'supino', caso: 'abl' }); }
  }
  return forms;
}

// ---------- verbi irregolari ----------
const SUM = {
  'ind pres': ['sum', 'es', 'est', 'sumus', 'estis', 'sunt'],
  'ind impf': ['eram', 'eras', 'erat', 'eramus', 'eratis', 'erant'],
  'ind fut': ['ero', 'eris', 'erit', 'erimus', 'eritis', 'erunt'],
  'cong pres': ['sim', 'sis', 'sit', 'simus', 'sitis', 'sint'],
  'cong impf': ['essem', 'esses', 'esset', 'essemus', 'essetis', 'essent'],
};
const POSSUM = {
  'ind pres': ['possum', 'potes', 'potest', 'possumus', 'potestis', 'possunt'],
  'ind impf': ['poteram', 'poteras', 'poterat', 'poteramus', 'poteratis', 'poterant'],
  'ind fut': ['potero', 'poteris', 'poterit', 'poterimus', 'poteritis', 'poterunt'],
  'cong pres': ['possim', 'possis', 'possit', 'possimus', 'possitis', 'possint'],
  'cong impf': ['possem', 'posses', 'posset', 'possemus', 'possetis', 'possent'],
};
const EO = {
  'ind pres': ['eo', 'is', 'it', 'imus', 'itis', 'eunt'],
  'ind impf': ['ibam', 'ibas', 'ibat', 'ibamus', 'ibatis', 'ibant'],
  'ind fut': ['ibo', 'ibis', 'ibit', 'ibimus', 'ibitis', 'ibunt'],
  'cong pres': ['eam', 'eas', 'eat', 'eamus', 'eatis', 'eant'],
  'cong impf': ['irem', 'ires', 'iret', 'iremus', 'iretis', 'irent'],
};
const FERO = {
  'ind pres': ['fero', 'fers', 'fert', 'ferimus', 'fertis', 'ferunt'],
  'ind impf': ['ferebam', 'ferebas', 'ferebat', 'ferebamus', 'ferebatis', 'ferebant'],
  'ind fut': ['feram', 'feres', 'feret', 'feremus', 'feretis', 'ferent'],
  'cong pres': ['feram', 'feras', 'ferat', 'feramus', 'feratis', 'ferant'],
  'cong impf': ['ferrem', 'ferres', 'ferret', 'ferremus', 'ferretis', 'ferrent'],
  'pass ind pres': ['feror', 'ferris', 'fertur', 'ferimur', 'ferimini', 'feruntur'],
  'pass ind impf': ['ferebar', 'ferebaris', 'ferebatur', 'ferebamur', 'ferebamini', 'ferebantur'],
  'pass ind fut': ['ferar', 'fereris', 'feretur', 'feremur', 'feremini', 'ferentur'],
  'pass cong pres': ['ferar', 'feraris', 'feratur', 'feramur', 'feramini', 'ferantur'],
  'pass cong impf': ['ferrer', 'ferreris', 'ferretur', 'ferremur', 'ferremini', 'ferrentur'],
};
const VOLO = {
  'ind pres': ['volo', 'vis', 'vult', 'volumus', 'vultis', 'volunt'],
  'ind impf': ['volebam', 'volebas', 'volebat', 'volebamus', 'volebatis', 'volebant'],
  'ind fut': ['volam', 'voles', 'volet', 'volemus', 'voletis', 'volent'],
  'cong pres': ['velim', 'velis', 'velit', 'velimus', 'velitis', 'velint'],
  'cong impf': ['vellem', 'velles', 'vellet', 'vellemus', 'velletis', 'vellent'],
};
const NOLO = {
  'ind pres': ['nolo', 'non vis', 'non vult', 'nolumus', 'non vultis', 'nolunt'],
  'ind impf': ['nolebam', 'nolebas', 'nolebat', 'nolebamus', 'nolebatis', 'nolebant'],
  'ind fut': ['nolam', 'noles', 'nolet', 'nolemus', 'noletis', 'nolent'],
  'cong pres': ['nolim', 'nolis', 'nolit', 'nolimus', 'nolitis', 'nolint'],
  'cong impf': ['nollem', 'nolles', 'nollet', 'nollemus', 'nolletis', 'nollent'],
};
const MALO = {
  'ind pres': ['malo', 'mavis', 'mavult', 'malumus', 'mavultis', 'malunt'],
  'ind impf': ['malebam', 'malebas', 'malebat', 'malebamus', 'malebatis', 'malebant'],
  'ind fut': ['malam', 'males', 'malet', 'malemus', 'maletis', 'malent'],
  'cong pres': ['malim', 'malis', 'malit', 'malimus', 'malitis', 'malint'],
  'cong impf': ['mallem', 'malles', 'mallet', 'mallemus', 'malletis', 'mallent'],
};
const FIO = {
  'ind pres': ['fio', 'fis', 'fit', 'fimus', 'fitis', 'fiunt'],
  'ind impf': ['fiebam', 'fiebas', 'fiebat', 'fiebamus', 'fiebatis', 'fiebant'],
  'ind fut': ['fiam', 'fies', 'fiet', 'fiemus', 'fietis', 'fient'],
  'cong pres': ['fiam', 'fias', 'fiat', 'fiamus', 'fiatis', 'fiant'],
  'cong impf': ['fierem', 'fieres', 'fieret', 'fieremus', 'fieretis', 'fierent'],
};

/**
 * Verbi irregolari e composti. Chiave: lemma normalizzato.
 * base: tabella; pre: prefisso davanti a consonante; preV: prefisso davanti a vocale; perf: tema del perfetto; sup: tema del supino.
 */
const IRREG = {
  sum: { base: SUM, perf: 'fu', fut: 'fut', inf: 'esse', imp: ['es', 'este'] },
  possum: { base: POSSUM, perf: 'potu', inf: 'posse', part: 'potent' },
  absum: { base: SUM, pre: 'ab', perf: 'afu', fut: 'afut', inf: 'abesse', alt: [['afu', 'abfu']] },
  adsum: { base: SUM, pre: 'ad', perf: 'adfu', inf: 'adesse', alt: [['adfu', 'affu']] },
  desum: { base: SUM, pre: 'de', perf: 'defu', inf: 'deesse' },
  intersum: { base: SUM, pre: 'inter', perf: 'interfu', inf: 'interesse' },
  obsum: { base: SUM, pre: 'ob', perf: 'obfu', inf: 'obesse', alt: [['obfu', 'offu']] },
  praesum: { base: SUM, pre: 'prae', perf: 'praefu', inf: 'praeesse' },
  prosum: { base: SUM, pre: 'pro', preV: 'prod', perf: 'profu', inf: 'prodesse' },
  supersum: { base: SUM, pre: 'super', perf: 'superfu', inf: 'superesse' },
  eo: { base: EO, perf: 'i', perfAlt: 'iv', sup: 'it', inf: 'ire', imp: ['i', 'ite'], part: ['iens', 'eunt'], ger: 'eund' },
  fero: { base: FERO, perf: 'tul', sup: 'lat', inf: 'ferre', infPass: 'ferri', imp: ['fer', 'ferte'], part: ['ferens', 'ferent'], ger: 'ferend' },
  volo: { base: VOLO, perf: 'volu', inf: 'velle', part: ['volens', 'volent'] },
  nolo: { base: NOLO, perf: 'nolu', inf: 'nolle', imp: ['noli', 'nolite'], part: ['nolens', 'nolent'] },
  malo: { base: MALO, perf: 'malu', inf: 'malle' },
  fio: { base: FIO, sup: 'fact', inf: 'fieri', passive: true },
};
// composti di eo e fero: [presente, perfetto, supino]
const EO_COMP = { abeo: 'ab', adeo: 'ad', exeo: 'ex', ineo: 'in', obeo: 'ob', pereo: 'per', redeo: 'red', subeo: 'sub', transeo: 'trans', praetereo: 'praeter', intereo: 'inter', prodeo: 'prod', circumeo: 'circum' };
const FERO_COMP = {
  affero: ['af', 'attul', 'allat'], aufero: ['au', 'abstul', 'ablat'], confero: ['con', 'contul', 'collat'], differo: ['dif', 'distul', 'dilat'],
  effero: ['ef', 'extul', 'elat'], infero: ['in', 'intul', 'illat'], offero: ['of', 'obtul', 'oblat'], perfero: ['per', 'pertul', 'perlat'],
  profero: ['pro', 'protul', 'prolat'], refero: ['re', 'rettul', 'relat'], transfero: ['trans', 'transtul', 'translat'], praefero: ['prae', 'praetul', 'praelat'],
};
for (const [k, pre] of Object.entries(EO_COMP)) IRREG[k] = { ...IRREG.eo, pre };
for (const [k, [pre, perf, sup]] of Object.entries(FERO_COMP)) IRREG[k] = { ...IRREG.fero, pre, perfFull: perf, supFull: sup };
IRREG.refero.alt = [['rettul', 'retul']];

/** Definizione dell'irregolare per un lemma (le chiavi sono confrontate in forma normalizzata: volo → uolo). */
const IRREG_N = new Map();
export function irregOf(lemma) {
  if (!IRREG_N.size) for (const [k, v] of Object.entries(IRREG)) IRREG_N.set(strip(k), { key: k, def: v });
  return IRREG_N.get(strip(lemma)) || null;
}

function irregForms(lemma, def) {
  const forms = [];
  const add = (form, an) => forms.push({ form, an });
  const pre = def.pre || '';
  const withPre = (w) => (!pre ? w : def.preV && /^[aeiou]/.test(w) ? def.preV + w : pre + w);
  // per i composti di fero, il prefisso del presente si assimila davanti a f (affero, aufero, confero…): lo applichiamo così com'è
  for (const [key, list] of Object.entries(def.base)) {
    const ks = key.split(' ');
    const voce = ks[0] === 'pass' ? 'pass' : (def.passive ? 'pass' : 'att');
    const [modo, tempo] = ks[0] === 'pass' ? ks.slice(1) : ks;
    list.forEach((w, i) => {
      if (w.includes(' ')) return; // "non vis"
      const [pers, num] = PN[i];
      add(withPre(w), { t: 'verbo', modo, tempo, voce: def.passive ? undefined : voce, pers, num, dep: def.passive ? true : undefined });
    });
  }
  add(def.base === SUM || def.base === POSSUM ? def.inf : withPre(def.inf), { t: 'inf', tempo: 'pres', voce: def.passive ? undefined : 'att', dep: def.passive || undefined });
  if (def.infPass) add(withPre(def.infPass), { t: 'inf', tempo: 'pres', voce: 'pass' });
  if (def.imp) {
    add(withPre(def.imp[0]), { t: 'verbo', modo: 'imp', tempo: 'pres', voce: 'att', pers: 2, num: 'sg' });
    add(withPre(def.imp[1]), { t: 'verbo', modo: 'imp', tempo: 'pres', voce: 'att', pers: 2, num: 'pl' });
  }
  if (lemma === 'sum') {
    for (const w of ['forem', 'fores', 'foret', 'foremus', 'foretis', 'forent']) add(w, { t: 'verbo', modo: 'cong', tempo: 'impf', voce: 'att', pers: PN[['forem', 'fores', 'foret', 'foremus', 'foretis', 'forent'].indexOf(w)][0], num: PN[['forem', 'fores', 'foret', 'foremus', 'foretis', 'forent'].indexOf(w)][1] });
    add('fore', { t: 'inf', tempo: 'fut', voce: 'att' });
    add('esto', { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 2, num: 'sg' });
    add('estote', { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 2, num: 'pl' });
    add('sunto', { t: 'verbo', modo: 'imp', tempo: 'fut', voce: 'att', pers: 3, num: 'pl' });
  }
  // participio presente
  if (def.part) {
    const [nom, stem] = Array.isArray(def.part) ? def.part : [def.part.replace(/nt$/, 'ns'), def.part];
    for (const f of adj3Forms({ one: true, m: withPre(nom), stem: withPre(stem) }, { abl: 'e', t: 'part', tempo: 'pres' })) add(f.form, f.an);
  }
  if (def.ger) {
    for (const [c, e] of [['gen', 'i'], ['dat', 'o'], ['acc', 'um'], ['abl', 'o']]) add(withPre(def.ger) + e, { t: 'gerundio', caso: c });
    for (const f of adj1Forms(withPre(def.ger), withPre(def.ger) + 'us')) add(f.form, { ...f.an, t: 'gerundivo' });
  }
  // perfetto
  const perfStems = [];
  if (def.perfFull) perfStems.push(strip(def.perfFull));
  else if (def.perf) perfStems.push(pre && def.base !== SUM ? pre + def.perf : def.perf);
  if (def.perfAlt) perfStems.push(pre ? pre + def.perfAlt : def.perfAlt);
  for (const [a, b] of def.alt || []) if (perfStems.includes(strip(a))) perfStems.push(strip(b));
  for (const s of perfStems) {
    const p = { perf: s };
    for (const f of verbForms(p)) if (f.an.tempo !== 'pres' || f.an.t === 'inf') add(f.form, f.an);
    if (s.endsWith('i')) { // eo: iisti → isti, iisse → isse, ierunt
      add(s.slice(0, -1) + 'isti', { t: 'verbo', modo: 'ind', tempo: 'perf', voce: 'att', pers: 2, num: 'sg' });
      add(s.slice(0, -1) + 'isse', { t: 'inf', tempo: 'perf', voce: 'att' });
      fin2(add, s.slice(0, -1), ['issem', 'isses', 'isset', 'issemus', 'issetis', 'issent'], 'cong', 'ppf');
    }
  }
  // supino e participi
  const sup = def.supFull || (def.sup ? (pre && def.base !== SUM ? pre : '') + def.sup : null);
  if (sup) for (const f of verbForms({ sup }, {})) add(f.form, def.passive ? { ...f.an, dep: true } : f.an);
  if (def.fut) for (const f of adj1Forms(def.fut + 'ur', def.fut + 'urus')) add(f.form, { ...f.an, t: 'part', tempo: 'fut' });
  return forms;
}
function fin2(add, root, endings, modo, tempo) {
  endings.forEach((e, i) => add(root + e, { t: 'verbo', modo, tempo, voce: 'att', pers: PN[i][0], num: PN[i][1] }));
}

// ======================= PRONOMI =======================
// tabelle: per ogni genere, singolare e plurale nell'ordine nom, gen, dat, acc, abl (il vocativo non c'è)
const P = (s) => s.split(' ').map((x) => x.split('/'));
const PRONOUNS = {
  ego: { sg: P('ego mei mihi/mi me me'), pl: P('nos nostri/nostrum nobis nos nobis'), noGen: true },
  tu: { sg: P('tu tui tibi te te'), pl: P('vos vestri/vestrum vobis vos vobis'), noGen: true, voc: true },
  sui: { sg: P('- sui sibi se/sese se/sese'), pl: P('- sui sibi se/sese se/sese'), noGen: true },
  is: { m: { sg: P('is eius ei eum eo'), pl: P('ei/ii/i eorum eis/iis/is eos eis/iis/is') }, f: { sg: P('ea eius ei eam ea'), pl: P('eae earum eis/iis/is eas eis/iis/is') }, n: { sg: P('id eius ei id eo'), pl: P('ea eorum eis/iis/is ea eis/iis/is') } },
  hic: { m: { sg: P('hic huius huic hunc hoc'), pl: P('hi horum his hos his') }, f: { sg: P('haec huius huic hanc hac'), pl: P('hae harum his has his') }, n: { sg: P('hoc huius huic hoc hoc'), pl: P('haec horum his haec his') } },
  ille: { m: { sg: P('ille illius illi illum illo'), pl: P('illi illorum illis illos illis') }, f: { sg: P('illa illius illi illam illa'), pl: P('illae illarum illis illas illis') }, n: { sg: P('illud illius illi illud illo'), pl: P('illa illorum illis illa illis') } },
  iste: { m: { sg: P('iste istius isti istum isto'), pl: P('isti istorum istis istos istis') }, f: { sg: P('ista istius isti istam ista'), pl: P('istae istarum istis istas istis') }, n: { sg: P('istud istius isti istud isto'), pl: P('ista istorum istis ista istis') } },
  ipse: { m: { sg: P('ipse ipsius ipsi ipsum ipso'), pl: P('ipsi ipsorum ipsis ipsos ipsis') }, f: { sg: P('ipsa ipsius ipsi ipsam ipsa'), pl: P('ipsae ipsarum ipsis ipsas ipsis') }, n: { sg: P('ipsum ipsius ipsi ipsum ipso'), pl: P('ipsa ipsorum ipsis ipsa ipsis') } },
  idem: { m: { sg: P('idem eiusdem eidem eundem eodem'), pl: P('eidem/iidem/idem eorundem eisdem/iisdem/isdem eosdem eisdem/iisdem/isdem') }, f: { sg: P('eadem eiusdem eidem eandem eadem'), pl: P('eaedem earundem eisdem/iisdem/isdem easdem eisdem/iisdem/isdem') }, n: { sg: P('idem eiusdem eidem idem eodem'), pl: P('eadem eorundem eisdem/iisdem/isdem eadem eisdem/iisdem/isdem') } },
  qui: { m: { sg: P('qui cuius cui quem quo'), pl: P('qui quorum quibus/quis quos quibus/quis') }, f: { sg: P('quae cuius cui quam qua'), pl: P('quae quarum quibus/quis quas quibus/quis') }, n: { sg: P('quod cuius cui quod quo'), pl: P('quae quorum quibus/quis quae quibus/quis') } },
  quis: { m: { sg: P('quis cuius cui quem quo'), pl: P('qui quorum quibus quos quibus') }, f: { sg: P('quis cuius cui quem quo'), pl: P('quae quarum quibus quas quibus') }, n: { sg: P('quid cuius cui quid quo'), pl: P('quae quorum quibus quae quibus') } },
  aliquis: { m: { sg: P('aliquis alicuius alicui aliquem aliquo'), pl: P('aliqui aliquorum aliquibus aliquos aliquibus') }, f: { sg: P('aliqua alicuius alicui aliquam aliqua'), pl: P('aliquae aliquarum aliquibus aliquas aliquibus') }, n: { sg: P('aliquid/aliquod alicuius alicui aliquid/aliquod aliquo'), pl: P('aliqua aliquorum aliquibus aliqua aliquibus') } },
  quidam: { m: { sg: P('quidam cuiusdam cuidam quendam quodam'), pl: P('quidam quorundam quibusdam quosdam quibusdam') }, f: { sg: P('quaedam cuiusdam cuidam quandam quadam'), pl: P('quaedam quarundam quibusdam quasdam quibusdam') }, n: { sg: P('quiddam/quoddam cuiusdam cuidam quiddam/quoddam quodam'), pl: P('quaedam quorundam quibusdam quaedam quibusdam') } },
  quisque: { m: { sg: P('quisque cuiusque cuique quemque quoque'), pl: P('quique quorumque quibusque quosque quibusque') }, f: { sg: P('quaeque cuiusque cuique quamque quaque'), pl: P('quaeque quarumque quibusque quasque quibusque') }, n: { sg: P('quidque/quodque cuiusque cuique quidque/quodque quoque'), pl: P('quaeque quorumque quibusque quaeque quibusque') } },
  nemo: { sg: P('nemo neminis/nullius nemini neminem nemine/nullo'), gen1: 'm' },
  nihil: { sg: P('nihil/nil nihili nihilo nihil/nil nihilo'), gen1: 'n' },
  duo: { m: { pl: P('duo duorum duobus duos/duo duobus') }, f: { pl: P('duae duarum duabus duas duabus') }, n: { pl: P('duo duorum duobus duo duobus') } },
  tres: { m: { pl: P('tres trium tribus tres/tris tribus') }, f: { pl: P('tres trium tribus tres/tris tribus') }, n: { pl: P('tria trium tribus tria tribus') } },
};

function pronounForms(key, t = 'pron') {
  const def = PRONOUNS[key];
  const forms = [];
  const push = (tab, num, gen) => tab.forEach((alts, i) => {
    for (const w of alts) if (w !== '-') forms.push({ form: w, an: { t, caso: CASES[i], num, gen, showGen: !!gen } });
  });
  if (def.sg && !def.m) {
    push(def.sg, 'sg', def.gen1 && !def.noGen ? def.gen1 : null);
    if (def.pl) push(def.pl, 'pl', null);
    if (def.voc) { forms.push({ form: 'tu', an: { t, caso: 'voc', num: 'sg' } }); forms.push({ form: 'vos', an: { t, caso: 'voc', num: 'pl' } }); }
    for (const f of forms) f.an.showGen = false;
  } else {
    for (const g of ['m', 'f', 'n']) {
      if (def[g].sg) push(def[g].sg, 'sg', g);
      if (def[g].pl) push(def[g].pl, 'pl', g);
    }
  }
  return forms;
}

// ======================= VOCI DEL LESSICO =======================
/**
 * Riga del lessico (data/lessico.txt):
 *   paradigma | categoria | significati (separati da ;) | caso retto | esempio | etichette
 * Categorie: n (nome), agg, v (verbo), pron, avv, prep, cong, inter, num.
 * Etichette (separate da spazi): conn=tipo_di_connettivo, gpl=um, abl=i, pl, sg, pronominale, ud, nocomp,
 *   comp=melior, sup=optimus, avv=bene, noavv, imp=dic, nopass, nofut, pron=is, forme=a/ab/abs, stato=...
 */
export const CATEGORIE = {
  n: 'nome', agg: 'aggettivo', v: 'verbo', pron: 'pronome', avv: 'avverbio', prep: 'preposizione',
  cong: 'congiunzione', inter: 'interiezione', num: 'numerale',
};

export function parseLexiconLine(line, n = 0) {
  const parts = line.split('|').map((x) => x.trim());
  if (parts.length < 3) return null;
  const [paradigma, cat, sig, regge = '', esempio = '', tagstr = ''] = parts;
  const tags = {};
  for (const tok of tagstr.split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf('=');
    if (i > 0) tags[tok.slice(0, i)] = tok.slice(i + 1).replace(/_/g, ' ');
    else tags[tok] = true;
  }
  const lemma = splitParadigm(paradigma)[0].replace(/\s*\(.*\)$/, '');
  return {
    id: `${normalize(lemma).replace(/[^a-z]/g, '')}-${cat}${tags.id ? `-${tags.id}` : ''}`,
    lemma, paradigma, cat, categoria: CATEGORIE[cat] || cat,
    significati: sig.split(';').map((x) => x.trim()).filter(Boolean),
    regge, esempio, tags, n,
    connettivo: tags.conn || null,
    stato: tags.stato || 'da verificare',
  };
}

export function parseLexicon(text) {
  const out = [];
  let stato = 'da verificare';
  text.split(/\r?\n/).forEach((l, i) => {
    const s = l.trim();
    const d = s.match(/^#!\s*stato=(\S+)/);
    if (d) { stato = d[1].replace(/_/g, ' '); return; }
    if (!s || s.startsWith('#')) return;
    const e = parseLexiconLine(s, i + 1);
    if (e) { if (!e.tags.stato) e.stato = stato; out.push(e); }
  });
  return out;
}

/** Classe grammaticale leggibile ("1ª declinazione", "3ª coniugazione"...). */
export function classeOf(entry) {
  const { cat, paradigma, tags } = entry;
  if (cat === 'n') { const p = parseNoun(paradigma, tags); return p.decl ? `${p.decl}ª declinazione` : ''; }
  if (cat === 'agg' && !tags.pron) { const p = parseAdj(paradigma); return p.cls ? `aggettivo della ${p.cls}ª classe` : ''; }
  if (cat === 'v') {
    const ir = irregOf(entry.lemma);
    if (ir) return 'verbo irregolare' + (ir.def.pre ? ` (composto di ${ir.key.endsWith('sum') ? 'sum' : ir.key.endsWith('eo') ? 'eo' : 'fero'})` : '');
    const p = parseVerb(paradigma);
    if (p.conj === 'perf') return 'verbo difettivo';
    const c = p.conj === '3io' ? '3ª coniugazione (in -io)' : p.conj ? `${p.conj}ª coniugazione` : '';
    return c + (p.dep ? ', deponente' : p.semidep ? ', semideponente' : '') + (p.impers ? ', impersonale' : '');
  }
  return '';
}

/** Controlla il paradigma e restituisce gli errori trovati (per le voci aggiunte in seguito). */
export function checkParadigm(cat, paradigma, tags = {}) {
  if (cat === 'n') return parseNoun(paradigma, tags).errors;
  if (cat === 'agg') return parseAdj(paradigma).errors;
  if (cat === 'v') return irregOf(splitParadigm(paradigma)[0] || '') ? [] : parseVerb(paradigma).errors;
  return [];
}

/** Tutte le forme di una voce: [{form (normalizzata), an}] */
export function formsOf(entry) {
  const { cat, paradigma, tags } = entry;
  const lemmaN = strip(entry.lemma);
  let forms = [];
  try {
    if (tags.pron && PRONOUNS[tags.pron]) forms = pronounForms(tags.pron, cat === 'num' ? 'agg' : 'pron');
    else if (cat === 'n') forms = nounForms(parseNoun(paradigma, tags), tags);
    else if (cat === 'agg' || (cat === 'num' && /,/.test(paradigma))) {
      const p = parseAdj(paradigma);
      forms = p.cls ? adjForms(entry, p, cat === 'num' ? { ...tags, nocomp: true } : tags) : [];
    } else if (cat === 'v') {
      const ir = irregOf(entry.lemma);
      if (ir) forms = irregForms(ir.key, ir.def);
      else {
        const p = parseVerb(paradigma);
        forms = verbForms(p, tags);
        // impersonali (licet, oportet…): solo la 3ª persona singolare e l'infinito
        if (p.impers) forms = forms.filter((f) => f.an.t === 'inf' || (f.an.t === 'verbo' && f.an.modo !== 'imp' && f.an.pers === 3 && f.an.num === 'sg' && f.an.voce !== 'pass'));
      }
    } else {
      // parole invariabili: il lemma e le eventuali varianti (forme=a/ab/abs)
      const label = entry.categoria + (entry.regge ? ` (regge ${entry.regge})` : '');
      const vs = new Set([lemmaN, ...(tags.forme ? tags.forme.split('/').map(strip) : [])]);
      forms = [...vs].map((form) => ({ form, an: { t: 'inv', label } }));
    }
    // forme particolari indicate nella voce: extra=di:nom.pl/dis:dat.pl ; no=voc.sg
    if (tags.no) {
      const drop = tags.no.split('/').map((x) => x.split('.'));
      forms = forms.filter((f) => !drop.some(([c, n]) => f.an.caso === c && f.an.num === n));
    }
    if (tags.extra) {
      const t = cat === 'agg' ? 'agg' : cat === 'pron' ? 'pron' : 'nome';
      for (const x of tags.extra.split('/')) {
        const [form, an = ''] = x.split(':');
        const [caso, num, gen] = an.split('.');
        forms.push({ form, an: caso === 'loc' ? { t: 'inv', label: 'locativo' } : { t, caso, num, gen: gen || null, showGen: !!gen } });
      }
    }
  } catch (e) {
    console.warn('Forme non generate per', entry.lemma, e);
  }
  for (const f of forms) f.form = strip(f.form);
  return forms.filter((f) => f.form);
}

// ======================= INDICE E ANALISI =======================
export class Lexicon {
  constructor(entries = []) {
    this.entries = new Map();
    this.index = new Map(); // forma normalizzata → [{id, an}]
    for (const e of entries) this.add(e);
  }
  add(entry) {
    if (this.entries.has(entry.id)) this.remove(entry.id);
    this.entries.set(entry.id, entry);
    const seen = new Set();
    for (const { form, an } of formsOf(entry)) {
      const key = `${form}|${JSON.stringify(an)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let list = this.index.get(form);
      if (!list) this.index.set(form, (list = []));
      list.push({ id: entry.id, an });
    }
  }
  remove(id) {
    if (!this.entries.delete(id)) return;
    for (const [form, list] of this.index) {
      const k = list.filter((x) => x.id !== id);
      if (k.length) this.index.set(form, k); else this.index.delete(form);
    }
  }
  get size() { return this.entries.size; }

  /**
   * Tutte le analisi possibili di una parola, raggruppate per voce.
   * @returns [{entry, analisi: [string], enclitica?: 'que'|'ne'|'ve'}]
   */
  analyze(word) {
    const w = strip(word);
    if (!w) return [];
    const out = this._lookup(w);
    // enclitiche: -que, -ne, -ve (solo se la parola intera non basta)
    for (const enc of ['que', 'ne', 've']) {
      if (w.length > enc.length + 1 && w.endsWith(normalize(enc))) {
        const base = w.slice(0, -enc.length);
        const r = this._lookup(base).map((x) => ({ ...x, enclitica: enc }));
        if (r.length && !out.some((o) => o.entry.cat === 'cong' && o.entry.lemma.endsWith('que'))) out.push(...r);
      }
    }
    return out;
  }
  _lookup(w) {
    const hits = this.index.get(w) || [];
    const byEntry = new Map();
    for (const h of hits) {
      const e = this.entries.get(h.id);
      if (!e) continue;
      if (!byEntry.has(h.id)) byEntry.set(h.id, { entry: e, analisi: [] });
      const d = describe(h.an);
      const g = byEntry.get(h.id);
      if (!g.analisi.includes(d)) g.analisi.push(d);
    }
    return [...byEntry.values()];
  }

  /** Ricerca per parola: forme flesse e inizio del lemma o del significato. */
  search(q, limit = 30) {
    const n = strip(q);
    const qi = q.trim().toLowerCase();
    if (!n && !qi) return [];
    const res = [];
    const seen = new Set();
    for (const r of this.analyze(q)) { if (!seen.has(r.entry.id)) { seen.add(r.entry.id); res.push({ ...r, how: 'forma' }); } }
    const pref = [];
    for (const e of this.entries.values()) {
      if (seen.has(e.id)) continue;
      const lem = strip(e.lemma);
      if (n && lem.startsWith(n)) pref.push({ entry: e, how: 'lemma', score: lem === n ? 0 : 1 });
      else if (qi.length >= 3 && e.significati.some((s) => s.toLowerCase().split(/[\s,;()]+/).some((x) => x.startsWith(qi)))) pref.push({ entry: e, how: 'significato', score: 2 });
    }
    pref.sort((a, b) => a.score - b.score || a.entry.lemma.localeCompare(b.entry.lemma));
    return res.concat(pref).slice(0, limit);
  }
}
