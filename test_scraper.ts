import { fetchDegrees, fetchTabs, fetchSchedule } from './src/utils/scraper';

async function test() {
  const degrees = await fetchDegrees();
  console.log("Degrees:", degrees.length);
  if (degrees.length > 0) {
    const tabs = await fetchTabs(degrees[0].url);
    console.log("Tabs:", tabs.map(t => t.name));
    if (tabs.length > 0) {
      const schedule = await fetchSchedule(tabs[0].url);
      console.log("Schedule Rows:");
      schedule.slice(0, 10).forEach(r => console.log(r));
    }
  }
}

test();
