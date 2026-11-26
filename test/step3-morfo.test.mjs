// Passo 3: lessico di base e riconoscimento delle forme flesse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Lexicon, parseLexicon, checkParadigm, classeOf } from '../latino/js/morfo.js';

const entries = parseLexicon(readFileSync(new URL('../latino/data/lessico.txt', import.meta.url), 'utf8'));
const L = new Lexicon(entries);
const an = (w) => L.analyze(w).map((r) => `${r.entry.lemma}${r.enclitica ? '+' + r.enclitica : ''}: ${r.analisi.join(' / ')}`);
const has = (w, lemma, text) => {
  const r = L.analyze(w).find((x) => x.entry.lemma === lemma);
  assert.ok(r, `${w} → manca il lemma ${lemma} (trovato: ${an(w).join(' || ') || 'niente'})`);
  assert.ok(r.analisi.some((a) => a.includes(text)), `${w} → ${lemma}: manca "${text}" (trovato: ${r.analisi.join(' / ')})`);
};

test('il lessico ha alcune centinaia di voci, tutte con paradigma valido', () => {
  assert.ok(entries.length >= 400, `voci: ${entries.length}`);
  const ids = new Set();
  for (const e of entries) {
    assert.ok(!ids.has(e.id), `voce doppia: ${e.id}`); ids.add(e.id);
    assert.ok(e.significati.length, `${e.lemma}: mancano i significati`);
    assert.ok(e.esempio, `${e.lemma}: manca l'esempio`);
    if (e.lemma !== 'vis') assert.deepEqual(checkParadigm(e.cat, e.paradigma, e.tags), [], `${e.lemma}: paradigma`);
  }
  assert.ok(entries.filter((e) => e.connettivo).length >= 60, 'connettivi');
});

test('classi grammaticali', () => {
  const c = (lemma) => classeOf(entries.find((e) => e.lemma === lemma));
  assert.equal(c('rosa'), '1ª declinazione');
  assert.equal(c('consul'), '3ª declinazione');
  assert.equal(c('fortis'), 'aggettivo della 2ª classe');
  assert.equal(c('capio'), '3ª coniugazione (in -io)');
  assert.equal(c('hortor'), '1ª coniugazione, deponente');
  assert.equal(c('audeo'), '2ª coniugazione, semideponente');
  assert.equal(c('aufero'), 'verbo irregolare (composto di fero)');
});

test('nomi: tutte le declinazioni e le forme ambigue', () => {
  has('rosarum', 'rosa', 'genitivo plurale');
  for (const a of ['genitivo singolare', 'dativo singolare', 'nominativo plurale']) has('rosae', 'rosa', a);
  has('deabus', 'dea', 'dativo plurale');
  has('domine', 'dominus', 'vocativo singolare');
  has('fili', 'filius', 'vocativo singolare');
  has('agros', 'ager', 'accusativo plurale');
  has('pueri', 'puer', 'genitivo singolare');
  has('civium', 'civis', 'genitivo plurale');
  has('patrum', 'pater', 'genitivo plurale');
  has('urbium', 'urbs', 'genitivo plurale');
  has('maria', 'mare', 'nominativo plurale');
  has('mari', 'mare', 'ablativo singolare');
  has('itineribus', 'iter', 'ablativo plurale');
  has('manibus', 'manus', 'dativo plurale');
  has('cornua', 'cornu', 'accusativo plurale');
  has('rei', 'res', 'genitivo singolare');
  has('diebus', 'dies', 'ablativo plurale');
  has('castris', 'castra', 'ablativo plurale');
  has('dis', 'deus', 'dativo plurale');
  has('vim', 'vis', 'accusativo singolare');
  has('domi', 'domus', 'locativo');
});

test('aggettivi, gradi e avverbi', () => {
  has('pulchrae', 'pulcher', 'genitivo singolare femminile');
  has('acrem', 'acer', 'accusativo singolare');
  has('felici', 'felix', 'ablativo singolare');
  has('omnia', 'omnis', 'nominativo plurale neutro');
  has('celerum', 'celer', 'genitivo plurale');
  has('meliorem', 'bonus', 'comparativo, accusativo singolare');
  has('optimi', 'bonus', 'superlativo');
  has('maximam', 'magnus', 'superlativo, accusativo singolare femminile');
  has('pulcherrima', 'pulcher', 'superlativo');
  has('facillimus', 'facilis', 'superlativo');
  has('fortiter', 'fortis', 'avverbio');
  has('audacter', 'audax', 'avverbio');
  has('alterius', 'alter', 'genitivo singolare');
  has('aliud', 'alius', 'nominativo singolare neutro');
  has('mi', 'meus', 'vocativo singolare maschile');
});

