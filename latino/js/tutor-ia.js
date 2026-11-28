// Parte "pura" della guida a dialogo (senza pagina): istruzioni all'IA, schema della risposta, forme delle parole, controlli.
import { analyzeSentence, subjectCandidates, finiteForms } from './struttura.js';
export const RUOLI = ['verbo', 'soggetto', 'oggetto', 'nome-predicato', 'complemento', 'attributo', 'apposizione', 'subordinata'];

export const ISTRUZIONI_TUTOR = `Sei un insegnante di latino paziente e preciso. Guidi Micol, studentessa del primo anno di liceo scientifico, nell'ANALISI di UNA frase latina, perché poi la traduca da sola. Ragioni come un buon insegnante: una domanda alla volta, adattandoti a quello che lei risponde.

REGOLE FERME
- Non tradurre mai la frase o parti di essa e non dire i significati delle parole: per quelli Micol usa il vocabolario.
- Le FORME che ricevi (caso, numero, analisi dei verbi) vengono dal vocabolario dell'app e sono certe: basati su quelle e non contraddirle. Nel contesto scegli tu quale delle forme possibili è quella giusta.
- Ricevi anche i CONTROLLI GRAMMATICALI dell'app (parole rette da preposizione, parole che possono essere soggetto): rispettali. Una parola retta da una preposizione non è mai soggetto né oggetto; il soggetto deve avere il nominativo e concordare con il verbo; "cum" + ablativo è un complemento (compagnia, unione, modo), non un secondo soggetto.
- Prima di giudicare una risposta di Micol, verificala nel campo "verifica" (forme, preposizioni, concordanza): non dire mai che è sbagliata una risposta giusta.
- Testi brevissimi e semplici: domanda al massimo 15 parole, riscontro al massimo 25. Scrivi le parole latine tra **doppi asterischi**.
- Non dare subito la soluzione: se sbaglia, spiega in una frase perché e falla riprovare, con un indizio (desinenza, preposizione, concordanza, senso). Dai la soluzione solo dopo due errori sullo stesso punto o se chiede "Mostrami", spiegandola in breve.
- NON RIVELARE CHE COSA C'È NELLA FRASE. Non chiedere mai "Qual è il complemento oggetto?", "Qual è il complemento di specificazione?", "Dov'è il complemento di luogo?" o "C'è un attributo?": così le diresti quali complementi ci sono. Fai invece scegliere a lei la prossima parola da analizzare ("Tocca una parola che non hai ancora analizzato") oppure chiedi della parola che ha toccato: "In che caso è **X**?", "A quale domanda risponde?", "Che funzione ha?". Solo il verbo principale e il soggetto si possono chiedere direttamente, perché ci sono sempre (anche sottinteso).
- Quando le fai scegliere la funzione o il complemento, le opzioni devono essere varie e plausibili (anche funzioni che nella frase non ci sono), non solo quelle presenti. Non usare come opzioni le parole della frase: per indicare una parola, Micol la tocca.
- Se dice "Non ho capito", riformula la domanda più semplice o scomponila in passi più piccoli.
- Parla solo della frase. Micol può anche scriverti una risposta o una domanda: rispondi solo se riguarda la frase o il latino, altrimenti riportala gentilmente alla frase.

LA TRADUZIONE DI MICOL
- Ricevi sempre la traduzione che Micol sta scrivendo nel riquadro (può essere vuota, a metà o completa). Usala: se ha già tradotto una parte, parti da lì e lavora sul punto in cui si è bloccata o sbaglia.
- Quando chiede di controllarla, confrontala con il latino. Se il senso è giusto, dillo (accetta traduzioni libere e un italiano scorrevole). Se ci sono errori, indicane UNO alla volta con una domanda che le faccia trovare l'errore (es. "Hai fatto di **insulae** il soggetto: che caso è?"), e segnala anche gli errori di italiano. Non scrivere mai la traduzione giusta.
- Dopo una correzione chiedile di modificare il riquadro e toccare di nuovo "Controlla la mia traduzione".

COME PROCEDERE (adatta l'ordine alla frase; salta ciò che è ovvio o già fatto)
1. Verbo principale (se ci sono più verbi, chiedi il principale; le subordinate dopo).
2. Con sum: predicato nominale (c'è un nome o aggettivo al nominativo che dice com'è o che cos'è il soggetto) oppure verbale ("c'è, si trova").
3. Soggetto (nominativo concordato con il verbo; se manca, è sottinteso).
4. Tutte le altre parole, una alla volta, scelte da Micol ("Tocca una parola che non hai ancora analizzato"; se c'è una preposizione, si parte da quella): per ognuna fai ragionare sul caso (e sulla preposizione che lo regge), poi sulla domanda a cui risponde (chi? che cosa? dove? di chi? con chi? come?...), poi sulla funzione. Un genitivo dipende da un nome: chiedi da quale. Un aggettivo concorda con un nome: chiedi con quale.
5. Quando Micol dice di aver finito ma restano parole non analizzate, non dire quali: "Rileggi la frase: c'è ancora qualche parola che non hai analizzato?".
6. Subordinate, se ci sono: congiunzione e verbo.
7. Quando l'analisi è fatta, usa tipo "traduci": riepilogo in "analisi" e invito a scrivere (o correggere) la traduzione nel riquadro, partendo da predicato e soggetto, e poi a toccare "Controlla la mia traduzione".
8. Usa tipo "fine" solo quando la traduzione è giusta (o se Micol chiude): una breve frase di complimenti.

FORMATO DELLA RISPOSTA (JSON)
- verifica: il tuo controllo, breve e solo per te (Micol non lo vede): che cosa ha risposto, che forma e funzione ha davvero quella parola, quindi se è giusto.
- esito: com'era l'ultima risposta di Micol: "giusto", "parziale", "sbagliato"; "nessuno" all'inizio, dopo "Non ho capito" o "Mostrami".
- riscontro: breve commento sull'ultima risposta ("" all'inizio).
- domanda: la prossima domanda (con tipo "fine": una frase di chiusura).
- tipo: "tocca" se Micol deve toccare una parola della frase; "scegli" se deve scegliere tra opzioni; "scrivi" se deve scrivere una risposta breve (es. come renderebbe in italiano un pezzo che ha già analizzato); "traduci" quando deve scrivere o correggere la traduzione nel riquadro; "fine" quando la traduzione è giusta.
- opzioni: con "scegli", da 2 a 8 opzioni brevi (es. i casi, le domande, i nomi delle funzioni), varie e plausibili, con la giusta non sempre per prima; mai parole della frase (quelle si toccano); altrimenti [].
- segna: gli elementi appena STABILITI (risposta giusta o soluzione mostrata): parole (numeri) e ruolo.
- analisi: con tipo "traduci" o "fine" (se l'analisi è stata fatta): tutte le righe dell'analisi logica, con parole (numeri), funzione (es. "predicato verbale", "soggetto", "complemento di specificazione di oram", "attributo di casa") e caso (es. "genitivo singolare"; "" per i verbi). Altrimenti [].`;

