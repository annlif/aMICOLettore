// aMICOLatino – navigazione tra le sezioni, impostazioni di base, installazione offline.
import { loadSettings, saveSettings, askPersistence } from './store.js';
import { $, toast, closeMenu } from './ui.js';
import { initVersioni, showList, showVersion, leaveVersion } from './versioni.js';
import { ascolta, loadVoce, saveVoce, parseVoceCode, provaVoce, usage, VOCI } from './voce.js';
import { initParole, showParole, addWord, addFromWord } from './parole.js';
import { initVocab, showVocab, showWord, showSearch, addToComplete, wordContext, renderDaCompletare, initDaCompletare, lexicon } from './vocab.js';

// Sezioni dell'app. Quelle con ready:false sono previste per le fasi successive:
// esistono già qui, ma non compaiono nella barra finché non sono pronte.
export const SECTIONS = [
  { id: 'versioni', label: 'Versioni', ready: true,
    icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' },
  { id: 'vocabolario', label: 'Vocabolario', ready: true,
    icon: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 21a2 2 0 0 1 2-2h13v2H6M9 7h6M9 11h4"/>' },
  { id: 'parole', label: 'Le mie parole', ready: true,
    icon: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z"/>' },
  { id: 'regole', label: 'Regole', ready: false,
    icon: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/>' },
  { id: 'esercizi', label: 'Esercizi', ready: false,
    icon: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/>' },
  { id: 'quaderno', label: 'Quaderno', ready: false,
    icon: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6Z"/><path d="M6 3v18M9 8h7M9 12h7"/>' },
];
const DEFAULT_VIEW = 'versioni';
// viste che non sono sezioni della barra, e la sezione a cui appartengono
const SUBVIEWS = { versione: 'versioni', cerca: null };

const settings = loadSettings();

// ---------- azioni sulle parole (menu che compare toccando una parola) ----------
const ICONS = {
  cerca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  analizza: '<path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="16" r="3"/><path d="m20.2 18.2 1.8 1.8"/>',
  ascolta: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9a3.5 3.5 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"/>',
  aggiungi: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z"/><path d="M12 9v6M9 12h6"/>',
};
const soon = () => toast('Questa funzione arriva nel prossimo aggiornamento. Ci siamo quasi!');
function wordActions(ctx) {
  return [
    { label: 'Cerca nel vocabolario', icon: ICONS.cerca, action: () => showWord(ctx, 'cerca') },
    { label: 'Analizza la forma', icon: ICONS.analizza, action: () => showWord(ctx, 'analizza') },
    { label: 'Ascolta', icon: ICONS.ascolta, action: () => speak(ctx.word) },
    { label: 'Aggiungi alle mie parole', icon: ICONS.aggiungi, action: () => addFromWord(ctx) },
  ];
}

// ---------- Ascolta ----------
let warnedIpad = false;
function speak(text) {
  ascolta(text).then((how) => {
    if (how === 'ipad' && !warnedIpad && !loadVoce().key) {
      warnedIpad = true;
      toast('Sto usando la voce dell\'iPad. Per la voce di Azure, collegala nelle impostazioni.', 5000);
    }
  }).catch((e) => toast(e.message || String(e), 5000));
}

// ---------- impostazioni della voce ----------
function voceStato(v) {
  if (v.key && v.region) return `Voce di Azure collegata (regione ${v.region})${v.from === 'amicolettore' ? ', presa da aMICOLettore' : ''}. ✓`;
  return 'La voce di Azure non è ancora collegata: per ora "Ascolta" usa la voce dell\'iPad.';
}
function openSettings() { fillSettings(); $('settings').showModal(); }
function fillSettings() {
  const v = loadVoce();
  $('voce-stato').textContent = voceStato(v);
  $('set-key').value = v.key; $('set-region').value = v.region;
  const sel = $('set-voce');
  sel.innerHTML = VOCI.map(([id, l]) => `<option value="${id}">${l}</option>`).join('');
  sel.value = v.voice;
  $('set-rate').value = String(v.rate);
  $('set-ipad').checked = v.iPad !== false;
  $('voce-msg').textContent = '';
  $('voce-usage').textContent = `Caratteri inviati ad Azure da aMICOLatino questo mese: ${usage().toLocaleString('it-IT')} (la quota gratuita è condivisa con aMICOLettore).`;
}
function formVoce() {
  return { ...loadVoce(), key: $('set-key').value.trim(), region: $('set-region').value.trim().toLowerCase().replace(/\s+/g, ''),
    voice: $('set-voce').value, rate: Number($('set-rate').value), iPad: $('set-ipad').checked };
}
for (const id of ['set-key', 'set-region', 'set-voce', 'set-rate', 'set-ipad']) {
  $(id).addEventListener('change', () => { const v = formVoce(); delete v.from; saveVoce(v); $('voce-stato').textContent = voceStato(v); });
}
$('btn-incolla-voce').addEventListener('click', async () => {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* permesso negato */ }
  if (!text) text = prompt('Incolla qui il codice copiato da aMICOLettore:') || '';
  const c = parseVoceCode(text);
  if (!c) { $('voce-msg').textContent = 'Non trovo il codice di aMICOLettore negli appunti. In aMICOLettore tocca prima "Copia la voce per aMICOLatino".'; return; }
  const v = { ...loadVoce(), ...c };
  delete v.from;
  saveVoce(v);
  fillSettings();
  $('voce-msg').textContent = 'Fatto! La voce di aMICOLettore è collegata. Tocca "Prova la voce".';
  try { await navigator.clipboard.writeText(''); } catch { /* ignora */ }
});
$('btn-prova-voce').addEventListener('click', async () => {
  const v = formVoce();
  if (!v.key || !v.region) { $('voce-msg').textContent = 'Prima collega la voce di Azure.'; return; }
  $('voce-msg').textContent = 'Provo…';
  try { await provaVoce(v); $('voce-msg').textContent = 'Funziona! ✓'; } catch (e) { $('voce-msg').textContent = e.message || String(e); }
});

// ---------- navigazione ----------
const readySections = SECTIONS.filter((s) => s.ready);
const views = new Set([...readySections.map((s) => s.id), ...Object.keys(SUBVIEWS)]);

function buildTabbar() {
  const nav = $('tabbar');
  nav.innerHTML = '';
  for (const s of readySections) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.dataset.view = s.id;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg><span>${s.label}</span>`;
    b.addEventListener('click', () => go(s.id));
    nav.append(b);
  }
}

function parseHash() {
  const [view, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  return views.has(view) ? { view, arg: rest.join('/') } : null;
}

export function go(route) {
  if (decodeURIComponent(location.hash.slice(1)) !== route) location.hash = route; else route_();
}

let currentView = null;
async function route_() {
  const r = parseHash() || { view: views.has(settings.lastView) ? settings.lastView : DEFAULT_VIEW, arg: '' };
  closeMenu();
  if (currentView === 'versione' && r.view !== 'versione') leaveVersion();

  if (r.view === 'versione' && !(await showVersion(r.arg))) return;
  if (r.view === 'versioni') await showList();
  if (r.view === 'vocabolario') { await showVocab(); renderDaCompletare(); }
  if (r.view === 'parole') await showParole();
  if (r.view === 'cerca') {
    if (!r.arg) { go('versioni'); return; }
    $('search-input').value = r.arg;
    await showSearch(r.arg);
  }

  for (const el of document.querySelectorAll('main.view')) el.hidden = el.dataset.view !== r.view;
  const tab = SUBVIEWS[r.view] === undefined ? r.view : SUBVIEWS[r.view];
  for (const b of document.querySelectorAll('.tab')) {
    if (b.dataset.view === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (r.view !== 'cerca') { settings.lastView = r.view === 'versione' ? 'versioni' : r.view; saveSettings(settings); }
  if (r.view !== 'versione' || currentView !== 'versione') window.scrollTo(0, 0);
  currentView = r.view;
}
window.addEventListener('hashchange', route_);

// ---------- dimensione del testo latino ----------
function applyFont() { document.documentElement.style.setProperty('--latin-size', `${settings.latinSize}px`); }
function changeFont(d) {
  settings.latinSize = Math.min(40, Math.max(18, settings.latinSize + d));
  applyFont(); saveSettings(settings);
  toast(`Testo latino: ${settings.latinSize} pt`, 1200);
}

// ---------- avvio ----------
buildTabbar();
applyFont();
initVersioni({ go, wordActions, speak });
initVocab();
initDaCompletare();
initParole();
lexicon().catch(() => {}); // prepara il vocabolario in anticipo

// pulsanti dentro le schede del vocabolario (ovunque compaiano)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'dacompletare') {
    addToComplete(b.dataset.word, wordContext() || {}).then(() => { if (currentView === 'vocabolario') renderDaCompletare(); });
  } else if (b.dataset.act === 'ascolta') {
    speak(b.dataset.text);
  } else if (b.dataset.act === 'aggiungi') {
    addWord(b.dataset.entry, wordContext() || {}).then(() => { if (currentView === 'parole') showParole(); });
  } else soon();
});
route_();
askPersistence();

$('btn-home').addEventListener('click', () => go('versioni'));
$('btn-font-down').addEventListener('click', () => changeFont(-2));
$('btn-font-up').addEventListener('click', () => changeFont(2));
$('btn-settings').addEventListener('click', openSettings);
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (!q) return;
  $('search-input').blur();
  go(`cerca/${q}`);
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
}

// per i test automatici
window.__amicolatino = { SECTIONS, settings };
