# Changelog

Tutte le modifiche rilevanti di StudICI. Il testo della sezione di ogni versione viene
pubblicato automaticamente come note della **GitHub Release** (vedi `.github/workflows/build-ipa.yml`).

> **Regola di rilascio:** a ogni nuova versione aggiungere qui una sezione `## 1.x.y` _prima_ del push.

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
