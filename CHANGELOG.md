# Changelog

Tutte le modifiche rilevanti di StudICI. Il testo della sezione di ogni versione viene
pubblicato automaticamente come note della **GitHub Release** (vedi `.github/workflows/build-ipa.yml`).

> **Regola di rilascio:** a ogni nuova versione aggiungere qui una sezione `## 1.x.y` _prima_ del push.

## 1.6.0

### Novità
- **Personalizzazione Colore Tema dell'App nel Profilo (Compatto e Nativo)**:
  - Nuova riga **Colore Tema** elegante e non ingombrante nel tab Profilo:
    - Su **.IPA (iOS Standalone / Nativo)**: un tocco apre il menu a discesa nativo Apple (`UIMenu` / `MenuView`) con elenco dei temi e spunta su quello attivo, integrato al 100% con il design di sistema iOS.
    - Su **Expo Go / non-IPA**: la riga è compatta e al tocco si espande dinamicamente rivelando la griglia delle palette colori, richiudibile con un secondo tocco.
  - 7 palette curate: *Rosso Sapienza* (`#822433`), *Blu Notte* (`#1d4ed8`), *Verde Smeraldo* (`#059669`), *Viola Reale* (`#7c3aed`), *Arancio Caldo* (`#d97706`), *Rosa Rubino* (`#be185d`), *Ciano Oceano* (`#0284c7`).
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
  - **Modal Aula (`ClassroomModal`)**: icone del libro nei tag degli *"Insegnamenti in quest'aula"*, badge campus, indicatore mappa e icona dell'indirizzo allineati al tema attivo.
- **Uniformità Cromatica nelle Impostazioni Pendolare e nella Home**:
  - Eliminata qualsiasi traccia di colore azzurrino/ciano (`#38bdf8`) residuo: il modal delle **Impostazioni Pendolare** (`CommuterConfigModal`), il banner rapido pendolare in Home e la schermata Viaggio riflettono con precisione assoluta il colore tema scelto.
  - Tasti "Salva", pulsanti "Ricalcola", box di stima stradale, indicatori di ricerca stazioni e icone sono ora 100% coordinati con la cromia dell'app.
