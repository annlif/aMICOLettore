// Piccoli aiuti per l'interfaccia, condivisi da tutte le sezioni.

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const DATE_FMT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDate = (ts) => DATE_FMT.format(new Date(ts));

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  // esegue subito, ma solo se c'era qualcosa in attesa
  d.flush = (...a) => { if (t !== null) { clearTimeout(t); t = null; fn(...a); } };
  return d;
}

/** Fa crescere un campo di testo insieme al suo contenuto. */
export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

/**
 * Menu a comparsa vicino a un elemento (per le parole e per le frasi).
 * items: [{label, icon?, action, disabled?}]
 */
export function openMenu(anchor, title, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'popmenu';
  menu.id = 'popmenu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = (title ? `<div class="popmenu-title">${title}</div>` : '') +
    items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>` +
      `${it.icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${it.icon}</svg>` : ''}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(menu);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it.action();
  });
  // posizione: sotto l'elemento, dentro lo schermo
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), window.innerWidth - mw - 8);
  let top = r.bottom + 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.classList.add('picked');
  menu._anchor = anchor;
  menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
function outside(e) {
  const m = $('popmenu');
  if (m && !m.contains(e.target)) closeMenu();
}
export function closeMenu() {
  const m = $('popmenu');
  if (m) { m._anchor?.classList.remove('picked'); m.remove(); }
  document.removeEventListener('pointerdown', outside, true);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('scroll', closeMenu, { passive: true });
