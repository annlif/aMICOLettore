// Guida con l'intelligenza artificiale (Gemini simulato): la guida usa l'analisi ricevuta, che non contiene traduzioni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startPagesServer } from './pages-server.mjs';
import { validaAnalisi } from '../latino/js/ai.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const ANALISI = {
  principale: { verbo: 5, tipo: 'verbale', nomePredicato: -1 }, soggetto: 0, soggettoSottinteso: '',
  complementi: [{ parole: [1, 2], tipo: 'compagnia' }, { parole: [3, 4], tipo: 'stato-luogo' }],
  attributi: [], apposizioni: [], subordinate: [], dubbi: '',
};

test('analisi dell\'IA: indici controllati', () => {
  assert.ok(validaAnalisi(ANALISI, 6));
  assert.equal(validaAnalisi({ ...ANALISI, principale: { verbo: 9, tipo: 'verbale', nomePredicato: -1 } }, 6), null);
  const v = validaAnalisi({ ...ANALISI, complementi: [{ parole: [1, 99], tipo: 'compagnia' }, { parole: [3], tipo: 'inventato' }] }, 6);
  assert.equal(v.complementi.length, 0, 'complementi non validi scartati');
});

test('Azure OpenAI: richiesta con schema JSON rigoroso e chiave nell\'intestazione', async () => {
  const server = await startPagesServer(8074);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let req = null;
  try {
    await page.route('https://prova.openai.azure.com/**', async (route) => {
      req = { url: route.request().url(), key: route.request().headers()['api-key'], body: route.request().postDataJSON() };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...ANALISI, principale: { verbo: 2, tipo: 'verbale', nomePredicato: -1 }, soggetto: 0, complementi: [{ parole: [1], tipo: 'oggetto' }] }) } }] }) });
    });
    await page.goto('http://localhost:8074/aMICOLettore/latino/');
    const ok = await page.evaluate(async () => {
      localStorage.setItem('amicolatino.ia', JSON.stringify({ provider: 'azure', endpoint: 'https://prova.openai.azure.com/', deployment: 'gpt-mini', key: 'k-azure', on: true }));
      const { provaIA } = await import('./js/ai.js');
      return provaIA();
    });
    assert.equal(ok, true);
    assert.match(req.url, /^https:\/\/prova\.openai\.azure\.com\/openai\/deployments\/gpt-mini\/chat\/completions\?api-version=/);
    assert.equal(req.key, 'k-azure');
    assert.equal(req.body.response_format.json_schema.strict, true);
    assert.equal(req.body.response_format.json_schema.schema.additionalProperties, false);
  } finally {
    await browser.close();
    server.close();
  }
});

test('Azure OpenAI: indirizzo con percorso in più ed errore 405 → prova l\'indirizzo v1', async () => {
  const server = await startPagesServer(8076);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const urls = [];
  try {
    await page.route('https://prova.openai.azure.com/**', async (route) => {
      const url = route.request().url();
      urls.push({ url, body: route.request().postDataJSON() });
      if (url.includes('/deployments/')) return route.fulfill({ status: 405, headers: { 'access-control-allow-origin': '*' }, body: '' });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...ANALISI, principale: { verbo: 2, tipo: 'verbale', nomePredicato: -1 }, soggetto: 0, complementi: [] }) } }] }) });
    });
    await page.goto('http://localhost:8076/aMICOLettore/latino/');
    const ok = await page.evaluate(async () => {
      localStorage.setItem('amicolatino.ia', JSON.stringify({ provider: 'azure', endpoint: 'prova.openai.azure.com/openai/v1/', deployment: 'latino', key: 'k', on: true }));
      const { provaIA } = await import('./js/ai.js');
      return provaIA();
    });
    assert.equal(ok, true);
    assert.match(urls[0].url, /^https:\/\/prova\.openai\.azure\.com\/openai\/deployments\/latino\/chat/);
    assert.equal(urls[1].url, 'https://prova.openai.azure.com/openai/v1/chat/completions');
    assert.equal(urls[1].body.model, 'latino');
  } finally {
    await browser.close();
    server.close();
  }
});

test('guida con Gemini: il senso decide il complemento', async () => {
  const server = await startPagesServer(8075);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const richieste = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    richieste.push({ url: route.request().url(), key: route.request().headers()['x-goog-api-key'], body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANALISI) }] } }] }) });
  });
  const tap = (w) => page.locator('.sent.guided .sent-la .w', { hasText: new RegExp(`^${w}$`) }).click();
  const fb = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-fb').textContent), re.source);
  const q = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-q').textContent), re.source, { timeout: 8000 });
  try {
    await page.goto('http://localhost:8075/aMICOLettore/latino/');
    await page.evaluate(() => localStorage.setItem('amicolatino.ia', JSON.stringify({ key: 'chiave-prova', on: true, model: 'gemini-flash-latest' })));
    await page.click('#btn-paste');
    await page.fill('#paste-text', 'Puella cum matre in horto ambulat.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    await page.locator('.sent').first().locator('[data-guide]').click();
    await q(/verbo principale/);
    assert.match(await page.textContent('#guide-mode'), /intelligenza artificiale/);
    assert.equal(richieste.length, 1);
    assert.equal(richieste[0].key, 'chiave-prova');
    assert.match(JSON.stringify(richieste[0].body), /NON tradurre/);
    await tap('ambulat');
    await q(/soggetto/);
    await tap('Puella');
    await q(/complemento oggetto/);
    await page.click('#guide-btns [data-g="no"]');
    await q(/altri elementi/);
    await tap('cum');
    await tap('matre');
    await q(/Scegli dall'elenco/);
    await page.click('#guide-btns [data-g="comp"][data-id="unione"]');
    await fb(/nel senso di questa frase/);
    await page.click('#guide-btns [data-g="comp"][data-id="compagnia"]');
    await fb(/complemento di compagnia/);
    await q(/altri complementi/);
    await tap('in');
    await tap('horto');
    await page.click('#guide-btns [data-g="comp"][data-id="tempo-det"]');
    await fb(/nel senso di questa frase/);
    await page.click('#guide-btns [data-g="comp"][data-id="moto-a-luogo"]');
    await fb(/ad\/in\/sub \+ accusativo/);
    await page.click('#guide-btns [data-g="mostra"]');
    await fb(/complemento di stato in luogo/);
    await page.click('#guide-btns [data-g="comp"][data-id="stato-luogo"]');
    await q(/altri complementi/);
    await page.click('#guide-btns [data-g="fine-altri"]');
    await q(/analisi logica/);
    const sum = await page.textContent('#guide-q');
    assert.match(sum, /complemento di compagnia\s*cum matre/);
    assert.match(sum, /complemento di stato in luogo\s*in horto/);
    await page.click('#guide-btns [data-g="esci"]');
    // la seconda volta l'analisi è già salvata: nessuna nuova richiesta
    await page.locator('.sent').first().locator('[data-guide]').click();
    await q(/verbo principale/);
    assert.equal(richieste.length, 1);
    await page.click('#guide-btns [data-g="esci"]');

    // senza IA: le regole dell'app
    await page.evaluate(() => localStorage.setItem('amicolatino.ia', JSON.stringify({ key: '', on: true })));
    await page.click('#btn-paste').catch(() => {});
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
