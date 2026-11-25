// Voce di sistema dell'iPad (Web Speech API): funziona senza internet e senza quota,
// usata come riserva quando Azure non è raggiungibile.

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let current = null; // tiene in vita l'enunciato (Safari lo perde se non è referenziato)

function italianVoices() {
  if (!supported) return [];
  return speechSynthesis.getVoices().filter((v) => /^it([-_]|$)/i.test(v.lang));
}

function bestVoice(voices) {
  const score = (v) =>
    (/premium/i.test(v.name) ? 40 : 0) +
    (/enhanced|migliorat/i.test(v.name) ? 30 : 0) +
    (/alice|federica|emma|isabella|elsa/i.test(v.name) ? 10 : 0) +
    (v.localService ? 5 : 0) +
    (/^it[-_]IT$/i.test(v.lang) ? 3 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

export const sysVoice = {
  supported,
  voices: italianVoices,
  available() { return italianVoices().length > 0; },
  pick(name) {
    const vs = italianVoices();
    return vs.find((v) => v.name === name) || bestVoice(vs);
  },
  /** Su iPad la sintesi va "sbloccata" con un tocco dell'utente. */
  unlock() {
    if (!supported) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignora */ }
  },
  onVoicesChanged(fn) {
    if (supported) speechSynthesis.addEventListener?.('voiceschanged', fn);
  },
  speak(text, { voiceName, rate = 1, onWord, onEnd, onError } = {}) {
    if (!supported) { onError?.({ error: 'non supportata' }); return; }
    this.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pick(voiceName);
    if (v) u.voice = v;
    u.lang = v?.lang || 'it-IT';
    u.rate = Math.max(0.5, Math.min(2, rate));
    u.onboundary = (e) => { if (!e.name || e.name === 'word') onWord?.(e.charIndex); };
    u.onend = () => { if (current === u) { current = null; onEnd?.(); } };
    u.onerror = (e) => {
      if (current !== u) return;
      current = null;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      onError?.(e);
    };
    current = u;
    speechSynthesis.speak(u);
  },
  cancel() {
    current = null;
    if (supported) try { speechSynthesis.cancel(); } catch { /* ignora */ }
  },
};
