// =====================================================================
// PRONUNCIA SCOLASTICA (ecclesiastica) ITALIANA DEL LATINO – regole per "Ascolta"
// =====================================================================
// Le regole trasformano SOLO il testo che viene mandato alla voce di Azure:
// il testo mostrato nell'app resta quello originale.
// Ogni regola lavora su una parola alla volta (in minuscolo, senza segni di quantità) e non cambia
// il numero delle parole, così l'evidenziazione può sempre ritrovare la parola originale.
//
// COME AGGIUNGERE UNA REGOLA
//   Copia una riga dell'elenco REGOLE e cambia:
//     cerca:  che cosa cercare dentro la parola (espressione regolare, con /g alla fine)
//     con:    con che cosa sostituirlo
//     tranne: (facoltativo) le parole a cui NON va applicata
//     esempio: solo un promemoria
//   L'ordine conta: le regole vengono applicate dall'alto in basso.
//
// COME CORREGGERE UNA SINGOLA PAROLA LETTA MALE
//   Aggiungi una riga in PAROLE: 'parola latina': 'come deve essere letta'.
//   (Le parole qui hanno la precedenza su tutte le regole.)
// =====================================================================

export const REGOLE = [
  { cerca: /j/g, con: 'i', esempio: 'Iulius / Julius → Iulius' },
  { cerca: /^h/g, con: '', esempio: 'hortus → ortus (h iniziale muta)' },
  { cerca: /ph/g, con: 'f', esempio: 'philosophia → filosofia' },
  { cerca: /th/g, con: 't', esempio: 'theatrum → teatrum' },
  { cerca: /y/g, con: 'i', esempio: 'Aegyptus → Egiptus' },
  // ti + vocale → zi, ma non all'inizio della parola né dopo s, t, x (bestia, Attius, mixtio restano così)
  { cerca: /(?<=[a-z])(?<![stx])ti(?=[aeiou])/g, con: 'zi', esempio: 'gratia → grazia, etiam → eziam' },
  { cerca: /ae/g, con: 'e', tranne: /^(aer|aër)/, esempio: 'puellae → puelle, rosae → rose' },
  { cerca: /oe/g, con: 'e', tranne: /^(poe[tms]|coer|coem|coeo|coi)/, esempio: 'poena → pena (ma poeta resta poeta)' },
];

export const PAROLE = {
  // 'parola': 'pronuncia',
  // esempio: 'mihi': 'miki',
};

// ---------------------------------------------------------------------
// Da qui in giù non serve modificare nulla.
// ---------------------------------------------------------------------
const plain = (w) => w.normalize('NFD').replace(/\p{M}/gu, '');

/** Pronuncia di una sola parola. */
export function pronunciaParola(word) {
  const low = plain(word).toLowerCase();
  let out = PAROLE[low];
  if (out == null) {
    out = low;
    for (const r of REGOLE) {
      if (r.tranne && r.tranne.test(low)) continue;
      r.cerca.lastIndex = 0;
      out = out.replace(r.cerca, r.con);
    }
  }
  // mantiene la maiuscola iniziale (inizio di frase, nomi propri)
  return /^\p{Lu}/u.test(word) && out ? out[0].toUpperCase() + out.slice(1) : out;
}

/** Testo da mandare alla voce: stesse parole e stessa punteggiatura, pronuncia scolastica. */
export function pronuncia(text) {
  return String(text).replace(/[\p{L}\p{M}]+/gu, (w) => pronunciaParola(w) || w);
}

/** Impronta delle regole: se cambiano, l'audio salvato con le regole vecchie viene rifatto. */
export const VERSIONE_REGOLE = (() => {
  const src = JSON.stringify([REGOLE.map((r) => [String(r.cerca), r.con, String(r.tranne || '')]), PAROLE]);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();
