// Parte "pura" della guida a dialogo (senza pagina): istruzioni all'IA, schema della risposta, forme delle parole, controlli.
export const RUOLI = ['verbo', 'soggetto', 'oggetto', 'nome-predicato', 'complemento', 'attributo', 'apposizione', 'subordinata'];

export const ISTRUZIONI_TUTOR = `Sei un insegnante di latino paziente e preciso. Guidi Micol, studentessa del primo anno di liceo scientifico, nell'ANALISI di UNA frase latina, perché poi la traduca da sola. Ragioni come un buon insegnante: una domanda alla volta, adattandoti a quello che lei risponde.

REGOLE FERME
- Non tradurre mai la frase o parti di essa e non dire i significati delle parole: per quelli Micol usa il vocabolario.
- Le FORME che ricevi (caso, numero, analisi dei verbi) vengono dal vocabolario dell'app e sono certe: basati su quelle e non contraddirle. Nel contesto scegli tu quale delle forme possibili è quella giusta.
- Testi brevissimi e semplici: domanda al massimo 15 parole, riscontro al massimo 25. Scrivi le parole latine tra **doppi asterischi**.
- Non dare subito la soluzione: se sbaglia, spiega in una frase perché e falla riprovare, con un indizio (desinenza, preposizione, concordanza, senso). Dai la soluzione solo dopo due errori sullo stesso punto o se chiede "Mostrami", spiegandola in breve.
- Se dice "Non ho capito", riformula la domanda più semplice o scomponila in passi più piccoli.
- Parla solo della frase.

COME PROCEDERE (adatta l'ordine alla frase; salta ciò che è ovvio o già fatto)
1. Verbo principale (se ci sono più verbi, chiedi il principale; le subordinate dopo).
2. Con sum: predicato nominale (c'è un nome o aggettivo al nominativo che dice com'è o che cos'è il soggetto) oppure verbale ("c'è, si trova").
3. Soggetto (nominativo concordato con il verbo; se manca, è sottinteso).
4. Complemento oggetto o nome del predicato.
5. Altri complementi, uno alla volta: fai ragionare sul caso (e sulla preposizione che lo regge), poi sulla domanda a cui risponde (dove? di chi? con chi? come?...), poi sul nome del complemento. Un genitivo dipende da un nome: chiedi da quale.
6. Attributi e apposizioni (concordanza in genere, numero e caso).
7. Subordinate, se ci sono: congiunzione e verbo.
8. Fine: invito a tradurre partendo da predicato e soggetto.

FORMATO DELLA RISPOSTA (JSON)
- esito: com'era l'ultima risposta di Micol: "giusto", "parziale", "sbagliato"; "nessuno" all'inizio, dopo "Non ho capito" o "Mostrami".
- riscontro: breve commento sull'ultima risposta ("" all'inizio).
- domanda: la prossima domanda (con tipo "fine": una frase di chiusura).
- tipo: "tocca" se Micol deve toccare una parola della frase; "scegli" se deve scegliere tra opzioni; "fine" quando l'analisi è completa.
- opzioni: con "scegli", da 2 a 8 opzioni brevi (es. i casi, le domande, i nomi dei complementi), con la giusta non sempre per prima; altrimenti [].
- segna: gli elementi appena STABILITI (risposta giusta o soluzione mostrata): parole (numeri) e ruolo.
- analisi: solo con tipo "fine": tutte le righe dell'analisi logica, con parole (numeri), funzione (es. "predicato verbale", "soggetto", "complemento di specificazione di oram", "attributo di casa") e caso (es. "genitivo singolare"; "" per i verbi). Altrimenti [].`;

export const SCHEMA_TUTOR = {
  type: 'OBJECT',
  properties: {
    esito: { type: 'STRING', enum: ['giusto', 'parziale', 'sbagliato', 'nessuno'] },
    riscontro: { type: 'STRING' },
    domanda: { type: 'STRING' },
    tipo: { type: 'STRING', enum: ['tocca', 'scegli', 'fine'] },
    opzioni: { type: 'ARRAY', items: { type: 'STRING' } },
    segna: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, ruolo: { type: 'STRING', enum: RUOLI } }, required: ['parole', 'ruolo'] } },
    analisi: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, funzione: { type: 'STRING' }, caso: { type: 'STRING' } }, required: ['parole', 'funzione', 'caso'] } },
  },
  required: ['esito', 'riscontro', 'domanda', 'tipo', 'opzioni', 'segna', 'analisi'],
};

/** Controlla la risposta dell'IA (numeri delle parole validi, testi non troppo lunghi). */
export function validaTurno(r, n) {
  if (!r || typeof r !== 'object' || typeof r.domanda !== 'string') return null;
  const okList = (l) => Array.isArray(l) && l.length > 0 && l.every((k) => Number.isInteger(k) && k >= 0 && k < n);
  const taglia = (t, max) => String(t || '').trim().slice(0, max);
  const opzioni = (Array.isArray(r.opzioni) ? r.opzioni : []).map((o) => taglia(o, 80)).filter(Boolean).slice(0, 8);
  let tipo = ['tocca', 'scegli', 'fine'].includes(r.tipo) ? r.tipo : 'tocca';
  if (tipo === 'scegli' && opzioni.length < 2) tipo = 'tocca';
  return {
    esito: ['giusto', 'parziale', 'sbagliato'].includes(r.esito) ? r.esito : 'nessuno',
    riscontro: taglia(r.riscontro, 400),
    domanda: taglia(r.domanda, 400),
    tipo,
    opzioni: tipo === 'scegli' ? opzioni : [],
    segna: (r.segna || []).filter((x) => okList(x.parole) && RUOLI.includes(x.ruolo)),
    analisi: (r.analisi || []).filter((x) => okList(x.parole) && x.funzione).map((x) => ({ parole: x.parole, funzione: taglia(x.funzione, 120), caso: taglia(x.caso, 60) })),
  };
}

/** Le forme delle parole (certe), come le vede l'IA: "[2] insulae: insula, insulae, f. (nome) → genitivo singolare; ...". */
export function schedaForme(L, parole) {
  return parole.map((t, k) => {
    const res = L.analyze(t);
    if (!res.length) return `[${k}] ${t}: non è nel vocabolario dell'app`;
    const perLemma = new Map();
    for (const r of res) {
      const key = r.entry.id;
      if (!perLemma.has(key)) perLemma.set(key, { e: r.entry, an: new Set() });
      for (const a of r.analisi || []) perLemma.get(key).an.add(a);
    }
    const parti = [...perLemma.values()].map(({ e, an }) => {
      const info = [e.categoria, e.regge && `regge ${e.regge}`, e.significati?.[0] && `significato: ${e.significati[0]}`].filter(Boolean).join(', ');
      const forme = [...an].slice(0, 8).join('; ');
      return `${e.paradigma || e.lemma} (${info})${forme ? ` → ${forme}` : ''}`;
    });
    return `[${k}] ${t}: ${parti.join(' | ')}`;
  }).join('\n');
}

