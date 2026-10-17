<p align="center">
  <img src="assets/images/icon.png" width="124" style="border-radius: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);" alt="StudICI Logo" />
</p>

<h1 align="center">StudICI</h1>

<p align="center">
  <b>L'applicazione definitiva per gli studenti e i pendolari di Ingegneria alla Sapienza Università di Roma.</b><br/>
  Orari lezioni in tempo reale, monitoraggio treni Trenitalia/ViaggiaTreno, percorsi urbani ATAC, registro presenze con esportazione PDF, mappa aule e sincronizzazione cloud.
</p>

<p align="center">
  <a href="https://github.com/Itachisann/StudICI/releases/latest">
    <img alt="GitHub Release" src="https://img.shields.io/github/v/release/Itachisann/StudICI?label=Release&color=822433&style=flat-square">
  </a>
  <img alt="Piattaforme" src="https://img.shields.io/badge/Piattaforme-iOS%20%7C%20iPadOS-822433?style=flat-square">
  <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo%20SDK-57-1c1c1e?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-3178c6?style=flat-square">
  <img alt="SideStore Ready" src="https://img.shields.io/badge/SideStore-Community%20Source-38bdf8?style=flat-square">
  <img alt="LiveContainer Ready" src="https://img.shields.io/badge/LiveContainer-Supported-a855f7?style=flat-square">
</p>

---

## 📖 Indice

