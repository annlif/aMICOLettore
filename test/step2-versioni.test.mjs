// Passo 2: caricare una versione da PDF, dividerla in frasi, tradurre e salvare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPagesServer } from './pages-server.mjs';
import { splitSentences, cleanVersion, tokenize, normalize } from '../latino/js/testo.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const URL_ = 'http://localhost:8097/aMICOLettore/latino/';

test('divisione in frasi: abbreviazioni latine', () => {
  assert.deepEqual(splitSentences('M. Tullius Cicero Catilinam vicit. Quis hoc fecit? Caesar a. Chr. n. C bellum gessit; hostes fugerunt! Cn. Pompeio et M. Crasso coss., Romani venerunt.'), [
    'M. Tullius Cicero Catilinam vicit.', 'Quis hoc fecit?', 'Caesar a. Chr. n. C bellum gessit; hostes fugerunt!', 'Cn. Pompeio et M. Crasso coss., Romani venerunt.',
  ]);
  assert.deepEqual(splitSentences('Tum dixit: «Nondum matura est!» Et abiit.'), ['Tum dixit: «Nondum matura est!»', 'Et abiit.']);
});

test('pulizia: titolo, numeri di riga, parole divise a capo', () => {
  const r = cleanVersion([{ lines: ['Versione 12', "La volpe e l'uva", 'Vulpes, fame coacta, uvam in alta', 'vinea vidit. Ad uvam saliebat 5', 'sed eam non attinge-', 'bat. Tum dixit: «Nondum matura est!»', '(Fedro)', '3'] }]);
  assert.equal(r.titleGuess, "La volpe e l'uva");
  assert.equal(r.latin, 'Vulpes, fame coacta, uvam in alta vinea vidit. Ad uvam saliebat sed eam non attingebat. Tum dixit: «Nondum matura est!»');
  assert.ok(r.notes.includes('(Fedro)'));
});

test('parole e normalizzazione', () => {
  assert.deepEqual(tokenize('Vulpes, fame coacta.').filter((p) => p.w).map((p) => p.t), ['Vulpes', 'fame', 'coacta']);
  assert.equal(normalize('Iūlius'), 'iulius');
  assert.equal(normalize('Vēnit'), 'uenit');
});

async function makePdfs(browser, dir) {
  const page = await browser.newPage();
  await page.setContent(`<style>body{font:16px serif;margin:60px} p{margin:0;line-height:1.6;width:420px;position:relative} .n{position:absolute;left:440px}</style>
    <h2>Versione 12</h2><h3>La volpe e l'uva</h3>
    <p>Vulpes, fame coacta, uvam in alta</p><p>vinea vidit. Ad uvam saliebat, sed</p><p>eam non attingebat. Tum, cum fru-<span class="n">5</span></p>
    <p>stra saltavisset, abiit et dixit: «Nondum</p><p>matura est: nolo acerbam sumere!» Qui</p><p>facere quae non possunt, verbis elevant.</p>
    <p>(Fedro)</p>`);
  const text = join(dir, 'volpe.pdf');
  await page.pdf({ path: text, format: 'A4' });
  // "scansione": solo un'immagine, nessun testo
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 500, height: 300 } });
  await page.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" style="width:500px">`);
  const scan = join(dir, 'scansione.pdf');
  await page.pdf({ path: scan, format: 'A4' });
  await page.close();
  return { text, scan };
}

test('versioni: PDF → frasi → traduzione salvata', async () => {
  const server = await startPagesServer(8097);
  const browser = await chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), 'amicolatino-'));
  const pdfs = await makePdfs(browser, dir);
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(URL_);
    await page.setInputFiles('#pdf-input', pdfs.text);
    await page.waitForSelector('#view-versione', { state: 'visible' });
    assert.equal(await page.inputValue('#ver-title-input'), "La volpe e l'uva");
    const sents = await page.locator('.sent-la').allTextContents();
    assert.deepEqual(sents, [
      'Vulpes, fame coacta, uvam in alta vinea vidit.',
      'Ad uvam saliebat, sed eam non attingebat.',
      'Tum, cum frustra saltavisset, abiit et dixit: «Nondum matura est: nolo acerbam sumere!»',
      'Qui facere quae non possunt, verbis elevant.',
    ]);
    assert.match(await page.locator('#ver-notes-text').textContent(), /Fedro/);

    // traduzione: salvataggio automatico e ripresa dopo la riapertura
    await page.locator('.sent textarea').first().fill('La volpe, spinta dalla fame, vide dell\'uva');
    await page.waitForSelector('#ver-saved.on');
    assert.match(await page.textContent('#ver-meta'), /1 di 4 frasi tradotte/);
    await page.reload();
    await page.waitForSelector('#view-versione', { state: 'visible' });
    assert.equal(await page.locator('.sent textarea').first().inputValue(), 'La volpe, spinta dalla fame, vide dell\'uva');

    // menu della parola
    await page.locator('.sent-la .w', { hasText: 'coacta' }).click();
    const items = await page.locator('.popmenu button').allTextContents();
    assert.deepEqual(items, ['Cerca nel vocabolario', 'Analizza la forma', 'Ascolta', 'Aggiungi alle mie parole']);
    await page.keyboard.press('Escape');

    // unisci e dividi
    await page.locator('.sent').nth(2).locator('[data-more]').click();
    await page.click('.popmenu button:has-text("Unisci")');
    assert.equal(await page.locator('.sent').count(), 3);
    await page.locator('.sent').nth(2).locator('[data-more]').click();
    await page.click('.popmenu button:has-text("Dividi")');
    await page.locator('.sent').nth(2).locator('.w', { hasText: 'Qui' }).click();
    assert.equal(await page.locator('.sent').count(), 4);
    assert.equal(await page.locator('.sent-la').nth(3).textContent(), 'Qui facere quae non possunt, verbis elevant.');

    // elenco delle versioni
    await page.click('#ver-back');
    await page.waitForSelector('#view-versioni', { state: 'visible' });
    assert.match(await page.textContent('.lib-item'), /La volpe e l'uva/);
    assert.match(await page.textContent('.lib-item'), /Caricata il \d+ \w+ \d{4}/);
    assert.match(await page.textContent('.lib-item'), /1 di 4 frasi tradotte/);

    // scansione: avviso chiaro
    await page.setInputFiles('#pdf-input', pdfs.scan);
    await page.waitForSelector('#scan-dialog[open]');
    await page.click('#scan-dialog button[value="paste"]');
    // ...e si può incollare il testo
    await page.waitForSelector('#paste-dialog[open]');
    await page.fill('#paste-title', 'Prova');
    await page.fill('#paste-text', 'Nauta rosas puellae dat. Puella nautam laudat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    assert.equal(await page.locator('.sent').count(), 2);

    // eliminazione
    await page.click('#ver-back');
    await page.waitForSelector('.lib-item >> nth=1');
    await page.locator('.lib-item', { hasText: 'Prova' }).locator('[data-del]').click();
    await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
