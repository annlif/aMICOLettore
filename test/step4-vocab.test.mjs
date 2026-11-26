// Passo 4: menu della parola, analisi, sezione Vocabolario, ricerca unica, Olivetti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL_ = 'http://localhost:8095/aMICOLettore/latino/';

test('vocabolario e analisi nell\'app', async () => {
  const server = await startPagesServer(8095);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(URL_);
    await page.click('#btn-paste');
    await page.fill('#paste-title', 'Prova');
    await page.fill('#paste-text', 'Nauta rosas puellae dat. Agricolae Quiritiumque filii laborant.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });

    // Analizza la forma: forma ambigua
    await page.locator('.sent-la .w', { hasText: 'puellae' }).click();
    await page.click('.popmenu button:has-text("Analizza la forma")');
    await page.waitForSelector('#word-sheet[open] .card');
    const an = await page.locator('#word-body .an li').allTextContents();
    assert.deepEqual(an, ['genitivo singolare', 'dativo singolare', 'nominativo plurale', 'vocativo plurale']);
    assert.match(await page.textContent('#word-body'), /più analisi possibili/);
    assert.match(await page.textContent('#word-body .card-lemma'), /puella, puellae, f\./);
    const href = await page.getAttribute('#word-body a.pill', 'href');
    assert.equal(href, 'https://www.dizionario-latino.com/dizionario-latino-italiano.php?parola=puella');
    await page.click('#word-sheet .close-x');

    // Cerca nel vocabolario: scheda completa con esempio
    await page.locator('.sent-la .w', { hasText: 'dat' }).click();
    await page.click('.popmenu button:has-text("Cerca nel vocabolario")');
    await page.waitForSelector('#word-sheet[open] .card');
    assert.match(await page.textContent('#word-body'), /do, das, dedi, datum, dare/);
    assert.match(await page.textContent('#word-body'), /indicativo presente attivo, 3ª persona singolare/);
    assert.match(await page.textContent('#word-body .badge'), /da verificare/);
    await page.click('#word-sheet .close-x');

    // parola sconosciuta → da completare
    await page.locator('.sent-la .w', { hasText: 'Quiritiumque' }).click();
    await page.click('.popmenu button:has-text("Cerca nel vocabolario")');
    await page.waitForSelector('#word-sheet[open] .notfound');
    await page.click('#word-body [data-act="dacompletare"]');
    await page.click('#word-sheet .close-x');

    // sezione Vocabolario
    await page.click('.tab[data-view="vocabolario"]');
    await page.waitForSelector('#vocab-list .vrow');
    assert.match(await page.textContent('#vocab-count'), /\d{3} voci/);
    await page.click('.chip[data-f="connettivi"]');
    const n = await page.locator('#vocab-list .vrow').count();
    assert.ok(n >= 60, `connettivi: ${n}`);
    await page.fill('#vocab-search', 'rosarum');
    await page.waitForFunction(() => document.querySelectorAll('#vocab-list .vrow').length === 0 || document.querySelector('#vocab-list .vrow-l').textContent.startsWith('rosa'));
    await page.click('.chip[data-f="tutti"]');
    await page.waitForSelector('#vocab-list .vrow');
    assert.match(await page.textContent('#vocab-list .vrow-l'), /^rosa, rosae/);
    await page.click('#vocab-list .vrow');
    await page.waitForSelector('#vocab-list .card');
    assert.ok(await page.locator('#dc-box').isVisible());
    assert.match(await page.textContent('#dc-list'), /Quiritiumque/);

    // ricerca unica
    await page.fill('#search-input', 'hostium');
    await page.press('#search-input', 'Enter');
    await page.waitForSelector('#search-results .card');
    assert.match(await page.textContent('#search-results'), /hostis, hostis, m\./);
    assert.match(await page.textContent('#search-results'), /genitivo plurale/);
    await page.fill('#search-input', 'nauta');
    await page.press('#search-input', 'Enter');
    await page.waitForSelector('#search-results .res-vers');
    assert.match(await page.textContent('#search-results .res-vers'), /Prova/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
