import axios from 'axios';
import { parseScheduleCells, ParsedClass } from './aiParser';

export interface Degree {
  name: string;
  url: string;
  className: string;
}

export interface Tab {
  name: string;
  url: string;
}

export interface ClassroomInfo {
  aulaName: string;
  building: string;
  address: string;
}

export interface ClassEvent {
  subject: string;
  teacher: string;
  room: string;
  startTime: string;
  endTime: string;
  duration: number;
}

export interface ScheduleData {
  info: {
    faculty: string;
    course: string;
    year: string;
    academicYear: string;
    channel: string;
    semester: string;
  };
  classrooms: ClassroomInfo[];
  days: ClassEvent[][]; // 5 arrays, one per day (LUN-VEN)
}

export async function fetchDegrees(): Promise<Degree[]> {
  try {
    const url = 'https://ici.web.uniroma1.it/node/388';
    const res = await axios.get(url);
    const html = res.data;
    const degrees: Degree[] = [];
    
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trContent = trMatch[1];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      
      let tdMatch = tdRegex.exec(trContent);
      if (!tdMatch) continue;
      const td1 = tdMatch[1];
      
      tdMatch = tdRegex.exec(trContent);
      if (!tdMatch) continue;
      const td2 = tdMatch[1];
      
      const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
      const aMatch = aRegex.exec(td1);
      if (aMatch) {
        const link = aMatch[1].trim();
        const name = aMatch[2].replace(/<[^>]+>/g, '').trim();
        const className = td2.replace(/<[^>]+>/g, '').trim();
        degrees.push({ name, url: link, className });
      }
    }
    return degrees;
  } catch (error) {
    console.error('Error fetching degrees:', error);
    return [];
  }
}

export async function fetchTabs(url: string): Promise<Tab[]> {
  try {
    const res = await axios.get(url);
    const data = res.data;
    const itemsRegex = /items\.push\(\{(.*?)\}\);/g;
    let match;
    const tabs: Tab[] = [];
    while ((match = itemsRegex.exec(data)) !== null) {
      const content = match[1];
      const nameMatch = content.match(/name:\s*"([^"]+)"/);
      const urlMatch = content.match(/pageUrl:\s*"([^"]+)"/);
      if (nameMatch && urlMatch) {
        const rawName = nameMatch[1];
        // Salta tab "Mappa Edifici" o simili
        if (/mappa/i.test(rawName)) continue;
        tabs.push({
          name: shortenTabName(rawName),
          url: urlMatch[1].replace(/\\/g, ''),
        });
      }
    }
    return tabs;
  } catch (error) {
    console.error('Error fetching tabs:', error);
    return [];
  }
}

/**
 * Abbrevia i nomi dei tab dal formato lungo del foglio Google
 * Es: "2026-27 I anno I sem Canale A-L" → "1° Anno (A-L)"
 *     "2026-27 II anno I sem" → "2° Anno"
 *     "III anno I sem" → "3° Anno"
 */
function shortenTabName(raw: string): string {
  // Rimuovi anno accademico (es. "2026-27 ")
  let name = raw.replace(/\d{4}-\d{2,4}\s*/g, '').trim();
  
  // Estrai il numero dell'anno (I, II, III, IV, V o 1, 2, 3, 4, 5)
  const romanMatch = name.match(/\b(I{1,3}V?|IV|V)\s*°?\s*anno/i);
  const arabicMatch = name.match(/\b([1-5])\s*°?\s*anno/i);
  
  let yearNum = '';
  if (romanMatch) {
    const romanMap: Record<string, string> = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5' };
    yearNum = romanMap[romanMatch[1].toUpperCase()] || romanMatch[1];
  } else if (arabicMatch) {
    yearNum = arabicMatch[1];
  }
  
  // Estrai il canale (A-L, M-Z, ecc.)
  const channelMatch = name.match(/[Cc]anale\s+([A-Z]-[A-Z])/);
  const channel = channelMatch ? ` (${channelMatch[1]})` : '';
  
  if (yearNum) {
    return `${yearNum}° Anno${channel}`;
  }
  
  // Fallback: abbrevia il semestre
  return name
    .replace(/\s*I\s*sem(estre)?/i, '')
    .replace(/\s*II\s*sem(estre)?/i, '')
    .trim() || raw;
}

