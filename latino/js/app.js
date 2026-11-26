// aMICOLatino – navigazione tra le sezioni, impostazioni di base, installazione offline.
import { loadSettings, saveSettings, askPersistence } from './store.js';
import { $, toast, closeMenu } from './ui.js';
import { initVersioni, showList, showVersion, leaveVersion } from './versioni.js';

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
function wordActions(/* { word, sentence, versionId, versionTitle } */) {
  return [
    { label: 'Cerca nel vocabolario', icon: ICONS.cerca, action: soon },
    { label: 'Analizza la forma', icon: ICONS.analizza, action: soon },
    { label: 'Ascolta', icon: ICONS.ascolta, action: soon },
    { label: 'Aggiungi alle mie parole', icon: ICONS.aggiungi, action: soon },
  ];
}

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
initVersioni({ go, wordActions });
route_();
askPersistence();

$('btn-home').addEventListener('click', () => go('versioni'));
$('btn-font-down').addEventListener('click', () => changeFont(-2));
$('btn-font-up').addEventListener('click', () => changeFont(2));
$('btn-settings').addEventListener('click', () => $('settings').showModal());
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (!q) return;
  $('search-query').textContent = q;
  go('cerca');
  $('search-input').blur();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
}

// per i test automatici
window.__amicolatino = { SECTIONS, settings };
