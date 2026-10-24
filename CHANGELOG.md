# Changelog

Tutte le modifiche rilevanti di StudICI. Il testo della sezione di ogni versione viene
pubblicato automaticamente come note della **GitHub Release** (vedi `.github/workflows/build-ipa.yml`).

> **Regola di rilascio:** a ogni nuova versione aggiungere qui una sezione `## 1.x.y` _prima_ del push.

## 1.9.2

### Sezione Viaggio & Orari Programmati
- **Modalità Programmata per Giorni Precedenti e Successivi**:
  - Quando si consulta un giorno diverso da quello odierno (giorni precedenti o successivi), la sezione Viaggio mostra ora l'orario ufficiale programmato pulito (`departureTimePlanned` e `arrivalTimePlanned`).
  - Rimossi i calcoli di ritardo live e i controlli sull'ora attuale di oggi (`currentNowM >= depPlanM`) per i giorni non odierni, evitando orari barrati o sfasati di ore.
  - La pill di stato mostra chiaramente **"Programmato"** con icona calendario e binario previsto da tabellone, senza falsi allarmi o badge di convoglio fermo.

### Icona dell'App
- **Sfondo Rosso Sapienza & Colonna Verticale Bianca Risaltata**:
  - Ripristinato lo sfondo dell'icona in Rosso Sapienza (`#822433` -> `#4c0519`) con profondità radiale.
  - La colonna verticale centrale ("I") è ora in bianco puro brillante (`#ffffff`, spessore 7.5) perfettamente nitida e visibile.
  - Spirale multi-tono argentata con accenti caldi e cuspide di Sant'Ivo in oro brillante (`#fbbf24`), perfettamente centrata a livello sub-pixel.

## 1.9.1

### Icona & Grafica Vettoriale
- **Icona App con Stile Primo Avvio & Centratura Geometrica**:
  - L'icona dell'app adotta ora la variante cromatica completa della schermata di primo avvio: sfondo scuro OLED (`#0d0e12`) con halo glow radiale rosso Sapienza, spirale con gradiente cremisi-argento, colonna verticale cremisi, cuspide in oro vivo e accento argentato.
  - Calcolata la centratura geometrica sub-pixel perfetta (margini superiore/inferiore e sinistro/destro esattamente identici).
- **Rimozione Completa Logo Vecchio in Verifica Orari**:
  - Nella schermata di verifica orari all'avvio (`StartupCheckScreen`), rimosso ogni riferimento al vecchio logo raster sostituendolo con la variante SVG vettoriale e halo glow coordinato identica a quella del primo avvio.

## 1.9.0

### Icona & Grafica Vettoriale
- **Nuova Icona dell'App Vettoriale SVG**:
  - Logo ufficiale in pura grafica vettoriale SVG impostato come icona dell'applicazione (1024x1024 full-bleed per iOS e Store, icone adattive Android 512x512 con livelli foreground/background e icona monocromatica per Material You).
- **Logo Originale all'Avvio Normale**:
  - Nella schermata di verifica orari all'avvio (`StartupCheckScreen`), ripristinato il logo badge originale con lo sfondo rosso Sapienza iconico e bordo sottile.

### Interfaccia Utente & Uniformazione Sfondi
- **Uniformazione Sfondo Schermate e Modali**:
  - Sfondo dark profondo calibrato `#0d0e12` (tramite costanti `UNIFORM_SCREEN_BG` e `UNIFORM_MODAL_BG`) esteso su tutte le schermate dell'app, inclusa la schermata Viaggio, le schermate di configurazione e personalizzazione corso, e tutti i modali per un'esperienza visiva coerente.
- **Configurazione Viaggio & Onboarding**:
  - Layout unificato tra schermata di avvio e modale viaggio: pill rapide (5, 10, 15, 20 min) per anticipo in aula e margine di sicurezza con icona orologio.
  - Selettore di precisione (+/-) centrato sotto la riga dei pulsanti rapidi con icona orologio integrata nel badge centrale.
  - Aumentato lo spazio inferiore nel modale configurazione viaggio per evitare tagli visivi sui pulsanti rapidi.
  - Pulsante Callstack nativo Liquid Glass "Configura più tardi" affiancato al tasto Salva nella schermata di avvio.
  - Tasto "Salva" nel modale Specifiche riposizionato nella barra superiore nativa iOS (`headerRight`).
  - Corretta la navigazione nativa con `usePreventRemove` per prevenire rimozioni dello stack desincronizzate.

### Profilo & Colori Materie
- **Colori Materie Deterministici**:
  - Algoritmo di hashing deterministico del nome materia per garantire che ogni materia mantenga esattamente lo stesso colore ad ogni avvio dell'app.
- **Badge Accademici Glowing**:
  - Badge glowing per Tipologia di Corso (Laurea Triennale/Magistrale) e pill della Classe di Laurea (es. L-9R) con colori e ombreggiature coordinati al tema.

## 1.8.9

### Interfaccia & Modali iOS
- **Schermata di Avvio & Verifica Orari**:
  - Logo statico pulito senza animazioni invasive.
  - Nuovo loader Dynamic Island in stile Liquid Glass con capsula fluttuante, feedback di stato real-time e transizioni morbide iOS.
- **Pulsanti Nativi Callstack Liquid Glass**:
  - Implementazione dei pulsanti nativi in basso ("Salva" e "Configura") con `@callstack/liquid-glass` per le build native iOS (IPA), mantenendo pieno supporto su iOS pre-26 e fallback fluido su Expo Go.
- **Profilo & Ricerca Corsi**:
  - Colore del testo dei pulsanti di sincronizzazione nel Profilo impostato su bianco per massimo contrasto.
  - Searchbar di scelta corso riposizionata in alto nella schermata per immediata accessibilità.
  - Schermata di configurazione/sincronizzazione all'avvio uniformata al tema dell'app.
  - Aumentato il padding inferiore nel modale Impostazioni Viaggio per raggiungere comodamente i pulsanti buffer minuti.

### Sincronizzazione Cloud & Dispositivi
- **Ripristino Dispositivo**:
  - Alla reimpostazione dell'app, il dispositivo viene dissociato da tutti gli altri, il vecchio documento cloud viene rimosso da Firebase e viene generato un nuovo codice univoco garantito.
- **Ereditarietà Immediata Orari e Lezioni**:
  - Al primo collegamento tra due dispositivi, il nuovo dispositivo eredita istantaneamente la cache completa degli orari e delle aule già calcolata dal master senza dover riscaricare nulla da rete.
- **Gestione Popup Pulita**:
  - Rimossi i popup di successo per l'associazione dispositivi e per la copia del codice, mostrati esclusivamente in caso di errore.

### Parsing Orari & Dati
- **Colori Materie Settimanali**:
  - Assegnazione deterministica del colore a ogni materia, mantenendolo identico e fisso per tutti i giorni della settimana.
- **Fix Estrazione Nomi Professori**:
  - Risolto il bug che su iPad causava l'errata interpretazione di stringhe come "di calcolo numerico" come nome del docente, con guardrail e istruzioni Gemini per mantenere intatto il titolo della materia.

## 1.8.8

### Viaggio Pendolare & Traffico

- **Integrazione del ritardo traffico nell'itinerario e nelle tappe**:
  - L'orario di partenza da casa e la durata stimata della tratta in auto tengono conto del ritardo dovuto a traffico, viabilità o rallentamenti indicato nelle impostazioni del viaggio.
  - La tappa del viaggio in auto riporta la durata complessiva effettiva e l'eventuale indicazione dei minuti di traffico previsti.

### Interfaccia e Sincronizzazione Cloud

- **Nuova scheda di Sincronizzazione Cloud**:
  - Box unificato con codice dispositivo compatto, switch rapido per la sincronizzazione automatica e pulsanti affiancati con stile glow coerente al tema attivo.
- **Pulsanti di ritorno nei modali**:
  - Sostituita la classica "X" con un pulsante circolare `<` (chevron) in alto a sinistra in stile nativo iOS.
- **Rifiniture grafiche nel Profilo**:
  - Titoli delle sezioni con peso del testo bilanciato (`500`) per una gerarchia visiva più pulita.
  - Divisori interni centrati orizzontalmente ed eliminato lo spazio vuoto in eccesso a fondo pagina.
- **Esportazione PDF**:
  - Risolto il problema che causava la ripetizione della parola "Aula" nei dettagli delle lezioni esportate.

## 1.8.7

> **[Aggiornamento Obbligatorio / Bloccante]**
> Questa versione introduce il controllo cumulativo sulle release intermedie saltate e il nuovo posizionamento della schermata di blocco ottimizzato per iPhone con Dynamic Island.

