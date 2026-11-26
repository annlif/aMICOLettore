// Passo 7: connettivi, esportazione (testo e PDF), backup e ripristino.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL_ = 'http://localhost:8090/aMICOLettore/latino/';

test('connettivi, esportazione e backup', async () => {
  const server = await startPagesServer(8090);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(URL_);
    await page.evaluate(() => { delete navigator.__proto__.share; delete navigator.__proto__.canShare; });
    await page.click('#btn-paste');
    await page.fill('#paste-title', 'La volpe e l\'uva');
    await page.fill('#paste-text', 'Vulpes uvam vidit, sed eam non attingebat. Itaque, cum abiret, dixit: «Nondum matura est.»');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    await page.locator('.sent textarea').first().fill('La volpe vide l\'uva, ma non la raggiungeva.');

    // connettivi
    await page.click('#ver-conn');
    await page.waitForSelector('.sent-la .w.conn');
    const conn = await page.locator('.sent-la .w.conn').allTextContents();
    assert.deepEqual(conn, ['sed', 'Itaque', 'cum']);
    assert.equal(await page.locator('.sent-la .w.conn.amb').textContent(), 'cum');
    assert.ok(await page.locator('#conn-legend').isVisible());

    // esportazione come testo (senza pannello Condividi: si scarica il file)
    let dl = page.waitForEvent('download');
    await page.click('#ver-export');
    await page.click('.popmenu button:has-text("testo")');
    const txt = readFileSync(await (await dl).path(), 'utf8');
    assert.match(txt, /La volpe e l'uva/);
    assert.match(txt, /1\. Vulpes uvam vidit, sed eam non attingebat\.\n {3}→ La volpe vide l'uva, ma non la raggiungeva\./);
    assert.match(txt, /\(da tradurre\)/);

    // esportazione come PDF
    dl = page.waitForEvent('download');
    await page.click('#ver-export');
    await page.click('.popmenu button:has-text("PDF")');
    const d = await dl;
    assert.match(d.suggestedFilename(), /\.pdf$/);
    const pdf = readFileSync(await d.path());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

    // backup
    await page.click('#btn-settings');
    dl = page.waitForEvent('download');
    await page.click('#btn-backup');
    const bpath = await (await dl).path();
    const backup = JSON.parse(readFileSync(bpath, 'utf8'));
    assert.equal(backup.app, 'aMICOLatino');
    assert.equal(backup.versioni.length, 1);
    assert.ok(!JSON.stringify(backup).includes('"key"'), 'la chiave di Azure non va nel backup');
    await page.keyboard.press('Escape');

    // cancello la versione e la ripristino dal backup
    await page.click('#ver-back');
    await page.locator('.lib-item [data-del]').click();
    await page.waitForSelector('#ver-empty', { state: 'visible' });
    await page.click('#btn-settings');
    await page.setInputFiles('#restore-input', bpath);
    await page.waitForSelector('#restore-dialog[open]');
    assert.match(await page.textContent('#restore-info'), /1 versioni/);
    await page.click('#restore-dialog button[value="unisci"]');
    await page.waitForSelector('#backup-msg:has-text("Ripristino fatto")');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.lib-item');
    assert.match(await page.textContent('.lib-item'), /La volpe e l'uva/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
