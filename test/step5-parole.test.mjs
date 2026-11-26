// Passo 5: Le mie parole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL_ = 'http://localhost:8092/aMICOLettore/latino/';

test('le mie parole: aggiungere, filtrare, appunti, eliminare', async () => {
  const server = await startPagesServer(8092);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(URL_);
    await page.click('#btn-paste');
    await page.fill('#paste-title', 'Prova');
    await page.fill('#paste-text', 'Nauta rosas puellae dat, sed cum amicis Quiritibus ambulat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    const add = async (w) => {
      await page.locator('.sent-la .w', { hasText: new RegExp(`^${w}$`) }).click();
      await page.click('.popmenu button:has-text("Aggiungi alle mie parole")');
    };
    await add('rosas');
    await page.waitForSelector('#toast:has-text("rosa")');
    await add('sed');
    await page.waitForSelector('#toast:has-text("sed")');
    // forma che viene da due voci: si sceglie
    await add('cum');
    await page.waitForSelector('#word-sheet[open] .hint-box');
    assert.equal(await page.locator('#word-body .card').count(), 2);
    await page.locator('#word-body .card', { hasText: 'preposizione' }).locator('[data-act="aggiungi"]').click();
    await page.click('#word-sheet .close-x');
    // parola sconosciuta: da completare
    await page.locator('.sent-la .w', { hasText: 'Quiritibus' }).click();
    await page.click('.popmenu button:has-text("Aggiungi alle mie parole")');
    await page.waitForSelector('#word-sheet[open] .notfound');
    await page.click('#word-body [data-act="dacompletare"]');
    await page.click('#word-sheet .close-x');

    await page.click('.tab[data-view="parole"]');
    await page.waitForSelector('#parole-list .pword');
    assert.match(await page.textContent('#parole-count'), /3 parole · 1 in attesa/);
    const heads = await page.locator('#parole-list .res-h').allTextContents();
    assert.deepEqual(heads, ['Connettivi', 'Altre parole', 'In attesa della scheda']);
    const rosa = page.locator('.pword', { hasText: 'rosa, rosae' });
    assert.match(await rosa.textContent(), /Nauta rosas puellae dat/);
    assert.equal(await rosa.locator('[data-act="aggiungi"]').count(), 0);
    // appunti salvati
    await rosa.locator('textarea').fill('Come il fiore!');
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('#parole-list .pword');
    assert.equal(await page.locator('.pword', { hasText: 'rosa, rosae' }).locator('textarea').inputValue(), 'Come il fiore!');
    // filtri
    await page.click('#parole-chips .chip[data-f="connettivi"]');
    await page.waitForFunction(() => document.querySelectorAll('#parole-list .pword').length === 1);
    assert.match(await page.textContent('#parole-list'), /sed/);
    await page.click('#parole-chips .chip[data-f="tutte"]');
    await page.waitForFunction(() => document.querySelectorAll('#parole-list .pword').length === 3);
    // eliminare
    await page.locator('.pword', { hasText: 'rosa, rosae' }).locator('[data-pdel]').click();
    await page.waitForFunction(() => document.querySelectorAll('#parole-list .pword').length === 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
