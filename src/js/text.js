// Estrazione del testo dai PDF (pdf.js) e divisione in frasi e parole.

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
 * Estrae il testo di tutte le pagine.
 * @returns {Promise<{pages: string[], title: string|null}>}
 */
export async function extractPdfText(arrayBuffer, { onProgress, askPassword } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: new URL('cmaps/', VENDOR).href,
    cMapPacked: true,
    isEvalSupported: false,
  });
  task.onPassword = (updatePassword, reason) => {
    const pw = askPassword?.(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw == null) task.destroy();
    else updatePassword(pw);
  };
  const pdf = await task.promise;
  let title = null;
  try {
    const meta = await pdf.getMetadata();
    title = (meta?.info?.Title || '').trim() || null;
  } catch { /* nessun titolo */ }

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(cleanPageText(content.items));
    page.cleanup();
    onProgress?.(i, pdf.numPages);
  }
  await pdf.destroy();
  return { pages, title };
}

/** Ricostruisce righe e paragrafi a partire dagli elementi di testo di pdf.js. */
/** Versione dell'algoritmo: se cambia, i PDF riaperti vengono rielaborati. */
export const TEXT_VERSION = 3;

/**
 * Rete di sicurezza per i PDF che "attaccano" le frasi: aggiunge lo spazio dopo la punteggiatura
 * quando segue subito una parola ("scurità.A volte" → "scurità. A volte", "casa,albero" → "casa, albero").
 * Le sigle (S.p.A., a.C., U.S.A.) e i numeri (3,5 · 10:30) restano come sono.
 */
