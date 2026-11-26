<p align="center"><img src="docs/logo-amicol.png" alt="aMICOL™" width="560"></p>

<p align="center"><i>aMICOL™ – app per studiare: aMICOLettore e aMICOLatino</i></p>

---

<p align="center"><img src="docs/logo.png" alt="aMICOLettore" width="520"></p>

**aMICOLettore** (sull'iPad: **aMICOL**) è una web app che legge ad alta voce i PDF con le voci neurali di
**Azure Speech**, evidenziando la parola pronunciata. Si installa nella schermata Home dell'iPad come una vera app.

👉 Indirizzo dell'app, una volta pubblicata: **https://annlif.github.io/aMICOLettore/**

## Cosa fa

- **Apre un PDF** dall'iPad (app File, iCloud, allegati…) ed estrae il testo con pdf.js.
  Se il PDF è una **scansione** (solo immagini, senza testo) lo segnala; le singole pagine senza testo vengono saltate.
- **Legge frase per frase** con la voce **it-IT-IsabellaNeural** (predefinita) o un'altra voce italiana:
  Isabella Multilingual, Elsa, Diego, Giuseppe Multilingual e tutte le altre disponibili nella tua regione Azure.
- **Evidenzia la parola** che sta pronunciando (eventi *word boundary* di Azure) e colora la frase in corso.
- **Comandi**: play/pausa, velocità (da 0,6× a 2×), frase precedente/successiva, pagina precedente/successiva.
  Si può anche **toccare una frase** per farla leggere da lì.
- **Riprende da dove eri arrivata**: il punto di lettura di ogni documento viene salvato; all'apertura l'app riapre
  l'ultimo documento sulla frase giusta.
- **Salva l'audio sul dispositivo**: ogni frase generata viene conservata sull'iPad. Rileggere le stesse pagine
  **non consuma la quota gratuita** e funziona anche senza internet. Cambiare velocità non rigenera l'audio.
- **Prepara per offline**: un pulsante genera e salva in anticipo l'audio di tutto il documento (prima dice quanti
  caratteri servono e quanti ne restano nel mese). Poi il documento si legge anche senza internet, con le voci di Azure.
- **Voce dell'iPad di riserva**: se manca internet o la quota di Azure è finita, le parti non ancora salvate vengono lette
  con una voce italiana installata sull'iPad (gratis e offline, meno naturale). Si può disattivare nelle impostazioni.
- **Audio salvato sotto controllo**: nelle impostazioni c'è lo spazio occupato documento per documento, con un pulsante per
  cancellare l'audio di un solo documento; togliendo un documento dalla libreria l'app chiede se cancellare anche il suo audio.
- **Contatore dei caratteri**: barra con i caratteri inviati ad Azure nel mese (stima per dispositivo), con avvisi
  all'80%, al 95% e al 100% della quota gratuita.
- **Testo regolabile** (A− / A+), colori chiari e tema scuro automatico.

## La chiave di Azure

La chiave **non è nel codice**: si inserisce una sola volta nelle **Impostazioni** dell'app (icona ⚙︎) e resta
salvata soltanto su quell'iPad. Il repository è pubblico, quindi non bisogna mai scriverla in nessun file.

Dove trovarla: [portale Azure](https://portal.azure.com) → la tua risorsa **Speech** → **Chiavi ed endpoint** (*Keys and Endpoint*).
Copia **KEY 1** e il valore di **Posizione/Area** (*Location/Region*, per esempio `westeurope`).

### Piano gratuito F0

- Include **0,5 milioni di caratteri al mese** per le voci neurali. Nelle impostazioni l'app mostra una **stima** dei
  caratteri inviati da quell'iPad nel mese in corso.
- L'app raggruppa le frasi brevi in un'unica richiesta, per non superare il limite di richieste al minuto del piano F0,
  e se Azure risponde "troppe richieste" riprova da sola dopo qualche secondo.
- Mentre leggi, prepara in anticipo il blocco di frasi successivo, così non ci sono pause.
- Il valore esatto dei caratteri usati è nel portale Azure: risorsa Speech → **Monitoring → Metrics** → *Synthesized Characters*.

### Usarla senza internet

- Serve internet solo la prima volta, per installare l'app, e per generare voci nuove con Azure.
- L'app, la libreria e tutto l'audio già salvato funzionano senza connessione.
- Per un documento intero: aprilo con il Wi-Fi e tocca **Prepara per offline**; quando compare *Pronto offline ✓* si legge ovunque.
- Per una voce di riserva migliore: Impostazioni dell'iPad → Accessibilità → Contenuto letto ad alta voce → Voci → Italiano,
  e scarica una voce “Migliorata” o “Premium”.

## Installare l'app sull'iPad

1. Apri **Safari** sull'iPad e vai su **https://annlif.github.io/aMICOLettore/**
2. Tocca il pulsante **Condividi** (il quadrato con la freccia in su).
3. Scegli **Aggiungi alla schermata Home**, poi **Aggiungi**. Comparirà l'icona **aMICOL**.
4. Apri l'app dalla Home, tocca ⚙︎ e inserisci **chiave** e **regione**. Tocca **Prova la voce**, poi **Salva**.

> L'app installata nella Home ha un archivio separato da Safari: inserisci la chiave **dall'app installata**.
> Se elimini l'app dalla Home, o cancelli i dati dei siti web, si perdono anche l'audio salvato e i punti di lettura.

## Pubblicazione (GitHub Pages)

La pubblicazione è automatica: a ogni modifica del ramo `main` la GitHub Action
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) scarica le librerie (pdf.js e Azure Speech SDK),
prepara la cartella `dist/` e la pubblica su GitHub Pages. Va attivata una sola volta in
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

