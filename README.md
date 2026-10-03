<p align="center">
  <img src="assets/images/icon.png" width="120" style="border-radius: 26px;" alt="StudICI logo" />
</p>

<h1 align="center">StudICI</h1>

<p align="center">
  L'orario delle lezioni di <b>Ingegneria Civile e Industriale</b> · Sapienza Università di Roma,<br/>
  sempre in tasca, con presenze, mappe delle aule, calendario e sincronizzazione tra dispositivi.
</p>

<p align="center">
  <a href="https://github.com/Itachisann/StudICI/releases/latest"><img alt="Ultima release" src="https://img.shields.io/github/v/release/Itachisann/StudICI?label=release&color=822433"></a>
  <img alt="Piattaforme" src="https://img.shields.io/badge/piattaforme-iOS%20%7C%20Android-822433">
  <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo%20SDK-57-1c1c1e">
</p>

---

## ✨ Funzionalità

- 📅 **Orario settimanale** per corso, anno e canale, sempre aggiornato dal sito della facoltà (con cache e controllo aggiornamenti all'avvio).
- 🔴 **Lezioni in corso** evidenziate in tempo reale.
- 🏛️ **Scheda aula** con edificio, campus, indirizzo e anteprima mappa; indicazioni con **Apple Maps** o **Google Maps**.
- ✅ **Registro presenze**: tieni premuto su una lezione (menu contestuale nativo `UIContextMenuInteraction` su iOS) o su un giorno; elenco raggruppato per giorno, swipe nativo per eliminare, statistiche per materia.
- 🔔 **Avvisi** della facoltà letti e riassunti automaticamente.
- 🗓️ **Sincronizzazione con Calendario Apple**: eventi ricorrenti con aula nel titolo, via nella posizione (viaggio con Apple Maps) e docente.
- 📄 **Esportazione PDF** dell'orario settimanale (formato calendario) e del registro presenze con frequenze.
- ☁️ **Sincronizzazione Cloud** tra dispositivi (corso, canale e presenze) con Codice Dispositivo e sync automatica.
- 🍎 Interfaccia in stile iOS: `UISegmentedControl`, `UISwitch` e menu contestuali nativi nella build `.ipa`.

## 📲 Installazione (iOS)

La build iOS non firmata (`.ipa`) viene generata automaticamente da GitHub Actions a ogni push su `main`
e pubblicata nella sezione **[Releases](https://github.com/Itachisann/StudICI/releases/latest)**.

1. Scarica `StudICI.ipa` dall'ultima release.
2. Installala con **[SideStore](https://sidestore.io)** / AltStore / Sideloadly.

Ogni release riporta l'elenco delle modifiche della versione (vedi anche [CHANGELOG.md](CHANGELOG.md)).

## 🛠️ Sviluppo

Requisiti: Node.js 20+, [Expo](https://docs.expo.dev) (SDK 57).

```bash
npm install
npx expo start        # avvia il dev server (Expo Go)
npx expo lint         # lint
npx tsc --noEmit      # typecheck
npx expo-doctor       # diagnostica dipendenze
```

> Alcune funzioni (menu contestuale, `UISegmentedControl`, `UISwitch` nativi) sono attive solo nella build nativa `.ipa`;
> in Expo Go vengono usate alternative equivalenti in React Native.

Struttura principale:

```
src/
  app/          # schermate (Expo Router): Orari, Profilo, ...
  components/   # componenti UI (selettori, onboarding, aule, ...)
  utils/        # scraper, presenze, cloudSync, calendario Apple, export PDF
  config/       # syncConfig.ts → URL del backend di sincronizzazione
```

## ☁️ Configurare la sincronizzazione Cloud

La sincronizzazione tra dispositivi usa un **Firebase Realtime Database** gratuito (piano Spark).
Ogni utente scrive solo sotto un percorso casuale e non indovinabile (il **Codice Dispositivo**).

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** (Analytics non necessario).
2. **Build → Realtime Database → Crea database** (scegli la regione, avvia in modalità _test_).
3. Nella scheda **Regole** incolla e pubblica:

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

   `sync` non è elencabile (nessun `.read` sul nodo padre): per leggere un percorso serve conoscere il codice completo.
4. Copia l'URL del database (es. `https://nome-progetto-default-rtdb.europe-west1.firebasedatabase.app`)
   in [`src/config/syncConfig.ts`](src/config/syncConfig.ts) → `SYNC_DB_URL`.

**Uso:** Profilo → _Sincronizzazione Cloud_ → _Invia all'altro dispositivo (AirDrop)_ oppure copia il codice e inseriscilo in _Collega un altro dispositivo_.
La sincronizzazione avviene **solo se due dispositivi sono associati** tra loro: nella schermata è visibile il dispositivo collegato (nome, modello e ultimo sync) e puoi **dissociarlo** in qualsiasi momento con l'apposito tasto per interrompere la sincronizzazione. Attiva _Sincronizzazione Automatica_ per tenerli sempre allineati.

> ℹ️ **Perché non iCloud?** L'iCloud nativo richiede un'app firmata con un account Apple Developer a pagamento
> (entitlement iCloud), non disponibile con installazioni SideStore / Apple ID gratuito.

## 🚀 Rilasci

1. Aggiorna `version` in `app.json` e `package.json` (e `buildNumber` / `versionCode`).
2. Aggiungi la sezione `## x.y.z` in [CHANGELOG.md](CHANGELOG.md) con le modifiche.
3. `git push origin main` → GitHub Actions compila l'`.ipa` e pubblica la release usando il testo del changelog.

## 📜 Note

Progetto non ufficiale, non affiliato a Sapienza Università di Roma. I dati degli orari sono letti dal sito pubblico della facoltà.