### Sistema di Aggiornamento Cumulativo & Dynamic Island

- **Ereditarietà degli Aggiornamenti Bloccanti Saltati (`updateChecker.ts`)**:
  - Se viene rilasciato un aggiornamento bloccante seguito da uno o più aggiornamenti non bloccanti, e l'utente non ha ancora installato l'aggiornamento bloccante intermedio, l'ultimo aggiornamento disponibile viene ora automaticamente riconosciuto e applicato come **bloccante obbligatorio** (`isMajor: true`).
  - L'app analizza l'intera cronologia delle release GitHub comprese tra la versione installata (`currentVersion`) e l'ultima versione rilasciata (`latestVersion`).
- **Layout Schermata di Blocco Ottimizzato per Dynamic Island (`index.tsx`)**:
  - Abbassati gli elementi superiori della schermata di aggiornamento obbligatorio con spaziatura sicura dedicata alla **Dynamic Island** di iPhone e applicato l'effetto bagliore neon dinamico anche alla pill `AGGIORNAMENTO BLOCCANTE`.

## 1.8.6

### Monitoraggio Treni Live & Partenza Stimata

- **Badge "Fermo a [Stazione]" Basato sulla Partenza Stimata (`trenitaliaApi.ts`, `viaggio.tsx`)**:
  - Il **ritardo** (`+X min` e orario barrato) segue sempre fedelmente l'orario di partenza **programmato** (`departureTimePlanned`).
  - La **partenza stimata** (`stoppedStationEstimatedDep`) viene calcolata tenendo conto del ritardo accumulato e dell'arrivo reale al binario sommato al tempo minimo tecnico di sosta in banchina (`partenza_teorica - arrivo_teorico`, min 1 minuto).
  - Il badge **"Fermo a [Stazione]"** compare ora esclusivamente quando l'orario attuale supera la **partenza stimata** e il treno non è ancora ripartito.

### Stile Pill & Bagliore Neon nella Configurazione Corso e Canale

- **Effetto Glow sulle Pill di Configurazione (`DefaultTabPicker.tsx`, `OnboardingCourseSelector.tsx`, `CourseDownloadView.tsx`, `settings.tsx`)**:
  - Esteso l'effetto bagliore neon dinamico (`shadowColor: theme.primary`, `backgroundColor: theme.bg`, `borderColor: theme.primary`) alle pillole di selezione di **Anno di Corso**, **Canale / Suddivisione**, **Modalità di Avvio** e badge dei corsi, sia durante il **primo avvio** che cambiando corso/canale dal **Profilo**.

## 1.8.5

> **[Aggiornamento Obbligatorio / Bloccante]**
> Questa versione introduce la nuova architettura parallela e multi-modello per il download e la normalizzazione AI degli orari e richiede l'aggiornamento dell'applicazione per continuare.

### Performance & Motore AI Gemini Ultra-Veloce

- **Elaborazione Parallela Completa dei Canali (`scraper.ts`)**:
  - Sostituito il ciclo sequenziale sui canali del corso con l'elaborazione parallela simultanea di tutti i tab e l'esecuzione concorrente di `parseScheduleCells` e `parseHeaderWithGemini` all'interno di ciascun canale, mantenendo intatta al 100% la struttura di scraping, pulizia celle invisibili e risoluzione aule.
- **Load-Balancing Multi-Modello & Zero Errori Gemini (`aiParser.ts`)**:
  - Introdotto un pool bilanciato di modelli Flash-Lite/Flash (`gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`) con semaforo di concorrenza e failover istantaneo (`80ms`), eliminando colli di bottiglia ed errori `429` / `503`.
  - Suddivisione automatica delle celle non in cache in micro-batch paralleli da 12 celle per dimezzare i token di output generati per singola richiesta e ridurre drasticamente la latenza.
- **Deduplicazione In-Flight & Lettura/Scrittura Batch (`multiGet` / `multiSet`)**:
  - Aggiunte mappe di deduplicazione sincronizzate (`inFlightCellPromises`, `inFlightHeaderPromises`) e cache in RAM a `0ms`: le intestazioni e le celle condivise tra canali diversi dello stesso corso vengono analizzate una sola volta.
  - Sostituite le letture sequenziali `AsyncStorage.getItem` con letture e scritture batch (`multiGet` / `multiSet`).

## 1.8.4

> **[Aggiornamento Obbligatorio / Bloccante]**
> Questa versione introduce la schermata bloccante fissa, il nuovo sistema cromatico dinamico e richiede l'aggiornamento dell'applicazione per continuare.

### Personalizzazione & Temi Dinamici

- **Pillole e Bagliori Neon 100% Coordinati al Tema Attivo**:
  - Risolto il problema per cui i colori interni e i bagliori neon delle pillole (giorni della settimana in Orario, selettori di Anno e Canale, capsule dei giorni in Viaggio) rimanevano vincolati al rosso anche impostando un tema cromatico differente.
  - Sfondo semitrasparente (`theme.bg`), bordo (`theme.primary`) ed effetto bagliore neon (`shadowColor: theme.primary`) si aggiornano ora istantaneamente in base al tema scelto (Rosso Sapienza, Blu Notte, Verde Smeraldo, Viola Reale o Arancio Caldo).
  - Anche il badge **Weekend** e la pillola del fine settimana ora adottano i colori e il bagliore dell'accento cromatico del tema (`theme.accent` / `theme.light` / `theme.subtle`).

### Monitoraggio Viaggio & Trasparenza Dati

- **Etichetta "Fonte: Trenitalia" nella Hero Card**:
  - Sostituita la dicitura "Dati Trenitalia" con **"Fonte: Trenitalia"** nella hero card della vista Viaggio.
  - L'intero badge (punto di stato, testo, bordo e sfondo trasparente) riflette ora con precisione il tema cromatico dell'applicazione anziché rimanere con colori fissi.

### Gestione Aggiornamenti & Modal Bloccante

- **Schermata Fissa Senza Scroll & Nuova Visualizzazione Compatta**:
  - Eliminato il popup alert "Aggiornamento Obbligatorio" in favore della sola schermata modale a tutto schermo.
  - Rimossa la sezione di anteprima delle note per evitare qualsiasi scorrimento: la schermata è ora completamente statica e fissa.
  - Aggiunta la data di rilascio, il riferimento commit/tag e il pulsante per consultare il Changelog completo su GitHub.
  - Rinominato il pulsante di download principale in "Aggiorna".

## 1.8.3

### Interfaccia Utente & Design System Sapienza

- **Glow Neon Rosso e Stile Pillole Coordinato**:
  - Esteso l'effetto neon glow rosso Sapienza (`SAPIENZA_RED`) ai selettori dei giorni della settimana nella vista Orario e ai selettori di anno e canale (`YearChannelSelector`).
  - Uniformata la struttura delle pillole attive con bordino rosso e interno semitrasparente (`rgba(130, 36, 51, 0.40)`), garantendo coerenza estetica tra le schermate Orario e Viaggio.
- **Interfaccia Orario Più Pulita**:
  - Rimosso il box "Itinerario Pendolari" dalla vista dell'orario giornaliero, rendendo l'elenco lezioni più lineare e focalizzato.

### Gestione Aggiornamenti

- **Sistema di Notifica Differenziato (Major vs Minor/Fix)**:
  - Introdotta la classificazione automatica degli aggiornamenti in **Major** (breaking / obbligatori) e **Minor / Fix** (facoltativi).
  - **Major Update Bloccante**: in presenza di una nuova release contrassegnata come major, l'app presenta un **modal nativo iOS a schermo intero bloccante** (con sfocatura dinamica `BlurView`, visualizzazione delle note di rilascio e unico pulsante "Aggiorna Ora su GitHub"), impedendo l'uso di versioni obsolete non compatibili.
  - Per patch e fix minori rimane attivo il consueto avviso con opzione di posticipare ("Più tardi").

## 1.8.2

### Risoluzioni & Precisione Monitoraggio Ferroviario

- **Doppio Badge di Stato per Treni Fermi in Ritardo**:
  - Quando un convoglio è fermo in stazione e accumula ritardo sulla partenza prevista, vengono ora mostrati entrambi i badge chiaramente separati:
    1. Il badge di sosta in stazione con il tempo effettivo in banchina (es. `Fermo a Orte (da 2m)`).
    2. Il nuovo badge dedicato al ritardo di partenza (es. `+10 min` in giallo/arancione o rosso se superiore a 5 minuti).
