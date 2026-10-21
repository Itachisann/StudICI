/**
 * Gestione colori e glowing unici per codici di percorso/classe di laurea (es. LM-20, L-9R, L-8, LM-32).
 * Ogni codice classe ha un colore univoco, vivace e con effetto glowing al neon.
 */

export interface DegreeClassTheme {
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  glowColor: string;
}

// Palette di colori al neon saturi e contrastanti su fondo scuro
const NEON_PALETTE: { text: string; border: string; bg: string; glow: string }[] = [
  { text: "#34d399", border: "#10b981", bg: "rgba(16, 185, 129, 0.22)", glow: "#10b981" }, // Smeraldo Neon
  { text: "#fb923c", border: "#f97316", bg: "rgba(249, 115, 22, 0.22)", glow: "#f97316" }, // Arancio Neon
  { text: "#38bdf8", border: "#0ea5e9", bg: "rgba(14, 165, 233, 0.22)", glow: "#0ea5e9" }, // Ciano Cielo
  { text: "#f472b6", border: "#ec4899", bg: "rgba(236, 72, 153, 0.22)", glow: "#ec4899" }, // Fucsia / Rosa Acceso
  { text: "#facc15", border: "#eab308", bg: "rgba(234, 179, 8, 0.22)", glow: "#eab308" }, // Ambra Dorata
  { text: "#a78bfa", border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.22)", glow: "#8b5cf6" }, // Viola Elettrico
  { text: "#2dd4bf", border: "#14b8a6", bg: "rgba(20, 184, 166, 0.22)", glow: "#14b8a6" }, // Turchese / Teal
  { text: "#fb7185", border: "#f43f5e", bg: "rgba(244, 63, 94, 0.22)", glow: "#f43f5e" }, // Rosa Corallo
  { text: "#a3e635", border: "#84cc16", bg: "rgba(132, 204, 22, 0.22)", glow: "#84cc16" }, // Lime Elettrico
  { text: "#818cf8", border: "#6366f1", bg: "rgba(99, 102, 241, 0.22)", glow: "#6366f1" }, // Indaco
  { text: "#e879f9", border: "#d946ef", bg: "rgba(217, 70, 239, 0.22)", glow: "#d946ef" }, // Magenta
  { text: "#fdba74", border: "#ea580c", bg: "rgba(234, 88, 12, 0.22)", glow: "#ea580c" }, // Corallo Arancio
  { text: "#67e8f9", border: "#06b6d4", bg: "rgba(6, 182, 212, 0.22)", glow: "#06b6d4" }, // Azzurro Ghiaccio
  { text: "#4ade80", border: "#22c55e", bg: "rgba(34, 197, 94, 0.22)", glow: "#22c55e" }, // Verde Prato
  { text: "#ff9f0a", border: "#ff9f0a", bg: "rgba(255, 159, 10, 0.22)", glow: "#ff9f0a" }, // Arancio Sapienza
  { text: "#f87171", border: "#ef4444", bg: "rgba(239, 68, 68, 0.22)", glow: "#ef4444" }, // Rosso Fuoco
];

