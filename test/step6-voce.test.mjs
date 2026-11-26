// Passo 6: "Ascolta" e collegamento della voce di aMICOLettore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
import { parseVoceCode } from '../latino/js/voce.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = 'http://localhost:8091/aMICOLettore/';

test('codice della voce', () => {
  const code = 'aMICOL-voce:' + Buffer.from(JSON.stringify({ key: 'abc', region: 'westeurope', voice: 'it-IT-ElsaNeural' })).toString('base64');
  assert.deepEqual(parseVoceCode(code), { key: 'abc', region: 'westeurope', voice: 'it-IT-ElsaNeural' });
  assert.equal(parseVoceCode('ciao'), null);
});

test('copia da aMICOLettore e incolla in aMICOLatino', async () => {
  const server = await startPagesServer(8091);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    // in aMICOLettore: chiave inserita e copiata
    await page.goto(BASE);
    await page.click('#btn-settings');
    await page.fill('#set-key', 'chiave-di-prova');
    await page.fill('#set-region', 'westeurope');
    await page.click('#btn-copy-latino');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /^aMICOL-voce:/);

    // in aMICOLatino (archivio separato, come sull'iPad): incolla
    await page.goto(BASE + 'latino/');
    await page.evaluate(() => localStorage.removeItem('amicolettore.settings'));
    await page.click('#btn-settings');
    assert.match(await page.textContent('#voce-stato'), /non è ancora collegata/);
    await page.click('#btn-incolla-voce');
    await page.waitForFunction(() => /Fatto!/.test(document.getElementById('voce-msg').textContent));
    assert.match(await page.textContent('#voce-stato'), /collegata \(regione westeurope\)/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('amicolatino.voce')));
    assert.equal(saved.key, 'chiave-di-prova');

    // stessa memoria (Safari, computer): la chiave di aMICOLettore viene riusata da sola
    await page.evaluate(() => { localStorage.removeItem('amicolatino.voce'); localStorage.setItem('amicolettore.settings', JSON.stringify({ key: 'k2', region: 'italynorth', voice: 'it-IT-ElsaNeural' })); });
    await page.reload();
    await page.click('#btn-settings');
    assert.match(await page.textContent('#voce-stato'), /regione italynorth\), presa da aMICOLettore/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
