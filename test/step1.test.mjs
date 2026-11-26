// Passo 1: le due app convivono, ognuna con il suo service worker, e funzionano offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = 'http://localhost:8099/aMICOLettore/';

test('aMICOLettore e aMICOLatino: app separate, anche offline', async () => {
  const server = await startPagesServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    // aMICOLettore registra il suo service worker
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // aMICOLatino registra il suo, con ambito /latino/
    await page.goto(BASE + 'latino/');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    assert.equal(scope, BASE + 'latino/');
    await page.reload();
    const ctrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    assert.equal(ctrl, BASE + 'latino/sw.js');

    // manifest
    const man = await (await page.request.get(BASE + 'latino/manifest.webmanifest')).json();
    assert.equal(man.short_name, 'aMICOLat');
    assert.equal(man.name, 'aMICOLatino');

    // solo le sezioni pronte nella barra
    const tabs = await page.locator('.tab').allTextContents();
    assert.deepEqual(tabs, ['Versioni', 'Vocabolario', 'Le mie parole']);
    await page.click('.tab[data-view="vocabolario"]');
    await page.waitForSelector('#view-vocabolario', { state: 'visible' });
    assert.ok(await page.locator('#view-versioni').isHidden());

    // offline: ognuna mostra se stessa
    await ctx.setOffline(true);
    await page.goto(BASE + 'latino/');
    assert.equal(await page.title(), 'aMICOLatino');
    assert.ok(await page.locator('#view-vocabolario').isVisible(), 'riapre l\'ultima sezione');
    await page.goto(BASE);
    assert.equal(await page.title(), 'aMICOLettore');
    await ctx.setOffline(false);

    // le cache sono separate
    const keys = await page.evaluate(() => caches.keys());
    assert.equal(keys.filter((k) => k.startsWith('amicolettore-')).length, 1);
    assert.equal(keys.filter((k) => k.startsWith('amicolatino-')).length, 1);
    const rootCache = await page.evaluate(async () => {
      const k = (await caches.keys()).find((x) => x.startsWith('amicolettore-'));
      return (await (await caches.open(k)).keys()).map((r) => r.url);
    });
    assert.ok(!rootCache.some((u) => u.includes('/latino/')), 'aMICOLettore non mette in cache aMICOLatino');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