// Assegnazioni curate specifiche per le classi più diffuse per garantire massima distinzione
const SPECIFIC_CLASS_THEMES: Record<string, typeof NEON_PALETTE[number]> = {
  "LM-20": { text: "#34d399", border: "#10b981", bg: "rgba(16, 185, 129, 0.22)", glow: "#10b981" }, // Aerospaziale: Emerald
  "L-9R": { text: "#fb923c", border: "#f97316", bg: "rgba(249, 115, 22, 0.22)", glow: "#f97316" }, // L-9R: Vivid Orange
  "L-9": { text: "#ff9f0a", border: "#ff9f0a", bg: "rgba(255, 159, 10, 0.22)", glow: "#ff9f0a" }, // L-9: Amber Orange
  "L-8": { text: "#38bdf8", border: "#0ea5e9", bg: "rgba(14, 165, 233, 0.22)", glow: "#0ea5e9" }, // Informatica/Automatica: Sky Cyan
  "LM-32": { text: "#2dd4bf", border: "#14b8a6", bg: "rgba(20, 184, 166, 0.22)", glow: "#14b8a6" }, // Ingegneria Informatica Mag.: Teal
  "LM-25": { text: "#a78bfa", border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.22)", glow: "#8b5cf6" }, // Automazione: Purple
  "LM-21": { text: "#f472b6", border: "#ec4899", bg: "rgba(236, 72, 153, 0.22)", glow: "#ec4899" }, // Biomedica: Hot Pink
  "LM-22": { text: "#facc15", border: "#eab308", bg: "rgba(234, 179, 8, 0.22)", glow: "#eab308" }, // Chimica: Yellow
  "LM-23": { text: "#818cf8", border: "#6366f1", bg: "rgba(99, 102, 241, 0.22)", glow: "#6366f1" }, // Civile: Indigo
  "LM-26": { text: "#fb7185", border: "#f43f5e", bg: "rgba(244, 63, 94, 0.22)", glow: "#f43f5e" }, // Sicurezza: Rose
  "LM-28": { text: "#a3e635", border: "#84cc16", bg: "rgba(132, 204, 22, 0.22)", glow: "#84cc16" }, // Elettrica: Lime
  "LM-30": { text: "#fdba74", border: "#ea580c", bg: "rgba(234, 88, 12, 0.22)", glow: "#ea580c" }, // Energetica: Coral
  "LM-33": { text: "#4ade80", border: "#22c55e", bg: "rgba(34, 197, 94, 0.22)", glow: "#22c55e" }, // Meccanica: Bright Green
  "LM-35": { text: "#67e8f9", border: "#06b6d4", bg: "rgba(6, 182, 212, 0.22)", glow: "#06b6d4" }, // Ambiente: Electric Cyan
  "LM-53": { text: "#e879f9", border: "#d946ef", bg: "rgba(217, 70, 239, 0.22)", glow: "#d946ef" }, // Materiali: Magenta
};

/**
 * Normalizza il codice classe (es. "Classe LM-20" -> "LM-20", "Percorso L-9R" -> "L-9R")
 */
export function extractClassCode(rawCode: string | undefined | null): string {
  if (!rawCode) return "";
  const trimmed = rawCode.trim();
  const match = trimmed.match(/\b(L[MR]?[- ]?\d+[A-Za-z0-9.]*|L[- ]\d+[A-Za-z0-9.]*)\b/i);
  if (match) {
    return match[1].toUpperCase().replace(/\s+/g, "-");
  }
  return trimmed.replace(/^(?:classe|percorso)\s+/i, "").toUpperCase().trim();
}

/**
 * Restituisce i colori e l'effetto glowing per un dato codice di classe/percorso.
 */
export function getDegreeClassTheme(rawCode: string | undefined | null): DegreeClassTheme {
  const code = extractClassCode(rawCode);
  if (!code) {
    // Default ambra neutro
    return {
      textColor: "#ffd60a",
      borderColor: "#ff9f0a",
      backgroundColor: "rgba(255, 159, 10, 0.22)",
      glowColor: "#ff9f0a",
    };
  }

  // Controllo se esiste un mapping specifico
  if (SPECIFIC_CLASS_THEMES[code]) {
    const item = SPECIFIC_CLASS_THEMES[code];
    return {
      textColor: item.text,
      borderColor: item.border,
      backgroundColor: item.bg,
      glowColor: item.glow,
    };
  }

  // Hash deterministico stringa -> palette neon
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash << 5) - hash + code.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % NEON_PALETTE.length;
  const picked = NEON_PALETTE[index];

  return {
    textColor: picked.text,
    borderColor: picked.border,
    backgroundColor: picked.bg,
    glowColor: picked.glow,
  };
}
