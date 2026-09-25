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

export async function fetchSchedule(tabUrl: string): Promise<string[][]> {
  try {
    const res = await axios.get(tabUrl);
    const html = res.data;
    const schedule: string[][] = [];
    
    const tableRegex = /<table[^>]*class=["'][^"']*waffle[^"']*["'][^>]*>([\s\S]*?)<\/table>/i;
    const tableMatch = tableRegex.exec(html);
    
    // If no waffle table is found, maybe fallback to any table or return empty
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
