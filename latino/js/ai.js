// Analisi della frase con l'intelligenza artificiale (Gemini di Google, quota gratuita), FACOLTATIVA.
// L'IA non parla con Micol e non traduce: restituisce solo la STRUTTURA della frase (indici delle parole),
// che la guida usa per controllare le risposte. Senza chiave o senza internet la guida usa le regole.
import { tokenize } from './testo.js';
import { COMPLEMENTI } from './struttura.js';

const KEY = 'amicolatino.ia';
const IA_DEFAULTS = { provider: 'gemini', key: '', model: 'gemini-flash-latest', on: true, endpoint: '', deployment: '' };
export function loadIA() {
  try { return { ...IA_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...IA_DEFAULTS }; }
}
export function saveIA(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignora */ } }
export const iaAttiva = () => { const v = loadIA(); return !!(v.on && v.key && (v.provider !== 'azure' || (v.endpoint && v.deployment))); };

const TIPI = COMPLEMENTI.filter((c) => !c.rif).map((c) => c.id);

const ISTRUZIONI = `Sei un insegnante di latino di un liceo italiano. Ricevi UNA frase latina già divisa in parole numerate.
Devi fare SOLO l'analisi logica, NON tradurre: non scrivere mai traduzioni o significati in italiano.
Indica le parole con il loro NUMERO. Rispondi solo con il JSON richiesto.
- principale.verbo: numero del verbo principale (di modo finito, fuori dalle subordinate). Se manca (frase nominale) usa -1.
- principale.tipo: "verbale" o "nominale" (nominale solo con una forma di sum + nome del predicato).
- principale.nomePredicato: numero della parola che fa da nome del predicato, oppure -1.
- soggetto: numero della parola soggetto del verbo principale, oppure -1 se è sottinteso.
- soggettoSottinteso: se il soggetto è sottinteso, il pronome italiano ("io", "tu", "egli", "ella", "noi", "voi", "essi"); altrimenti "".
- complementi: i complementi della proposizione principale. parole = numeri delle parole del complemento, compresa
  l'eventuale preposizione e gli aggettivi concordati; tipo = uno di: ${TIPI.join(', ')}.
- attributi: aggettivi o participi che accompagnano un nome della principale (parola, riferito = numero del nome).
- apposizioni: come gli attributi, ma per i nomi in apposizione.
- subordinate: per ogni proposizione subordinata, parole (dalla prima all'ultima), verbo, introduttore (numero della congiunzione o del relativo, -1 se non c'è) e tipo in italiano (es. "temporale", "causale", "relativa", "finale", "narrativa (cum + congiuntivo)").
- dubbi: una breve nota in italiano se la frase è ambigua, altrimenti "".`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    principale: { type: 'OBJECT', properties: { verbo: { type: 'INTEGER' }, tipo: { type: 'STRING', enum: ['verbale', 'nominale'] }, nomePredicato: { type: 'INTEGER' } }, required: ['verbo', 'tipo', 'nomePredicato'] },
    soggetto: { type: 'INTEGER' },
    soggettoSottinteso: { type: 'STRING' },
    complementi: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, tipo: { type: 'STRING', enum: TIPI } }, required: ['parole', 'tipo'] } },
    attributi: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parola: { type: 'INTEGER' }, riferito: { type: 'INTEGER' } }, required: ['parola', 'riferito'] } },
    apposizioni: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parola: { type: 'INTEGER' }, riferito: { type: 'INTEGER' } }, required: ['parola', 'riferito'] } },
    subordinate: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, verbo: { type: 'INTEGER' }, introduttore: { type: 'INTEGER' }, tipo: { type: 'STRING' } }, required: ['parole', 'verbo', 'introduttore', 'tipo'] } },
    dubbi: { type: 'STRING' },
  },
  required: ['principale', 'soggetto', 'soggettoSottinteso', 'complementi', 'attributi', 'apposizioni', 'subordinate', 'dubbi'],
};

/** Controlla che la risposta sia coerente con la frase (indici validi); altrimenti null. */
export function validaAnalisi(a, n) {
  if (!a || typeof a !== 'object' || !a.principale) return null;
  const ok = (k) => Number.isInteger(k) && k >= -1 && k < n;
  const okList = (l) => Array.isArray(l) && l.every((k) => Number.isInteger(k) && k >= 0 && k < n);
  if (!ok(a.principale.verbo) || !ok(a.principale.nomePredicato ?? -1) || !ok(a.soggetto ?? -1)) return null;
  const comps = (a.complementi || []).filter((c) => okList(c.parole) && c.parole.length && TIPI.includes(c.tipo));
  const rif = (l) => (l || []).filter((x) => ok(x.parola) && ok(x.riferito) && x.parola >= 0 && x.riferito >= 0);
  const subs = (a.subordinate || []).filter((s) => okList(s.parole) && ok(s.verbo));
  return {
    principale: { verbo: a.principale.verbo, tipo: a.principale.tipo === 'nominale' ? 'nominale' : 'verbale', nomePredicato: a.principale.nomePredicato ?? -1 },
    soggetto: a.soggetto ?? -1, soggettoSottinteso: a.soggettoSottinteso || '',
    complementi: comps, attributi: rif(a.attributi), apposizioni: rif(a.apposizioni), subordinate: subs, dubbi: a.dubbi || '',
  };
}

