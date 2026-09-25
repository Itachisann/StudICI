import * as cheerio from 'cheerio';
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
    const $ = cheerio.load(res.data);
    const degrees: Degree[] = [];
    $('table tbody tr').each((_, el) => {
      const tds = $(el).find('td');
      const name = $(tds[0]).text().trim();
      const link = $(tds[0]).find('a').attr('href');
      const className = $(tds[1]).text().trim();
      if (name && link) {
        degrees.push({ name, url: link, className });
      }
    });
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
    const $ = cheerio.load(res.data);
    const schedule: string[][] = [];
    
    $('table.waffle tbody tr').each((rowIndex, tr) => {
      const row: string[] = [];
      $(tr).find('td').each((colIndex, td) => {
        row.push($(td).text().trim());
      });
      if (row.some(r => r !== '')) {
        schedule.push(row);
      }
    });
    
    return schedule;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return [];
  }
}
