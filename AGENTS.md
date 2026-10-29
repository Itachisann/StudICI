This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Workflow & Commit Rules (Antigravity)

- **Per ogni prompt / task**:
  - Eseguire sempre `npx tsc --noEmit` e `npx expo lint` prima di dichiarare completato il lavoro.
  - Aggiungere sempre in fondo a `CHANGELOG_INTERNAL.md` il riepilogo tecnico dettagliato delle modifiche apportate (inclusi sviluppi progressivi, iterazioni e bug fix intermedi).
  - **NON fare MAI `git commit` o `git push`** finché l'utente non lo richiede esplicitamente. Tutte le modifiche rimangono locali.

- **Al comando di Dev Build dell'utente** (es. "commit per la dev build", "aggiorna dev", "genera dev"):
  - Lavorare, eseguire lo staging, il commit e il push **esclusivamente sul branch `dev`** (mai su `main`).
  - **NON toccare MAI `main`**, né i file ufficiali di release (`CHANGELOG.md`, `apps.json`). Non incrementare la versione ufficiale dell'app.
  - Gli appunti tecnici restano salvati localmente in `CHANGELOG_INTERNAL.md` (senza committarlo o pusharlo se l'utente richiede di non includerlo).
  - Non si avvia il workflow di produzione (`build-ipa.yml`). Si avvia unicamente `build-dev-client.yml` che genera l'IPA Dev Client privato negli Artifacts di GitHub Actions.

- **Al comando esplicito di Release Ufficiale dell'utente** (es. "rilascia", "fai la release", "crea la release"):
  - Incrementare la versione dell'app in `package.json`, `app.json` e `apps.json`.
  - Elaborare e trasferire il resoconto da `CHANGELOG_INTERNAL.md` al changelog ufficiale `CHANGELOG.md` rispettando rigorosamente queste direttive:
    1. **Zero stile AI e zero fronzoli superflui**: vietato qualsiasi tono enfatico o tipico delle intelligenze artificiali, così come descrizioni fittizie, ridondanti o dettagli estetici banali privi di valore informativo (es. *"realizzato in Liquid Glass"*, *"aggiornato il Callstack"*, *"Sentence case"* o dettagli architetturali gonfiati).
    2. **Citazione esatta di file, moduli e componenti quando informativa**: è consentito e incoraggiato citare i nomi esatti dei moduli, dei componenti o dei file interessati (es. `trenitaliaApi.ts`, `commuterOptimizer.ts`, `PastAttendanceModal.tsx`, `manualEvents.ts`) quando ciò apporta reale chiarezza tecnica — in particolare se un modulo specifico presentava un problema ed è stato corretto o se è stato introdotto un nuovo modulo/componente rilevante.
    3. **Sintesi diretta del risultato finale (nessun passaggio intermedio)**: mentre `CHANGELOG_INTERNAL.md` conserva l'intero storico cronologico (creazione di una funzione e successive correzioni di bug o ritocchi sulla stessa), in `CHANGELOG.md` **non va mai riportata la sequenza "aggiunta funzione → risolto bug della funzione"**. Tutto va fuso e presentato direttamente nel suo risultato finale pulito e definitivo. Vanno citati come bug fix solo i problemi che esistevano già nelle versioni precedentemente rilasciate.
  - Resettare `CHANGELOG_INTERNAL.md` con la testata pulita per il ciclo successivo.
  - Effettuare il merge/staging su `main`, il commit descrittivo e il push su `main` (avviando il workflow di produzione `build-ipa.yml`), e riallineare `dev`.

