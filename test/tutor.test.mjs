// Guida a dialogo: l'IA (simulata) decide le domande; l'app manda le forme certe e mostra domanda, riscontro e pulsanti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startPagesServer } from './pages-server.mjs';
import { Lexicon, parseLexicon } from '../latino/js/morfo.js';
import { schedaForme, validaTurno } from '../latino/js/tutor-ia.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const L = new Lexicon(parseLexicon(readFileSync(new URL('../latino/data/lessico.txt', import.meta.url), 'utf8')));

test('controlli grammaticali per l\'IA: cum filiabus non è un secondo soggetto', async () => {
  const { controlliGrammaticali } = await import('../latino/js/tutor-ia.js');
  const c = controlliGrammaticali(L, 'In casa nauta cum filiabus habitat.');
  assert.match(c, /\[3\] cum è una preposizione \(regge ablativo\): \[4\] filiabus dipende da lei, quindi NON è soggetto/);
  assert.match(c, /Possono essere soggetto di \[5\] habitat .*: \[2\] nauta\. Nessun'altra parola/);
  const d = controlliGrammaticali(L, 'Filiae autem in casa manent et nautam exspectant.');
  assert.match(d, /soggetto di \[4\] manent .*\[0\] Filiae/);
});

test('scheda delle forme per l\'IA e controllo della risposta', () => {
  const sch = schedaForme(L, ['Prope', 'oram', 'insulae', 'parva', 'casa', 'est']);
  assert.match(sch, /\[0\] Prope: prope \(preposizione, regge accusativo/);
  assert.match(sch, /\[2\] insulae: insula, insulae, f\. .*genitivo singolare/);
  assert.match(sch, /\[5\] est: sum/);
  const r = validaTurno({ esito: 'boh', riscontro: 'x', domanda: 'Che caso?', tipo: 'scegli', opzioni: ['genitivo'], segna: [{ parole: [9], ruolo: 'soggetto' }, { parole: [4], ruolo: 'soggetto' }], analisi: [] }, 6);
  assert.equal(r.tipo, 'tocca', 'scegli con una sola opzione diventa tocca');
  assert.equal(r.esito, 'nessuno');
  assert.deepEqual(r.segna, [{ parole: [4], ruolo: 'soggetto' }], 'indici non validi scartati');
});

test('guida a dialogo nell\'app (IA simulata) e ritorno alle regole se l\'IA non risponde', async () => {
  const server = await startPagesServer(8078);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const turni = [
    { esito: 'nessuno', riscontro: '', domanda: 'Tocca il **verbo principale**.', tipo: 'tocca', opzioni: [], segna: [], analisi: [] },
    { esito: 'giusto', riscontro: 'Sì, **est** è il verbo.', domanda: 'Qui **est** vuol dire "è" o "c\'è"?', tipo: 'scegli', opzioni: ['è (copula)', 'c\'è, si trova'], segna: [{ parole: [5], ruolo: 'verbo' }], analisi: [] },
    { esito: 'sbagliato', riscontro: 'Guarda **prope oram**: è un luogo.', domanda: 'Riprova: "è" o "c\'è"?', tipo: 'scegli', opzioni: ['è (copula)', 'c\'è, si trova'], segna: [], analisi: [] },
    { esito: 'giusto', riscontro: 'Brava.', domanda: 'Che caso è **insulae** qui?', tipo: 'scegli', opzioni: ['genitivo', 'dativo', 'nominativo'], segna: [{ parole: [4], ruolo: 'soggetto' }], analisi: [] },
    { esito: 'nessuno', riscontro: 'Te lo dico più semplice.', domanda: 'Di chi è la riva? Che caso esprime "di"?', tipo: 'scegli', opzioni: ['genitivo', 'dativo'], segna: [], analisi: [] },
    { esito: 'giusto', riscontro: 'Esatto.', domanda: 'Ora scrivi la traduzione nel riquadro e tocca Controlla.', tipo: 'traduci', opzioni: [], segna: [{ parole: [2], ruolo: 'complemento' }],
      analisi: [{ parole: [5], funzione: 'predicato verbale', caso: '' }, { parole: [4], funzione: 'soggetto', caso: 'nominativo singolare' }, { parole: [2], funzione: 'complemento di specificazione di oram', caso: 'genitivo singolare' }] },
    { esito: 'sbagliato', riscontro: 'Hai fatto di **insulae** il soggetto: che caso è?', domanda: 'Correggi e tocca di nuovo Controlla.', tipo: 'traduci', opzioni: [], segna: [], analisi: [] },
    { esito: 'nessuno', riscontro: 'Bella domanda.', domanda: 'Pensa a «la riva di…».', tipo: 'scrivi', opzioni: [], segna: [], analisi: [] },
    { esito: 'giusto', riscontro: 'Perfetto, ora il senso è giusto!', domanda: 'Brava, frase finita.', tipo: 'fine', opzioni: [], segna: [], analisi: [] },
    { esito: 'nessuno', riscontro: '', domanda: 'Bentornata: vuoi rivedere qualcosa?', tipo: 'tocca', opzioni: [], segna: [], analisi: [] },
  ];
  const richieste = [];
  let rotto = false;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = route.request().postDataJSON();
    richieste.push(body);
    if (rotto) return route.fulfill({ status: 500, body: '' });
    const r = turni[Math.min(richieste.length - 1, turni.length - 1)];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }] }) });
  });
  const tap = (w) => page.locator('.sent.guided .sent-la .w', { hasText: new RegExp(`^${w}$`) }).click();
  const q = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-q').textContent), re.source, { timeout: 8000 });
  const fb = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-fb').textContent), re.source, { timeout: 8000 });
  const ultima = () => richieste.at(-1).contents[0].parts[0].text;
  try {
    await page.goto('http://localhost:8078/aMICOLettore/latino/');
    await page.evaluate(() => localStorage.setItem('amicolatino.ia', JSON.stringify({ key: 'k', on: true, model: 'gemini-flash-latest' })));
    await page.click('#btn-paste');
    await page.fill('#paste-text', 'Prope oram insulae parva casa est. Vita nautae dura est.');
    await page.click('#paste-dialog button[value="ok"]');
    await page.waitForSelector('#view-versione', { state: 'visible' });
    await page.locator('.sent').first().locator('[data-guide="aiuto"]').click();
    await q(/Tocca il verbo principale/);
    assert.match(await page.textContent('#guide-mode'), /dialogo/);
    const primo = richieste[0];
    assert.match(primo.systemInstruction.parts[0].text, /Non tradurre mai/);
    assert.match(ultima(), /\[2\] insulae: insula.*genitivo singolare/, 'all\'IA arrivano le forme certe');
    assert.match(ultima(), /Possono essere soggetto di \[5\] est .*: \[4\] casa\. Nessun'altra parola/, 'e i controlli grammaticali');
    assert.match(ultima(), /\[0\] Prope è una preposizione \(regge accusativo\): \[1\] oram dipende da lei/);
    await tap('est');
    await fb(/Sì, est è il verbo/);
    assert.match(ultima(), /Ultima azione di Micol: ha toccato \[5\] est/);
    assert.equal(await page.locator('.sent.guided .w.g-verb').textContent(), 'est');
    await page.locator('#guide-btns [data-t="opz"]', { hasText: 'è (copula)' }).click();
    await fb(/Guarda prope oram/);
    assert.match(await page.getAttribute('#guide-fb', 'class'), /ko/);
    assert.match(ultima(), /ha scelto «è \(copula\)»/);
    assert.match(ultima(), /Insegnante: Sì, \*\*est\*\* è il verbo\./, 'il dialogo precedente va all\'IA');
    await page.locator('#guide-btns [data-t="opz"]', { hasText: 'c\'è' }).click();
    await q(/Che caso è insulae/);
    await page.click('#guide-btns [data-t="capito"]');
    await q(/Di chi è la riva/);
    assert.match(ultima(), /non ha capito/);
    await page.locator('#guide-btns [data-t="opz"]', { hasText: 'genitivo' }).click();
    await q(/analisi logica/);
    const sum = await page.textContent('#guide-q');
    assert.match(sum, /predicato verbale\s*est/);
    assert.match(sum, /complemento di specificazione di oram\s*insulae\s*\(genitivo singolare\)/);
    // scrive la traduzione (la guida resta aperta) e chiede di controllarla
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    await page.locator('.sent').first().locator('textarea').fill('Vicino alla riva le isole sono una piccola casa.');
    await page.click('#guide-btns [data-t="controlla"]');
    await fb(/Hai fatto di insulae il soggetto/);
    assert.match(ultima(), /chiede di controllarla: «Vicino alla riva le isole sono una piccola casa\.»/);
    assert.match(ultima(), /Traduzione che Micol ha scritto nel riquadro \(ora\): «Vicino alla riva/);
    // può anche scrivere una domanda
    await page.fill('#tutor-input', 'non capisco il genitivo');
    await page.press('#tutor-input', 'Enter');
    await q(/la riva di/);
    assert.match(ultima(), /ha scritto: «non capisco il genitivo»/);
    await page.locator('.sent').first().locator('textarea').fill('Vicino alla riva dell\'isola c\'è una piccola casa.');
    await page.click('#guide-btns [data-t="controlla"]');
    await fb(/ora il senso è giusto/);
    await page.click('#guide-btns [data-t="esci"]');
    assert.ok(await page.locator('#guide-bar').isHidden());
    await page.waitForTimeout(600);
    assert.match(await page.locator('.sent').first().locator('.an-logica').textContent(), /insulae → complemento di specificazione di oram/);
    // riaprendo la guida, l'IA riceve il dialogo già fatto
    await page.reload();
    await page.waitForSelector('.sent [data-guide="controlla"]');
    await page.locator('.sent').first().locator('[data-guide="aiuto"]').click();
    await q(/Bentornata/);
    assert.match(ultima(), /riapre la guida/);
    assert.match(ultima(), /Insegnante: Perfetto, ora il senso è giusto!/);
    await page.click('#guide-btns [data-t="esci"]');

    // l'IA non risponde: si torna alla guida con le regole
    rotto = true;
    await page.locator('.sent').nth(1).locator('[data-guide="aiuto"]').click();
    await q(/verbo principale/);
    assert.match(await page.textContent('#guide-mode'), /regole/);
    assert.match(await page.textContent('#guide-fb'), /Uso le regole dell'app/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