/**
 * Chiede l'analisi della frase. Restituisce l'analisi (validata) oppure lancia un errore comprensibile.
 * La frase viene inviata a Google solo se la chiave è stata inserita nelle impostazioni.
 */
/** Lo schema nel formato standard JSON Schema (per Azure OpenAI): tipi in minuscolo, nessuna proprietà in più. */
function jsonSchema(x) {
  if (Array.isArray(x)) return x.map(jsonSchema);
  if (!x || typeof x !== 'object') return x;
  const o = {};
  for (const [k, v] of Object.entries(x)) o[k] = k === 'type' ? v.toLowerCase() : jsonSchema(v);
  if (o.type === 'object') { o.additionalProperties = false; o.required = Object.keys(o.properties || {}); }
  return o;
}

async function chiamaAzure(v, la, numerata, signal) {
  const ep = v.endpoint.trim().replace(/\/+$/, '');
  const url = `${ep}/openai/deployments/${encodeURIComponent(v.deployment.trim())}/chat/completions?api-version=2024-10-21`;
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'api-key': v.key.trim() },
    body: JSON.stringify({
      messages: [{ role: 'system', content: ISTRUZIONI }, { role: 'user', content: `Frase: ${la}\nParole numerate: ${numerata}` }],
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'analisi_logica', strict: true, schema: jsonSchema(SCHEMA) } },
    }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Azure OpenAI non accetta la chiave: controllala nelle impostazioni.');
  if (res.status === 404) throw new Error('Azure OpenAI: indirizzo (endpoint) o nome del modello (deployment) non trovati.');
  if (res.status === 429) throw new Error('Troppe richieste ad Azure OpenAI o credito finito: uso le regole dell\'app.');
  if (!res.ok) throw new Error(`Azure OpenAI non risponde (errore ${res.status}): uso le regole dell'app.`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

export async function analizzaConIA(la) {
  const v = loadIA();
  if (!v.key) throw new Error('Chiave dell\'intelligenza artificiale mancante.');
  if (!navigator.onLine) throw new Error('Senza internet uso le regole dell\'app.');
  const parole = tokenize(la).filter((p) => p.w).map((p) => p.t);
  const numerata = parole.map((w, i) => `[${i}] ${w}`).join('  ');
  if (v.provider === 'azure') {
    const ctrlA = new AbortController();
    const tA = setTimeout(() => ctrlA.abort(), 25000);
    let text;
    try { text = await chiamaAzure(v, la, numerata, ctrlA.signal); } catch (e) {
      throw e instanceof Error && /Azure/.test(e.message) ? e : new Error('Non riesco a contattare Azure OpenAI: uso le regole dell\'app.');
    } finally { clearTimeout(tA); }
    let jsonA;
    try { jsonA = JSON.parse(text); } catch { throw new Error('Risposta di Azure OpenAI non valida: uso le regole dell\'app.'); }
    const aA = validaAnalisi(jsonA, parole.length);
    if (!aA) throw new Error('Risposta di Azure OpenAI non valida: uso le regole dell\'app.');
    return { ...aA, parole: parole.length, modello: `azure:${v.deployment}`, quando: Date.now() };
  }
  const body = {
    systemInstruction: { parts: [{ text: ISTRUZIONI }] },
    contents: [{ role: 'user', parts: [{ text: `Frase: ${la}\nParole numerate: ${numerata}` }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(v.model || 'gemini-flash-latest')}:generateContent`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': v.key.trim() }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch {
    throw new Error('Non riesco a contattare Gemini: uso le regole dell\'app.');
  } finally { clearTimeout(t); }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error('Gemini non accetta la chiave: controllala nelle impostazioni.');
  if (res.status === 429) throw new Error('Per oggi la quota gratuita di Gemini è finita: uso le regole dell\'app.');
  if (!res.ok) throw new Error(`Gemini non risponde (errore ${res.status}): uso le regole dell'app.`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Risposta di Gemini non valida: uso le regole dell\'app.'); }
  const a = validaAnalisi(json, parole.length);
  if (!a) throw new Error('Risposta di Gemini non valida: uso le regole dell\'app.');
  return { ...a, parole: parole.length, modello: v.model, quando: Date.now() };
}

/** Prova la chiave con una frase semplice. */
export async function provaIA() {
  const a = await analizzaConIA('Puella rosam amat.');
  return a.principale.verbo === 2;
}
