// Guida all'analisi della frase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startPagesServer } from './pages-server.mjs';
import { Lexicon, parseLexicon } from '../latino/js/morfo.js';
import { analyzeSentence, subjectCandidates, complementType, complementCandidates, implicitSubject, verbLemmas } from '../latino/js/struttura.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const L = new Lexicon(parseLexicon(readFileSync(new URL('../latino/data/lessico.txt', import.meta.url), 'utf8')));
const T = (S, ks) => ks.map((k) => S.words[k].t);

test('struttura: verbo principale, soggetto, complementi', () => {
  let S = analyzeSentence(L, 'Cum milites ad urbem venissent, consul legatos misit.');
  assert.deepEqual(T(S, S.main), ['misit']);
  assert.deepEqual(T(S, S.verbs), ['venissent', 'misit']);
  const v = S.main[0];
  assert.deepEqual(T(S, subjectCandidates(S, v).all), ['consul']);
  assert.equal(complementType(S, v), 'acc');
  assert.deepEqual(T(S, complementCandidates(S, v, 'acc', [])), ['legatos']);

  S = analyzeSentence(L, 'Puer, quem vides, meus filius est.');
  assert.deepEqual(T(S, S.main), ['est']);
  assert.equal(complementType(S, S.main[0]), 'pred');

  S = analyzeSentence(L, 'Pugnare possumus.');
  assert.deepEqual(T(S, S.main), ['possumus']);
  assert.equal(implicitSubject(S, S.main[0]), 'noi');
  assert.equal(complementType(S, S.main[0]), 'inf');

  S = analyzeSentence(L, 'Milites duci parent.');
  assert.deepEqual(verbLemmas(S.words[S.main[0]]).map((e) => e.lemma).sort(), ['pareo', 'paro']);
  const pareo = verbLemmas(S.words[S.main[0]]).find((e) => e.lemma === 'pareo');
  assert.equal(complementType(S, S.main[0], pareo.id), 'dat');

  S = analyzeSentence(L, 'Romani armis utuntur.');
  assert.equal(complementType(S, S.main[0]), 'abl');
  assert.deepEqual(T(S, complementCandidates(S, S.main[0], 'abl', [])), ['armis']);

  // la preposizione regge il suo gruppo e si ferma al nome: il soggetto dopo non è "retto"
  S = analyzeSentence(L, 'In parva insula puella habitat.');
  assert.deepEqual(T(S, [...S.governed.keys()]), ['parva', 'insula']);
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['puella']);
  S = analyzeSentence(L, 'Ad urbem magnam milites veniunt.');
  assert.deepEqual(T(S, [...S.governed.keys()]), ['urbem', 'magnam']);
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['milites']);

  S = analyzeSentence(L, 'Cum amicis ambulo.');
  assert.deepEqual(T(S, S.main), ['ambulo']);
  assert.equal(S.spans.length, 0, 'cum + ablativo è una preposizione');
});

