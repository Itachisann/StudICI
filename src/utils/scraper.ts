import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScheduleCells, parseTabsWithAI, extractAlertsWithAI, cleanTabNameFallback, mapClassroomsWithAI, ParsedClass, MappedClassroom } from './aiParser';

// Funzione di hashing (djb2) per rilevare cambiamenti nel foglio
function hashCode(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

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
  building?: string;
  address?: string;
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
    semester: string; // we'll keep this as fallback
  };
  alerts: string[]; // <--- New alerts array
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
    
    // Check Cache
    const contentHash = hashCode(data);
    const cacheKey = `tabsCache_${url}`;
    try {
      const cachedStr = await AsyncStorage.getItem(cacheKey);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (cached.hash === contentHash && cached.tabs) return cached.tabs;
      }
    } catch {}

    const itemsRegex = /items\.push\(\{(.*?)\}\);/g;
    let match;
    const rawTabs: { rawName: string; url: string }[] = [];
    
    let mapTabUrl: string | null = null;
    while ((match = itemsRegex.exec(data)) !== null) {
      const content = match[1];
      const nameMatch = content.match(/name:\s*"([^"]+)"/);
      const urlMatch = content.match(/pageUrl:\s*"([^"]+)"/);
      if (nameMatch && urlMatch) {
        const rawName = nameMatch[1];
        const pageUrl = urlMatch[1].replace(/\\/g, '');

        // Se è la mappa edifici, memorizza l'URL per scaricarlo
        if (/mappa|edifici/i.test(rawName)) {
          mapTabUrl = pageUrl;
          continue;
        }

        if (/aule/i.test(rawName)) continue;
        rawTabs.push({
          rawName: rawName,
          url: pageUrl,
        });
      }
    }

    if (mapTabUrl) {
      try {
        const mapRes = await axios.get(mapTabUrl, { timeout: 6000 });
        const cleanText = mapRes.data
          .replace(/<\/tr>|<\/p>|<br\s*\/?>/gi, '\n')
          .replace(/<\/td>/gi, ' - ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        await AsyncStorage.setItem(`courseMapText_${url}`, cleanText);
        const baseSheetUrl = url.split('/sheet')[0];
        await AsyncStorage.setItem(`courseMapText_${baseSheetUrl}`, cleanText);
      } catch {}
    }
    
    if (rawTabs.length === 0) return [];

    const rawNames = rawTabs.map(t => t.rawName);
    const parsedNames = await parseTabsWithAI(rawNames);
    
    const tabs: Tab[] = [];
    for (let i = 0; i < rawTabs.length; i++) {
      const aiName = parsedNames[i];
      const newName = (aiName && aiName.trim() !== '') ? aiName.trim() : cleanTabNameFallback(rawTabs[i].rawName);
      if (newName.trim() !== '') {
        tabs.push({ name: newName, url: rawTabs[i].url });
      }
    }
    
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hash: contentHash, tabs }));
    } catch {}

    return tabs;
  } catch (error) {
    console.error('Error fetching tabs:', error);
    return [];
  }
}

export async function fetchScheduleData(tabUrl: string): Promise<ScheduleData> {
  const defaultData: ScheduleData = {
    info: { faculty: '', course: '', year: '', academicYear: '', channel: '', semester: '' },
    alerts: [],
    classrooms: [],
    days: [[], [], [], [], []],
  };

  try {
    const res = await axios.get(tabUrl);
    const html = res.data;

    // Check Cache
    const contentHash = hashCode(html);
    const cacheKey = `scheduleCache_${tabUrl}`;
    try {
      const cachedStr = await AsyncStorage.getItem(cacheKey);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (cached.hash === contentHash && cached.data) {
          return cached.data;
        }
      }
    } catch {}
    
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

    // Trova la riga con i giorni (Lunedì, Martedì, ecc.)
    let dayRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const joined = rows[i].join(' ').toLowerCase();
      if (joined.includes('lunedì') || joined.includes('lunedi')) {
        dayRowIndex = i;
        break;
      }
    }
    if (dayRowIndex === -1) return data;

    // Tutte le righe precedenti alla riga dei giorni costituiscono l'intestazione
    const headerRows = dayRowIndex > 0 ? rows.slice(0, dayRowIndex) : rows.slice(0, 15);
    
    // AI Alert extraction
    data.alerts = await extractAlertsWithAI(headerRows);

    // Parsa le info dall'intestazione
    for (const row of headerRows) {
      const joined = row.join(' ').toLowerCase();
      if (joined.includes('a.a.')) {
        const aaMatch = row.join(' ').match(/\d{4}-\d{2,4}/);
        if (aaMatch) data.info.academicYear = aaMatch[0];
      }
      if (joined.includes('semestre')) {
        data.info.semester = row.slice(1).join(' ').trim();
      }
    }

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

    // Mappa con Gemini le aule al loro rispettivo edificio e indirizzo usando le celle adiacenti dell'intestazione e il tab Mappa Edifici
    const uniqueRooms = Array.from(new Set(parsed.map(p => p.room).filter(Boolean)));
    let mapText = '';
    try {
      const baseSheetUrl = tabUrl.split('/sheet')[0];
      mapText = (await AsyncStorage.getItem(`courseMapText_${baseSheetUrl}`)) || '';
      if (!mapText) {
        const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
        if (storedUrl) {
          mapText = (await AsyncStorage.getItem(`courseMapText_${storedUrl}`)) || '';
        }
      }
    } catch {}

    if (!mapText) {
      mapText = headerRows.map(r => r.join(' ')).join('\n');
    }

    const mappedRooms = await mapClassroomsWithAI(headerRows, mapText, uniqueRooms);

    const uniqueClassroomsMap = new Map<string, ClassroomInfo>();
    Object.values(mappedRooms).forEach(m => {
      if (!uniqueClassroomsMap.has(m.displayName)) {
        uniqueClassroomsMap.set(m.displayName, {
          aulaName: m.displayName,
          building: m.building,
          address: m.address,
        });
      }
    });
    data.classrooms = Array.from(uniqueClassroomsMap.values());

    // Ricostruisci gli eventi per giorno, accorpando slot adiacenti
    for (let day = 0; day < 5; day++) {
      const events: ClassEvent[] = [];
      let currentEvent: ClassEvent | null = null;

      for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
        const flatIdx = slotIdx * 5 + day;
        const p = parsed[flatIdx];
        const slot = timeSlots[slotIdx];

        if (p && p.subject) {
          const roomClean = p.room ? p.room.replace(/^aula\s+/i, '').toLowerCase().trim() : '';
          let mInfo: MappedClassroom | undefined;
          if (day === 0) {
            // Lunedì
            mInfo = mappedRooms[`${roomClean} (lunedi)`] || mappedRooms[`${roomClean} (lunedì)`];
          }
          if (!mInfo) {
            mInfo = mappedRooms[roomClean] || mappedRooms[p.room.toLowerCase().trim()] || mappedRooms[p.room];
          }
          const roomLabel = mInfo ? mInfo.displayName : (p.room ? `Aula ${p.room}` : '');
          
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
              building: mInfo?.building || '',
              address: mInfo?.address || '',
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
    
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hash: contentHash, data }));
    } catch {}

    return data;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return defaultData;
  }
}
