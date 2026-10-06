# Changelog

Tutte le modifiche rilevanti di StudICI. Il testo della sezione di ogni versione viene
pubblicato automaticamente come note della **GitHub Release** (vedi `.github/workflows/build-ipa.yml`).

> **Regola di rilascio:** a ogni nuova versione aggiungere qui una sezione `## 1.x.y` _prima_ del push.

## 1.6.0

### Novità
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
  - **Auto-Calcolo del Tempo e Distanza di Guida (Auto ➔ Stazione)**:
    - Rimosso l'inserimento manuale dei minuti di guida nelle impostazioni: il tempo stimato e la distanza chilometrica sono ora calcolati automaticamente dal motore di routing stradale (es. Amelia ➔ Stazione di Orte FS: 24 min • 17.2 km via SP8/SS204).
    - Database geografico e geocoding istantaneo con supporto offline per i principali comuni e stazioni pendolari di Lazio e Umbria (Amelia, Orte, Narni, Terni, Viterbo, ecc.).
    - Pulsante dedicato "Ricalcola" nelle impostazioni per aggiornare al volo i tempi se cambia la residenza o la stazione.
  - **Ottimizzazione Dinamica e Intelligente dei Mezzi Urbani a Roma**:
    - Rimossi i campi manuali "Tempo medio verso l'aula" e "Mezzo o linea suggerita": l'app valuta in tempo reale la soluzione più rapida (Metro B/A, Bus ATAC, Tram 3/19 o a piedi) calcolando tempi esatti a bordo, tempi effettivi di camminata pedonale e coincidenze in base all'aula della specifica lezione selezionata.
    - Mantenuto solo lo stepper per l'anticipo di sicurezza desiderato in aula (es. 10 minuti).
  - **Reindirizzamento Diretto su Google Maps con Percorso Pre-Compilato**:
    - Toccando qualsiasi card della timeline (tragitto in auto, mezzi pubblici urbani, percorso a piedi), l'app reindirizza direttamente all'app Google Maps (o alla pagina web) con punto di partenza, destinazione e modalità di viaggio (`driving`, `transit`, `walking`) già interamente compilati e pronti per la navigazione.
    - Banner dedicato ad alta leggibilità su ogni tappa interattiva ("Apri Guida su Google Maps", "Apri Mezzi su Google Maps", "Apri a Piedi su Google Maps").
    - Configurato schema nativo iOS `comgooglemaps://` in `Info.plist` con fallback universale.
  - **Linee Urbane Roma Dirette a ZERO Cambi**: calcolo automatico della linea ottimale per raggiungere ciascun campus da Roma Tiburtina/Termini privilegiando collegamenti diretti senza cambi (es. Bus 492 diretto, Metro B diretta, passeggiata a piedi 8 min per Polo Tiburtina RM025).
  - **Calcolo Multimodale Completo**: auto da casa alla stazione (con tempo di parcheggio), treno regionale, mezzi urbani e ingresso in aula con margine.
  - **Doppia Modalità Andata & Ritorno**: commutazione immediata tra andata e ritorno con `UISegmentedControl` nativo iOS.

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
