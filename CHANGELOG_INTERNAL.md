# Changelog Interno (Note di Commit & Release - v1.8.9)

Questo file raccoglie in modo strutturato tutti i cambiamenti recenti effettuati sul codice sorgente di StudICI. Può essere consultato e utilizzato come riferimento per messaggi di commit, pull request o note di rilascio.

---

## 1. Animazioni e Transizioni Fluide (Recente)

### Transizione Giorno-Giorno (Identica in "Orari" e "Viaggio")
- **File**: `src/app/index.tsx` e `src/app/viaggio.tsx`
- **Descrizione**:
  - Implementata una transizione fluida direzionale sia nella sezione **Orari** (`index.tsx`) che nella sezione **Viaggio** (`viaggio.tsx`).
  - Quando si seleziona un giorno successivo (es. Lunedì → Martedì), il contenuto scivola con naturalezza da destra verso sinistra (`translateX: 16 → 0`) con dissolvenza (`opacity: 0.25 → 1.0`).
  - Quando si seleziona un giorno precedente, il contenuto scivola da sinistra verso destra (`translateX: -16 → 0`).
  - Utilizza `Easing.out(Easing.cubic)` a 220ms guidato sul thread nativo GPU a 60/120fps (`useNativeDriver: true`), garantendo la massima fluidità e assenza totale di stuttering.

### Animazione a Scorrimento dello Slider dei Giorni (Sezione "Viaggio")
- **File**: `src/app/viaggio.tsx`
- **Descrizione**:
  - Eliminato il passaggio netto/istantaneo dell'evidenziatore del giorno quando si toccava un segmento della barra settimanale.
  - Creata una **capsula attiva fluttuante a molla** (`slidingActivePill`) con fisica Apple (`Animated.spring`, `damping: 24`, `stiffness: 280`, `mass: 0.8`).
  - Quando l'utente tocca un giorno qualsiasi (es. da Lunedì a Mercoledì o Sabato), la capsula scivola fisicamente lungo la barra agganciandosi alle coordinate e alla larghezza precisa misurata del segmento (`onLayout`).
  - Le etichette dei giorni e i punti di stato risiedono su un livello superiore (`zIndex: 2`) con sfondi trasparenti, permettendo alla pillola luminosa di scorrere al di sotto con transizione cromatica (Rosso Sapienza nei feriali, ambra caldo nel weekend).

---

## 2. Refactoring del Selettore Giorni Settimanali (Sezione "Viaggio")

### Design Ultra-Pulito Apple Liquid Glass
- **File**: `src/app/viaggio.tsx`
- **Descrizione**:
  - **Eliminazione Toolbar Superflue**: Rimosso il vecchio header secondario con frecce `< >`, badge testuali e pulsanti multipli che creava un cruscotto visivamente appesantito (4 barre sovrapposte).
  - **Barra a 7 Pillole Allineata ai Margini**: I 7 giorni (`LUN`, `MAR`, `MER`, `GIO`, `VEN`, `SAB`, `DOM`) risiedono in un'unica capsula in vetro scuro satinato (`backgroundColor: "rgba(255, 255, 255, 0.05)"`, `borderRadius: 16`, `borderWidth: 1`, `borderColor: "rgba(255, 255, 255, 0.09)"`).
  - **Allineamento Millimetrico (`paddingHorizontal: 16`)**: Occupa esattamente la stessa larghezza delle card sottostanti (timeline e lezioni), eliminando lo slider orizzontale a scorrimento che prima sforava dai bordi dello schermo.
  - **Nessun Numero del Giorno**: Rimossi tutti i numeri del mese (`25`, `26`, ecc.) mantenendo solo le sigle dei giorni della settimana.
  - **Separatore Feriale / Weekend**: Inserito un sottile divisore verticale satinato tra Venerdì e Sabato per evidenziare visivamente la distinzione tra giorni accademici e fine settimana.
  - **Contesto Spostato nella Sezione Contenuto**: Il titolo del giorno esteso (es. *LUNEDÌ • LEZIONI DI OGGI* o *SABATO • FINE SETTIMANA*) e il pulsante rapido `[↩ Torna a oggi]` risiedono nell'intestazione della sezione lezioni, mantenendo l'header pulito e leggero.

---

## 3. Modalità Programmata Viaggio per Giorni Non Odierni

### Orari Programmati Puliti e Rimozione Falsi Allarmi Live
- **File**: `src/app/viaggio.tsx`, `src/utils/trenitaliaApi.ts`, `src/utils/commuterOptimizer.ts`
- **Descrizione**:
  - Quando si consulta un giorno precedente o successivo a quello odierno (`!isSelectedDayToday`), la schermata mostra l'orario ufficiale programmato da tabellone (`departureTimePlanned` e `arrivalTimePlanned`).
  - Rimossi i calcoli di ritardo live e i controlli sull'ora attuale di oggi (`currentNowM >= depPlanM`) per i giorni diversi da oggi, evitando orari barrati o segnalazioni errate di treno già partito/in ritardo.
  - La pill di stato mostra **"Programmato"** con icona calendario e binario previsto, senza avvisi di convoglio fermo.

---

## 4. Nuova Icona dell'App e Grafica Vettoriale SVG

### Icona Ufficiale Vettoriale Centrata con Sfondo Rosso Sapienza
- **File**: `assets/images/icon.png`, `assets/images/android-icon-*.png`
- **Descrizione**:
  - Ripristinato lo sfondo in Rosso Sapienza profondo (`#822433` -> `#4c0519`) con gradiente radiale scuro.
  - Colonna centrale verticale ("I") in bianco puro brillante (`#ffffff`, spessore 7.5) risaltata e nitida.
  - Spirale multi-tono argentata con accenti caldi e cuspide di Sant'Ivo in oro brillante (`#fbbf24`), matematicamente centrata su 1024x1024 e icone adattive Android 512x512.
  - Nella schermata di verifica orari all'avvio (`StartupCheckScreen`), sostituito ogni logo vecchio raster con la variante vettoriale SVG ufficiale.

---

## 5. Uniformazione Sfondi & Modali

### Sfondo Dark OLED Calibrato (`#0d0e12`)
- **File**: `src/constants/theme.ts`, `src/app/viaggio.tsx`, `src/components/CommuterConfigModal.tsx`, `src/components/OnboardingCourseSelector.tsx`
- **Descrizione**:
  - Sfondo dark profondo calibrato `#0d0e12` (`UNIFORM_SCREEN_BG` e `UNIFORM_MODAL_BG`) esteso su tutte le schermate dell'app, modali e configurazioni.
  - Layout unificato tra schermata di avvio e modale viaggio: pill rapide per buffer minuti (5, 10, 15, 20 min) con icona orologio.
  - Pulsante Callstack nativo Liquid Glass "Configura più tardi" affiancato al tasto Salva nella schermata di avvio.
  - Risolto il warning di navigazione nativa con `usePreventRemove` per prevenire rimozioni dello stack desincronizzate.

---

## 6. Informazioni Versione
- **Versione app**: `1.8.9` (Downgrade mantenuto come richiesto dall'utente)
- **iOS Build Number**: `68`
- **Android Version Code**: `62`
