import axios from 'axios';

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
  duration: number; // hours
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
        tabs.push({
          name: nameMatch[1],
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
 * Parsa una cella del tipo: "FISICA II (14) PATERA Vincenzo"
 * Estrae: materia, numero aula, docente
 */
function parseCell(cell: string): { subject: string; roomNum: string; teacher: string } | null {
  if (!cell || cell.trim() === '') return null;
  
  // Decode HTML entities
  const decoded = cell.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  
  // Formato: "MATERIA (NUM_AULA) COGNOME Nome"
  const match = decoded.match(/^(.+?)\s*\((\d+)\)\s*(.+)$/);
  if (match) {
    return {
      subject: match[1].trim(),
      roomNum: match[2].trim(),
      teacher: match[3].trim(),
    };
  }
  
  // Fallback: no aula number
  return {
    subject: decoded.trim(),
    roomNum: '',
    teacher: '',
  };
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
        const text = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        row.push(text);
      }
      if (row.length > 0) rows.push(row);
    }

    const data = { ...defaultData };

    // Parsa le info dall'intestazione (righe 0-8)
    for (const row of rows.slice(0, 10)) {
      const joined = row.join(' ').toLowerCase();
      if (joined.includes('facoltà di') || joined.includes('facolta di')) {
        data.info.faculty = row.slice(1).join(' ').trim();
      }
      if (joined.includes('corso di studi') || joined.includes('laurea in')) {
        data.info.course = row[2] || row[1] || '';
      }
      if (joined.includes('anno di corso')) {
        data.info.year = row[2] || '';
      }
      if (joined.includes('a.a.')) {
        data.info.academicYear = row[1]?.replace('A.A.', '').trim() || '';
      }
      if (joined.includes('canale')) {
        data.info.channel = row[2] || '';
      }
      if (joined.includes('semestre')) {
        data.info.semester = row.slice(1).join(' ').trim();
      }
    }

    // Parsa le aule (righe che contengono "AULA" e un codice edificio tipo RM006)
    for (const row of rows.slice(0, 10)) {
      if (row[1] && /^AULA\s+/i.test(row[1])) {
        data.classrooms.push({
          aulaName: row[1].trim(),
          building: row[2] || '',
          address: row[3] || '',
        });
      }
    }

    // Trova la riga con i giorni (lunedì, martedì, ecc.)
    let dayRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const joined = rows[i].join(' ').toLowerCase();
      if (joined.includes('lunedì') || joined.includes('lunedi')) {
        dayRowIndex = i;
        break;
      }
    }

    if (dayRowIndex === -1) return data;

    // Righe orario sono dalla dayRowIndex + 1 in poi
    // Col 0 = orario, Col 1-5 = LUN-VEN
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

    // Mappa aula number -> ClassroomInfo
    const aulaMap: Record<string, ClassroomInfo> = {};
    for (const cr of data.classrooms) {
      const numMatch = cr.aulaName.match(/\d+/);
      if (numMatch) {
        aulaMap[numMatch[0]] = cr;
      }
    }

    // Accorpa slot adiacenti con la stessa materia nello stesso giorno
    for (let day = 0; day < 5; day++) {
      const events: ClassEvent[] = [];
      let currentEvent: ClassEvent | null = null;

      for (const slot of timeSlots) {
        const cellText = slot.cells[day];
        const parsed = parseCell(cellText);

        if (parsed && parsed.subject) {
          if (
            currentEvent &&
            currentEvent.subject === parsed.subject &&
            currentEvent.teacher === parsed.teacher
          ) {
            // Stesso evento, estendi la durata
            currentEvent.endTime = slot.time.split('-')[1] || slot.time;
            currentEvent.duration += 1;
          } else {
            // Nuovo evento
            if (currentEvent) events.push(currentEvent);
            
            const times = slot.time.split('-');
            const roomLabel = parsed.roomNum
              ? `Aula ${parsed.roomNum}`
              : '';
            
            currentEvent = {
              subject: parsed.subject,
              teacher: parsed.teacher,
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

// Legacy function, kept for compatibility
export async function fetchSchedule(tabUrl: string): Promise<string[][]> {
  try {
    const res = await axios.get(tabUrl);
    const html = res.data;
    const schedule: string[][] = [];
    
    const tableRegex = /<table[^>]*class=["'][^"']*waffle[^"']*["'][^>]*>([\s\S]*?)<\/table>/i;
    const tableMatch = tableRegex.exec(html);
    const tableContent = tableMatch ? tableMatch[1] : html;
    
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    
    while ((trMatch = trRegex.exec(tableContent)) !== null) {
      const trContent = trMatch[1];
      const row: string[] = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        const text = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        row.push(text);
      }
      if (row.some(r => r !== '')) {
        schedule.push(row);
      }
    }
    
    return schedule;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return [];
  }
}
