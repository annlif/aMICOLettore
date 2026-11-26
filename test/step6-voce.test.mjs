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
    // il messaggio si vede dentro le impostazioni, e il codice è scritto anche sullo schermo
    assert.match(await page.textContent('#copy-msg'), /Copiato/);
    assert.equal(await page.inputValue('#copy-code'), clip);

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

    // incollare a mano nella casella
    await page.evaluate(() => localStorage.removeItem('amicolatino.voce'));
    await page.keyboard.press('Escape');
    await page.click('#btn-settings');
    assert.match(await page.textContent('#voce-stato'), /non è ancora collegata/);
    await page.fill('#voce-code', 'ciao');
    assert.match(await page.textContent('#voce-msg'), /non sembra il codice/);
    await page.fill('#voce-code', clip);
    assert.match(await page.textContent('#voce-msg'), /Fatto!/);
    assert.match(await page.textContent('#voce-stato'), /collegata \(regione westeurope\)/);
    await page.keyboard.press('Escape');

    // stessa memoria (Safari, computer): la chiave di aMICOLettore viene riusata da sola
    await page.evaluate(() => { localStorage.removeItem('amicolatino.voce'); localStorage.setItem('amicolettore.settings', JSON.stringify({ key: 'k2', region: 'italynorth', voice: 'it-IT-ElsaNeural' })); });
    await page.reload();
    await page.click('#btn-settings');
    assert.match(await page.textContent('#voce-stato'), /regione italynorth\), presa da aMICOLettore/);
    await page.keyboard.press('Escape');

    // audio già salvato: Ascolta lo riproduce davvero (anche senza internet)
    await page.evaluate(async () => {
      const { db } = await import('./js/store.js');
      // 1 secondo di tono a 440 Hz (WAV 16 bit)
      const n = 8000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 8000)), true);
      const voice = JSON.parse(localStorage.getItem('amicolatino.voce') || '{}').voice || 'it-IT-IsabellaNeural';
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voice}\u0001rosas`));
      const key = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
      await db.audio.put({ key, voice, text: 'rosas', audio: buf, createdAt: Date.now() });
    });
    await page.goto(BASE + 'latino/#versioni');
    await page.waitForSelector('#btn-paste', { state: 'visible' });
    await ctx.setOffline(true);
    await page.click('#btn-paste');
    await page.fill('#paste-text', 'Nauta rosas dat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    await page.locator('.sent-la .w', { hasText: 'rosas' }).click();
    await page.click('.popmenu button:has-text("Ascolta")');
    await page.waitForFunction(() => { const a = window.__amicolatino.audioState(); return a && !a.paused && a.time > 0.1; }, null, { timeout: 5000 });
    const st = await page.evaluate(() => window.__amicolatino.audioState());
    assert.equal(st.volume, 1);
    assert.ok(Math.abs(st.duration - 1) < 0.05, `durata ${st.duration}`);
    await ctx.setOffline(false);

    // senza voce collegata e senza voce dell'iPad: un messaggio chiaro
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(BASE + 'latino/#versioni');
    await page.reload();
    await page.click('#btn-paste');
    await page.fill('#paste-text', 'Nauta rosas dat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    await page.locator('.sent-la .w', { hasText: 'rosas' }).click();
    await page.click('.popmenu button:has-text("Ascolta")');
    await page.waitForSelector('#toast:has-text("impostazioni")');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
