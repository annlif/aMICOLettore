// Sintesi vocale con Azure Speech + salvataggio dell'audio sul dispositivo.
// L'audio NON viene riprodotto dall'SDK: lo riceviamo come file MP3 insieme ai tempi
// di ogni parola (eventi "word boundary"), lo salviamo e lo riproduciamo noi.
// Così rileggere una frase già ascoltata non consuma la quota gratuita.

import { db, sha256Hex, addUsage } from './store.js';

export const ITALIAN_VOICES = [
  { id: 'it-IT-IsabellaNeural', label: 'Isabella (femminile) – predefinita' },
  { id: 'it-IT-IsabellaMultilingualNeural', label: 'Isabella Multilingual (femminile)' },
  { id: 'it-IT-ElsaNeural', label: 'Elsa (femminile)' },
  { id: 'it-IT-FiammaNeural', label: 'Fiamma (femminile)' },
  { id: 'it-IT-FabiolaNeural', label: 'Fabiola (femminile)' },
  { id: 'it-IT-ImeldaNeural', label: 'Imelda (femminile)' },
  { id: 'it-IT-IrmaNeural', label: 'Irma (femminile)' },
  { id: 'it-IT-PalmiraNeural', label: 'Palmira (femminile)' },
  { id: 'it-IT-PierinaNeural', label: 'Pierina (femminile)' },
  { id: 'it-IT-DiegoNeural', label: 'Diego (maschile)' },
  { id: 'it-IT-GiuseppeMultilingualNeural', label: 'Giuseppe Multilingual (maschile)' },
  { id: 'it-IT-AlessioMultilingualNeural', label: 'Alessio Multilingual (maschile)' },
  { id: 'it-IT-MarcelloMultilingualNeural', label: 'Marcello Multilingual (maschile)' },
  { id: 'it-IT-BenignoNeural', label: 'Benigno (maschile)' },
  { id: 'it-IT-CalimeroNeural', label: 'Calimero (maschile)' },
  { id: 'it-IT-CataldoNeural', label: 'Cataldo (maschile)' },
  { id: 'it-IT-GianniNeural', label: 'Gianni (maschile)' },
  { id: 'it-IT-LisandroNeural', label: 'Lisandro (maschile)' },
  { id: 'it-IT-RinaldoNeural', label: 'Rinaldo (maschile)' },
];

export class TTSError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

const TICKS_PER_SECOND = 10_000_000;