- **Risolto Binario 0 & Visualizzazione Binario di Partenza Corretto**:
  - Corretto il parsing dei binari di ViaggiaTreno: il codice `0` restituito da Trenitalia per binari non ancora assegnati non viene più scambiato per un numero di binario reale ("Binario 0").
  - Nel box "BINARIO" della card di viaggio viene ora estratto e visualizzato il binario effettivo/programmato della **stazione di partenza del pendolare** (es. Binario 3 a Orte per RV 4155), anziché il binario della stazione di arrivo.
- **Correzione Evidenziazione Orario di Arrivo in Orario o in Anticipo**:
  - Risolto il bug per cui l'orario di arrivo a destinazione (es. 17:46) veniva colorato in giallo/arancione anche quando il convoglio viaggiava in perfetto orario o in anticipo.
  - L'evidenziazione in giallo e l'orario programmato barrato scattano unicamente se l'orario effettivo di arrivo è posteriore a quello previsto (`orario_effettivo > orario_programmato`).

## 1.8.1

### Risoluzioni & Precisione Monitoraggio Ferroviario

- **Timer Treno Fermo in Stazione Basato sul Tempo Effettivo in Banchina**:
  - Il badge `Fermo a [Stazione]` ora indica esattamente da quanti minuti il convoglio è effettivamente fermo al binario (es. `Fermo a Orte (da 2m)`), calcolato rispetto al momento di arrivo reale (`arrivoReale`) comunicato dai sensori di banchina di Trenitalia.
  - Risolto il conteggio fittizio che mostrava il ritardo cumulativo della corsa anziché il tempo effettivo di sosta del treno alla stazione di partenza o intermedia.
  - L'eventuale ritardo di partenza continua a essere calcolato con precisione sull'orario di partenza effettivo e programmato.

### Esperienza Utente & Notifiche Aggiornamenti

- **Popup Aggiornamento Automatico con Link Diretto a GitHub Releases**:
  - Quando è disponibile una nuova versione su GitHub, all'avvio dell'app compare un avviso chiaro che indirizza direttamente alla pagina di rilascio GitHub (`/releases/latest`) con il file `.ipa` pronto al download.
  - Chi ha già configurato la sorgente in SideStore o AltStore continuerà ad aggiornare automaticamente dall'elenco app con un solo tap.
  - Semplificata la scheda Impostazioni: rimosse le sezioni manuali non necessarie per SideStore e LiveContainer, mantenendo una gestione degli aggiornamenti pulita e lineare.

## 1.8.0

### Risoluzioni & Precisione Monitoraggio Ferroviario

- **Gestione Corretta Treni Fermi in Stazione Prima vs Dopo l'Orario Previsto**:
  - Risolto il problema per cui un treno già giunto alla stazione di partenza prima dell'orario (es. RV 4153 arrivato a Orte alle 12:13 con partenza programmata alle 12:16) appariva erroneamente colorato in giallo con badge "Fermo a Orte".
  - Fintanto che l'orario attuale è precedente o uguale a quello programmato di partenza (`now <= orario_partenza`), il treno fermo al binario è classificato come **perfettamente in orario** (testo orario regolare, badge verde "In orario", nessun testo barrato e chip alternativi senza stato "Fermo").
  - L'evidenziazione in giallo/arancione, l'orario programmato barrato sotto e il badge "Fermo a [Stazione] (+X min)" scattano **esclusivamente se l'orario di partenza programmato è stato superato** e il convoglio si trova ancora fermo al binario, calcolando minuto per minuto il ritardo nascente.

## 1.7.9

### Risoluzioni & Precisione Monitoraggio Ferroviario

- **Tracciamento Reale Stazione di Partenza vs Arrivo**:
  - Risolto il problema per cui nei viaggi di andata comparivano treni "passati" o con orari riferiti alla stazione di arrivo (Roma Tiburtina) invece di quella di partenza effettiva (es. Orte).
  - Eliminato completamente il recupero cieco di convogli dal tabellone arrivi: ora qualsiasi treno regionale mostrato viene verificato con certezza assoluta (tramite orario di linea, origine corsa o analisi del percorso `andamentoTreno`).
  - Convogli di altre direttrici (es. FL1 da Fiumicino, FL2 da Tivoli, FL3 da Viterbo) che arrivano a Roma Tiburtina senza fermare a Orte o alla stazione scelta non vengono mai più inseriti erroneamente tra i treni dell'itinerario.
- **Supporto Universale per Qualsiasi Tratta Configurata**:
  - La verifica di fermata, ordine delle tappe (`progressivo_partenza < progressivo_arrivo`), orario programmato ed effettivo di passaggio e stato "Già passato" si applica ora in modo dinamico a **qualunque coppia di stazioni** scelta dall'utente nelle Impostazioni.
  - Orario effettivo e ritardo alla partenza sono calcolati direttamente sulla banchina della stazione di partenza del pendolare, mentre il ritardo cumulativo verso la destinazione viene evidenziato in giallo/arancione solo sull'orario di arrivo.
- **Finestra Alternativi Pulita**:
  - Nei chip rapidi di selezione treno viene mostrato al massimo 1 treno passato precedente a quello selezionato, evitando liste sature di treni storici a fine giornata.

## 1.7.8

### Novità & Funzionalità

- **Notifiche Aggiornamenti GitHub In-App**:
  - Implementato modulo di verifica automatica delle release GitHub (`updateChecker.ts`).
  - Quando è disponibile una nuova release su GitHub superiore alla versione installata, viene mostrato un banner nativo ad alto risalto nella schermata principale dell'orario con l'avviso e il tasto `UPDATE`.
  - Toccando il banner o la sezione Impostazioni si apre un ActionSheet iOS completo con scorciatoie di installazione rapida.
- **Integrazione SideStore, AltStore & LiveContainer**:
  - Creata la sorgente repository ufficiale per SideStore e AltStore (`apps.json`), che consente di aggiungere la repo con un solo tap tramite lo schema URL `sidestore://source?url=...` o `altstore://source?url=...` per aggiornamenti automatici senza computer.
  - Aggiunto supporto per installazione diretta con LiveContainer tramite URL scheme `livecontainer://install?url=...`.
  - Nella schermata Impostazioni è ora presente la sezione dedicata **"AGGIORNAMENTI & SIDELOADING"** con controllo manuale release, aggiunta sorgente SideStore e installazione con LiveContainer in un tocco.
- **Ripristino Badge Minutaggio Tappe Viaggio**:
  - Ripristinato e garantito il badge del minutaggio di percorrenza in alto a destra su tutte le card delle tappe del viaggio (`formatDuration(durationMinutes)`), offrendo sempre a colpo d'occhio la durata di ogni singolo step (treno, auto, mezzi, attese).

## 1.7.7

### Novità & Rifiniture UI / UX

- **Card Tappe Viaggio Semplificate & Pulite**:
  - **Treno e Arrivo Destinazione**: rimosse le etichette con minutaggio e le note ridondanti; le card mostrano con massima chiarezza unicamente il titolo e il sottotitolo grigio descrittivo della tratta.
  - **Icona Traguardo**: sostituita l'icona del tocco accademico (`school`) con l'icona della destinazione raggiunta (`flag`) sia nella hero card che nel nodo di arrivo della timeline.
  - **Card Mezzi Urbani & Pullman**:
    - Titolo dinamico calcolato in base all'aula target e alla stazione (`transitSolution.lineName`).
    - Rimosso il minutaggio dalla card e dal sottotitolo per un look minimale.
    - Il pulsante d'azione diventa **"Cerca mezzi su Google Maps"**.
    - Toccando la card o il banner si apre un **ActionSheet nativo iOS** (con fallback Alert su Android) che consente di scegliere se avviare la ricerca **"Dalla posizione attuale (GPS)"** oppure direttamente **"Dalla Stazione di [Nome]"** / sede prestabilita.
- **Riformattazione Universale delle Durate**:
  - Introdotto `formatDuration`: qualsiasi durata temporale (es. `260m`) viene convertita automaticamente nel formato ore e minuti (es. `4h 20m`), sia nella hero card che nelle tappe di viaggio.
- **Armonizzazione Colori e Bagliore Neon 360° nel Selettore Giorni**:
  - Allineati i colori delle capsule del selettore giorni ai pill della schermata Orario (`#1c1c1e` con bordo `#2c2c2e` a riposo, `rgba(130, 36, 51, 0.45)` con bordo primario `#822433` e testo bianco quando attivo).
  - Risolto il ritaglio del bagliore neon: aumentato il padding verticale e sbloccato l'overflow dello scroll con ombra simmetrica (`shadowOffset: { width: 0, height: 0 }`), diffondendo l'effetto bagliore in tutte le direzioni senza tagli netti.
  - Rimosso il testo data esteso sotto il selettore andata/ritorno, preservando elegantemente il badge `Weekend` e il tasto `Oggi`.
