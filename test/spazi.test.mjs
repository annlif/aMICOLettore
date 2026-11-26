// Spazi mancanti nei PDF ("scurità.A"): aMICOLettore e aMICOLatino.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixSpacing, cleanPageText, splitSentences } from '../src/js/text.js';
import { fixSpacing as fixLat, itemsToLines } from '../latino/js/testo.js';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const casi = {
  'La mancanza di scurità.A volte i ragazzi': 'La mancanza di scurità. A volte i ragazzi',
  'casa,albero e prato': 'casa, albero e prato',
  'Fine.E poi?': 'Fine. E poi?',
  'Disse: «Vieni!»Poi partì.': 'Disse: «Vieni!» Poi partì.',
  'Costa 3,5 euro alle 10:30': 'Costa 3,5 euro alle 10:30',
  'La S.p.A. fu fondata nel 44 a.C. negli U.S.A.': 'La S.p.A. fu fondata nel 44 a.C. negli U.S.A.',
};

test('punteggiatura attaccata: si aggiunge lo spazio (sigle e numeri intatti)', () => {
  for (const [a, b] of Object.entries(casi)) { assert.equal(fixSpacing(a), b, a); assert.equal(fixLat(a), b, a); }
});

test('spazio ricavato dalla posizione dei pezzi di testo nel PDF', () => {
  const items = [
    { str: 'Non c\'era sicurezza.', transform: [1, 0, 0, 1, 10, 100], width: 90, height: 10 },
    { str: 'A volte', transform: [1, 0, 0, 1, 103, 100], width: 35, height: 10 },
    { str: 'si', transform: [1, 0, 0, 1, 141, 100], width: 8, height: 10, hasEOL: true },
  ];
  const t = cleanPageText(items);
  assert.match(t, /sicurezza\. A volte/);
  assert.equal(splitSentences(t).length, 2, 'ora le frasi sono due');
  assert.deepEqual(itemsToLines(items), ['Non c\'era sicurezza. A volte si']);
});

test('aMICOLettore: i documenti già salvati vengono corretti all\'apertura', async () => {
  const server = await startPagesServer(8076);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:8076/aMICOLettore/');
    await page.evaluate(async () => {
      const { db } = await import('./js/store.js');
      await db.putDoc({ id: 'v2', name: 'vecchio.pdf', title: 'Vecchio', numPages: 1, page: 0, sentence: 0, textVersion: 2, createdAt: Date.now(), updatedAt: Date.now() });
      await db.putText({ id: 'v2', pages: ['La mancanza di scurità.A volte i ragazzi giocano.'] });
    });
    await page.reload();
    await page.click('.lib-open');
    await page.waitForSelector('#view-reader:not([hidden])');
    await page.waitForFunction(() => /scurità\. A volte/.test(document.querySelector('.reader')?.textContent || ''));
    const doc = await page.evaluate(async () => (await import('./js/store.js')).db.getDoc('v2'));
    assert.equal(doc.textVersion, 3);
  } finally {
    await browser.close();
    server.close();
  }
});