export async function fetchScheduleData(tabUrl: string): Promise<ScheduleData> {
  const defaultData: ScheduleData = {
    info: { faculty: '', course: '', year: '', academicYear: '', channel: '', semester: '' },
    classrooms: [],
    days: [[], [], [], [], []],
  };

  try {
    const res = await axios.get(tabUrl);
    const html = res.data;
    
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    const rows: string[][] = [];
    
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trContent = trMatch[1];
      const row: string[] = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        const text = tdMatch[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        row.push(text);
      }
      if (row.length > 0) rows.push(row);
    }

    const data = { ...defaultData };

    // Parsa le info dall'intestazione
    for (const row of rows.slice(0, 10)) {
      const joined = row.join(' ').toLowerCase();
      if (joined.includes('a.a.')) {
        const aaMatch = row.join(' ').match(/\d{4}-\d{2,4}/);
        if (aaMatch) data.info.academicYear = aaMatch[0];
      }
      if (joined.includes('semestre')) {
        data.info.semester = row.slice(1).join(' ').trim();
      }
    }

    // Parsa le aule
    for (const row of rows.slice(0, 10)) {
      if (row[1] && /^AULA\s+/i.test(row[1])) {
        data.classrooms.push({
          aulaName: row[1].trim(),
          building: row[2] || '',
          address: row[3] || '',
        });
      }
    }

    // Trova la riga con i giorni
    let dayRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const joined = rows[i].join(' ').toLowerCase();
      if (joined.includes('lunedì') || joined.includes('lunedi')) {
        dayRowIndex = i;
        break;
      }
    }
    if (dayRowIndex === -1) return data;

    // Raccogli tutti gli slot orari
    const timeSlots: { time: string; cells: string[] }[] = [];
    for (let i = dayRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const time = row[0] || '';
      if (!time.match(/\d{1,2}:\d{2}/)) continue;
      timeSlots.push({
        time,
        cells: [row[1] || '', row[2] || '', row[3] || '', row[4] || '', row[5] || ''],
      });
    }

    // Raccogli tutte le celle non vuote per inviarle all'AI in batch
    const allCells: string[] = [];
    const cellMap: { day: number; slotIndex: number }[] = [];
    
    for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
      for (let day = 0; day < 5; day++) {
        const cellText = timeSlots[slotIdx].cells[day];
        allCells.push(cellText);
        cellMap.push({ day, slotIndex: slotIdx });
      }
    }

    // Parsa con AI (o fallback regex)
    const parsed: ParsedClass[] = await parseScheduleCells(allCells);

    // Ricostruisci gli eventi per giorno, accorpando slot adiacenti
    for (let day = 0; day < 5; day++) {
      const events: ClassEvent[] = [];
      let currentEvent: ClassEvent | null = null;

      for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
        const flatIdx = slotIdx * 5 + day;
        const p = parsed[flatIdx];
        const slot = timeSlots[slotIdx];

        if (p && p.subject) {
          const roomLabel = p.room ? `Aula ${p.room}` : '';
          
          if (
            currentEvent &&
            currentEvent.subject === p.subject &&
            currentEvent.teacher === p.teacher
          ) {
            // Estendi la durata
            currentEvent.endTime = slot.time.split('-')[1] || slot.time;
            currentEvent.duration += 1;
          } else {
            if (currentEvent) events.push(currentEvent);
            const times = slot.time.split('-');
            currentEvent = {
              subject: p.subject,
              teacher: p.teacher,
              room: roomLabel,
              startTime: times[0] || slot.time,
              endTime: times[1] || '',
              duration: 1,
            };
          }
        } else {
          if (currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
          }
        }
      }
      if (currentEvent) events.push(currentEvent);
      data.days[day] = events;
    }

    return data;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return defaultData;
  }
}
