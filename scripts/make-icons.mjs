// Genera le icone PNG a partire dagli SVG (serve Playwright; i PNG sono già nel repository).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();

// icone di aMICOLettore (src/icons) e di aMICOLatino (latino/icons)
for (const app of ['../src/icons/', '../latino/icons/']) {
  const dir = new URL(app, import.meta.url).pathname;
  const rounded = readFileSync(dir + 'icon.svg', 'utf8');
  const full = readFileSync(dir + 'icon-full.svg', 'utf8');
  const jobs = [
    ['apple-touch-icon.png', full, 180],
    ['icon-192.png', rounded, 192],
    ['icon-512.png', rounded, 512],
    ['icon-maskable-512.png', full, 512],
  ];
  for (const [name, svg, size] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    writeFileSync(dir + name, await page.screenshot({ omitBackground: true }));
  }
}
const dir = new URL('../src/icons/', import.meta.url).pathname;

// logo completo (per il README)
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const symbol = html.slice(html.indexOf('<svg width="0"'), html.indexOf('</svg>', html.indexOf('<svg width="0"')) + 6);
const mark = readFileSync(dir + 'logo-mark.svg', 'utf8');
await page.setViewportSize({ width: 1200, height: 400 });
await page.setContent(`<style>
  body{margin:0;background:transparent;font-family:ui-rounded,"SF Pro Rounded",system-ui,"Inter",sans-serif}
  .logo{display:inline-flex;align-items:center;gap:28px;padding:30px 40px}
  .logo > svg{width:190px;height:168px}
  .wm{font-size:110px;font-weight:800;letter-spacing:2px;display:inline-flex;align-items:baseline;line-height:1}
  .g{color:#6B819B;font-weight:600}.c{color:#FF6F61;display:inline-flex;align-items:baseline}
  .o{width:.78em;height:.78em;margin:0 .02em -.015em;color:#FF6F61}
</style>${symbol}<div class="logo">${mark}<span class="wm"><span class="g">a</span><span class="c">MIC<svg class="o"><use href="#speaker-o"/></svg>L</span><span class="g">ettore</span></span></div>`);
writeFileSync(new URL('../docs/logo.png', import.meta.url), await page.locator('.logo').screenshot({ omitBackground: true }));

// logo completo di aMICOLatino (per il README)
const latHtml = readFileSync(new URL('../latino/index.html', import.meta.url), 'utf8');
const colSymbol = latHtml.slice(latHtml.indexOf('<svg width="0"'), latHtml.indexOf('</svg>', latHtml.indexOf('<svg width="0"')) + 6);
const latIcon = readFileSync(new URL('../latino/icons/icon.svg', import.meta.url), 'utf8');
await page.setContent(`<style>
  body{margin:0;background:transparent;font-family:ui-rounded,"SF Pro Rounded",system-ui,"Inter",sans-serif}
  .logo{display:inline-flex;align-items:center;gap:28px;padding:30px 40px}
  .logo > svg{width:150px;height:150px}
  .wm{font-size:110px;font-weight:800;letter-spacing:2px;display:inline-flex;align-items:baseline;line-height:1}
  .g{color:#6B819B;font-weight:600}.c{color:#FF6F61;display:inline-flex;align-items:baseline}
  .o{width:.8em;height:.8em;margin:0 .02em -.02em;color:#FF6F61}
</style>${colSymbol}<div class="logo">${latIcon}<span class="wm"><span class="g">a</span><span class="c">MIC<svg class="o"><use href="#column-o"/></svg>L</span><span class="g">atino</span></span></div>`);
writeFileSync(new URL('../docs/logo-latino.png', import.meta.url), await page.locator('.logo').screenshot({ omitBackground: true }));
// docs/logo-amicol.png (marchio aMICOL™) è l'immagine originale del marchio: non viene generata qui.
await browser.close();
console.log('Icone generate');