export function fixSpacing(t) {
  return t
    .replace(/(\p{Ll}{2,}[.!?…;:]+)(?=\p{Lu})/gu, '$1 ')
    .replace(/(\p{Ll}{2,}[.!?…]+["”»’)\]])(?=\p{L})/gu, '$1 ')
    .replace(/(\p{L}{2,}[,;])(?=\p{L})/gu, '$1 ');
}

export function cleanPageText(items) {
  // 1) righe, con la loro posizione verticale
  const lines = [];
  let cur = '';
  let curY = null;
  let lastY = null;
  const push = () => { lines.push({ text: cur, y: curY }); cur = ''; curY = null; };
  let lastEndX = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform ? it.transform[5] : null;
    const x = it.transform ? it.transform[4] : null;
    // cambio di riga non segnalato (alcuni PDF non usano hasEOL)
    if (cur && lastY != null && y != null && Math.abs(y - lastY) > Math.max(2, (it.height || 10) * 0.6) && !cur.endsWith(' ')) { push(); lastEndX = null; }
    if (curY == null && it.str.trim() && y != null) curY = y;
    // spazio "visivo" fra due pezzi di testo che nel PDF non hanno lo spazio (es. "scurità." + "A volte")
    if (cur && it.str && !/\s$/.test(cur) && !/^\s/.test(it.str) && lastEndX != null && x != null && x - lastEndX > Math.max(1, (it.height || 10) * 0.18)) cur += ' ';
    cur += it.str;
    if (y != null && it.str.trim()) lastY = y;
    if (x != null && it.str) lastEndX = x + (it.width || 0);
    if (it.hasEOL) { push(); lastEndX = null; }
  }
  if (cur) push();

  let ls = lines.map((l) => ({ text: fixSpacing(l.text.replace(/\s+/g, ' ').trim()), y: l.y }));
  // numeri di pagina isolati all'inizio o alla fine
  const isPageNum = (t) => /^(pag\.?\s*)?[-–]?\s*\d{1,4}\s*[-–]?$/i.test(t);
  while (ls.length && (!ls[0].text || isPageNum(ls[0].text))) ls.shift();
  while (ls.length && (!ls[ls.length - 1].text || isPageNum(ls[ls.length - 1].text))) ls.pop();

  // 2) misure tipiche: lunghezza delle righe e interlinea
  const full = ls.filter((l) => l.text);
  const lengths = full.map((l) => l.text.length).sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.floor(lengths.length * 0.8)] : 0;
  const gaps = [];
  for (let i = 1; i < full.length; i++) {
    const g = full[i - 1].y != null && full[i].y != null ? Math.abs(full[i - 1].y - full[i].y) : 0;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  // 3) paragrafi. Le righe vuote NON contano: molti PDF ne inseriscono una dopo ogni riga.
  //    Si va a capo solo con: spazio verticale ampio, riga corta che chiude una frase,
  //    titoli in MAIUSCOLO, punti di un elenco.
  const isHeading = (t) => { const letters = t.match(/\p{L}/gu) || []; return letters.length >= 3 && t.length <= 90 && !/\p{Ll}/u.test(t); };
  const isBullet = (t) => /^([●•▪◦■□➢➤►▶✓✔◆◇○–—*-]\s|\d{1,2}[.)]\s|[a-z][)]\s)/u.test(t);
  const paras = [];
  let para = '';
  let prev = null;
  for (const line of ls) {
    if (!line.text) continue;
    if (prev) {
      const dy = line.y != null && prev.y != null ? prev.y - line.y : null;
      const bigGap = lineGap && dy != null && (dy > lineGap * 1.6 || dy < -lineGap * 0.5); // più spazio, o salto di colonna
      const prevClosed = /[.!?:;…»"”)]$/.test(prev.text) && prev.text.length < typical * 0.8;
      if (bigGap || prevClosed || isHeading(prev.text) || isHeading(line.text) || isBullet(line.text)) {
        paras.push(para); para = '';
      }
    }
    if (!para) para = line.text;
    else if (/[\p{L}]-$/u.test(para) && /^\p{Ll}/u.test(line.text)) para = para.slice(0, -1) + line.text; // parola divisa a capo
    else para += ' ' + line.text;
    prev = line;
  }
  if (para) paras.push(para);
  return paras.join('\n');
}

/** Conta le lettere vere: serve a capire se una pagina è solo un'immagine. */
export function letterCount(text) {
  const m = text.match(/\p{L}/gu);
  return m ? m.length : 0;
}

// ---------- frasi ----------
const ABBREV = /(?:^|[\s(])(?:dott|dr|prof|profssa|sig|sigg|sig\.ra|ing|avv|arch|geom|rag|on|sen|gen|col|cap|art|artt|par|parr|pag|pagg|p|pp|fig|figg|tab|vol|voll|ed|n|nn|nr|num|es|ecc|cfr|ca|cit|op|sec|secc|ss|s|sg|sgg|v|vd|ad|a\.c|d\.c|ved|tel|ib|ibid|id|c\.d|cd|etc|vs|st|sant|s\.ta|s\.to|lett|co|comma|all|cod|d\.lgs|l|reg|min)\.$/i;
const MAX_SENTENCE = 380;

/** Restituisce [{start, end}] delle frasi nel testo della pagina. */
export function splitSentences(text) {
  let raw = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('it', { granularity: 'sentence' });
    for (const s of seg.segment(text)) raw.push([s.index, s.index + s.segment.length]);
  } else {
    const re = /[^.!?…\n]+(?:[.!?…]+["”»')\]]*\s*|\n|$)/g;
    let m;
    while ((m = re.exec(text)) && m[0]) raw.push([m.index, m.index + m[0].length]);
  }

  // togli spazi ai bordi e separa sempre sugli a-capo (paragrafi)
  const parts = [];
  for (const [a, b] of raw) {
    let start = a;
    for (const piece of text.slice(a, b).split('\n')) {
      const lead = piece.length - piece.trimStart().length;
      const t = piece.trim();
      if (t) parts.push({ start: start + lead, end: start + lead + t.length });
      start += piece.length + 1;
    }
  }

  // riunisci frasi spezzate dopo un'abbreviazione o frammenti minuscoli ("1.", "a)")
  const merged = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (prev && !text.slice(prev.end, p.start).includes('\n')) {
      const prevText = text.slice(prev.start, prev.end);
      const tiny = prev.end - prev.start <= 3 || p.end - p.start <= 2;
      if (ABBREV.test(prevText) || tiny || /^\p{Ll}/u.test(text.slice(p.start, p.end))) { prev.end = p.end; continue; }
    }
    merged.push({ ...p });
  }

  // spezza frasi lunghissime su punteggiatura o spazi
  const out = [];
  for (const s of merged) {
    let { start } = s;
    while (s.end - start > MAX_SENTENCE) {
      const window = text.slice(start, start + MAX_SENTENCE);
      let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(', '));
      if (cut < MAX_SENTENCE * 0.4) cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = MAX_SENTENCE - 1;
      out.push({ start, end: start + cut + 1 });
      start += cut + 1;
      while (text[start] === ' ') start++;
    }
    if (s.end > start) out.push({ start, end: s.end });
  }
  return out;
}

/**
 * Raggruppa frasi consecutive in "blocchi" da inviare ad Azure in una sola richiesta
 * (il piano gratuito F0 limita il numero di richieste al minuto).
 */
export const CHUNK_CHARS = 500;
export function makeChunks(text, sentences) {
  const chunks = [];
  let cur = null;
  sentences.forEach((s, i) => {
    if (cur && s.end - cur.start <= CHUNK_CHARS) { cur.end = s.end; cur.s1 = i; return; }
    cur = { start: s.start, end: s.end, s0: i, s1: i };
    chunks.push(cur);
  });
  for (const c of chunks) c.text = text.slice(c.start, c.end);
  return chunks;
}

/** Parole (per l'evidenziazione) dentro un intervallo di testo. */
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-.,][\p{L}\p{M}\p{N}]+)*/gu;
export function findWords(text, start, end) {
  const out = [];
  const slice = text.slice(start, end);
  for (const m of slice.matchAll(WORD_RE)) out.push({ start: start + m.index, end: start + m.index + m[0].length });
  return out;
}

/** Modello completo di una pagina: testo, frasi, blocchi. */
export function pageModel(text) {
  const sentences = splitSentences(text);
  return { text, sentences, chunks: makeChunks(text, sentences) };
}
