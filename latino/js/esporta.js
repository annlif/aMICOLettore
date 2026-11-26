// Esportazione di una versione (testo o PDF da condividere con la professoressa) e backup di tutti i dati.
import { db, loadSettings, saveSettings } from './store.js';
import { fmtDate, toast } from './ui.js';

// ---------- condivisione ----------
/** Condivide un file (pannello Condividi dell'iPad) o, se non si può, lo scarica. */
export async function shareFile(file, title) {
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return 'share'; }
  } catch (e) { if (e?.name === 'AbortError') return 'abort'; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'download';
}
const safeName = (s) => (s || 'versione').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'versione';

// ---------- versione come testo ----------
export function versionText(v) {
  const lines = [`${v.title}`, `Traduzione di Micol – ${fmtDate(Date.now())}`, ''];
  v.sentences.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.la}`);
    lines.push(`   → ${s.it.trim() || '(da tradurre)'}`);
    lines.push('');
  });
  lines.push('— preparato con aMICOLatino');
  return lines.join('\n');
}

export async function shareText(v) {
  const text = versionText(v);
  try {
    if (navigator.share) { await navigator.share({ title: v.title, text }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  await shareFile(new File([text], `${safeName(v.title)}.txt`, { type: 'text/plain' }), v.title);
}

// ---------- versione come PDF ----------
let jspdfPromise = null;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = () => resolve(window.jspdf);
    s.onerror = () => { jspdfPromise = null; reject(new Error('Non riesco a preparare il PDF.')); };
    document.head.append(s);
  });
  return jspdfPromise;
}
// i caratteri standard del PDF non hanno le vocali con il segno di quantità: le togliamo
const pdfSafe = (s) => s.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, '-');

export async function versionPdf(v) {
  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18, maxW = W - 2 * M - 8;
  let y = 22;
  const newPageIfNeeded = (h) => { if (y + h > 280) { doc.addPage(); y = 20; } };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(18, 53, 91);
  for (const l of doc.splitTextToSize(pdfSafe(v.title), W - 2 * M)) { doc.text(l, M, y); y += 8; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(91, 107, 125);
  doc.text(`Traduzione di Micol - ${fmtDate(Date.now())}`, M, y); y += 10;
  v.sentences.forEach((s, i) => {
    doc.setFont('times', 'bold'); doc.setFontSize(13);
    const la = doc.splitTextToSize(pdfSafe(s.la), maxW);
    const itText = s.it.trim() || '(da tradurre)';
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
    const it = doc.splitTextToSize(pdfSafe(itText), maxW);
    newPageIfNeeded(la.length * 6 + it.length * 5.6 + 6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(226, 85, 74);
    doc.text(String(i + 1), M, y);
    doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(28, 39, 51);
    la.forEach((l) => { doc.text(l, M + 8, y); y += 6; });
    doc.setFont('helvetica', s.it.trim() ? 'normal' : 'italic'); doc.setFontSize(12); doc.setTextColor(s.it.trim() ? 31 : 150, s.it.trim() ? 95 : 150, s.it.trim() ? 173 : 150);
    it.forEach((l) => { doc.text(l, M + 8, y); y += 5.6; });
    y += 4;
  });
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150, 150, 150);
    doc.text(`aMICOLatino - ${pdfSafe(v.title)} - pagina ${p} di ${n}`, M, 290);
  }
  return new File([doc.output('blob')], `${safeName(v.title)}.pdf`, { type: 'application/pdf' });
}

// ---------- backup ----------
export async function makeBackup() {
  const data = {
    app: 'aMICOLatino', formato: 1, creato: new Date().toISOString(),
    versioni: await db.versioni.all(), parole: await db.parole.all(), voci: await db.voci.all(),
    impostazioni: loadSettings(), // la chiave di Azure NON viene salvata nel backup
  };
  const d = new Date().toISOString().slice(0, 10);
  return new File([JSON.stringify(data, null, 1)], `aMICOLatino-backup-${d}.json`, { type: 'application/json' });
}

export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Questo file non è un backup di aMICOLatino.'); }
  if (data?.app !== 'aMICOLatino' || !Array.isArray(data.versioni)) throw new Error('Questo file non è un backup di aMICOLatino.');
  return data;
}

/** Ripristina un backup: mode 'unisci' (aggiunge e aggiorna) oppure 'sostituisci' (cancella prima tutto). */
export async function restoreBackup(data, mode) {
  if (mode === 'sostituisci') { await db.versioni.clear(); await db.parole.clear(); await db.voci.clear(); }
  let n = 0;
  for (const v of data.versioni || []) {
    const cur = mode === 'unisci' ? await db.versioni.get(v.id) : null;
    if (!cur || (v.updatedAt || 0) >= (cur.updatedAt || 0)) { await db.versioni.put(v); n++; }
  }
  for (const p of data.parole || []) {
    const cur = mode === 'unisci' ? await db.parole.get(p.id) : null;
    if (cur) {
      for (const c of p.contesti || []) if (!cur.contesti.some((x) => x.sentence === c.sentence)) cur.contesti.push(c);
      if (p.appunti && !cur.appunti) cur.appunti = p.appunti;
      await db.parole.put(cur);
    } else await db.parole.put(p);
  }
  for (const v of data.voci || []) if (mode !== 'unisci' || !(await db.voci.get(v.id))) await db.voci.put(v);
  if (data.impostazioni && mode === 'sostituisci') saveSettings({ ...loadSettings(), ...data.impostazioni });
  return { versioni: (data.versioni || []).length, parole: (data.parole || []).length, aggiornate: n };
}

export { toast };
