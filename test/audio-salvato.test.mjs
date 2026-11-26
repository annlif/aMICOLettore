// Cancellazione selettiva dell'audio salvato (aMICOLettore e aMICOLatino).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = 'http://localhost:8084/aMICOLettore/';

test('audio salvato: cancellare per documento, per parola, tutto', async () => {
  const server = await startPagesServer(8084);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    // --- aMICOLettore: un documento con il suo audio, più audio "orfano"
    await page.goto(BASE);
    await page.evaluate(async () => {
      const { db, sha256Hex } = await import('./js/store.js');
      const { pageModel } = await import('./js/text.js');
      const pages = ['Prima frase del documento. Seconda frase del documento.', 'Pagina due, con un\'altra frase.'];
      await db.putDoc({ id: 'd1', name: 'Prova.pdf', title: 'Documento di prova', numPages: 2, page: 0, sentence: 0, createdAt: Date.now(), updatedAt: Date.now(), offlineVoice: 'it-IT-IsabellaNeural' });
      await db.putText({ id: 'd1', pages });
      for (const p of pages) for (const c of pageModel(p).chunks) {
        const key = await sha256Hex(`it-IT-IsabellaNeural\u0001${c.text}`);
        await db.putAudio({ key, voice: 'it-IT-IsabellaNeural', chars: c.text.length, createdAt: Date.now(), audio: new ArrayBuffer(300000), words: [] });
      }
      await db.putAudio({ key: 'orfano', voice: 'it-IT-IsabellaNeural', chars: 10, createdAt: Date.now(), audio: new ArrayBuffer(200000), words: [] });
    });
    await page.reload();
    await page.click('#btn-settings');
    await page.waitForSelector('#audio-list li .audio-name');
    const names = await page.locator('#audio-list .audio-name').allTextContents();
    assert.deepEqual(names, ['Documento di prova', 'Documenti tolti dalla libreria e altro']);
    assert.match(await page.textContent('#audio-list'), /2 blocchi · 0,6 MB/);
    // cancello l'audio del documento
    await page.locator('#audio-list li', { hasText: 'Documento di prova' }).locator('button').click();
    await page.waitForFunction(() => document.querySelectorAll('#audio-list .audio-name').length === 1);
    assert.equal(await page.evaluate(async () => (await import('./js/store.js')).db.countAudio()), 1);
    const doc = await page.evaluate(async () => (await import('./js/store.js')).db.getDoc('d1'));
    assert.equal(doc.offlineVoice, null, 'il documento non è più "pronto offline"');

    // --- aMICOLatino: elenco delle parole con audio
    await page.goto(BASE + 'latino/');
    await page.evaluate(async () => {
      const { db } = await import('./js/store.js');
      await db.audio.put({ key: 'a1', voice: 'v', text: 'rosarum', audio: new ArrayBuffer(8000), createdAt: Date.now() });
      await db.audio.put({ key: 'a2', voice: 'v', text: 'Nauta rosas puellae dat.', audio: new ArrayBuffer(20000), createdAt: Date.now() - 1000 });
    });
    await page.click('#btn-settings');
    await page.waitForSelector('#audio-list .audio-name');
    assert.deepEqual(await page.locator('#audio-list .audio-name').allTextContents(), ['rosarum', 'Nauta rosas puellae dat.']);
    assert.match(await page.textContent('#audio-info'), /2 parole e frasi/);
    await page.locator('#audio-list li', { hasText: 'rosarum' }).locator('button').click();
    await page.waitForFunction(() => document.querySelectorAll('#audio-list .audio-name').length === 1);
    await page.click('#btn-audio-clear');
    await page.waitForSelector('#audio-info:has-text("Nessun audio salvato")');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
