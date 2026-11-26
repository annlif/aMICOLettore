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
    const choose = (id) => page.click(`#guide-btns [data-g="comp"][data-id="${id}"]`);

    // frase 1: subordinata, Mostrami, soggetto, oggetto, complemento con preposizione
    await sent(0).locator('[data-guide]').click();
    await q(/2 verbi.*verbo principale/);
    await tap('venissent');
    await fb(/subordinata/);
    await tap('urbem');
    await fb(/non è un verbo/);
    await page.click('#guide-btns [data-g="mostra"]');
    assert.equal(await page.locator('.sent.guided .w.g-hint').textContent(), 'misit');
    await tap('misit');
    await fb(/Sì! misit è il verbo principale: indicativo perfetto attivo, 3ª persona singolare/);
    await q(/soggetto/);
    await tap('legatos');
    await fb(/non è al nominativo/);
    await tap('consul');
    await q(/complemento oggetto/);
    await tap('legatos');
    await q(/altri elementi/);
    await tap('ad');
    await q(/regge/);
    await tap('urbem');
    await q(/Scegli dall'elenco/);
    assert.ok(await page.locator('#guide-btns [data-g="comp"]').count() >= 25, 'elenco completo dei complementi');
    await choose('termine');
    await fb(/dativo senza preposizione\. Qui c'è ad \+ accusativo/);
    await choose('moto-a-luogo');
    await fb(/complemento di moto a luogo/);
    await q(/altri complementi/);
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
    await q(/2 verbi diversi/);
    await page.locator('#guide-btns [data-g="lemma"]', { hasText: 'pareo' }).click();
    await q(/soggetto/);
    await tap('Milites');
    await q(/regge il dativo/);
    await tap('duci');
    await fb(/complemento di termine/);
    await page.click('#guide-btns [data-g="esci"]');

    // frase 3: predicato nominale
    await sent(2).locator('[data-guide]').click();
    await q(/verbo principale/);
    await tap('est');
    await q(/predicato verbale.*predicato nominale/);
    await page.click('#guide-btns [data-g="pt"][data-id="verbale"]');
    await fb(/Guarda meglio/);
    await page.click('#guide-btns [data-g="pt"][data-id="nominale"]');
    await fb(/copula/);
    await q(/soggetto/);
    await tap('Puella');
    await q(/nome del predicato/);
    await tap('laeta');
    await q(/altri elementi/);
    await page.click('#guide-btns [data-g="fine-altri"]');
    await q(/analisi logica/);
    assert.match(await page.textContent('#guide-q'), /predicato nominale\s*laeta … est/);
    await page.click('#guide-btns [data-g="esci"]');

    // frase 4: attributo e complemento di termine
    await sent(3).locator('[data-guide]').click();
    await q(/verbo principale/);
    await tap('dat');
    await q(/soggetto/);
    await tap('nauta');
    await q(/complemento oggetto/);
    await tap('rosas');
    await q(/altri elementi/);
    await tap('Magnus');
    await q(/Scegli dall'elenco/);
    await choose('attributo');
    await q(/a cui si riferisce/);
    await tap('rosas');
    await fb(/non concordano/);
    await tap('nauta');
    await fb(/attributo di nauta/);
    await q(/altri complementi/);
    await tap('puellae');
    await choose('termine');
    await fb(/complemento di termine/);
    await q(/altri complementi/);
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