- **Pulizia Diciture Tratte in Auto**:
  - Rimosso il sottotitolo ridondante *"Tocca per aprire la navigazione con orario impostato"* dalle tratte in auto di andata e ritorno, lasciando una visualizzazione pulita con *"Naviga su Google Maps"*.
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
      - A fianco al numero del treno è presente la pill con lo stato in tempo reale (*Programmato*, *In orario*, *In viaggio*, *+X min ritardo*, *Anticipo*, *Cancellato*, *Deviato*, *Interruzione linea*).
      - **Orari Reali di Partenza e Arrivo con Ritardo**:
        - **Alla partenza**: l'orario di partenza da rispettare e visualizzato rimane quello ufficiale programmato da orario: il minutaggio di ritardo **non** viene sommato alla partenza, per evitare che lo studente ritardi l'uscita da casa rischiando di perdere il treno se questo recupera tempo o anticipa.
        - **All'arrivo**: il ritardo si applica unicamente all'arrivo a destinazione (es. Roma Tiburtina), indicando l'ora reale di arrivo e ricalcolando le coincidenze con i mezzi urbani per l'aula.
      - Logica temporale intelligente: se l'ora attuale rientra nella finestra di viaggio, viene mostrato lo stato reale di marcia (*In viaggio*, *In orario* o ritardo effettivo); se il treno deve ancora partire (oggi più tardi o nei giorni successivi), indica chiaramente *"Programmato"*.
      - Monitoraggio disservizi Trenitalia: banner dedicato in caso di treno soppresso/cancellato, deviazioni di percorso, variazioni, interruzioni di linea o biglietti non disponibili.
  - **Supporto Indirizzo Completo di Casa e Correzione Chilometraggio Stazione FS**:
    - Risolto il problema del chilometraggio (15.6 km vs 19 km): l'app in precedenza calcolava la distanza verso il centro storico comunale di Orte (Piazza della Libertà) anziché verso la **Stazione di Orte (Orte Scalo)**, situata a ~3.5 km di distanza.
    - Ora tutte le stazioni ferroviarie (Orte Scalo, Narni Scalo, Orvieto Scalo, ecc.) puntano alle coordinate esatte del piazzale e parcheggio della stazione FS, restituendo **18.5 km (~19 km su Google Maps)** e tempi di guida precisi.
    - Oltre al semplice comune, ora è possibile inserire l'indirizzo esatto di partenza con via e civico (es. `Via Roma 135c`, `Via Amerina 15, Amelia`), con auto-completamento del comune pendolare di riferimento e routing reale turn-by-turn OSRM.
    - **Motore Universale di Analisi della Scorrevolezza e del Traffico (`analyzeRouteFluency`)**:
      - **Completamente Generale e Non Isolato a una Singola Tratta**: eliminata qualsiasi eccezione statica o hardcoded limitata a singole località; l'algoritmo analizza dinamicamente volta per volta qualunque coppia di indirizzo di partenza e stazione ferroviaria su scala nazionale (es. Orte, Latina, Viterbo, Rieti, Fara Sabina, Monterotondo, Civitavecchia, Narni, Terni, Orvieto, ecc.).
      - **Analisi Turn-by-Turn del Percorso**: esamina in tempo reale la distanza metrica OSRM, il tempo base free-flow, la densità di incroci per km e le strade principali percorse (es. SS, SR, SP, arterie urbane).
      - **Calcolo Dinamico dei Colli di Bottiglia e della Scorrevolezza**:
        - *Orari di morbida/fuori punta*: traffico scorrevole e tempi allineati al free-flow di Google Maps (es. 25 min esatti per 18.2 km, 12 min per 8.9 km).
        - *Picco rientro serale (17:15 - 19:15, con culmine alle 18:00)*: stima ponderata su deflusso pendolari, uscite autostradali/superstrade, rotatorie e semafori congestionati.
        - *Punta mattutina (07:00 - 08:35)*: stima ponderata su afflusso pendolari, accesso al piazzale/parcheggi FS e tratti a scorrimento veloce.
        - *Fasce spalla*: transizione graduale del traffico con buffer moderato.
  - **Linee Bus/Pullman Urbani Reali da Google Maps e Coerenza Totale**:
    - Integrata espressamente la linea reale **Pullman 448** utilizzata quotidianamente per raggiungere le sedi Sapienza da Stazione Tiburtina (fermate Tiburtina/Marrucini per Polo Tiburtina RM025/RM158, Tiburtina/Castro Laurenziano per Economia e Plesso Scarpa RM018/RM004/RM014, Piazzale del Verano e De Lollis per Città Universitaria), affiancata dalle linee reali 492, 71, 163 e 310.
    - Per la **Sede Ariosto (RM102 - Via Ariosto 25)**: confermato il collegamento diretto **Bus 649** con discesa alla fermata **Conte Verde/Manzoni** (a soli 180 metri / 2 min dall'aula), oppure **Metro A (fermata Manzoni)**.
    - **Coerenza Titolo-Descrizione Tratte Urbane**: eliminata ogni discrepanza; la descrizione specifica punto di salita, esatta direzione del mezzo, fermata di discesa, minuti a bordo, minuti a piedi e collegamenti alternativi (es. Metro B / Tram).
  - **Ripristino Apertura Diretta App Google Maps**:
    - Reindirizzamento nativo immediato all'app Google Maps tramite schema iOS `comgooglemaps://` (con fallback su web maps): tocca la tratta per aprire direttamente l'app Google Maps con partenza e destinazione già compilate e navigazione live attiva.
    - Banner auto semplificato: mostra unicamente *"Naviga su Google Maps"*.
  - **Rifiniture Grafiche e Tipografiche Schermata Viaggio**:
    - **Visualizzazione Evidente del Traffico Stradale**: banner e badge ad alta visibilità nella tratta in auto che evidenziano chiaramente le condizioni di traffico (*Traffico molto intenso*, *Rallentamenti su strada*, *Ora di punta* o *Traffico scorrevole*), con badge dedicato per il ritardo stimato e ricalcolo precauzionale dell'orario di partenza.
    - **Palette Cromatica Omogenea (Rosso Sapienza)**: rimossa ogni traccia di azzurrino/ciano (`#38bdf8`) nella sezione Viaggio a favore dell'elegante tema ufficiale Rosso Sapienza (`#822433`, `#e05666`, `rgba(130, 36, 51, ...)`), uniformando pill dei giorni, selettore lezioni, card treno, chips e banner di navigazione con il resto dell'app.
    - **Reindirizzamento Diretto a Trenitalia dalla Card del Treno**: toccando la card del treno regionale (o la relativa tappa nella timeline), il numero del treno viene copiato automaticamente negli appunti e viene aperta istantaneamente la pagina ufficiale di ViaggiaTreno / Trenitalia con pulsante/badge *"Trenitalia"* visibile.
    - **Header Omogeneo e Rimozione Sottotitolo**: titolo allineato agli standard iOS Large Title del resto dell'app (titolo *"Viaggio"*, dimensione 34, peso 700, medesime spaziature di "Orari") e rimozione del vecchio sottotitolo *"Casa ➔ Sapienza..."*.
    - **Contenitore Liquid Glass Arrotondato Sotto i Giorni della Settimana**: l'header sfumato con effetto Liquid Glass e angoli inferiori arrotondati (raggio 24) racchiude ora titolo, selettore di direzione (Andata/Ritorno) e selettore dei giorni della settimana, terminando esattamente al di sotto dei giorni.
    - Diciture selettore direzione aggiornate a **"Andata"** e **"Ritorno"**: su IPA nativo utilizza il `SegmentedControl` Apple, mentre su Expo Go / non-IPA utilizza il selettore slider a pill con gli stessi colori della barra anni/canali (`#1c1c1e`, `#2c2c2e`, accento rosso Sapienza).
    - Selettore dei giorni nel tab Viaggio allineato a quello della schermata Orario (pill compatte con frecce cicliche prev/next, attivo in rosso Sapienza).
    - Dicitura intestazione lezioni pulita: rimossa la frase *"Tocca una lezione per calcolare il viaggio"*.
    - Badge di stato aggiornato a **"Dati Trenitalia"**.
    - Card del treno riorganizzata ed eliminazione overflow: rimosse le diciture ridondanti *"Regionale veloce consigliato"* e *"programmato"* (che sbordavano fuori dalla card); ora il badge treno, la pill di stato e l'eventuale ritardo rimangono perfettamente all'interno dei bordi.
    - Centratura automatica del treno selezionato nello slider orizzontale delle alternative, mantenendo la possibilità di scorrere liberamente la lista.
    - Sezione tappe rinominata in **"TAPPE DEL VIAGGIO"**.
    - Risolto il troncamento con tre puntini (`...`) nei titoli delle tappe: i testi vanno ora a capo in modo fluido e leggibile, con badge della durata allineato in alto a destra.
    - Modal Impostazioni Pendolare: dicitura snella e chiara nella sezione trasporto urbano (*"L’app seleziona automaticamente il mezzo più veloce dalla stazione fino all’aula, esatta direzione."*).

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
- **UISegmentedControl nativo Apple su IPA all'avvio**: il selettore della modalità di onboarding tra *Configurazione Normale* e *Da Sincronizzazione* utilizza il controllo nativo iOS `UISegmentedControl` nelle build IPA.
- **Pulizia e aggiornamento automatico orari Calendario Apple**: la sincronizzazione del calendario rileva se il calendario "StudICI - Lezioni Sapienza" esiste già e, in caso di cambi di orario o aggiornamenti, rimuove tutti i vecchi eventi dell'intervallo ricreando quelli aggiornati, azzerando duplicati e orari non più validi.
- **Condivisione ottimizzata per AirDrop & LiveContainer**: il messaggio condiviso include sia il codice testuale semplice sia il link diretto `studici://sync`, garantendo massima compatibilità sia con l'app installata sia avviata tramite LiveContainer.
- **Testi pulsanti semplificati**: etichette aggiornate a "Invia via AirDrop" e "Collega" sia nelle impostazioni che nella schermata di benvenuto.

## 1.5.7

### Novità
- **Configurazione iniziale tramite Sincronizzazione o Normale**: al primo avvio dell'app (o dopo un reset), è ora possibile scegliere tra *Configurazione Normale* (seleziona corso e canale) oppure *Da Sincronizzazione* (inserisci il codice del tuo altro dispositivo o usa AirDrop per scaricare subito corso, canali e presenze).
- **Blocco Sincronizzazione Automatica non associata**: l'interruttore della sincronizzazione automatica è ora bloccato e non selezionabile finché non sono presenti due dispositivi associati, con avviso esplicativo al tocco.
- **Disattivazione automatica su dissociazione**: dissociando un dispositivo, la sincronizzazione automatica viene disattivata immediatamente.

## 1.5.6

### Novità
- **Modello di Associazione tra 2 Dispositivi**: la sincronizzazione cloud ora richiede obbligatoriamente che due dispositivi siano associati tra loro per poter scambiare i dati, prevenendo sovrascritture o sincronizzazioni isolate.
- **Riconoscimento e visualizzazione del dispositivo associato**: la schermata di sincronizzazione mostra chiaramente il dispositivo corrente e il nome/modello del dispositivo associato (es. *iPhone 13*, data/ora dell'ultimo sync e stato).
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
- **Sincronizzazione Cloud reale tra dispositivi**: corso, canale predefinito e presenze vengono uniti automaticamente tra tutti i dispositivi collegati con lo stesso **Codice Dispositivo** (`STUD-XXXX-XXXX-XXXX`).
- Nuovo campo **"Collega un altro dispositivo"** nel modale Sincronizzazione Cloud.
- **Logo vettoriale** (SVG) più grande nella schermata di avvio e nell'onboarding.
- Aggiunto il `README.md` del progetto e questo `CHANGELOG.md`; le note di ogni release GitHub ora riportano le modifiche della versione.

### Correzioni
- La "sync iCloud" precedente salvava solo un file locale all'interno dell'app: i dispositivi non si scambiavano mai i dati. Sostituita con una sincronizzazione bidirezionale con merge per ID (le cancellazioni di presenze si propagano correttamente).
- Il codice di sincronizzazione ora è lungo e non indovinabile (il vecchio formato viene rigenerato automaticamente).

## 1.5.2

- Switch di sincronizzazione automatica spostato solo nel modale Sincronizzazione Cloud, senza pop-up.
- Calendario Apple: via nella **posizione**, aula nel **titolo**, note pulite.
- Corretto il bug per cui `UISegmentedControl` dei canali rimbalzava avanti e indietro.

## 1.5.1

- Migrazione a `expo-calendar/legacy`, professore nel titolo degli eventi, pulsanti pill nel modale cloud, `UISwitch` nativo per la sync automatica.

## 1.5.0

- Sincronizzazione Cloud (codice di backup), sincronizzazione con Calendario Apple, esportazione PDF di orario settimanale e registro presenze.

## 1.4.x

- Registro presenze con pressione prolungata, `UIContextMenuInteraction` nativo, swipe-to-delete, scheda aula con mappa e indicazioni (Apple Maps / Google Maps), nuovo logo.
