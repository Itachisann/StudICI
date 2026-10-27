# Changelog Interno (Note di Commit & Release - Ciclo successivo a v1.9.0)

Questo file raccoglie in modo strutturato tutti i cambiamenti tecnici effettuati sul codice sorgente di StudICI a partire dal rilascio `v1.9.0`.

---

## 1. Risoluzione Errore 400 Cloud Sync al Collegamento e Padding Registro Presenze (`cloudSync.ts`, `settings.tsx`, `CHANGELOG.md`)
- **Fix Errore 400 Firebase Realtime Database in Cloud Sync (`src/utils/cloudSync.ts`)**:
  - Risolta la causa radice dell'errore 400 ("Impossibile salvare sul cloud (400)") che si verificava collegando un dispositivo tramite codice di sincronizzazione al primo avvio.
  - Le mappe multi-corso `allCoursesAttendance` e `allCoursesManualEvents` utilizzano come chiavi gli URL completi dei corsi universitari (contenenti caratteri non ammessi da Firebase RTDB come `/` e `.`).
  - Implementate le funzioni di serializzazione sicura `encodeFirebaseKey` e `decodeFirebaseKey` (con `encodeURIComponent` e `%2E` per i punti), integrate automaticamente all'interno di `pushRemote` (`sanitizeDocForFirebase`) e `fetchRemote` (`parseDocFromFirebase`), garantendo che qualsiasi richiesta a Firebase rispetti le restrizioni sulle chiavi.
- **Padding Inferiore Registro Presenze (`src/app/settings.tsx`)**:
  - Aggiunto `contentContainerStyle={{ paddingBottom: Math.max(90, insets.bottom + 70) }}` al componente `ScrollView` del modale "Presenze", assicurando che anche in presenza di un numero elevato di registrazioni il pulsante d'azione "Azzera il registro" possa essere scorso comodamente al di sopra dell'home indicator e del bordo inferiore dello schermo, rimanendo pienamente visibile e cliccabile.