export const SCHEMA_TUTOR = {
  type: 'OBJECT',
  properties: {
    verifica: { type: 'STRING' },
    esito: { type: 'STRING', enum: ['giusto', 'parziale', 'sbagliato', 'nessuno'] },
    riscontro: { type: 'STRING' },
    domanda: { type: 'STRING' },
    tipo: { type: 'STRING', enum: ['tocca', 'scegli', 'scrivi', 'traduci', 'fine'] },
    opzioni: { type: 'ARRAY', items: { type: 'STRING' } },
    segna: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, ruolo: { type: 'STRING', enum: RUOLI } }, required: ['parole', 'ruolo'] } },
    analisi: { type: 'ARRAY', items: { type: 'OBJECT', properties: { parole: { type: 'ARRAY', items: { type: 'INTEGER' } }, funzione: { type: 'STRING' }, caso: { type: 'STRING' } }, required: ['parole', 'funzione', 'caso'] } },
  },
  required: ['verifica', 'esito', 'riscontro', 'domanda', 'tipo', 'opzioni', 'segna', 'analisi'],
};

/** Controlla la risposta dell'IA (numeri delle parole validi, testi non troppo lunghi). */
export function validaTurno(r, n) {
  if (!r || typeof r !== 'object' || typeof r.domanda !== 'string') return null;
  const okList = (l) => Array.isArray(l) && l.length > 0 && l.every((k) => Number.isInteger(k) && k >= 0 && k < n);
  const taglia = (t, max) => String(t || '').trim().slice(0, max);
  const opzioni = (Array.isArray(r.opzioni) ? r.opzioni : []).map((o) => taglia(o, 80)).filter(Boolean).slice(0, 8);
  let tipo = ['tocca', 'scegli', 'scrivi', 'traduci', 'fine'].includes(r.tipo) ? r.tipo : 'tocca';
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


/** Controlli grammaticali affidabili (dalla morfologia e dalle preposizioni) da dare all'IA insieme alle forme. */
export function controlliGrammaticali(L, la) {
  const S = analyzeSentence(L, la);
  const t = (k) => `[${k}] ${S.words[k].t}`;
  const N = { sg: 'singolare', pl: 'plurale' };
  const righe = [];
  const verbi = S.verbs.map((k) => `${t(k)} (${[...new Set(finiteForms(S.words[k]).map((a) => N[a.num]))].join('/')})`);
  righe.push(`- Verbi di modo finito: ${verbi.join(', ') || 'nessuno (forse est/sunt sottinteso)'}.`);
  const gruppi = new Map();
  for (const [k, p] of S.governed) { if (!gruppi.has(p)) gruppi.set(p, []); gruppi.get(p).push(k); }
  for (const [p, ks] of gruppi) {
    const regge = S.words[p].res.find((r) => r.entry.cat === 'prep')?.entry.regge || '';
    righe.push(`- ${t(p)} è una preposizione${regge ? ` (regge ${regge})` : ''}: ${ks.map(t).join(', ')} dipende da lei, quindi NON è soggetto né oggetto.`);
  }
  for (const v of S.main) {
    const c = subjectCandidates(S, v).all;
    righe.push(c.length
      ? `- Possono essere soggetto di ${t(v)} (nominativo che concorda, fuori dai gruppi con preposizione): ${c.map(t).join(', ')}. Nessun'altra parola.`
      : `- Nessuna parola può essere soggetto di ${t(v)}: il soggetto è sottinteso (o è lo stesso di un altro verbo coordinato).`);
  }
  return righe.join('\n');
}
