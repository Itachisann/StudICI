# Linee Guida Operative per Antigravity (StudICI)

Questo documento definisce il flusso di lavoro obbligatorio per l'assistente AI (Antigravity) durante lo sviluppo del progetto **StudICI**.

---

## 1. Regole per Ogni Singolo Prompt / Richiesta Utente

A ogni iterazione o prompt inviato dall'utente, Antigravity deve seguire rigorosamente questi passaggi prima di dichiarare terminato il lavoro:

1. **Qualità del Codice e Type Safety**:
   - Eseguire sempre `npx tsc --noEmit` e verificare l'assenza totale di errori TypeScript.
   - Eseguire sempre `npx expo lint` e risolvere qualsiasi warning o violazione ESLint.
   - In caso di aggiunta di dipendenze, utilizzare unicamente `npx expo install <package>` per garantire la compatibilità con la versione di Expo SDK attiva.

2. **Aggiornamento di `CHANGELOG_INTERNAL.md`**:
   - **Alla fine di ogni prompt completato con successo**, aggiungere una nuova sezione in fondo a `CHANGELOG_INTERNAL.md`.
   - Documentare in dettaglio:
     - I file modificati o creati.
     - Il problema o requisito affrontato.
     - La soluzione tecnica adottata e le scelte architetturali rilevanti.

3. **DIVIETO ASSOLUTO DI COMMIT E PUSH AUTOMATICI**:
   - **Non eseguire mai `git commit` o `git push` di propria iniziativa.**
   - Tutte le modifiche al codice e ai file devono rimanere come modifiche locali (working directory / staged) finché l'utente non ordina esplicitamente di committare o rilasciare.

---

## 2. Procedura di Commit e Rilascio (Solo su Comando Esplicito dell'Utente)

Quando l'utente richiede espressamente di effettuare il commit (es. *"fai il commit"*, *"rilascia"*, *"committa e pusha"*), Antigravity deve eseguire la seguente sequenza:

1. **Aggiornamento della Versione dell'App**:
   - Incrementare la versione dell'app (es. `1.8.9` → `1.9.0` o come specificato dall'utente) in:
     - `package.json` (`version`)
     - `app.json` (`expo.version`)
     - Eventuali riferimenti interni (es. footer in `settings.tsx`).

2. **Sintesi Professionale in `CHANGELOG.md`**:
   - Raccogliere tutte le modifiche accumulate in `CHANGELOG_INTERNAL.md` relative alle sessioni di lavoro recenti.
   - Creare la nuova sezione di versione in cima a `CHANGELOG.md` (es. `## 1.9.0`).
   - **Tono e Stile di Scrittura**:
     - Scrivere un resoconto curato, asciutto, chiaro e professionale, pensato per le note di rilascio ufficiali (GitHub Release).
     - **Evitare assolutamente cliché da intelligenza artificiale** (es. frasi roboanti, enfasi vuota come *"rivoluzionario"*, *"potenziato all'infinito"*, *"magico"*, elenchi infantili o prolissi).
     - Usare il linguaggio di uno sviluppatore esperto: evidenziare il valore concreto per l'utente, le rifiniture grafiche (UI/UX), le ottimizzazioni di performance e le correzioni tecniche puntuali.

3. **Reset di `CHANGELOG_INTERNAL.md`**:
   - Svuotare `CHANGELOG_INTERNAL.md` reimpostando l'intestazione pulita per la nuova versione in arrivo, pronto ad accogliere le note tecniche dei prompt successivi.

4. **Esecuzione Git Commit & Push**:
   - Eseguire lo staging di tutti i file modificati (`git add .`).
   - Creare un commit con messaggio semantico e descrittivo.
   - Pushare le modifiche su entrambi i rami:
     ```bash
     git push origin main ; git push origin main:dev
     ```
