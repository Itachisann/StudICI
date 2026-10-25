/**
 * Palette e mappatura deterministica e immutabile dei colori per le materie.
 * Garantisce che ogni materia abbia lo stesso colore fisso ad ogni avvio dell'app.
 */

export const ACCENT_COLORS = [
  "#3b82f6", // 0: Blue
  "#8b5cf6", // 1: Violet
  "#f59e0b", // 2: Amber
  "#10b981", // 3: Emerald
  "#ef4444", // 4: Crimson Red
  "#ec4899", // 5: Pink
  "#06b6d4", // 6: Cyan
  "#f97316", // 7: Bright Orange
  "#14b8a6", // 8: Teal
  "#6366f1", // 9: Indigo
  "#84cc16", // 10: Lime
  "#a855f7", // 11: Purple
  "#e11d48", // 12: Rose
  "#0284c7", // 13: Sky Blue
] as const;

// Corrispondenze semantiche stabili per i rami di insegnamento universitari più frequenti
const SPECIAL_SUBJECT_MATCHERS: { pattern: RegExp; color: string }[] = [
  { pattern: /\bANALISI(?:\s+MATEMATICA)?\s*(?:1|I)\b/i, color: "#3b82f6" }, // Blue
  { pattern: /\bANALISI(?:\s+MATEMATICA)?\s*(?:2|II)\b/i, color: "#a855f7" }, // Purple
  { pattern: /\bANALISI\b/i, color: "#3b82f6" }, // Blue
  { pattern: /\b(?:GEOMETRIA|ALGEBRA(?:\s+LINEARE)?)\b/i, color: "#10b981" }, // Emerald
  { pattern: /\bFISICA(?:\s+GENERALE)?\s*(?:1|I)\b/i, color: "#f59e0b" }, // Amber
  { pattern: /\bFISICA(?:\s+GENERALE)?\s*(?:2|II)\b/i, color: "#f97316" }, // Bright Orange
  { pattern: /\bFISICA\b/i, color: "#f59e0b" }, // Amber
  { pattern: /\bCHIMICA\b/i, color: "#8b5cf6" }, // Violet
  { pattern: /\b(?:INFORMATICA|FONDAMENTI\s+DI\s+INFORMATICA|PROGRAMMAZIONE)\b/i, color: "#06b6d4" }, // Cyan
  { pattern: /\bMECCANICA(?:\s+RAZIONALE)?\b/i, color: "#84cc16" }, // Lime
  { pattern: /\b(?:ELETTROTECNICA|CIRCUITI)\b/i, color: "#14b8a6" }, // Teal
  { pattern: /\b(?:TERMODINAMICA|FISICA\s+TECNICA)\b/i, color: "#f97316" }, // Bright Orange
  { pattern: /\b(?:ECONOMIA|GESTIONE\s+AZIENDALE)\b/i, color: "#ec4899" }, // Pink
  { pattern: /\bDISEGNO\b/i, color: "#6366f1" }, // Indigo
  { pattern: /\bSCIENZA\s+DELLE\s+COSTRUZIONI\b/i, color: "#ef4444" }, // Crimson Red
];

/**
 * Restituisce in modo completamente deterministico il colore associato ad una materia.
 * Non varia mai tra sessioni, riavvii o caricamenti parziali della tabella.
 */
export function getSubjectColor(subjectName?: string | null): string {
  if (!subjectName || !subjectName.trim()) {
    return ACCENT_COLORS[0];
  }

  const raw = subjectName.trim().toUpperCase();

  // 1. Controllo corrispondenze tematiche stabili
  for (const matcher of SPECIAL_SUBJECT_MATCHERS) {
    if (matcher.pattern.test(raw)) {
      return matcher.color;
    }
  }

  // 2. Hash deterministico FNV-1a a 32 bit per qualsiasi altra materia (caso generico)
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const index = Math.abs(hash) % ACCENT_COLORS.length;
  return ACCENT_COLORS[index];
}

/**
 * Palette estesa di colori vibranti e distinti per le lezioni manuali.
 */
export const EXTENDED_MANUAL_PALETTE = [
  "#d946ef", // Fuchsia
  "#06b6d4", // Cyan
  "#14b8a6", // Teal
  "#84cc16", // Lime
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#10b981", // Emerald
  "#e11d48", // Rose
  "#0284c7", // Sky Blue
  "#f59e0b", // Amber
  "#3b82f6", // Blue
  "#8b5cf6", // Violet
] as const;

/**
 * Restituisce un colore deterministico per una lezione manuale garantendo
 * che non coincida con i colori già utilizzati da altre materie ufficiali del corso.
 */
export function getManualSubjectColor(
  subjectName?: string | null,
  usedColors?: Set<string> | string[]
): string {
  const usedSet = usedColors instanceof Set
    ? usedColors
    : new Set((usedColors || []).map((c) => c.toLowerCase()));

  // Filtra i colori non ancora utilizzati da altre materie
  const availableColors = EXTENDED_MANUAL_PALETTE.filter(
    (c) => !usedSet.has(c.toLowerCase())
  );

  const candidatePool = availableColors.length > 0 ? availableColors : EXTENDED_MANUAL_PALETTE;

  if (!subjectName || !subjectName.trim()) {
    return candidatePool[0];
  }

  let hash = 2166136261;
  const normalized = subjectName.trim().toUpperCase();
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const index = Math.abs(hash) % candidatePool.length;
  return candidatePool[index];
}

