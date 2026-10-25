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

---

## 7. Risoluzione Badge Stato Viaggio e Prevenzione Partenze nel Passato

### Correzione Badge di Stato ("Fonte: Trenitalia" vs "Tutto regolare")
- **File**: `src/app/viaggio.tsx`, `src/utils/commuterOptimizer.ts`
- **Problema riscontrato**:
  - Per i giorni futuri/passati, la card mostrava erroneamente "Tutto regolare" anche se non esiste stato live per giorni non odierni.
  - Per il giorno odierno, l'etichetta di stato veniva sovrascritta con la stringa di attribuzione "Fonte: Trenitalia" invece di mostrare l'effettivo stato del viaggio ("In orario", ritardo in minuti o soppressione).
- **Risoluzione**:
  - Per i giorni diversi da oggi (`!isToday` / `!isSelectedDayToday`), il badge di stato mostra sempre **"Programmato"** in azzurro cielo (`#38bdf8`) con pillola semitrasparente.
  - Per il giorno odierno, il badge mostra fedelmente lo stato reale della circolazione: **"In orario"** (verde smeraldo `#10b981`), **`+Xm ritardo`** (ambra `#f59e0b` / rosso se elevato) o **"Treno Soppresso"** (rosso `#ef4444`). "Fonte: Trenitalia" non sovrascrive più lo stato del viaggio.

### Prevenzione Assoluta di Orari di Partenza nel Passato ("Treni da ora")
- **File**: `src/utils/commuterOptimizer.ts`, `src/utils/trenitaliaApi.ts`
- **Problema riscontrato**:
  - Quando si consultava la sezione viaggio durante il weekend, in assenza di lezioni o ad orario inoltrato (es. ore 11:44), l'app calcolava `stationTargetArrivalMins = nowMins + 50`. Questo selezionava un treno in arrivo a Roma alle 12:34 e in partenza da Orte alle 11:40 o 12:05.
  - Sottraendo i tempi di percorrenza in auto (24 min) e parcheggio (7 min), l'orario di partenza da casa risultava essere alle **11:34** (10 minuti nel passato!), costringendo l'utente a un'impossibile "partenza indietro nel tempo".
  - Inoltre, la funzione `isTrainCatchable` consentiva a treni con orario già trascorso fino a 60 minuti (`nowMins - depM <= 60`) di essere considerati prendibili.
- **Risoluzione**:
  - **Calcolo Tempi Reali da Casa**: Quando si considerano treni "da adesso" (weekend, lezioni terminate o orario di inizio lezione ormai superato), l'orario minimo in cui il passeggero può trovarsi sul binario della stazione include esplicitamente il tragitto in auto e il buffer di parcheggio: `minTrainDepartureMins = nowMins + carDuration + parkDuration`.
  - **Filtro Treni Utili (`minDepartureMins`)**: Passato `minDepartureMins` a `findOptimalCommuterTrain` ed eliminata la tolleranza retroattiva di 60 minuti in `isTrainCatchable`. Qualsiasi treno che parte prima dell'arrivo fisico del passeggero in stazione viene escluso dai treni prendibili.
  - **Garanzia Assoluta di Avanzamento al Treno Successivo**: In `computeOutboundItinerary` e `computeReturnItinerary`, se l'orario di partenza consigliato da casa o dall'università risulterebbe precedente all'orario attuale (`homeDepartureMins < nowMins`), l'algoritmo avanza automaticamente e seleziona il primo treno successivo della lista `availableTrains` per cui `homeDepartureMins >= nowMins`.
  - **Titolo Hero Card Dinamico**: Nel fine settimana o a lezioni terminate, il titolo dell'hero card mostra coerentemente *"Prossima partenza da casa alle"* anziché *"Parti da casa alle"*.

---

## 8. Calibrazione Slider Treni: Rimozione Falsi 'Fermo' e Badge Programmato Grigio

### Rimozione Falsi "Fermo" nello Slider dei Treni
- **File**: `src/app/viaggio.tsx`
- **Problema riscontrato**:
  - Treni fermi al binario in orario prima della partenza (ad esempio il convoglio 7461 alle 12:45 con partenza programmata alle 13:15) mostravano erroneamente l'etichetta `(Fermo)` e il colore ambra sullo slider alternativo, a causa della presenza del flag `Boolean(at.stoppedMinutes)`.
