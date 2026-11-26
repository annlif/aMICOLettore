// Pronuncia scolastica italiana del latino per "Ascolta".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pronuncia, VERSIONE_REGOLE } from '../latino/js/pronuncia.js';

test('regole di pronuncia: parole e frase di prova', () => {
  const casi = {
    puellae: 'puelle', rosae: 'rose', poena: 'pena', gratia: 'grazia', bestia: 'bestia', sunt: 'sunt', philosophia: 'filosofia',
    'Rosas tuas amo, agricola, nam pulchrae sunt': 'Rosas tuas amo, agricola, nam pulchre sunt',
    // altre regole ed eccezioni
    hortus: 'ortus', theatrum: 'teatrum', Aegyptus: 'Egiptus', Iulius: 'Iulius', etiam: 'eziam', natio: 'nazio', gratiae: 'grazie',
    ostium: 'ostium', Attius: 'Attius', mixtio: 'mixtio', tibi: 'tibi', poeta: 'poeta', poema: 'poema', aer: 'aer', 'Rōmae': 'Rome',
  };
  for (const [la, atteso] of Object.entries(casi)) assert.equal(pronuncia(la), atteso, la);
});

test('la trasformazione non cambia il numero delle parole (per l\'evidenziazione)', () => {
  const frase = 'Hostes, cum philosophiae gratia venissent, theatrum relinquunt.';
  const parole = (s) => s.match(/[\p{L}]+/gu);
  assert.equal(parole(pronuncia(frase)).length, parole(frase).length);
  assert.ok(VERSIONE_REGOLE);
});

test('SSML: italiano dichiarato e voce Isabella (non Multilingual)', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { buildSsml, VOCE_LATINO } = await import('../latino/js/voce.js');
  const ssml = buildSsml(pronuncia('Rosas tuas amo, agricola, nam pulchrae sunt.'));
  assert.equal(VOCE_LATINO, 'it-IT-IsabellaNeural');
  assert.match(ssml, /<speak [^>]*xml:lang="it-IT"/);
  assert.match(ssml, /<voice name="it-IT-IsabellaNeural">/);
  assert.doesNotMatch(ssml, /Multilingual/);
  assert.match(ssml, /nam pulchre sunt\./);
});