test('guida nell\'app: si arriva alla struttura toccando le parole', async () => {
  const server = await startPagesServer(8082);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tap = (w) => page.locator('.sent.guided .sent-la .w', { hasText: new RegExp(`^${w}$`) }).click();
  const fb = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-fb').textContent), re.source);
  const q = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-q').textContent), re.source, { timeout: 8000 });
  try {
    await page.goto('http://localhost:8082/aMICOLettore/latino/');
    await page.click('#btn-paste');
    await page.fill('#paste-text', 'Cum milites ad urbem venissent, consul legatos misit. Milites duci parent. Puella laeta est. Magnus nauta rosas puellae dat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    const sent = (n) => page.locator('.sent').nth(n);
    const avanti = async () => { await page.click('#guide-btns [data-g="avanti"]'); };
    const caso = (id) => page.click(`#guide-btns [data-g="caso"][data-id="${id}"]`);
    const dom = (testo) => page.locator('#guide-btns [data-g="dom"]', { hasText: testo }).first().click();
    const choose = (id) => page.click(`#guide-btns [data-g="comp"][data-id="${id}"]`);

    // frase 1: subordinata, Mostrami, soggetto, oggetto, complemento con preposizione
    await sent(0).locator('[data-guide]').click();
    await q(/verbo principale.*2 verbi/);
    await tap('venissent');
    await fb(/subordinata/);
    await tap('urbem');
    await fb(/non è un verbo/);
    await page.click('#guide-btns [data-g="mostra"]');
    assert.equal(await page.locator('.sent.guided .w.g-hint').textContent(), 'misit');
    await tap('misit');
    await fb(/Sì! misit è il verbo principale: indicativo perfetto attivo, 3ª persona singolare/);
    // non va avanti da sola: resta il tempo di leggere
    await page.waitForTimeout(1500);
    assert.match(await page.textContent('#guide-fb'), /verbo principale/);
    await avanti();
    await q(/soggetto/);
    await tap('legatos');
    await fb(/non è al nominativo/);
    await tap('consul');
    await avanti();
    await q(/complemento oggetto/);
    await tap('legatos');
    await avanti();
    await q(/altri pezzi/);
    await tap('ad');
    await q(/retta da/);
    await tap('urbem');
    await q(/In che caso/);
    assert.match(await page.textContent('#guide-q'), /ad urbem/);
    await caso('abl');
    await fb(/non è all'ablativo/);
    await caso('acc');
    await q(/A quale domanda/);
    assert.ok(await page.locator('#guide-btns [data-g="dom"]').count() >= 25, 'elenco completo delle domande');
    await dom('A chi? A che cosa?');
    await fb(/non risponde/);
    await dom('Verso dove?');
    await fb(/complemento di moto a luogo/);
    await avanti();
    await q(/Altri pezzi/);
    await page.click('#guide-btns [data-g="fine-altri"]');
    await q(/analisi logica/);
    const sum = await page.textContent('#guide-q');
    assert.match(sum, /predicato verbale\s*misit/);
    assert.match(sum, /soggetto\s*consul/);
    assert.match(sum, /complemento oggetto\s*legatos/);
    assert.match(sum, /complemento di moto a luogo\s*ad urbem/);
    assert.match(sum, /proposizione subordinata/);
    await page.click('#guide-btns [data-g="traduci"]');
    assert.ok(await page.locator('#guide-bar').isHidden());
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    // l'analisi resta sotto la frase, anche dopo aver riaperto l'app
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('.sent .w.g-verb');
    assert.equal(await sent(0).locator('.w.g-verb').textContent(), 'misit');
    assert.match(await sent(0).locator('.an-logica').textContent(), /misit → predicato verbale/);

    // frase 2: parent viene da pareo o da paro
    await sent(1).locator('[data-guide]').click();
    await q(/verbo principale/);
    await tap('parent');
    await avanti();
    await q(/2 verbi diversi/);
    await page.locator('#guide-btns [data-g="lemma"]', { hasText: 'pareo' }).click();
    await avanti();
    await q(/soggetto/);
    await tap('Milites');
    await avanti();
    await q(/regge il dativo/);
    await tap('duci');
    await fb(/complemento di termine/);
    await page.click('#guide-btns [data-g="esci"]');

    // frase 3: predicato nominale
    await sent(2).locator('[data-guide]').click();
    await q(/verbo principale/);
    await tap('est');
    await avanti();
    await q(/predicato verbale o nominale/);
    await page.click('#guide-btns [data-g="pt"][data-id="verbale"]');
    await fb(/Guarda meglio/);
    await page.click('#guide-btns [data-g="pt"][data-id="nominale"]');
    await fb(/copula/);
    await avanti();
    await q(/soggetto/);
    await tap('Puella');
    await avanti();
    await q(/nome del predicato/);
    await tap('laeta');
    await avanti();
    await q(/altri pezzi/);
    await page.click('#guide-btns [data-g="fine-altri"]');
    await q(/analisi logica/);
    assert.match(await page.textContent('#guide-q'), /predicato nominale\s*laeta … est/);
    await page.click('#guide-btns [data-g="esci"]');

    // frase 4: attributo e complemento di termine
    await sent(3).locator('[data-guide]').click();
    await q(/verbo principale/);
    await tap('dat');
    await avanti();
    await q(/soggetto/);
    await tap('nauta');
    await avanti();
    await q(/complemento oggetto/);
    await tap('rosas');
    await avanti();
    await q(/altri pezzi/);
    await tap('Magnus');
    await q(/In che caso/);
    await caso('nom');
    await q(/A quale domanda/);
    await dom('Accompagna un nome');
    await q(/che cos'è/);
    await choose('attributo');
    await q(/a cui si riferisce/);
    await tap('rosas');
    await fb(/non concordano/);
    await tap('nauta');
    await fb(/attributo di nauta/);
    await avanti();
    await q(/Altri pezzi/);
    await tap('puellae');
    await caso('acc');
    await fb(/non è all'accusativo/);
    await caso('dat');
    await dom('A chi? A che cosa?');
    await fb(/complemento di termine/);
    await avanti();
    await q(/Altri pezzi/);
    await page.click('#guide-btns [data-g="fine-altri"]');
    await q(/analisi logica/);
    const s4 = await page.textContent('#guide-q');
    assert.match(s4, /attributo di nauta\s*Magnus/);
    assert.match(s4, /complemento di termine\s*puellae/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test('contesto: le 5 frasi di prova (forma sicura, funzione ipotizzata)', async () => {
  const { tipoPredicato, ipotesiFunzioni, formeCaso } = await import('../latino/js/struttura.js');
  const fun = (S, w, forma) => {
    const k = S.words.findIndex((x) => x.t === w);
    const f = ipotesiFunzioni(S, k).find((x) => x.forma === forma);
    return f?.no ? `NO: ${f.no}` : f?.funzioni.map((y) => y.nome).join(' | ');
  };
  // 1. Prope oram insulae parva casa est.
  let S = analyzeSentence(L, 'Prope oram insulae parva casa est.');
  assert.deepEqual(T(S, S.main), ['est']);
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['casa']);
  assert.equal(tipoPredicato(S, S.main[0]).tipo, 'verbale', 'est = c\'è, si trova');
  assert.equal(fun(S, 'oram', 'accusativo singolare'), 'complemento di stato in luogo');
  assert.deepEqual(formeCaso(S.words[2]), ['genitivo singolare', 'dativo singolare', 'nominativo plurale', 'vocativo plurale']);
  assert.match(fun(S, 'insulae', 'genitivo singolare'), /specificazione/);
  assert.match(fun(S, 'insulae', 'nominativo plurale'), /NO: il verbo è singolare/);
  assert.equal(fun(S, 'parva', 'nominativo singolare'), 'attributo di casa', 'con est = c\'è, parva non è nome del predicato');
  assert.equal(fun(S, 'casa', 'nominativo singolare'), 'soggetto');
  // 2. In casa nauta cum filiabus habitat.
  S = analyzeSentence(L, 'In casa nauta cum filiabus habitat.');
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['nauta']);
  assert.match(fun(S, 'casa', 'ablativo singolare'), /stato in luogo/);
  assert.match(fun(S, 'filiabus', 'ablativo plurale'), /compagnia/);
  assert.match(fun(S, 'filiabus', 'dativo plurale'), /NO: cum non regge il dativo/);
  // 3. Vita nautae dura est.
  S = analyzeSentence(L, 'Vita nautae dura est.');
  const tp = tipoPredicato(S, S.main[0]);
  assert.equal(tp.tipo, 'nominale');
  assert.equal(S.words[tp.pred].t, 'dura');
  assert.deepEqual(T(S, complementCandidates(S, S.main[0], 'pred', [0])), ['dura'], 'nautae (nom. plurale) non concorda con est');
  assert.match(fun(S, 'nautae', 'genitivo singolare'), /specificazione/);
  // 4. Agricola puellae rosas donat.
  S = analyzeSentence(L, 'Agricola puellae rosas donat.');
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['Agricola']);
  assert.deepEqual(T(S, complementCandidates(S, S.main[0], 'acc', [])), ['rosas']);
  assert.match(fun(S, 'puellae', 'dativo singolare'), /termine/);
  // 5. Filiae nautam laetitia salutant.
  S = analyzeSentence(L, 'Filiae nautam laetitia salutant.');
  assert.deepEqual(T(S, subjectCandidates(S, S.main[0]).all), ['Filiae']);
  assert.deepEqual(T(S, complementCandidates(S, S.main[0], 'acc', [])), ['nautam']);
  assert.match(fun(S, 'laetitia', 'nominativo singolare'), /NO: il verbo è plurale/);
  assert.match(fun(S, 'laetitia', 'ablativo singolare'), /modo/);
});