---

<p align="center"><img src="docs/logo-latino.png" alt="aMICOLatino" width="520"></p>

## aMICOLatino (sull'iPad: **aMICOLat**)

Una seconda app, nello stesso repository, per fare le **versioni di latino ragionando**: divide la versione in frasi,
aiuta con il vocabolario e l'analisi delle forme, ma **non traduce mai al posto tuo**.

👉 Indirizzo: **https://annlif.github.io/aMICOLettore/latino/**

### Cosa fa

- **Versioni** – carica il PDF (o incolla il testo): l'app lo divide in frasi, toglie numeri di riga e parole spezzate,
  mette a parte titolo e consegne. Accanto a ogni frase c'è il campo per la **tua traduzione**, salvata da sola.
  Puoi unire, dividere o correggere le frasi. Se il PDF è una scansione, l'app lo dice chiaramente.
- **Ogni parola si tocca**: *Cerca nel vocabolario*, *Analizza la forma*, *Ascolta*, *Aggiungi alle mie parole*.
- **Analisi delle forme** – riconosce le forme flesse (es. *rosarum* → *rosa, rosae*, genitivo plurale) e mostra **tutte**
  le analisi possibili quando una forma è ambigua, invitando a scegliere guardando la frase.
- **Guida all'analisi** ("🧭 Sono bloccata: aiutami") – solo quando serve: una domanda alla volta (verbo principale →
  da quale verbo viene, se la forma è ambigua → soggetto → complemento retto dal verbo, o nome del predicato con *sum* →
  preposizioni), Micol risponde toccando le parole e riceve un riscontro, un indizio o, dopo due tentativi, "Mostrami".
  Con *sum* chiede se il predicato è verbale o nominale; per gli altri elementi Micol sceglie dall'**elenco completo dei
  complementi** (più attributo e apposizione) e l'app controlla che la scelta sia compatibile con caso e preposizione.
  Alla fine compare l'**analisi logica scritta**, che resta sotto la frase e può andare nel PDF. Non traduce mai.
- **Intelligenza artificiale per la guida (facoltativa)** – con una chiave di **Gemini** (Google AI Studio, quota
  gratuita) o di **Azure OpenAI** (anche Azure for Students), la guida usa l'analisi dell'IA per verbo principale, soggetto,
  complementi, attributi e tipo di subordinata, e capisce quando una scelta è possibile per la grammatica ma non per il senso.
  L'IA **non traduce**: restituisce solo la struttura della frase (numeri delle parole), salvata con la frase. Senza chiave
  o senza internet la guida usa le regole dell'app.
- **Significato al passaggio** – passando sopra una parola con trackpad, mouse o Apple Pencil compare il significato del lemma.
- **Connettivi** – un pulsante li evidenzia; quelli con più valori (*cum*, *ut*, *quod*…) sono tratteggiati.
- **Vocabolario offline** – lessico del biennio (circa 2.570 voci: le parole più frequenti nelle versioni, con tutti i connettivi principali), con paradigma,
  declinazione o coniugazione, significati, caso retto ed esempio. Le voci sono state **confrontate con il dizionario
  Olivetti** (paradigma, categoria, genere, declinazione o coniugazione, significati principali) e restano da verificare
  con la professoressa: dal Vocabolario si scarica l'**elenco in PDF** da rivedere.
  Per ogni voce c'è il pulsante **Apri nell'Olivetti** (dizionario-latino.com).
