export type DisruptionCategory =
  | 'sciopero_treni'
  | 'sciopero_tpl'
  | 'manifestazione'
  | 'blocco_stradale'
  | 'cantiere_viabilita'
  | 'altro';

export type DisruptionImpact = 'high' | 'medium' | 'info';

export interface DisruptionEvent {
  id: string;
  title: string;
  category: DisruptionCategory;
  impact: DisruptionImpact;
  startDate: string; // Formato 'YYYY-MM-DD'
  endDate: string; // Formato 'YYYY-MM-DD'
  formattedDateSpan: string; // es. "09/11/2026" oppure "27/10 - 30/10"
  timeWindow?: string; // es. " dalle 09:01 alle 16:59"
  scope: string; // es. "Nazionale", "Regionale Lazio", "Roma Centro"
  affectedModes: ('train' | 'transit' | 'walk')[];
  affectedCompanies?: string; // es. "PERSONALE SOC. ITALO-NTV", "ATAC"
  affectedAreas?: string[]; // es. ["Verano", "Termini", "Barberini"]
  unions?: string; // Sindacati
  notes?: string;
  isNocturnal?: boolean; // Se si tratta di evento/lavori puramente notturni (es. ore 22-06)
  isCommuterRelevant?: boolean; // Se impatta direttamente la tratta del pendolare (Trenitalia / RFI / corridor Sapienza)
  isWalkRelevant?: boolean; // Se impatta specificamente il corridoio pedonale stazione <-> aule
  sourceName: 'Ministero dei Trasporti (MIT)' | 'Luceverde Roma' | 'Roma Mobilità';
  sourceUrl?: string;
}
