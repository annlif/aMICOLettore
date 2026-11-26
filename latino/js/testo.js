// Testo della versione: estrazione dal PDF (pdf.js), pulizia, divisione in frasi e in parole.
// Le funzioni di elaborazione del testo sono "pure" (niente DOM), così si provano anche in Node.

const VENDOR = new URL('../vendor/', import.meta.url);
let pdfjsPromise;

function loadPdfjs() {
  pdfjsPromise ??= import(new URL('pdf.min.mjs', VENDOR).href).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', VENDOR).href;
    return lib;
  });
  return pdfjsPromise;
}

/**
 * Legge il PDF e restituisce le righe di ogni pagina.
 * @returns {Promise<{pages: {lines: string[]}[], title: string|null}>}
 */
export async function readPdf(arrayBuffer, { askPassword } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: new URL('cmaps/', VENDOR).href,
    cMapPacked: true,
    isEvalSupported: false,
  });
  task.onPassword = (updatePassword, reason) => {
    const pw = askPassword?.(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw == null) task.destroy(); else updatePassword(pw);
  };
  const pdf = await task.promise;
  let title = null;
  try { title = ((await pdf.getMetadata())?.info?.Title || '').trim() || null; } catch { /* nessun titolo */ }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({ lines: itemsToLines(content.items) });
    page.cleanup();
  }
  await pdf.destroy();
  return { pages, title };
}