- **Risoluzione**:
  - L'etichetta `(Fermo)` sullo slider compare **esclusivamente** quando l'orario attuale supera la partenza stimata (`currentNowM >= atEstDepM`) o programmata (`currentNowM >= atPlannedDepM` se non c'è la stimata).
  - Un treno fermo al binario ma ancora in orario viene visualizzato in modo pulito con il suo orario regolare, senza falsi avvisi di convoglio bloccato.

### Badge "Programmato" Grigio nel Box di Selezione Treno
- **File**: `src/app/viaggio.tsx`, `src/utils/trenitaliaApi.ts`
- **Descrizione**:
  - Nel box di selezione ed evidenziazione del treno (`trainHighlightCard`), la pillola di stato **"Programmato"** è ora visualizzata in grigio Apple sobrio (`badgeColor: '#94a3b8'`, `badgeBg: 'rgba(148, 163, 184, 0.12)'`, `badgeBorder: 'rgba(148, 163, 184, 0.25)'`), distinguendosi chiaramente dai badge operativi live.

---

## 9. Disambiguazione Grafica tra Tempo di Sosta in Banchina e Ritardo di Corsa

### Separazione del Badge di Posizione dal Ritardo e Sosta
- **File**: `src/app/viaggio.tsx`, `src/utils/trenitaliaApi.ts`
- **Problema riscontrato**:
  - Per treni fermi in stazione con ritardo (es. RV 7461 a Terni), venivano mostrati affiancati due badge numerici: `[ ⏸ Fermo a Terni (da 13m) ]` e `[ ⏱ +8 min ]`.
  - Questo generava confusione visiva, facendo sembrare i 13 minuti e gli 8 minuti due stime di ritardo discordanti. In realtà, 13m è il tempo fisico di stazionamento in banchina dall'arrivo reale (comprensivo di 5m di sosta programmata da orario), mentre +8m è il ritardo accumulato rispetto all'orario ufficiale di partenza da quella stazione ($13\text{m} - 5\text{m} = 8\text{m}$).
- **Risoluzione grafica**:
  - **Badge di Posizione Puro**: Quando è presente un ritardo, il badge di stato principale indica unicamente la posizione e lo stato del treno: **`[ ⏸ Fermo a Terni ]`**, senza minutaggio tra parentesi.
  - **Badge di Ritardo Ufficiale**: Mostra chiaramente la discrepanza rispetto alla tabella di marcia: **`[ ⏱ +8 min ]`** (in ambra `#f59e0b` o rosso).
  - **Dwell Badge Dedicato (`dwellBadge`)**: Il tempo di stazionamento fisico al binario è convogliato in una terza pillola autonoma in grigio sobrio con icona a clessidra: **`[ ⏳ In banchina da 13m ]`**.
  - In questo modo, l'interfaccia separa in modo cristallino lo stato (`Fermo a Terni`), il ritardo (`+8 min`) e la durata della sosta fisica (`In banchina da 13m`), eliminando ogni possibile confusione.

---

## 10. Risoluzione Duplicazione Testo Ritardo Traffico nella Card Partenza

### Prevenzione Duplicati "rispetto al tempo base"
- **File**: `src/app/viaggio.tsx`
- **Problema riscontrato**:
  - Nella card del tragitto in auto (tappa partenza), in presenza di traffico con ritardo stimato, la descrizione generava una ripetizione testuale duplicata (es. `Viabilità attuale: rallentamenti verso la stazione (+3 min rispetto al tempo base) (+3 min rispetto al tempo base)`).
  - Questo accadeva perché la stringa calcolata da `drivingRouter.ts` conteneva già al suo interno l'indicazione `(+X min rispetto al tempo base)`, e la vista in `viaggio.tsx` la concatenava una seconda volta con `delayInfo`.
- **Risoluzione grafica**:
  - Inserito un controllo preventivo di deduplicazione: se la stringa della condizione (`baseCondition`) contiene già il riferimento al tempo base o una stima tra parentesi `(+`, l'append di `delayInfo` viene inibito.
  - Aggiunta inoltre una regex di sanificazione per ripulire eventuali doppioni già presenti o persistiti in cache, garantendo un'unica e pulita dicitura informativa per il tragitto stradale.