- **Parole che non ci sono** – si aggiungono con un tocco alla lista **"da completare"**: le schede vengono poi compilate
  seguendo l'Olivetti e aggiunte al lessico in un aggiornamento dell'app.
- **Le mie parole** – il vocabolario personale, con la scheda, le frasi in cui hai incontrato la parola e i tuoi appunti;
  filtri per categoria e i connettivi in una sezione a parte.
- **Ascolta** – voce italiana di Azure (pronuncia scolastica), la stessa di aMICOLettore; l'audio viene salvato sul
  dispositivo. Senza internet usa la voce dell'iPad.
- **Esporta** una versione (latino + traduzione) in **PDF** o **testo** da mandare alla professoressa.
- **Backup** di tutti i dati in un file, e ripristino.
- **Ricerca unica** nella barra in alto: vocabolario (anche forme flesse), significati, versioni.

### Pronuncia del latino in "Ascolta"

La voce è sempre **Isabella** (it-IT-IsabellaNeural, non la Multilingual) con il testo dichiarato in italiano, e prima di
inviarlo ad Azure l'app applica la **pronuncia scolastica italiana**: *ae* → e, *oe* → e, *ti* + vocale → zi (tranne
dopo s, t, x), *ph* → f, *th* → t, *y* → i, *h* iniziale muta (es. *puellae* → "puelle", *gratia* → "grazia").
La trasformazione vale solo per l'audio: il testo mostrato resta quello originale e il numero delle parole non cambia.

Le regole sono tutte in [`latino/js/pronuncia.js`](latino/js/pronuncia.js): per correggere una parola letta male basta
aggiungerla in `PAROLE` (es. `'mihi': 'miki'`), per una regola nuova si copia una riga di `REGOLE`. Quando le regole
cambiano, l'audio salvato con quelle vecchie viene rifatto da solo.

### Collegare la voce di aMICOLettore (una volta sola)

Sull'iPad ogni app della schermata Home ha un archivio separato, quindi aMICOLatino non può leggere da sola la chiave
salvata in aMICOLettore. Basta passarla con gli appunti:

1. Apri **aMICOLettore** → ⚙︎ Impostazioni → **Copia la voce per aMICOLatino**.
2. Apri **aMICOLatino** → ⚙︎ Impostazioni → tieni premuto nella casella **Codice di aMICOLettore** e scegli **Incolla**
   (oppure tocca **Incolla da aMICOLettore**), poi **Prova la voce**.
   Se la copia non riesce, in aMICOLettore il codice compare anche scritto: tienilo premuto → *Seleziona tutto* → *Copia*.

(In Safari o sul computer, dove l'archivio è lo stesso, aMICOLatino trova la chiave da solo.)

### Installarla sull'iPad

Safari → **https://annlif.github.io/aMICOLettore/latino/** → Condividi → **Aggiungi alla schermata Home**.
Compare l'icona con la colonna e il nome **aMICOLat**. È un'app separata da aMICOLettore.

### Il lessico

Il lessico è nel file [`latino/data/lessico.txt`](latino/data/lessico.txt), una voce per riga
(`paradigma | categoria | significati | caso retto | esempio | etichette`). Il motore in
[`latino/js/morfo.js`](latino/js/morfo.js) ricava dal paradigma tutte le forme flesse, senza dati esterni.
I significati sono scritti per aMICOLatino: dal dizionario Olivetti non viene copiato nulla.

Prossime fasi (già previste nella navigazione, ma nascoste): **Regole**, **Esercizi**, **Quaderno**,
riconoscimento del testo dei PDF scansionati.

## Per chi sviluppa

```bash
npm install
npm start        # prepara dist/ e la apre su http://localhost:8080
```

- `src/` contiene l'app (HTML, CSS, JavaScript senza framework); `scripts/build.mjs` copia le librerie in `dist/vendor/`.
- `npm run icons` rigenera le icone PNG di entrambe le app, `docs/logo.png` e `docs/logo-latino.png` dagli SVG (richiede Playwright).
- `npm test` prepara `dist/` e prova le due app nel browser (anche offline), imitando l'indirizzo di GitHub Pages,
  e verifica il motore morfologico di aMICOLatino su centinaia di forme.
- Il testo del PDF e l'audio sono salvati in IndexedDB; le impostazioni in `localStorage`.
- Il testo da leggere viene inviato soltanto ad Azure Speech; non c'è nessun altro server.

---

© 2026 Anna Lisa Ferrara. Tutti i diritti riservati.
aMICOL™, aMICOLettore™ e aMICOLatino™ sono marchi di Anna Lisa Ferrara.