test('verbi: coniugazioni, modi e tempi', () => {
  has('amabatur', 'amo', 'indicativo imperfetto passivo, 3ª persona singolare');
  has('amaverant', 'amo', 'indicativo piuccheperfetto attivo, 3ª persona plurale');
  has('amasti', 'amo', 'indicativo perfetto attivo, 2ª persona singolare');
  has('amarunt', 'amo', 'indicativo perfetto attivo, 3ª persona plurale');
  has('amaris', 'amo', 'indicativo presente passivo, 2ª persona singolare');
  has('amandi', 'amo', 'gerundio, genitivo');
  has('amaturus', 'amo', 'participio futuro');
  has('monebimus', 'moneo', 'indicativo futuro semplice attivo, 1ª persona plurale');
  has('legam', 'lego', 'indicativo futuro semplice attivo, 1ª persona singolare');
  has('legam', 'lego', 'congiuntivo presente attivo, 1ª persona singolare');
  has('legerent', 'lego', 'congiuntivo imperfetto attivo, 3ª persona plurale');
  has('legissent', 'lego', 'congiuntivo piuccheperfetto attivo, 3ª persona plurale');
  has('capiunt', 'capio', 'indicativo presente attivo, 3ª persona plurale');
  has('audiebant', 'audio', 'indicativo imperfetto attivo, 3ª persona plurale');
  has('audierunt', 'audio', 'indicativo perfetto attivo, 3ª persona plurale');
  has('auditur', 'audio', 'indicativo presente passivo, 3ª persona singolare');
  has('dic', 'dico', 'imperativo presente');
  has('dedit', 'do', 'indicativo perfetto attivo');
  has('fuere', 'sum', 'indicativo perfetto attivo, 3ª persona plurale');
});

test('deponenti, semideponenti, irregolari, difettivi, impersonali', () => {
  has('hortatur', 'hortor', 'indicativo presente, 3ª persona singolare');
  has('hortaretur', 'hortor', 'congiuntivo imperfetto, 3ª persona singolare');
  has('secutus', 'sequor', 'participio perfetto');
  has('profecti', 'proficiscor', 'participio perfetto');
  has('utebatur', 'utor', 'indicativo imperfetto');
  has('moriturus', 'morior', 'participio futuro');
  has('ausus', 'audeo', 'participio perfetto');
  has('sumus', 'sum', 'indicativo presente attivo, 1ª persona plurale');
  has('esset', 'sum', 'congiuntivo imperfetto');
  has('potest', 'possum', 'indicativo presente');
  has('prodest', 'prosum', 'indicativo presente');
  has('afuit', 'absum', 'indicativo perfetto');
  has('eunt', 'eo', 'indicativo presente attivo, 3ª persona plurale');
  has('ierunt', 'eo', 'indicativo perfetto');
  has('redibant', 'redeo', 'indicativo imperfetto');
  has('transierant', 'transeo', 'indicativo piuccheperfetto');
  has('fert', 'fero', 'indicativo presente attivo, 3ª persona singolare');
  has('fertur', 'fero', 'indicativo presente passivo');
  has('abstulit', 'aufero', 'indicativo perfetto');
  has('rettulit', 'refero', 'indicativo perfetto');
  has('vult', 'volo', 'indicativo presente attivo, 3ª persona singolare');
  has('nolite', 'nolo', 'imperativo presente');
  has('mavult', 'malo', 'indicativo presente');
  has('fit', 'fio', 'indicativo presente, 3ª persona singolare');
  has('oderam', 'odi', 'indicativo piuccheperfetto');
  has('licuit', 'licet', 'indicativo perfetto');
});

test('pronomi, enclitiche e parole invariabili', () => {
  has('eius', 'is', 'genitivo singolare');
  has('mihi', 'ego', 'dativo singolare');
  has('quorum', 'qui', 'genitivo plurale');
  has('cuius', 'quis', 'genitivo singolare');
  has('hanc', 'hic', 'accusativo singolare femminile');
  has('eadem', 'idem', 'nominativo singolare femminile');
  has('quendam', 'quidam', 'accusativo singolare maschile');
  has('rosasque', 'rosa', 'accusativo plurale');
  assert.ok(L.analyze('rosasque')[0].enclitica === 'que');
  // forme ambigue tra voci diverse
  const cum = L.analyze('cum').map((r) => r.entry.categoria);
  assert.ok(cum.includes('preposizione') && cum.includes('congiunzione'));
  const est = L.analyze('est').map((r) => r.entry.lemma);
  assert.ok(est.includes('sum'));
  // j/v e quantità
  has('Iūlium'.replace('Iūlium', 'iūssit'), 'iubeo', 'indicativo perfetto');
  has('VENIT', 'venio', 'indicativo presente');
});

test('ricerca per lemma, forma e significato', () => {
  assert.equal(L.search('rosarum')[0].entry.lemma, 'rosa');
  assert.ok(L.search('ros').some((r) => r.entry.lemma === 'rosa'));
  assert.ok(L.search('guerra').some((r) => r.entry.lemma === 'bellum'));
});
