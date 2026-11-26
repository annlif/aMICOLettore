// Prepara la cartella dist/ da pubblicare su GitHub Pages:
//   dist/         → aMICOLettore (da src/)
//   dist/latino/  → aMICOLatino  (da latino/), app separata con il suo service worker
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const nm = join(root, 'node_modules');

const PDFJS = [
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['pdfjs-dist/cmaps', 'cmaps'],
];
const SPEECH = [['microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js', 'speech-sdk.js']];

/**
 * Copia le librerie e completa il service worker dell'app in `outDir`
 * con la versione e l'elenco dei file da tenere offline.
 * `skipDirs`: sottocartelle da non mettere nella cache (cmaps: scaricate solo se servono;
 * per aMICOLettore anche latino/, che ha un service worker suo).
 */
function finishApp(outDir, vendorFiles, skipDirs) {
  const vendor = join(outDir, 'vendor');
  mkdirSync(vendor, { recursive: true });
  for (const [from, to] of vendorFiles) cpSync(join(nm, from), join(vendor, to), { recursive: true });

  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = relative(outDir, p).split('\\').join('/');
      if (statSync(p).isDirectory()) { if (!skipDirs.includes(rel) && name !== 'cmaps') walk(p); continue; }
      if (rel !== 'sw.js' && !rel.endsWith('.map')) files.push(rel);
    }
  })(outDir);
  files.sort();

  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
  const version = hash.digest('hex').slice(0, 12);

  const assets = ['./', ...files.map((f) => `./${f}`)];
  const swPath = join(outDir, 'sw.js');
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2)));
  return { version, count: files.length };
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'src'), dist, { recursive: true });
cpSync(join(root, 'latino'), join(dist, 'latino'), { recursive: true });

// prima aMICOLatino, così il suo sw.js è già completo quando si calcola la versione di aMICOLettore
const lat = finishApp(join(dist, 'latino'), [...PDFJS, ...SPEECH], []);
const let_ = finishApp(dist, [...PDFJS, ...SPEECH], ['latino']);

writeFileSync(join(dist, '.nojekyll'), '');
console.log(`dist/ pronta: aMICOLettore ${let_.version} (${let_.count} file), aMICOLatino ${lat.version} (${lat.count} file)`);