- **Layout Box Lezioni Uniformato**:
  - Rimossa l'indentazione eccessiva del box lezioni/fine settimana per pareggiare perfettamente la larghezza di tutte le card della schermata Viaggio, garantendo il wrapping del testo per prevenire qualsiasi fuoriuscita dallo schermo.
- **Eliminazione Footer Riassuntivo Ridondante**:
  - Rimosso il box riepilogativo in fondo alla schermata per snellire la navigazione.

## 1.7.6

### Novità & UI / UX

- **Nuovo Selettore Giorni a Nastro Orizzontale in Stile iOS (Capsule Ribbon)**:
  - Rimosse le frecce laterali rigide che causavano l'overflow dello schermo con 7 giorni attivi.
  - Introdotto un carousel orizzontale a capsule fluide ispirato al design nativo di **Apple Calendar & Apple Fitness**:
    - Ogni giorno è una capsula verticale (`LUN`, `MAR`, `MER`, `GIO`, `VEN`, `SAB`, `DOM`) che include sia l'abbreviazione del giorno che il **numero effettivo del giorno del mese** (`12`, `13`, `14`...).
    - **Sottotitolo dinamico data**: sopra il nastro viene mostrata la data completa in italiano (es. `Oggi • Sabato, 17 Ottobre` o `Domenica, 18 Ottobre`) con badge contestuale per il `Weekend`.
    - **Tasto rapido "Oggi"**: toccando qualsiasi altro giorno della settimana appare un tasto in vetro satinato per ritornare istantaneamente alla giornata odierna in un tocco.
    - **Centraggio automatico e feedback visivo**: scorrimento fluido con decelerazione rapida; la capsula selezionata viene automaticamente portata al centro dello schermo con illuminazione ad accento Sapienza Red e ombra sfumata iOS.

## 1.7.5

### Novità & Miglioramenti

- **Supporto Orari Treni nel Fine Settimana (Sabato & Domenica)**:
  - Esteso il selettore dei giorni nella schermata Viaggio per includere l'intera settimana: `LUN`, `MAR`, `MER`, `GIO`, `VEN`, `SAB`, `DOM`.
  - **Modalità Stazione-Stazione senza lezioni**: nel fine settimana i viaggi non vengono forzatamente agganciati alle lezioni universitarie (non previste), ma calcolano e monitorano direttamente le partenze e gli arrivi tra le stazioni di riferimento del pendolare (es. Orte <-> Roma Tiburtina/Termini).
  - La card delle lezioni mostra chiaramente `FINE SETTIMANA • Monitoraggio treni stazione-stazione` senza falsi messaggi di errore o card vuote, ancorando la ricerca treni all'orario attuale se consultata nel weekend o all'orario diurno per i giorni a venire.
- **Recupero Universale dei Treni in Arrivo**:
  - Implementata la scansione universale di tutti i treni regionali (`REG` / `RV`) presenti nella mappa degli arrivi della stazione di destinazione, garantendo che qualsiasi treno non ancora presente nelle partenze istantanee venga rintracciato e monitorato live su tutta la linea pendolare.

## 1.7.4

### Correzioni & Miglioramenti

- **Tracciamento Treni Serali (es. RV 4161) & Risoluzione Fine Giornata**:
  - **Aggiunta del treno serale RV 4161 (23:00 Orte -> 23:34 Tiburtina -> 23:48 Termini)** alla tabella ufficiale programmata e supporto per il codice stazione di Roma Tiburtina (`S08217`) nella procedura di recupero arrivi.
  - **Tracciamento continuativo fino all'arrivo**: i treni appena arrivati o in transito restano visibili e tracciabili nella schermata Viaggio fino a 60 minuti dopo l'arrivo (evitando la sparizione immediata al momento del tocco banchina).
  - **Gestione fine giornata**: a fine servizio, quando non vi sono più corse in partenza per la giornata, l'app mostra solo gli ultimi 2-3 treni serali passati con indicatore `(Passato)`, senza ricaricare erroneamente i treni del mattino dalle 05:00 né mostrarli come non partiti.
  - **Risolto falso ritardo di 1 min**: corretta l'anomalia di arrotondamento di Trenitalia quando l'orario effettivo di partenza coincide al minuto con quello programmato (es. partenza alle 23:00 con 30s registrata da ViaggiaTreno come +1m), azzerando il ritardo locale per treni effettivamente in orario.

## 1.7.3

### Correzioni & Miglioramenti

- **Separazione Ritardo alla Partenza vs Ritardo all'Arrivo per Treni Già Passati**:
  - Risolto il caso in cui un treno già passato dalla stazione del pendolare (es. partito in orario alle 23:00 da Orte) si vedeva erroneamente applicare il ritardo accumulato a valle lungo la linea (es. tra Orte e Roma) anche all'orario di partenza:
    - **Orario di partenza effettivo preservato**: l'orario di partenza riflette fedelmente il passaggio reale registrato alla propria stazione (es. `23:00`). Se il treno è partito in orario, l'orario di partenza rimane pulito nel colore di default del tema e senza orario barrato, perché il passaggio è avvenuto come previsto.
    - **Ritardo a valle applicato solo all'arrivo**: l'eventuale ritardo maturato successivamente dal convoglio in corsa viene riflesso esclusivamente sull'orario di arrivo a destinazione (evidenziato in arancione, con l'orario di arrivo programmato barrato `prog. HH:mm`).
    - Introdotto il campo `departureDelayAtStation` per distinguere con precisione il ritardo al momento dello stacco da banchina rispetto al ritardo globale della corsa.

## 1.7.2

### Correzioni & Miglioramenti

- **Orario Programmato Barrato per Treni Fermi & Propagazione Ritardo Tratta**:
  - Risolta l'assenza dell'orario programmato barrato quando un treno è fermo al binario o accumula ritardo lungo il tragitto:
    - **Treno fermo a monte (es. a Terni in direzione Orte)**: il ritardo maturato nella sosta prolungata viene ora propagato istantaneamente sia alla partenza prevista nella stazione del pendolare (es. Orte) che all'arrivo alla destinazione finale. L'orario effettivo stimato appare evidenziato in arancione e sotto viene sempre mostrato l'orario programmato barrato (`prog. HH:mm`).
    - **Treno fermo alla propria stazione di salita (es. a Orte o Tiburtina)**: quando il convoglio è al binario in attesa di partire oltre l'orario previsto ("non si sa quando parte"), il ritardo viene monitorato dinamicamente minuto per minuto; l'orario programmato viene barrato e sostituito dalla stima in tempo reale con badge `Fermo a [Stazione] (+Xm)`.
    - Sincronizzazione automatica degli orari effettivi (`departureTimeActual` e `arrivalTimeActual`) con il ritardo live in tutto il motore orari pendolare.

## 1.7.1

### Novità & Correzioni

- **Gestione Treni Fermi in Stazione ("Fermo a [Stazione]")**:
  - Risolto il caso in cui un treno fermo al binario in una stazione intermedia (es. Roma Tiburtina) veniva erroneamente etichettato come `Già passato` solo perché l'orario programmato di partenza era trascorso:
    - Se il convoglio è arrivato alla stazione ma non è ancora partito (`inStazione: true` e nessuna partenza reale registrata), lo stato mostra esplicitamente `Fermo a [Nome Stazione]` (es. `Fermo a Roma Tiburtina (+6m)`).
    - Il ritardo alla partenza viene calcolato dinamicamente minuto per minuto rispetto all'orario effettivo di sosta al binario.
    - Il treno rimane correttamente contrassegnato come prendibile nell'algoritmo di viaggio, evitando che la selezione salti prematuramente al treno successivo mentre il viaggiatore è a bordo o in banchina.
    - Nelle chips dei treni alternativi appare l'indicatore `(Fermo)` con icona dedicata.
  - Arricchimento in tempo reale con i dati di rilevamento delle fermate di ViaggiaTreno (`andamentoTreno`), permettendo di identificare con esattezza le soste prolungate su tutte le stazioni della linea.

## 1.7.0

### Correzioni & Miglioramenti

- **Recupero Treni Già Passati in Viaggio (Es. RV 4153)**:
  - Risolta la scomparsa dei treni già partiti dalla propria stazione di riferimento (es. Orte) ma non ancora giunti al capolinea di destinazione (es. Roma Termini). ViaggiaTreno rimuove i treni dall'endpoint `/partenze` poco dopo la partenza; ora il sistema effettua un pass di riconciliazione con l'endpoint `/arrivi` della stazione di destinazione.
  - I treni in transito vengono mantenuti in elenco con lo stato `Già passato` (o `Già passato (+Xm)` in caso di ritardo), consentendo di consultarli premendo "Treno prima" o selezionando la chip con l'etichetta `(Passato)` fino all'effettivo arrivo a termine corsa.
  - L'algoritmo di raccomandazione continua a suggerire in automatico il prossimo treno utile prendibile.

