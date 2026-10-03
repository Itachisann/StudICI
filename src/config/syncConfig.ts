/**
 * Configurazione sincronizzazione Cloud tra dispositivi.
 *
 * URL radice del Firebase Realtime Database (senza slash finale), es.:
 *   https://studici-xxxxx-default-rtdb.europe-west1.firebasedatabase.app
 *
 * L'URL NON è un segreto: i dati di ogni utente sono salvati sotto un percorso
 * casuale e non indovinabile (il "Codice Dispositivo" STUD-XXXX...).
 * Vedi README.md → "Configurare la sincronizzazione Cloud".
 */
export const SYNC_DB_URL: string = 'https://icistud-default-rtdb.europe-west1.firebasedatabase.app';