1. [Caratteristiche Principali](#-caratteristiche-principali)
   - [📅 Orario Accademico & AI Alerts](#1-orario-accademico--ai-alerts)
   - [🚆 Modulo Pendolari Intelligente (Viaggio)](#2-modulo-pendolari-intelligente-viaggio)
   - [🏛️ Schede Aula & Mappa Sedi Sapienza](#3-schede-aula--mappa-sedi-sapienza)
   - [📊 Registro Presenze & Esportazione PDF](#4-registro-presenze--esportazione-pdf)
   - [☁️ Sincronizzazione Cloud Multi-Dispositivo](#5-sincronizzazione-cloud-multi-dispositivo)
   - [🔔 Notifiche di Aggiornamento In-App](#6-notifiche-di-aggiornamento-in-app)
   - [🎨 Design Nativo iOS & Temi Sapienza](#7-design-nativo-ios--temi-sapienza)
2. [Guida all'Installazione & Sideloading (iOS)](#-guida-allinstallazione--sideloading-ios)
   - [Opzione 1: SideStore & AltStore (Consigliata · Aggiornamenti Automatici)](#opzione-1-sidestore--altstore-consigliata--aggiornamenti-automatici)
   - [Opzione 2: LiveContainer (Nessun limite di 3 app)](#opzione-2-livecontainer-nessun-limite-di-3-app)
   - [Opzione 3: TrollStore (Installazione permanente)](#opzione-3-trollstore-installazione-permanente)
   - [Opzione 4: Sideloadly / AltServer via Computer](#opzione-4-sideloadly--altserver-via-computer)
3. [Architettura Tecnica & Funzionamento](#-architettura-tecnica--funzionamento)
4. [Sviluppo Locale](#-sviluppo-locale)
5. [Configurazione Cloud Backend](#-configurazione-cloud-backend)
6. [Crediti & Disclaimer](#-crediti--disclaimer)

---

## ✨ Caratteristiche Principali

### 1. Orario Accademico & AI Alerts
- **Scraping Diretto e Istantaneo**: sincronizzazione automatica degli orari ufficiali della presidenza della Facoltà di Ingegneria Civile e Industriale (ICI) e Ingegneria dell'Informazione (I3S).
- **Suddivisione Avanzata**: consultazione per Corso di Laurea, Anno di Corso e Canale alfabetico (A-K, L-Z, ecc.).
- **Live Class Indicator**: indicatore visivo in tempo reale delle lezioni attualmente in corso con barra di avanzamento e minuti rimanenti.
- **AI Academic Alerts**: sistema di analisi semantica degli avvisi urgenti della presidenza (variazioni d'aula, lezioni sospese, festività) con visualizzazione in banner fluttuante in stile iOS.
- **Offline-First**: cache locale ad accesso immediato (0ms di latenza all'avvio dell'app).

### 2. Modulo Pendolari Intelligente (Viaggio)
Il sistema più evoluto dedicato agli studenti pendolari che viaggiano verso le sedi Sapienza di Roma:
- **Monitoraggio Trenitalia in Tempo Reale**:
  - Collegamento diretto con le API ViaggiaTreno per il tracciamento dei treni Regionali (`REG`) e Regionali Veloci (`RV`).
  - **Gestione Dinamica Ritardi**: calcolo del ritardo stazione per stazione, con indicazione dell'orario di partenza effettivo e dell'arrivo stimato.
  - **Stati Treno Contestuali**: evidenziazione chiara se il treno è *in orario*, *in ritardo*, *"Fermo in stazione [Nome]"* o *"Già passato"* dalla stazione di salita dello studente.
  - **Visualizzazione Orario Programmato Barrato**: indicazione visiva dell'orario originale barrato affiancato all'orario effettivo ricalcolato con il ritardo.
  - **Tracciamento Completo Fino a Destinazione**: monitoraggio continuo della corsa fino al raggiungimento della stazione di arrivo prestabilita.
- **Tratte Stradali Casa ➔ Stazione (OSRM)**:
  - Calcolo del tragitto in automobile dall'indirizzo di partenza fino al parcheggio della stazione ferroviaria.
  - Stima del traffico in tempo reale con differenziazione oraria di punta e buffer per parcheggio e accesso ai binari.
- **Trasporti Urbani di Roma (ATAC / Metro / Bus)**:
  - Calcolo del percorso ottimale dalla stazione di arrivo ferroviaria (es. Roma Tiburtina, Roma Termini) fino all'aula esatta della lezione.
  - Titolo dinamico del mezzo (es. Metro B, Bus 310, Tram 3 o tragitto a piedi).
  - **ActionSheet Nativo Google Maps**: toccando la card del mezzo o il banner dedicato, si apre un menu nativo iOS per scegliere se navigare con partenza **dalla posizione GPS attuale** oppure **dalla stazione ferroviaria prestabilita**.
- **Selettore Giorni a Nastro Fluido (Capsule Ribbon)**:
  - Scorrimento orizzontale ispirato al design nativo di Apple Calendar e Apple Fitness con data del mese, feedback tattile e **bagliore neon radiale a 360°**.
  - **Supporto Fine Settimana**: consultazione treni estesa al Sabato e alla Domenica in modalità stazione-stazione indipendente dalle lezioni universitarie.
  - **Pulsante Rapido "Oggi"**: ritorno istantaneo alla giornata corrente in un solo tocco.

### 3. Schede Aula & Mappa Sedi Sapienza
- **Database Geocodificato Completo**:
  - Sede Centrale San Pietro in Vincoli (Aule 1–40, Chiostro, Aule Boaga, Radice, ecc.).
  - Sede Via Scarpa / Castro Laurenziano (Ingegneria Informatica ed Economia).
  - Sede Via Regina Elena, Via Ariosto, Via Eudossiana e Città Universitaria.
- **Navigazione Integrata**: anteprima mappa satellitare, coordinate precise dell'edificio, indicazioni stradali in un tocco con **Apple Maps** o **Google Maps**.

### 4. Registro Presenze & Esportazione PDF
- **Segnatura Rapida Presenze**: menu contestuale nativo iOS (`UIContextMenuInteraction`) tenendo premuto sulla lezione o sul giorno settimanale per segnare l'intera giornata.
- **Monitoraggio Frequenza**: barra percentuale e contatore per verificare il rispetto della soglia minima di frequenza obbligatoria per ciascuna materia.
- **Esportazione Documentale Professionale**:
  - Generazione istantanea di **documenti PDF** formattati in grafica vettoriale ad alta definizione.
  - Tabella Orario Settimanale in formato planning accademico.
  - Registro Completo Presenze e Statistiche Frequenze con branding Sapienza.

### 5. Sincronizzazione Cloud Multi-Dispositivo
- **Architettura Crittografata Zero-Knowledge**: sincronizzazione istantanea di corsi selezionati, preferenze pendolari e registro presenze su tutti i tuoi dispositivi iOS/iPadOS tramite un codice univoco non indovinabile.
- **Accoppiamento Rapido**: condivisione codice via AirDrop, clipboard o input diretto.
- **Gestione Dispositivi Associati**: pannello per visualizzare i dispositivi collegati (modello, ultimo sync) con possibilità di dissociarli in qualsiasi momento.

### 6. Notifiche di Aggiornamento In-App
- **Verifica Automatica Release GitHub**: all'apertura dell'app viene effettuato un controllo non bloccante delle release ufficiali.
- **Banner Intelligente & ActionSheet**: se è disponibile una nuova versione rispetto a quella installata, appare un banner con tasto `UPDATE` che consente di aggiornare direttamente l'app via SideStore, LiveContainer o scaricare l'IPA in un tocco.

### 7. Design Nativo iOS & Temi Sapienza
- Interfaccia costruita con i componenti UIKit nativi su iOS: `UISegmentedControl`, `UISwitch`, menu a comparsa, effetto vetro satinato (`BlurView`) e feedback aptico.
- Motore di personalizzazione grafica con palette studiate ad hoc: *Sapienza Red*, *Midnight Blue*, *Emerald Green*, *Amethyst Purple*, *Slate Dark* e *AMOLED Black*.

---

## 📲 Guida all'Installazione & Sideloading (iOS)

A ogni aggiornamento su `main`, la pipeline di GitHub Actions compila automaticamente il file `.ipa` non firmato e lo pubblica nella sezione **[Releases](https://github.com/Itachisann/StudICI/releases/latest)**.

```
File IPA Ufficiale: StudICI.ipa
Download Diretto:   https://github.com/Itachisann/StudICI/releases/latest/download/StudICI.ipa
Sorgente SideStore: https://raw.githubusercontent.com/Itachisann/StudICI/main/apps.json
```

---

### Opzione 1: SideStore & AltStore (Consigliata · Aggiornamenti Automatici)

**[SideStore](https://sidestore.io)** permette di installare e aggiornare le app direttamente dal dispositivo iOS via Wi-Fi tramite VPN locale (WireGuard), senza dover ricollegare l'iPhone al computer ogni 7 giorni.

#### Aggiunta della Community Source (1-Tap):
1. Sul tuo iPhone, apri questo link per aggiungere automaticamente il repository a SideStore:
   ```
   sidestore://source?url=https%3A%2F%2Fraw.githubusercontent.com%2FItachisann%2FStudICI%2Fmain%2Fapps.json
   ```
2. Oppure manualmente:
   - Apri **SideStore** ➔ scheda **Sources** (in alto a destra premi **+**).
   - Incolla l'URL della sorgente:
     ```
     https://raw.githubusercontent.com/Itachisann/StudICI/main/apps.json
     ```
3. Cerca **StudICI** nella scheda *Browse* e premi **GET** per installarla.
4. Da questo momento, quando esce una nuova versione, SideStore te la notificherà e potrai aggiornarla con un semplice tocco!

---

### Opzione 2: LiveContainer (Nessun limite di 3 app)

**[LiveContainer](https://github.com/khanhduytran0/LiveContainer)** permette di eseguire app non firmate senza consumare i 3 slot del certificato Apple ID gratuito e senza limiti di revoca.

#### Installazione Diretta con URL Scheme:
1. Apri questo link da Safari per avviare l'installazione automatica in LiveContainer:
   ```
   livecontainer://install?url=https%3A%2F%2Fgithub.com%2FItachisann%2FStudICI%2Freleases%2Flatest%2Fdownload%2FStudICI.ipa
   ```
2. Oppure manualmente:
   - Scarica il file `StudICI.ipa` da **[GitHub Releases](https://github.com/Itachisann/StudICI/releases/latest)**.
   - Apri **LiveContainer** ➔ premi l'icona **+** ➔ seleziona `StudICI.ipa`.

---

### Opzione 3: TrollStore (Installazione permanente)

Per dispositivi compatibili con **[TrollStore](https://github.com/opa334/TrollStore)** (iOS 14.0 – 16.6.1 / 17.0):
1. Scarica `StudICI.ipa` dall'ultima release.
2. Condividi il file e seleziona **"Apri con TrollStore"**.
3. L'app verrà installata permanentemente con certificato di sistema, senza scadenze dei 7 giorni e con supporto completo a tutte le funzioni native.

---

### Opzione 4: Sideloadly / AltServer via Computer

1. Scarica `StudICI.ipa` sul tuo PC/Mac da **[GitHub Releases](https://github.com/Itachisann/StudICI/releases/latest)**.
2. Collega l'iPhone con cavo USB.
3. Apri **[Sideloadly](https://sideloadly.io)** (o AltServer), trascina il file `StudICI.ipa`, inserisci il tuo Apple ID e premi **Start**.
4. Su iPhone, vai in *Impostazioni ➔ Generali ➔ VPN e gestione dispositivi* e autorizza il tuo profilo sviluppatore.

---

## 🏛️ Architettura Tecnica & Funzionamento

```mermaid
graph TD
    A["Portale Ufficiale Sapienza ICI"] -->|"Web Scraper & AI Parser"| B("StudICI Core State")
    C["Trenitalia / ViaggiaTreno API"] -->|"Live Delays & Stazioni"| D("Commuter Optimizer")
    E["OSRM Routing Engine"] -->|"Stima Traffico Casa-Stazione"| D
    F["ATAC / Trasporto Roma"] -->|"Routing Mezzi Urbani"| D
    D --> G["Interfaccia Viaggio Pendolari"]
    B --> H["Schermata Orario Settimanale"]
    B --> I["Schede Aule & Geocoding"]
    J["Registro Presenze"] -->|"PDFKit"| K["Esportazione PDF Ufficiale"]
    J -->|"Realtime Sync"| L["Firebase Cloud Storage"]
    M["GitHub Releases API"] -->|"Update Checker"| N["In-App Update Notifier"]
    N -->|"Schemi URL"| O["SideStore / LiveContainer"]
```

- **Framework**: [Expo SDK 57](https://expo.dev) su React Native 0.76+ con architettura New Architecture (Bridgeless / Fabric).
- **Navigazione**: [Expo Router v4](https://docs.expo.dev/router/introduction/) (File-based routing typed con navigazione a schede native).
- **Backend Treni**: Parser asincrono REST basato su endpoint Trenitalia ViaggiaTreno con calcolo delta ritardi, gestione partenze programmate vs effettive e fallback multi-stazione.
- **Routing Stradale**: Engine Open Source Routing Machine (OSRM) per calcolo distanze chilometriche, tempi di percorrenza e correzione euristica per traffico di punta.
- **CI/CD Cloud**: Workflow GitHub Actions su macOS runner per la compilazione automatica e la pubblicazione delle release `latest`.

---

## 🛠️ Sviluppo Locale

### Requisiti
- **Node.js** 20+ o 22+
- **npm** o **bun**
- **Expo CLI** (`npx expo`)

```bash
# Clona il repository
git clone https://github.com/Itachisann/StudICI.git
cd StudICI

# Installa le dipendenze
npm install

# Avvia il server di sviluppo (Expo Go o Dev Client)
npx expo start

# Esegui typecheck rigoroso TypeScript
npx tsc --noEmit

# Esegui il linter
npx expo lint

# Diagnostica configurazione e dipendenze
npx expo-doctor
```

---

## ☁️ Configurazione Cloud Backend

La sincronizzazione tra dispositivi si basa su **Firebase Realtime Database** (piano Spark 100% gratuito). Ogni utente scrive e legge unicamente sul proprio percorso con codice crittografico univoco.

1. Vai su [Firebase Console](https://console.firebase.google.com) ➔ **Aggiungi progetto**.
2. **Build ➔ Realtime Database ➔ Crea database** (seleziona regione europea `europe-west1`).
3. Nella scheda **Regole**, incolla la policy di sicurezza:
   ```json
   {
     "rules": {
       "sync": {
         "$code": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
4. Inserisci l'URL del tuo database in [`src/config/syncConfig.ts`](src/config/syncConfig.ts):
   ```ts
   export const SYNC_DB_URL = "https://tuo-database.europe-west1.firebasedatabase.app";
   ```

---

## 📜 Crediti & Disclaimer

- **Sviluppatore**: Vitor ([@Itachisann](https://github.com/Itachisann))
- **Progetto**: Open-source, indipendente e realizzato per la comunità studentesca.
- **Disclaimer**: *StudICI è un software non ufficiale e non è in alcun modo affiliato, sponsorizzato o approvato da Sapienza Università di Roma o da Trenitalia S.p.A. Tutti i marchi, i nomi di corsi e le stazioni appartengono ai rispettivi proprietari. I dati degli orari sono estratti dalle tabelle pubbliche fornite dalla presidenza di Facoltà.*

---

<p align="center">
  Realizzato con ❤️ per tutti gli studenti e i pendolari della Sapienza.
</p>