## 1.6.14

### Novità & Miglioramenti

- **Header Viaggio Semplificato**: rimosso il pallino verde e la dicitura `• Auto 60s` sotto il titolo "Viaggio", mostrando un'etichetta pulita e minimale `Aggiornato HH:mm:ss`.
- **Impostazioni Pendolare**: eliminato l'esempio restrittivo `(es. da Amelia a Orte FS)` nella descrizione della sezione tragitto in auto.
- **Pulsante GitHub nel Profilo**: introdotto a fondo pagina nella schermata Profilo un pulsante circolare con icona di GitHub (`logo-github`) per accedere con un tocco al repository del progetto.

## 1.6.13

### Correzioni & Miglioramenti

- **Risoluzione Logica Treni Passanti ("Già passato" solo a passaggio avvenuto)**:
  - Corretta la logica di transito per i treni con origine remota (es. convogli provenienti da Ancona o Perugia diretti a Roma via Orte): il treno non viene più etichettato come già partito non appena lascia la stazione di origine.
  - Finché il convoglio è in viaggio e non ha ancora raggiunto la stazione di imbarco del pendolare (es. Orte), lo stato riporta fedelmente la marcia in avvicinamento (`+Xm ritardo`, `Anticipo (Xm)` o `In orario`) e il treno rimane correttamente valutato e selezionabile dall'algoritmo.
  - Sostituita la dicitura `Già partito` con `Già passato` (es. `Già passato` o `Già passato (+Xm)`), che scatta esclusivamente dopo che il treno ha realmente superato l'orario effettivo di transito per la stazione del pendolare.
  - Aggiornata l'etichetta nelle chips dei treni alternativi in `(Passato)`.

## 1.6.12

### Correzioni & Miglioramenti

- **Risoluzione Nomi Stazione di Origine Remota (No Codici S0...)**:
  - Risolto il problema per cui l'origine dei treni passanti mostrava il codice tecnico ViaggiaTreno (es. _S07004_ anziché _Perugia_).
  - L'origine corsa ora estrae prioritariamente il nome testuale certificato da ViaggiaTreno (`arr.origine` dall'elenco arrivi della tratta, contenente il nome della stazione in lettere, es. _Perugia_, _Ancona_, _Foligno_).
  - Espanso il dizionario delle stazioni regionali con tutti i codici delle direttrici Orte-Roma, Orte-Falconara/Ancona, Orte-Terontola/Firenze e Roma-Pescara/Napoli.
  - Implementato un filtro di sanitizzazione per bloccare categoricamente la visualizzazione di codici raw tipo `S0...`.
- **Uniformazione Icona Badge Origine Corsa**:
  - Uniformata l'icona del badge permanente "Origine corsa" all'icona a freccia di navigazione (`navigate-outline`), mantenendo la differenziazione cromatica (ciano per la propria stazione di partenza, ardesia per stazioni remote).

## 1.6.11

### Novità & Miglioramenti

- **Rework e Standardizzazione Completa dei Badge Treno**:
  - Unificato lo stato dei treni futuri e non avviati sotto l'etichetta `Non partito` con icona a orologio (`time-outline`), rimuovendo i vecchi testi frammentati `Programmato` e `Non ancora partito`.
  - Pulizia del badge `Già partito`: rimosso l'orario tra parentesi per mostrare in modo essenziale e pulito `Già partito` (se in orario) o `Già partito (+Xm)` (se in ritardo).
  - Badge anticipo semplificato: omessa la dicitura superflua `In orario • ` a favore del formato sintetico `Anticipo (Xm)`.
  - Badge in orario pulito: convertito `In viaggio • In orario` in `In orario`.
  - Badge partenza origine ritardata: per i treni fermi alla stazione di inizio corsa oltre l'orario previsto viene ora visualizzato `Non partito (+Xm)`.
- **Badge Permanente "Origine corsa • NOME STAZIONE"**:
  - Introdotto un nuovo badge permanente nella card del treno che specifica sempre la stazione di partenza del convoglio (es. _Origine corsa • Orte_, _Origine corsa • Ancona_).
  - Differenziazione cromatica dinamica: tonalità ciano/sky con icona bandiera se la stazione di origine coincide con la stazione di riferimento del pendolare, oppure tonalità ardesia/neutra per convogli passanti provenienti da altra origine remota.

## 1.6.10

### Correzioni

- **Risoluzione Anomalia Orari e Ritardo Treni Partiti dall'Origine**: corretto il parsing dei dati di partenza di ViaggiaTreno (`compOrarioPartenzaZeroEffettivo`, timestamp `partenzaTreno` e array `compInStazionePartenza`). Eliminato il falso calcolo incrementale `now - orarioProgrammato` che sovrascriveva il ritardo reale certificato da Trenitalia (+29m) con un ritardo fittizio (+43m) sui treni già partiti dall'origine.
- **Dicitura e Badge "In stazione" Ristretti ai Soli Casi Reali**: la dicitura `In stazione a ...` viene ora applicata esclusivamente ai convogli effettivamente non partiti (`nonPartito === true`) che attendono ancora al binario oltre l'orario programmato. Per tutti i treni partiti, l'app visualizza l'orario effettivo di partenza (es. `18:06`), il badge `Già partito` con il ritardo autentico e non altera gli orari delle tappe.

## 1.6.9

### Correzioni

- **Card Prossima Partenza con Lezione Reale**: rimosso il testo segnaposto generico "Lezioni di oggi" quando le lezioni della giornata sono terminate; la hero card visualizza ora con precisione il nome della lezione selezionata (es. _GEOMETRIA_) accompagnata dalla dicitura `Terminata • Treni da adesso`.
- **Visibilità Treni Precedenti Ancora in Viaggio**: ampliata la finestra di campionamento delle partenze (-90 min) e perfezionato il filtro N.D. per non scartare i convogli già transitati dalla stazione di origine ma tuttora in viaggio verso Roma; i treni precedenti restano consultabili e selezionabili tra i "treni prima" finché non giungono a destinazione.
- **Cambio Treno Immediato**: introdotto listener di sincronizzazione dello stato di selezione convoglio e lezione (`useEffect`), garantendo il ricalcolo istantaneo del viaggio sia da pulsanti "Treno prima / dopo" che dai chip numerati.
- **Robustezza Router Urbano**: protette le funzioni di mapping aula/campus da parametri indefiniti, azzerando possibili eccezioni a runtime sul cambio giorno.

## 1.6.8

### Correzioni

- **Cambio Treno Funzionante**: risolto il conflitto nella selezione dei treni alternativi sia da pulsanti "Treno prima" / "Treno dopo" che da chip numerati; aggiunto re-render immediato dell'itinerario a ogni cambio convoglio.
- **Treni Già Partiti ma Ancora in Viaggio**: mantenuti nell'elenco dei treni disponibili e selezionabili i convogli che hanno già lasciato la stazione del pendolare ma non sono ancora giunti a destinazione (contrassegnati con badge `Partito`), mentre il target consigliato automatico punta sempre con precisione sul primo treno ideale ancora prendibile.

## 1.6.7

### Correzioni

- **Connessione Trenitalia / ViaggiaTreno su IPA iOS Standalone**: configurata la direttiva `NSAppTransportSecurity` in `Info.plist` con `NSAllowsArbitraryLoads` ed eccezione di dominio per `viaggiatreno.it`, sbloccando le chiamate API di ViaggiaTreno bloccate in precedenza dalla sicurezza iOS nelle build native.
- **Ottimizzazione chiamate ViaggiaTreno**: richiesta diretta all'endpoint HTTP nativo per azzerare il redirect 301, dimezzare la latenza (~150ms) e garantire fallback automatico su HTTPS con header client standard.
- **Resilienza Orari Notturni e Cambio Giorni**: fallback elegante a corse giornaliere concluse a tarda sera e pulizia immediata dello stato itinerario quando si cambia giorno della settimana.

## 1.6.1

### Novità

- **Esportazione PDF dell'orario a calendario**: il file si chiama ora `Orario.pdf` e la griglia è organizzata per fasce orarie (righe) e giorni (colonne); ogni lezione (materia, docente, aula, senza emoji) occupa la fascia oraria corretta e le lezioni sovrapposte vengono affiancate. Rimossa la numerazione delle pagine.
- **Impostazioni Pendolare**: rimosso il pulsante _Ricalcola_, il tempo di guida si aggiorna sempre in automatico.