/** Ricompone le righe a partire dagli elementi di testo di pdf.js. */
export function itemsToLines(items) {
  const lines = [];
  let cur = '';
  let lastY = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform ? it.transform[5] : null;
    if (cur && lastY != null && y != null && Math.abs(y - lastY) > Math.max(2, (it.height || 10) * 0.6) && !cur.endsWith(' ')) { lines.push(cur); cur = ''; }
    cur += it.str;
    if (y != null && it.str.trim()) lastY = y;
    if (it.hasEOL) { lines.push(cur); cur = ''; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Conta le lettere vere: serve a capire se il PDF è una scansione (solo immagini). */
export function letterCount(text) {
  const m = text.match(/\p{L}/gu);
  return m ? m.length : 0;
}

// ---------- pulizia del testo ----------
const isPageNum = (t) => /^(pag\.?\s*)?[-–]?\s*\d{1,4}\s*[-–]?$/i.test(t);

/** Parole italiane molto frequenti che in latino non esistono (o quasi): servono a riconoscere titoli e consegne in italiano. */
const ITALIAN = new Set(('il lo la le l gli della dello delle degli del dei nel nella nelle negli nei sul sulla alla alle allo agli ai al ' +
  'che di da per con una uno un è sono traduci versione brano esercizio pagina come questo questa quella quello ' +
  'perché anche più dopo poi era erano suo sua loro molto').split(' '));
export function italianScore(line) {
  const words = line.toLowerCase().match(/\p{L}+/gu) || [];
  if (!words.length) return 0;
  return words.filter((w) => ITALIAN.has(w)).length / words.length;
}

/**
 * Pulisce le righe di tutte le pagine e separa il testo latino dalle righe "di contorno"
 * (titolo, autore, consegne in italiano), che vengono mostrate a parte.
 * @returns {{latin: string, notes: string[], titleGuess: string|null}}
 */
export function cleanVersion(pages) {
  let lines = [];
  for (const p of pages) {
    const ls = p.lines.slice();
    while (ls.length && isPageNum(ls[0])) ls.shift();
    while (ls.length && isPageNum(ls[ls.length - 1])) ls.pop();
    lines.push(...ls);
  }
  // numeri di riga a inizio o fine riga (5, 10, 15…) e righe fatte solo di numeri
  lines = lines
    .map((l) => l.replace(/^\(?\d{1,3}\)?\s+(?=\p{L})/u, '').replace(/(?<=[\p{L}.,;:!?»”"'-])\s+\d{1,3}$/u, '').trim())
    .filter((l) => l && !/^\d{1,3}$/.test(l));

  // righe iniziali di contorno: titoli brevi, autore tra parentesi, consegne in italiano
  const notes = [];
  while (lines.length > 1) {
    const l = lines[0];
    const next = lines[1] || '';
    // titolo breve senza punteggiatura, seguito da una riga che comincia con la maiuscola
    const shortTitle = l.length <= 50 && !/[,.;:?!]/.test(l) && /^\p{Lu}/u.test(next);
    const allCaps = /\p{Lu}{3}/u.test(l) && !/\p{Ll}/u.test(l);
    if (italianScore(l) >= 0.2 || /^\(.*\)$/.test(l) || allCaps || shortTitle) { notes.push(lines.shift()); continue; }
    break;
  }
  // righe finali di contorno: "(Cesare, De bello Gallico)", "(da Fedro)"
  while (lines.length > 1 && (/^\(.*\)$/.test(lines[lines.length - 1]) || italianScore(lines[lines.length - 1]) >= 0.3)) notes.push(lines.pop());

  // unisci le righe: parole divise a capo con il trattino
  let latin = '';
  for (const l of lines) {
    if (!latin) latin = l;
    else if (/\p{L}-$/u.test(latin) && /^\p{Ll}/u.test(l)) latin = latin.slice(0, -1) + l;
    else latin += ' ' + l;
  }
  const titleGuess = notes.find((n) => n.length >= 3 && n.length <= 70 && !/^\(.*\)$/.test(n) && !/^(versione|esercizio|brano|traduci)\b/i.test(n)) || null;
  return { latin: latin.replace(/\s+/g, ' ').trim(), notes, titleGuess };
}

// ---------- frasi ----------
// Abbreviazioni che finiscono con il punto ma non chiudono la frase.
// Con la maiuscola: prenomi e date ("M. Tullius", "Cn. Pompeius", "a. d. III Kal. Ian.").
const ABBR_UPPER = new Set(['a', 'ap', 'c', 'cn', 'd', 'k', 'l', 'm', 'mam', 'n', 'p', 'q', 's', 'ser', 'sex', 'sp', 't', 'ti', 'v',
  'kal', 'id', 'non', 'ian', 'feb', 'mart', 'apr', 'mai', 'iun', 'quint', 'sext', 'sept', 'oct', 'nov', 'dec', 'chr', 'imp']);
// In minuscolo: abbreviazioni d'uso ("cos.", "a. Chr. n.", "cfr.").
const ABBR_LOWER = new Set(['a', 'd', 'n', 'cos', 'coss', 'procos', 'pr', 'tr', 'pl', 'cfr', 'cf', 'ecc', 'sc', 'es']);

/** Divide il testo latino in frasi: punto, punto interrogativo, punto esclamativo. */
export function splitSentences(text) {
  const out = [];
  const re = /[.?!]+["”»')\]]*(?=\s|$)/g;
  let start = 0;
  let m;
  let chain = false; // il punto precedente era di un'abbreviazione ("a. Chr. n.")
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const wasChain = chain;
    chain = false;
    if (m[0] === '.') {
      const word = (text.slice(start, m.index).match(/(\p{L}+)$/u) || [])[1] || '';
      const next = text.slice(end).trimStart();
      const nextUpper = /^\p{Lu}/u.test(next);
      const isUpper = /^\p{Lu}/u.test(word);
      const w = word.toLowerCase();
      // "M. Tullius": abbreviazione maiuscola seguita da un nome (maiuscola) o da un numero romano
      const nextIsAbbr = /^\p{L}{1,4}\.(\s|$)/u.test(next);
      if (isUpper && ABBR_UPPER.has(w) && (nextUpper || nextIsAbbr || /^[IVXLCDM]+\b/.test(next))) { chain = true; continue; }
      // "cos. iterum", "a. Chr. n.": abbreviazione minuscola seguita da altro testo
      if (!isUpper && ABBR_LOWER.has(w) && next && (w.length > 1 || nextIsAbbr || wasChain)) { chain = true; continue; }
    }
    const s = text.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// ---------- parole ----------
/** Divide una frase in pezzi: parole (toccabili) e tutto il resto (spazi, punteggiatura). */
const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu;
export function tokenize(sentence) {
  const parts = [];
  let last = 0;
  for (const m of sentence.matchAll(WORD_RE)) {
    if (m.index > last) parts.push({ t: sentence.slice(last, m.index) });
    parts.push({ t: m[0], w: true });
    last = m.index + m[0].length;
  }
  if (last < sentence.length) parts.push({ t: sentence.slice(last) });
  return parts;
}

/** Forma "normalizzata" di una parola latina, per le ricerche: minuscole, senza segni di quantità, j→i, v→u. */
export function normalize(word) {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/j/g, 'i').replace(/v/g, 'u');
}

/** Crea le frasi di una nuova versione. */
let seq = 0;
export function newId(prefix = 's') {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function makeSentences(latin) {
  return splitSentences(latin).map((la) => ({ id: newId(), la, it: '' }));
}