function sdk() {
  const s = window.SpeechSDK;
  if (!s) throw new TTSError('La libreria di Azure Speech non è stata caricata. Controlla la connessione e riapri l\'app.', 'sdk');
  return s;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSsml(text, voice) {
  const body = escapeXml(text);
  // Le voci "Multilingual" leggono meglio l'italiano se la lingua è indicata esplicitamente
  const inner = /Multilingual/i.test(voice) ? `<lang xml:lang="it-IT">${body}</lang>` : body;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="it-IT"><voice name="${voice}">${inner}</voice></speak>`;
}

function describeError(details = '') {
  const d = String(details);
  if (/401|unauthori[sz]ed|authentication|invalid subscription/i.test(d)) {
    return new TTSError('Azure non accetta la chiave: controlla chiave e regione nelle impostazioni.', 'auth');
  }
  if (/429|too many|throttl/i.test(d)) return new TTSError('Troppe richieste ad Azure in poco tempo: riprovo tra qualche secondo…', 'throttle');
  if (/quota|403|forbidden/i.test(d)) return new TTSError('Azure ha rifiutato la richiesta: forse la quota gratuita del mese è finita.', 'quota');
  if (/voice|1007|unsupported/i.test(d)) return new TTSError('Questa voce non è disponibile nella tua regione Azure: scegline un\'altra nelle impostazioni.', 'voice');
  if (/websocket|network|connection|1006|timeout/i.test(d) || !navigator.onLine) {
    return new TTSError('Non riesco a collegarmi ad Azure. Controlla la connessione a internet.', 'network');
  }
  return new TTSError(`Errore di Azure Speech: ${d || 'sconosciuto'}`, 'other');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Speaker {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.synth = null;
    this.synthSig = '';
    this.queue = Promise.resolve();   // una richiesta alla volta
    this.inflight = new Map();        // evita doppie richieste dello stesso testo
  }

  /** Chiave della cache: dipende solo da voce e testo (la velocità si regola in riproduzione). */
  cacheKey(text, voice) { return sha256Hex(`${voice}\u0001${text}`); }

  /** true se l'audio di questo testo è già salvato sul dispositivo. */
  async isCached(text) {
    return db.hasAudio(await this.cacheKey(text, this.getSettings().voice)).catch(() => false);
  }

  /**
   * Restituisce {audio: ArrayBuffer, mime, words: [{o, len, t}], fromCache}.
   * o = posizione del carattere nel testo, t = istante in secondi.
   */
  async get(text, { cacheOnly = false } = {}) {
    const voice = this.getSettings().voice;
    const key = await this.cacheKey(text, voice);
    const cached = await db.getAudio(key).catch(() => null);
    if (cached) return { ...cached, fromCache: true };
    if (cacheOnly) return null;
    if (!navigator.onLine) throw new TTSError('Sei senza internet e questa parte non è ancora stata salvata sul dispositivo.', 'network');
    if (this.inflight.has(key)) return this.inflight.get(key);

    const p = (this.queue = this.queue.catch(() => {}).then(() => this.synthesizeWithRetry(text, voice)))
      .then(async (res) => {
        const rec = { key, voice, chars: text.length, createdAt: Date.now(), ...res };
        try { await db.putAudio(rec); } catch (e) { console.warn('Impossibile salvare l\'audio', e); }
        return { ...rec, fromCache: false };
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async synthesizeWithRetry(text, voice) {
    let wait = 4000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.synthesize(text, voice);
      } catch (e) {
        const err = e instanceof TTSError ? e : describeError(e?.message || e);
        const retriable = err.kind === 'throttle' || (err.kind === 'network' && navigator.onLine);
        if (!retriable || attempt >= 3) throw err;
        this.reset();
        await sleep(wait);
        wait *= 2;
      }
    }
  }

  ensureSynth() {
    const { key, region, voice } = this.getSettings();
    if (!key || !region) throw new TTSError('Manca la chiave di Azure: aprila nelle impostazioni (icona a forma di ingranaggio).', 'nokey');
    const sig = `${key}|${region}|${voice}`;
    if (this.synth && this.synthSig === sig) return this.synth;
    this.reset();
    const S = sdk();
    const cfg = S.SpeechConfig.fromSubscription(key.trim(), region.trim());
    cfg.speechSynthesisLanguage = 'it-IT';
    cfg.speechSynthesisVoiceName = voice;
    cfg.speechSynthesisOutputFormat = S.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
    cfg.setProperty(S.PropertyId.SpeechServiceResponse_RequestWordBoundary, 'true');
    this.synth = new S.SpeechSynthesizer(cfg, null); // null = non riprodurre, restituisci solo l'audio
    this.synthSig = sig;
    return this.synth;
  }

  reset() {
    try { this.synth?.close(); } catch { /* già chiuso */ }
    this.synth = null;
    this.synthSig = '';
  }

  synthesize(text, voice) {
    const S = sdk();
    const synth = this.ensureSynth();
    const ssml = buildSsml(text, voice);
    const bodyStart = ssml.indexOf(escapeXml(text));
    const words = [];
    let cursor = 0;
    const lower = text.toLowerCase();

    return new Promise((resolve, reject) => {
      synth.wordBoundary = (_s, e) => {
        if (e.boundaryType && e.boundaryType !== S.SpeechSynthesisBoundaryType.Word) return;
        const w = e.text || '';
        // Ritrova la parola nel testo originale procedendo in avanti
        let o = w ? lower.indexOf(w.toLowerCase(), cursor) : -1;
        if (o < 0 || o - cursor > 80) {
          o = Math.max(cursor, Math.min(text.length - 1, (e.textOffset ?? 0) - bodyStart));
        }
        const len = w.length || e.wordLength || 1;
        cursor = o + Math.max(1, len);
        words.push({ o, len, t: e.audioOffset / TICKS_PER_SECOND });
      };
      synth.speakSsmlAsync(
        ssml,
        (result) => {
          synth.wordBoundary = undefined;
          if (result.reason === S.ResultReason.SynthesizingAudioCompleted && result.audioData?.byteLength) {
            addUsage(text.length);
            resolve({ audio: result.audioData, mime: 'audio/mpeg', words });
          } else {
            reject(describeError(result.errorDetails));
          }
        },
        (err) => { synth.wordBoundary = undefined; reject(describeError(err)); },
      );
    });
  }

  /** Elenco delle voci italiane disponibili per questa chiave e regione. */
  async listVoices() {
    const synth = this.ensureSynth();
    const S = sdk();
    const res = await synth.getVoicesAsync('it-IT');
    if (res.reason !== S.ResultReason.VoicesListRetrieved) throw describeError(res.errorDetails);
    return res.voices
      .filter((v) => v.locale === 'it-IT' || /^it-IT-/.test(v.shortName))
      .map((v) => ({
        id: v.shortName,
        label: `${v.shortName.replace(/^it-IT-|Neural$/g, '').replace(/(?=Multilingual|DragonHD)/g, ' ')} (${v.gender === 2 ? 'maschile' : v.gender === 1 ? 'femminile' : 'voce'})${v.shortName === 'it-IT-IsabellaNeural' ? ' – predefinita' : ''}`,
      }));
  }
}