### Correzioni

- **Colore Tema (iOS nativo)**: la riga occupa tutta la larghezza con nome del tema e freccia allineati a destra (anche su iPad); il menu mostra un pallino con il colore del tema al posto delle emoji.
- **Card del treno in Viaggio**: rimosso il collegamento a ViaggiaTreno.
- **Orari**: il sottotitolo del banner Itinerario Pendolare è ora "Calcola tempi di trasporto".

## 1.6.0 (Major Update)

### Novità

- **Sincronizzazione Istantanea Profilo e Canale (Zero Latenza al Cambio Tab e Avvio)**:
  - Eliminato qualsiasi tempo di attesa o blocco di rete all'apertura del tab Profilo: corso di laurea, classe, canale predefinito, registro presenze, statistiche e parametri cloud vengono caricati immediatamente dalla cache locale (`AsyncStorage`) a latenza zero.
  - Le operazioni di rete (aggiornamento dispositivi accoppiati, lista completa dei corsi e sync cloud) avvengono in background in modo silente, senza bloccare l'interfaccia né ritardare l'avvio della schermata orari.
- **Riorganizzazione Visiva delle Card nella Sezione Viaggio**:
  - **Card delle Tappe**: sfondo grigio pulito e minimale (`#1c1c1e`), preservando fedelmente tutti i colori, avvisi ed evidenziazioni dei box traffico e rallentamenti stradali.
  - **Card del Treno Regionale (con "Treno prima" e "Treno dopo")**: sfondo grigio scuro (`#1c1c1e`) con bordo rifinito a tema (colore primario / rosso Sapienza con spessore 1.5).
  - **Hero Card Principale ("Parti alle...")**: mantiene lo sfondo sfumato a tema per massimo risalto dell'orario di partenza consigliato.
- **Integrazione App Trenitalia e Collegamento Diretto al Monitoraggio Treno**:
  - Dalla scheda principale del treno regionale (dove si trova il selettore per "Treno prima" e "Treno dopo"), un tocco apre direttamente l'applicazione ufficiale **Trenitalia** (`trenitalia://`) oppure reindirizza alla pagina ufficiale di monitoraggio e andamento treno di Trenitalia (`Infomobilita.html#gestisci-viaggio`), con il numero del convoglio copiato automaticamente negli appunti.
  - Rimossa l'interazione ridondante dalla card della tappa treno nella timeline, lasciando il controllo centralizzato nella card principale del treno.
- **Pulizia Card Mezzi e Tratte**:
  - Rimossa la dicitura _"Orari in tempo reale e fermate"_ dal banner di navigazione dei mezzi pubblici Google Maps.
  - Rimosso il sottotitolo ridondante _"Tocca per aprire la navigazione con orario impostato"_ dalle tratte in auto di andata e ritorno, lasciando una visualizzazione pulita con _"Naviga su Google Maps"_.
- **Personalizzazione Colore Tema dell'App nel Profilo (Compatto e Nativo)**:
  - Nuova riga **Colore Tema** elegante e non ingombrante nel tab Profilo:
    - Su **.IPA (iOS Standalone / Nativo)**: un tocco apre il menu a discesa nativo Apple (`UIMenu` / `MenuView`) con elenco dei temi e spunta su quello attivo, integrato al 100% con il design di sistema iOS.
    - Su **Expo Go / non-IPA**: la riga è compatta e al tocco si espande dinamicamente rivelando la griglia delle palette colori, richiudibile con un secondo tocco.
  - 7 palette curate: _Rosso Sapienza_ (`#822433`), _Blu Notte_ (`#1d4ed8`), _Verde Smeraldo_ (`#059669`), _Viola Reale_ (`#7c3aed`), _Arancio Caldo_ (`#d97706`), _Rosa Rubino_ (`#be185d`), _Ciano Oceano_ (`#0284c7`).
  - Memorizzazione persistente su memoria locale (`AsyncStorage`).
- **Coordinamento Cromatico Completo dei Giorni della Settimana**:
  - **Pill dei Giorni in Orari (`Home`)**: le pill dei giorni (`LUN`, `MAR`, `MER`, `GIO`, `VEN`) e i relativi indicatori/puntini di presenza ora recepiscono istantaneamente lo sfondo e i bordi del colore tema attivo.
  - **Pill dei Giorni in Viaggio**: formattazione uniforme e coerente con la schermata orari, con etichette in maiuscolo (`LUN` - `VEN`) e sincronizzazione dei colori attivi.
- **Armonizzazione Cromatica delle Card e degli Sfondi in Sezione Viaggio**:
  - Estesi i bordi dinamici (`theme.border`) e gli sfondi sfumati (`theme.cardTint`, `theme.subtle`) a tutta la schermata Viaggio: Hero Card principale, target lezione, Card del treno regionale, box del binario, card interattive delle tappe del viaggio (treno e navigazione mappe) e box di riepilogo finale.
  - Sfondo e bordi a tema (`theme.subtle`, `theme.border`) per i pulsanti di cambio treno **"Treno prima"** e **"Treno dopo"**.
  - Nome dell'aula e icona della lezione selezionata nel carosello delle lezioni del giorno coordinati con il tema (`theme.light`).
- **Coordinamento Cromatico Sezione Aule e Badge Luoghi**:
  - **Pill Aula nelle Card Orari (Home)**: la pillola dell'aula (`roomBadge`) che apre la scheda dell'aula ora adotta lo sfondo (`theme.cardTint`), il bordo (`theme.border`) e l'accento cromatico del tema per testo e icone.
  - **Badge Luoghi delle Aule (Sezione Aule)**: l'icona circolare del luogo/posizione (`iconCircle`), il badge del campus universitario (`campusBadge`), il bordo delle card aula e il contatore insegnamenti aggiuntivi (`subBadgeMore`) riflettono fedelmente il tema.
  - **Modal Aula (`ClassroomModal`)**: icone del libro nei tag degli _"Insegnamenti in quest'aula"_, badge campus, indicatore mappa e icona dell'indirizzo allineati al tema attivo.
- **Uniformità Cromatica nelle Impostazioni Pendolare e nella Home**:
  - Eliminata qualsiasi traccia di colore azzurrino/ciano (`#38bdf8`) residuo: il modal delle **Impostazioni Pendolare** (`CommuterConfigModal`), il banner rapido pendolare in Home e la schermata Viaggio riflettono con precisione assoluta il colore tema scelto.
  - Tasti "Salva", pulsanti "Ricalcola", box di stima stradale, indicatori di ricerca stazioni e icone sono ora 100% coordinati con la cromia dell'app.
