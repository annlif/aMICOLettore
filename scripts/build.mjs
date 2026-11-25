// Prepara la cartella dist/ da pubblicare su GitHub Pages.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');
const dist = join(root, 'dist');
const nm = join(root, 'node_modules');

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

const vendor = join(dist, 'vendor');
mkdirSync(vendor, { recursive: true });
cpSync(join(nm, 'pdfjs-dist/legacy/build/pdf.min.mjs'), join(vendor, 'pdf.min.mjs'));
cpSync(join(nm, 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'), join(vendor, 'pdf.worker.min.mjs'));
cpSync(join(nm, 'pdfjs-dist/cmaps'), join(vendor, 'cmaps'), { recursive: true });
cpSync(join(nm, 'microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js'), join(vendor, 'speech-sdk.js'));

// elenco dei file da tenere offline (escluse le cmaps, scaricate solo se servono)
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'cmaps') walk(p); continue; }
    const rel = relative(dist, p).split('\\').join('/');
    if (rel !== 'sw.js' && !rel.endsWith('.map')) files.push(rel);
  }
})(dist);
files.sort();

const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);

const assets = ['./', ...files.map((f) => `./${f}`)];
const swPath = join(dist, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2)));
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`dist/ pronta (versione ${version}, ${files.length} file)`);
