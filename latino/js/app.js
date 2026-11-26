// aMICOLatino – navigazione tra le sezioni, impostazioni di base, installazione offline.

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

// ---------- impostazioni (solo su questo dispositivo) ----------
const SETTINGS_KEY = 'amicolatino.settings';
const DEFAULTS = { latinSize: 24, lastView: DEFAULT_VIEW };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* spazio non disponibile */ } }
const settings = loadSettings();

const $ = (id) => document.getElementById(id);

// ---------- messaggi brevi ----------
let toastTimer;
export function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- navigazione ----------
const readySections = SECTIONS.filter((s) => s.ready);
const views = new Set([...readySections.map((s) => s.id), 'cerca']);

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

function currentView() {
  const v = decodeURIComponent(location.hash.slice(1)).split('/')[0];
  return views.has(v) ? v : null;
}

export function go(view) {
  if (location.hash.slice(1) !== view) location.hash = view; else show(view);
}

function show(view) {
  for (const el of document.querySelectorAll('[data-view]')) {
    if (el.classList.contains('view')) el.hidden = el.dataset.view !== view;
  }
  for (const b of document.querySelectorAll('.tab')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (view !== 'cerca') { settings.lastView = view; saveSettings(); }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => show(currentView() || DEFAULT_VIEW));

// ---------- dimensione del testo latino ----------
function applyFont() { document.documentElement.style.setProperty('--latin-size', `${settings.latinSize}px`); }
function changeFont(d) {
  settings.latinSize = Math.min(40, Math.max(18, settings.latinSize + d));
  applyFont(); saveSettings();
  toast(`Testo: ${settings.latinSize} pt`, 1200);
}

// ---------- avvio ----------
buildTabbar();
applyFont();
show(currentView() || (views.has(settings.lastView) ? settings.lastView : DEFAULT_VIEW));

$('btn-home').addEventListener('click', () => go('versioni'));
$('btn-font-down').addEventListener('click', () => changeFont(-2));
$('btn-font-up').addEventListener('click', () => changeFont(2));
$('btn-settings').addEventListener('click', () => $('settings').showModal());
$('btn-load-pdf').addEventListener('click', () => toast('Il caricamento delle versioni arriva nel prossimo aggiornamento. Ci siamo quasi!'));
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