- **Ottimizzatore Viaggio Pendolare (Nuova Scheda "Viaggio")**: sistema intelligente e moderno per calcolare e ottimizzare il tragitto quotidiano degli studenti pendolari della Sapienza:
  - **Risoluzione Aula e Orario Reale del Corso**: risolto il problema di fallback generico ("Aula 1 Sede Ariosto"); l'app estrae l'aula reale, l'edificio esatto (es. RM025 Tiburtina, RM031 S. Pietro in Vincoli, RM018 Castro Laurenziano, ecc.) e gli orari ufficiali direttamente dall'orario Google Sheet del canale selezionato.
  - **Selettore Intelligente e Manuale delle Lezioni**:
    - Mostra tutte le lezioni del giorno con materia, orario e aula esatta.
    - Selezione intelligente: se la mattina si è rimasti a casa (es. lezioni 09:00-12:00) e ci si sposta per una lezione pomeridiana (es. ore 13:00), l'app seleziona automaticamente la prossima lezione futura!
    - L'utente può toccare qualsiasi lezione della giornata per ricalcolare istantaneamente l'intero viaggio per quella specifica lezione.
  - **Treni Regionali con Orari Ufficiali Trenitalia al Minuto e Ricerca Dinamica**:
    - **Integrazione Dinamica ViaggiaTreno API**: ricerca in tempo reale dei treni regionali effettivi (partenze e arrivi incrociati per numero treno) per qualunque giorno e fascia oraria selezionata (oggi, domani, giorni successivi), eliminando tabelle statiche disallineate.
    - **Numeri Treno e Orari Perfetti**: orari e numeri corrispondono esattamente a quelli ufficiali Trenitalia (es. REG 4151 delle 06:34 con arrivo a Tiburtina alle 07:14, REG 4521 delle 07:00 con arrivo alle 07:33, REG 4256 delle 07:20 con arrivo alle 07:59, ecc.).
    - **Esclusione Treni Non Regionali**: filtraggio automatico che esclude Frecce, Italo e Intercity per tutelare i possessori di abbonamento regionale o Metrebus Lazio.
    - **Priorità Regionale Veloce (RV)**: preferisce automaticamente i treni veloci (~33-40 min), fornendo anche tutte le alternative Regionale lento (REG) con pulsanti di navigazione ("< Treno prima", "Treno dopo >") e chip rapidi selezionabili con un tocco.
    - **Binario Live, Binario Programmato e Ritardi**: visualizzazione del binario esatto di partenza e arrivo da Trenitalia, con indicazione del ritardo o anticipo in tempo reale.
    - **Pill di Stato Live Trenitalia, Gestione Ritardi e Avvisi Disservizi**:
      - A fianco al numero del treno è presente la pill con lo stato in tempo reale (_Programmato_, _In orario_, _In viaggio_, _+X min ritardo_, _Anticipo_, _Cancellato_, _Deviato_, _Interruzione linea_).
      - **Orari Reali di Partenza e Arrivo con Ritardo**:
        - **Alla partenza**: l'orario di partenza da rispettare e visualizzato rimane quello ufficiale programmato da orario: il minutaggio di ritardo **non** viene sommato alla partenza, per evitare che lo studente ritardi l'uscita da casa rischiando di perdere il treno se questo recupera tempo o anticipa.
        - **All'arrivo**: il ritardo si applica unicamente all'arrivo a destinazione (es. Roma Tiburtina), indicando l'ora reale di arrivo e ricalcolando le coincidenze con i mezzi urbani per l'aula.
      - Logica temporale intelligente: se l'ora attuale rientra nella finestra di viaggio, viene mostrato lo stato reale di marcia (_In viaggio_, _In orario_ o ritardo effettivo); se il treno deve ancora partire (oggi più tardi o nei giorni successivi), indica chiaramente _"Programmato"_.
      - Monitoraggio disservizi Trenitalia: banner dedicato in caso di treno soppresso/cancellato, deviazioni di percorso, variazioni, interruzioni di linea o biglietti non disponibili.
  - **Supporto Indirizzo Completo di Casa e Correzione Chilometraggio Stazione FS**:
    - Risolto il problema del chilometraggio (15.6 km vs 19 km): l'app in precedenza calcolava la distanza verso il centro storico comunale di Orte (Piazza della Libertà) anziché verso la **Stazione di Orte (Orte Scalo)**, situata a ~3.5 km di distanza.
    - Ora tutte le stazioni ferroviarie (Orte Scalo, Narni Scalo, Orvieto Scalo, ecc.) puntano alle coordinate esatte del piazzale e parcheggio della stazione FS, restituendo **18.5 km (~19 km su Google Maps)** e tempi di guida precisi.
    - Oltre al semplice comune, ora è possibile inserire l'indirizzo esatto di partenza con via e civico (es. `Via Roma 135c`, `Via Amerina 15, Amelia`), con auto-completamento del comune pendolare di riferimento e routing reale turn-by-turn OSRM.
    - **Motore Universale di Analisi della Scorrevolezza e del Traffico (`analyzeRouteFluency`)**:
      - **Completamente Generale e Non Isolato a una Singola Tratta**: eliminata qualsiasi eccezione statica o hardcoded limitata a singole località; l'algoritmo analizza dinamicamente volta per volta qualunque coppia di indirizzo di partenza e stazione ferroviaria su scala nazionale (es. Orte, Latina, Viterbo, Rieti, Fara Sabina, Monterotondo, Civitavecchia, Narni, Terni, Orvieto, ecc.).
      - **Analisi Turn-by-Turn del Percorso**: esamina in tempo reale la distanza metrica OSRM, il tempo base free-flow, la densità di incroci per km e le strade principali percorse (es. SS, SR, SP, arterie urbane).
      - **Calcolo Dinamico dei Colli di Bottiglia e della Scorrevolezza**:
        - _Orari di morbida/fuori punta_: traffico scorrevole e tempi allineati al free-flow di Google Maps (es. 25 min esatti per 18.2 km, 12 min per 8.9 km).
        - _Picco rientro serale (17:15 - 19:15, con culmine alle 18:00)_: stima ponderata su deflusso pendolari, uscite autostradali/superstrade, rotatorie e semafori congestionati.
        - _Punta mattutina (07:00 - 08:35)_: stima ponderata su afflusso pendolari, accesso al piazzale/parcheggi FS e tratti a scorrimento veloce.
        - _Fasce spalla_: transizione graduale del traffico con buffer moderato.
  - **Linee Bus/Pullman Urbani Reali da Google Maps e Coerenza Totale**:
    - Integrata espressamente la linea reale **Pullman 448** utilizzata quotidianamente per raggiungere le sedi Sapienza da Stazione Tiburtina (fermate Tiburtina/Marrucini per Polo Tiburtina RM025/RM158, Tiburtina/Castro Laurenziano per Economia e Plesso Scarpa RM018/RM004/RM014, Piazzale del Verano e De Lollis per Città Universitaria), affiancata dalle linee reali 492, 71, 163 e 310.
    - Per la **Sede Ariosto (RM102 - Via Ariosto 25)**: confermato il collegamento diretto **Bus 649** con discesa alla fermata **Conte Verde/Manzoni** (a soli 180 metri / 2 min dall'aula), oppure **Metro A (fermata Manzoni)**.
    - **Coerenza Titolo-Descrizione Tratte Urbane**: eliminata ogni discrepanza; la descrizione specifica punto di salita, esatta direzione del mezzo, fermata di discesa, minuti a bordo, minuti a piedi e collegamenti alternativi (es. Metro B / Tram).
  - **Ripristino Apertura Diretta App Google Maps**:
    - Reindirizzamento nativo immediato all'app Google Maps tramite schema iOS `comgooglemaps://` (con fallback su web maps): tocca la tratta per aprire direttamente l'app Google Maps con partenza e destinazione già compilate e navigazione live attiva.
    - Banner auto semplificato: mostra unicamente _"Naviga su Google Maps"_.
  - **Rifiniture Grafiche e Tipografiche Schermata Viaggio**:
    - **Visualizzazione Evidente del Traffico Stradale**: banner e badge ad alta visibilità nella tratta in auto che evidenziano chiaramente le condizioni di traffico (_Traffico molto intenso_, _Rallentamenti su strada_, _Ora di punta_ o _Traffico scorrevole_), con badge dedicato per il ritardo stimato e ricalcolo precauzionale dell'orario di partenza.
    - **Palette Cromatica Omogenea (Rosso Sapienza)**: rimossa ogni traccia di azzurrino/ciano (`#38bdf8`) nella sezione Viaggio a favore dell'elegante tema ufficiale Rosso Sapienza (`#822433`, `#e05666`, `rgba(130, 36, 51, ...)`), uniformando pill dei giorni, selettore lezioni, card treno, chips e banner di navigazione con il resto dell'app.
    - **Reindirizzamento Diretto a Trenitalia dalla Card del Treno**: toccando la card del treno regionale (o la relativa tappa nella timeline), il numero del treno viene copiato automaticamente negli appunti e viene aperta istantaneamente la pagina ufficiale di ViaggiaTreno / Trenitalia con pulsante/badge _"Trenitalia"_ visibile.
    - **Header Omogeneo e Rimozione Sottotitolo**: titolo allineato agli standard iOS Large Title del resto dell'app (titolo _"Viaggio"_, dimensione 34, peso 700, medesime spaziature di "Orari") e rimozione del vecchio sottotitolo _"Casa ➔ Sapienza..."_.
    - **Contenitore Liquid Glass Arrotondato Sotto i Giorni della Settimana**: l'header sfumato con effetto Liquid Glass e angoli inferiori arrotondati (raggio 24) racchiude ora titolo, selettore di direzione (Andata/Ritorno) e selettore dei giorni della settimana, terminando esattamente al di sotto dei giorni.
    - Diciture selettore direzione aggiornate a **"Andata"** e **"Ritorno"**: su IPA nativo utilizza il `SegmentedControl` Apple, mentre su Expo Go / non-IPA utilizza il selettore slider a pill con gli stessi colori della barra anni/canali (`#1c1c1e`, `#2c2c2e`, accento rosso Sapienza).
    - Selettore dei giorni nel tab Viaggio allineato a quello della schermata Orario (pill compatte con frecce cicliche prev/next, attivo in rosso Sapienza).
    - Dicitura intestazione lezioni pulita: rimossa la frase _"Tocca una lezione per calcolare il viaggio"_.
    - Badge di stato aggiornato a **"Dati Trenitalia"**.
    - Card del treno riorganizzata ed eliminazione overflow: rimosse le diciture ridondanti _"Regionale veloce consigliato"_ e _"programmato"_ (che sbordavano fuori dalla card); ora il badge treno, la pill di stato e l'eventuale ritardo rimangono perfettamente all'interno dei bordi.
    - Centratura automatica del treno selezionato nello slider orizzontale delle alternative, mantenendo la possibilità di scorrere liberamente la lista.
    - Sezione tappe rinominata in **"TAPPE DEL VIAGGIO"**.
    - Risolto il troncamento con tre puntini (`...`) nei titoli delle tappe: i testi vanno ora a capo in modo fluido e leggibile, con badge della durata allineato in alto a destra.
    - Modal Impostazioni Pendolare: dicitura snella e chiara nella sezione trasporto urbano (_"L’app seleziona automaticamente il mezzo più veloce dalla stazione fino all’aula, esatta direzione."_).

## 1.5.10

### Novità

- **Risolto problema di ri-comparsa del dispositivo dissociato**: quando un dispositivo viene rimosso o dissociato, viene registrato un tombstone di dissociazione permanente nel cloud (`dissociatedDevices`). Questo impedisce al dispositivo rimosso di ri-registrarsi automaticamente tramite il poller live di sincronizzazione in background.
- **Disaccoppiamento e isolamento immediato del dispositivo rimosso**: non appena il dispositivo escluso rileva la dissociazione (o l'assenza dal gruppo), genera un nuovo codice/ID privato e indipendente, disattiva l'auto-sync e interrompe qualsiasi connessione con il vecchio gruppo.
- **Pulsante "Scollega" per il dispositivo corrente**: aggiunto pulsante dedicato "Scollega" sulla scheda "Questo iPhone" nelle Impostazioni per consentire all'utente di abbandonare autonomamente il gruppo di sincronizzazione con un solo tocco.

## 1.5.9

### Novità

- **Sincronizzazione Live in Tempo Reale**: ogni modifica (nuovo dispositivo associato, aggiornamento orario/corso, aggiunta o rimozione presenze, dissociazione) si riflette istantaneamente e in tempo reale su tutti i dispositivi aperti, senza dover ricaricare a mano.
- **Formato Codice Iniziale `ST + 4 Numeri + 1 Lettera`**: il codice cloud iniziale e di generazione segue ora il nuovo formato compatto e chiaro (es. `ST4928X`).
- **Non-conflittualità dei nomi**:
  - Impossibile scegliere nomi/codici personalizzati già in uso da altri utenti sul cloud: l'app verifica e previene conflitti e sovrascritture accidentali.
  - I nomi dei dispositivi all'interno dello stesso gruppo vengono disambiguati automaticamente con numerazione progressiva (es. `iPhone (2)`).
- **Aggiornamento automatico in background per Calendario Apple**: quando l'orario o canale viene modificato tramite sincronizzazione live, se l'utente ha il Calendario Apple attivo, StudICI provvede ad aggiornare automaticamente e in live anche il Calendario Apple, pulendo vecchie lezioni ed evitando calendari o eventi duplicati.

## 1.5.8

### Novità

- **Associazione multi-dispositivo**: rimosso il limite di 2 dispositivi. È ora possibile associare qualsiasi numero di dispositivi (iPhone, iPad, ecc.) allo stesso account cloud; ogni dispositivo associato viene mostrato nell'elenco con possibilità di dissociazione individuale.
- **UISegmentedControl nativo Apple su IPA all'avvio**: il selettore della modalità di onboarding tra _Configurazione Normale_ e _Da Sincronizzazione_ utilizza il controllo nativo iOS `UISegmentedControl` nelle build IPA.
- **Pulizia e aggiornamento automatico orari Calendario Apple**: la sincronizzazione del calendario rileva se il calendario "StudICI - Lezioni Sapienza" esiste già e, in caso di cambi di orario o aggiornamenti, rimuove tutti i vecchi eventi dell'intervallo ricreando quelli aggiornati, azzerando duplicati e orari non più validi.
- **Condivisione ottimizzata per AirDrop & LiveContainer**: il messaggio condiviso include sia il codice testuale semplice sia il link diretto `studici://sync`, garantendo massima compatibilità sia con l'app installata sia avviata tramite LiveContainer.
- **Testi pulsanti semplificati**: etichette aggiornate a "Invia via AirDrop" e "Collega" sia nelle impostazioni che nella schermata di benvenuto.

## 1.5.7

### Novità

- **Configurazione iniziale tramite Sincronizzazione o Normale**: al primo avvio dell'app (o dopo un reset), è ora possibile scegliere tra _Configurazione Normale_ (seleziona corso e canale) oppure _Da Sincronizzazione_ (inserisci il codice del tuo altro dispositivo o usa AirDrop per scaricare subito corso, canali e presenze).
- **Blocco Sincronizzazione automatica non associata**: l'interruttore della sincronizzazione automatica è ora bloccato e non selezionabile finché non sono presenti due dispositivi associati, con avviso esplicativo al tocco.
- **Disattivazione automatica su dissociazione**: dissociando un dispositivo, la sincronizzazione automatica viene disattivata immediatamente.

## 1.5.6

### Novità

- **Modello di Associazione tra 2 Dispositivi**: la sincronizzazione cloud ora richiede obbligatoriamente che due dispositivi siano associati tra loro per poter scambiare i dati, prevenendo sovrascritture o sincronizzazioni isolate.
- **Riconoscimento e visualizzazione del dispositivo associato**: la schermata di sincronizzazione mostra chiaramente il dispositivo corrente e il nome/modello del dispositivo associato (es. _iPhone 13_, data/ora dell'ultimo sync e stato).
- **Funzione Dissociazione istantanea**: nuovo pulsante "Dissocia" che permette di interrompere l'associazione in qualsiasi momento, disattivando la sincronizzazione tra i due dispositivi.
- **Sincronizzazione condizionale**: se non sono associati due dispositivi, l'app avvisa l'utente e sospende la sincronizzazione automatica finché non viene completata l'associazione tramite AirDrop o codice.

## 1.5.5

### Novità

- **Sincronizzazione rapida via AirDrop (1-Tap)**: pulsante dedicato "Invia all'altro dispositivo (AirDrop)" per sincronizzare istantaneamente iPhone, iPad o un secondo telefono con un solo tocco, senza copiare codici a mano.
- **Supporto Deep Link automatico**: aprendo il link inviato via AirDrop o Messaggi (`studici://sync?code=...`), l'app si collega e si sincronizza all'istante.
- **Codici personalizzati facili**: puoi ora personalizzare il tuo codice con un nome facile a tua scelta (es. nickname o matricola) toccando l'etichetta del codice.

## 1.5.4

### Novità

- **Backend Firebase Realtime Database collegato**: sincronizzazione cloud multi-dispositivo attiva sul database Firebase dedicato.
- **Logo ufficiale ripristinato**: tornata l'icona ufficiale sia nella schermata iniziale che nell'onboarding, leggermente ingrandita con resa nitida e angoli stondati.

## 1.5.3

### Novità

- **Sincronizzazione reale tra dispositivi**: corso, canale predefinito e presenze vengono uniti automaticamente tra tutti i dispositivi collegati con lo stesso **Codice Dispositivo** (`STUD-XXXX-XXXX-XXXX`).
- Nuovo campo **"Collega un altro dispositivo"** nel modale Sincronizzazione.
- **Logo vettoriale** (SVG) più grande nella schermata di avvio e nell'onboarding.
- Aggiunto il `README.md` del progetto e questo `CHANGELOG.md`; le note di ogni release GitHub ora riportano le modifiche della versione.

### Correzioni

- La "sync iCloud" precedente salvava solo un file locale all'interno dell'app: i dispositivi non si scambiavano mai i dati. Sostituita con una sincronizzazione bidirezionale con merge per ID (le cancellazioni di presenze si propagano correttamente).
- Il codice di sincronizzazione ora è lungo e non indovinabile (il vecchio formato viene rigenerato automaticamente).

## 1.5.2

- Switch di sincronizzazione automatica spostato solo nel modale Sincronizzazione, senza pop-up.
- Calendario Apple: via nella **posizione**, aula nel **titolo**, note pulite.
- Corretto il bug per cui `UISegmentedControl` dei canali rimbalzava avanti e indietro.

## 1.5.1

- Migrazione a `expo-calendar/legacy`, professore nel titolo degli eventi, pulsanti pill nel modale cloud, `UISwitch` nativo per la sync automatica.

## 1.5.0

- Sincronizzazione (codice di backup), sincronizzazione con Calendario Apple, esportazione PDF di orario settimanale e registro presenze.

## 1.4.x

- Registro presenze con pressione prolungata, `UIContextMenuInteraction` nativo, swipe-to-delete, scheda aula con mappa e indicazioni (Apple Maps / Google Maps), nuovo logo.
