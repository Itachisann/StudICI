import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { ScheduleData } from './scraper';
import { AttendanceRecord, AttendanceStats } from './attendance';

const SAPIENZA_RED = '#822433';
const DAYS_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
const ACCENT_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];


const escapeHtml = (s?: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const timeToMinutes = (t: string) => {
  const [h, m] = (t || '0:0').split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
};

/**
 * Rinomina il PDF generato (nome casuale) con un nome leggibile, es. "Orario.pdf".
 * In caso di errore ripiega sull'URI originale.
 */
async function renamePdf(uri: string, fileName: string): Promise<string> {
  try {
    const source = new File(uri);
    const target = new File(Paths.cache, fileName);
    await source.move(target, { overwrite: true });
    return target.uri;
  } catch {
    return uri;
  }
}

/**
 * Genera ed esporta il PDF dell'orario delle lezioni settimanali strutturato a calendario:
 * colonne = giorni, righe = fasce orarie; ogni lezione è posizionata nella fascia corretta.
 */
export async function exportScheduleToPdf(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string
): Promise<string> {
  const currentDateFormatted = new Date().toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const allClasses = schedule.days.flat();
  const starts = allClasses.map((c) => timeToMinutes(c.startTime));
  const ends = allClasses.map((c) => timeToMinutes(c.endTime));
  const gridStart = allClasses.length ? Math.min(8 * 60, Math.floor(Math.min(...starts) / 60) * 60) : 8 * 60;
  const gridEnd = allClasses.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
  const hours = Math.max(1, (gridEnd - gridStart) / 60);
  const hourH = Math.max(36, Math.min(64, Math.floor(450 / hours)));
  const gridHeight = hours * hourH;
  const BOTTOM_PAD = 22; // spazio sotto l'ultima fascia oraria

  // Colore stabile per materia
  const subjectColors = new Map<string, string>();
  allClasses.forEach((c) => {
    const key = (c.subject || '').toUpperCase();
    if (!subjectColors.has(key)) {
      subjectColors.set(key, ACCENT_COLORS[subjectColors.size % ACCENT_COLORS.length]);
    }
  });

  // Le etichette sono centrate sulla riga della propria ora: una lezione 15-19 inizia
  // esattamente a "15:00" e finisce esattamente a "19:00".
  const endLabelHtml = `<div class="hour-label" style="top:${gridHeight - 6}px;">${String(gridEnd / 60).padStart(2, '0')}:00</div>`;

  const hourLabelsHtml =
    Array.from({ length: hours }, (_, i) => {
      const h = gridStart / 60 + i;
      const top = i === 0 ? 1 : i * hourH - 6;
      return `<div class="hour-label" style="top:${top}px;">${String(h).padStart(2, '0')}:00</div>`;
    }).join('') + endLabelHtml;

  const hourLinesHtml = Array.from({ length: hours + 1 }, (_, i) => {
    return `<div class="hour-line" style="top:${i * hourH}px;"></div>`;
  }).join('');

  const columnsHtml = DAYS_NAMES.map((dayName, dayIdx) => {
    const dayClasses = [...(schedule.days[dayIdx] || [])]
      .map((c) => ({ c, s: timeToMinutes(c.startTime), e: timeToMinutes(c.endTime) }))
      .sort((a, b) => a.s - b.s || a.e - b.e);

    // Gestione lezioni sovrapposte: assegna corsie dentro a ogni gruppo di sovrapposizione
    const placed: { c: (typeof dayClasses)[number]['c']; s: number; e: number; lane: number; lanes: number }[] = [];
    let cluster: typeof placed = [];
    let laneEnds: number[] = [];
    let clusterEnd = -1;
    const flush = () => {
      cluster.forEach((p) => (p.lanes = laneEnds.length));
      placed.push(...cluster);
      cluster = [];
      laneEnds = [];
    };
    dayClasses.forEach((item) => {
      if (cluster.length && item.s >= clusterEnd) flush();
      let lane = laneEnds.findIndex((end) => end <= item.s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.e);
      } else {
        laneEnds[lane] = item.e;
      }
      clusterEnd = Math.max(clusterEnd, item.e);
      cluster.push({ ...item, lane, lanes: 1 });
    });
    flush();

    const lessonsHtml = placed
      .map((p) => {
        const color = subjectColors.get((p.c.subject || '').toUpperCase()) || ACCENT_COLORS[0];
        const top = ((p.s - gridStart) / 60) * hourH + 1;
        const height = ((p.e - p.s) / 60) * hourH - 2;
        const width = 100 / p.lanes;
        return `
          <div class="lesson" style="top:${top}px; height:${height}px; left:calc(${p.lane * width}% + 1px); width:calc(${width}% - 2px); border-left:3px solid ${color}; background:linear-gradient(${color}22, ${color}22), #ffffff;">
            <div class="lesson-time">${escapeHtml(p.c.startTime)} - ${escapeHtml(p.c.endTime)}</div>
            <div class="lesson-title">${escapeHtml((p.c.subject || '').toUpperCase())}</div>
            ${p.c.teacher ? `<div class="lesson-meta">${escapeHtml(p.c.teacher)}</div>` : ''}
            ${p.c.room ? `<div class="lesson-room">Aula ${escapeHtml(p.c.room)}</div>` : ''}
          </div>
        `;
      })
      .join('');

    return `
      <div class="day-col">
        <div class="day-head">${dayName.toUpperCase()}</div>
        <div class="day-body" style="height:${gridHeight + BOTTOM_PAD}px;">
          ${hourLinesHtml}
          ${lessonsHtml}
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>Orario</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #ffffff;
            color: #1c1c1e;
            margin: 0;
            padding: 32px 0 0 0;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid ${SAPIENZA_RED};
            padding-bottom: 10px;
            margin-bottom: 12px;
          }
          .logo-box {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .badge-sapienza {
            background-color: ${SAPIENZA_RED};
            color: #ffffff;
            font-weight: 800;
            font-size: 13px;
            padding: 6px 12px;
            border-radius: 6px;
            letter-spacing: 0.5px;
          }
          .university-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #636366;
            margin: 0;
          }
          .course-title {
            font-size: 18px;
            font-weight: 800;
            color: #111111;
            margin: 2px 0 0 0;
          }
          .header-meta {
            text-align: right;
            font-size: 12px;
            color: #636366;
          }
          .meta-pill {
            display: inline-block;
            background: #f2f2f7;
            padding: 4px 10px;
            border-radius: 12px;
            font-weight: 600;
            color: #3a3a3c;
            margin-top: 4px;
          }
          .calendar {
            display: flex;
            border: 1px solid #d1d1d6;
            border-radius: 8px;
            overflow: hidden;
          }
          .time-col {
            width: 48px;
            flex: none;
            background: #f9f9fb;
            border-right: 1px solid #d1d1d6;
          }
          .time-head, .day-head {
            height: 26px;
            line-height: 26px;
            background: #ebebf0;
            border-bottom: 1px solid #d1d1d6;
            text-align: center;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            color: #1c1c1e;
          }
          .time-body {
            position: relative;
            height: ${gridHeight + BOTTOM_PAD}px;
          }
          .hour-label {
            position: absolute;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 9px;
            font-weight: 600;
            color: #8e8e93;
            padding-top: 2px;
          }
          .day-col {
            flex: 1;
            min-width: 0;
            border-right: 1px solid #d1d1d6;
          }
          .day-col:last-child {
            border-right: none;
          }
          .day-body {
            position: relative;
            background: #ffffff;
          }
          .hour-line {
            position: absolute;
            left: 0;
            right: 0;
            height: 0;
            border-top: 1px solid #e5e5ea;
          }
          .lesson {
            position: absolute;
            border-radius: 5px;
            padding: 3px 5px;
            overflow: hidden;
          }
          .lesson-time {
            font-size: 8.5px;
            font-weight: 800;
            color: ${SAPIENZA_RED};
          }
          .lesson-title {
            font-size: 9.5px;
            font-weight: 800;
            line-height: 11px;
            color: #1c1c1e;
            margin-top: 1px;
          }
          .lesson-meta, .lesson-room {
            font-size: 8.5px;
            line-height: 10px;
            color: #48484a;
            margin-top: 1px;
          }
          .lesson-room {
            font-weight: 700;
          }
          .footer {
            margin-top: 8px;
            display: flex;
            justify-content: space-between;
            font-size: 9.5px;
            color: #8e8e93;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo-box">
            <span class="badge-sapienza">SAPIENZA</span>
            <div>
              <p class="university-title">Facoltà di Ingegneria Civile e Industriale</p>
              <h1 class="course-title">${escapeHtml(courseName)}</h1>
            </div>
          </div>
          <div class="header-meta">
            ${channelName ? `<div>Canale / Anno: <strong>${escapeHtml(channelName)}</strong></div>` : ''}
            ${schedule?.info?.semester ? `<div>Periodo: <strong>${escapeHtml(schedule.info.semester)}</strong></div>` : ''}
            <div class="meta-pill">Aggiornato al: ${currentDateFormatted}</div>
          </div>
        </div>

        <div class="calendar">
          <div class="time-col">
            <div class="time-head">ORA</div>
            <div class="time-body">${hourLabelsHtml}</div>
          </div>
          ${columnsHtml}
        </div>

        <div class="footer">
          <span>Generato dall'app mobile <strong>StudICI</strong> per Sapienza Università di Roma</span>
          <span>Orario Ufficiale Didattica ICI</span>
        </div>
      </body>
    </html>
  `;

  const { uri: rawUri } = await Print.printToFileAsync({ html });
  const uri = await renamePdf(rawUri, 'Orario.pdf');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: 'Orario',
    });
  }
  return uri;
}


/**
 * Genera ed esporta il PDF del Registro Presenze con frequenza lezioni e dettaglio calendario.
 */
export async function exportAttendanceToPdf(
  records: AttendanceRecord[],
  stats: AttendanceStats | null,
  courseName: string
): Promise<string> {
  const currentDateFormatted = new Date().toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Raggruppamento presenze per data (calendario presenze)
  const map = new Map<string, { date: string; displayDate: string; dayName: string; records: AttendanceRecord[] }>();
  const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);

  for (const r of sorted) {
    const key = r.date || 'other';
    if (!map.has(key)) {
      map.set(key, {
        date: r.date,
        displayDate: r.displayDate || r.date,
        dayName: r.dayName || 'Giorno',
        records: [],
      });
    }
    map.get(key)!.records.push(r);
  }

  const groupedList = Array.from(map.values());

  const subjectStatsRows =
    stats?.subjectStats && stats.subjectStats.length > 0
      ? stats.subjectStats
          .map(
            (s, idx) => `
          <tr>
            <td style="font-weight: 700;">${idx + 1}. ${s.subject.toUpperCase()}</td>
            <td style="text-align: center; font-weight: 600;">${s.count} lezioni</td>
            <td style="text-align: center; font-weight: 700; color: #10b981;">${s.hours} ore</td>
            <td style="text-align: right; color: #636366;">${s.lastDate}</td>
          </tr>
        `
          )
          .join('')
      : `<tr><td colspan="4" style="text-align: center; color: #8e8e93;">Nessuna materia registrata</td></tr>`;

  const calendarDaysHtml =
    groupedList.length === 0
      ? `<div style="text-align:center; padding: 30px; color: #8e8e93; font-style: italic;">Nessuna presenza registrata finora.</div>`
      : groupedList
          .map(group => {
            const recordsHtml = group.records
              .map(
                r => `
              <div class="attendance-item-row">
                <div class="item-time">${r.startTime} - ${r.endTime} (${r.duration}h)</div>
                <div class="item-subject"><strong>${r.subject.toUpperCase()}</strong></div>
                ${r.room ? `<div class="item-room">📍 ${r.room}</div>` : ''}
                <div class="item-status"><span class="badge-presente">✓ FREQUENTATA</span></div>
              </div>
            `
              )
              .join('');

            return `
              <div class="attendance-day-group">
                <div class="day-group-header">
                  <span>📅 <strong>${group.dayName.toUpperCase()}</strong> · ${group.displayDate.toUpperCase()}</span>
                  <span>${group.records.length} ${group.records.length === 1 ? 'lezione' : 'lezioni'}</span>
                </div>
                ${recordsHtml}
              </div>
            `;
          })
          .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>Registro Presenze - ${courseName}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #ffffff;
            color: #1c1c1e;
            margin: 0;
            padding: 32px 0 0 0;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid ${SAPIENZA_RED};
            padding-bottom: 12px;
            margin-bottom: 16px;
          }
          .badge-sapienza {
            background-color: ${SAPIENZA_RED};
            color: #ffffff;
            font-weight: 800;
            font-size: 13px;
            padding: 6px 12px;
            border-radius: 6px;
          }
          .university-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #636366;
            margin: 0;
          }
          .title-main {
            font-size: 20px;
            font-weight: 800;
            color: #111111;
            margin: 4px 0 0 0;
          }
          .header-meta {
            text-align: right;
            font-size: 12px;
            color: #636366;
          }
          /* KPI Cards */
          .kpi-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }
          .kpi-card {
            background: #f9f9fb;
            border: 1px solid #e5e5ea;
            border-radius: 10px;
            padding: 12px 14px;
            text-align: center;
          }
          .kpi-val {
            font-size: 24px;
            font-weight: 800;
            color: #1c1c1e;
          }
          .kpi-label {
            font-size: 10px;
            font-weight: 700;
            color: #8e8e93;
            letter-spacing: 0.6px;
            margin-top: 2px;
          }
          /* Section headers */
          .section-title {
            font-size: 13px;
            font-weight: 800;
            color: ${SAPIENZA_RED};
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin: 16px 0 8px 0;
          }
          /* Table */
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-bottom: 20px;
          }
          th {
            background: #f2f2f7;
            padding: 8px 10px;
            text-align: left;
            font-weight: 700;
            color: #3a3a3c;
            border-bottom: 1px solid #d1d1d6;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #e5e5ea;
          }
          /* Day Group */
          .attendance-day-group {
            background: #f9f9fb;
            border-radius: 8px;
            border: 1px solid #e5e5ea;
            margin-bottom: 10px;
            overflow: hidden;
          }
          .day-group-header {
            background: #ebebf0;
            padding: 6px 12px;
            font-size: 11px;
            font-weight: 700;
            color: #3a3a3c;
            display: flex;
            justify-content: space-between;
          }
          .attendance-item-row {
            display: grid;
            grid-template-columns: 140px 1fr 100px 110px;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid #efeff4;
            font-size: 11.5px;
          }
          .attendance-item-row:last-child {
            border-bottom: none;
          }
          .item-time {
            color: #636366;
            font-weight: 600;
          }
          .item-room {
            color: #ef4444;
            font-weight: 500;
          }
          .badge-presente {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            font-weight: 700;
            font-size: 9.5px;
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid rgba(16, 185, 129, 0.3);
          }
          .footer {
            margin-top: 24px;
            border-top: 1px solid #e5e5ea;
            padding-top: 8px;
            display: flex;
            justify-content: space-between;
            font-size: 9.5px;
            color: #8e8e93;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <span class="badge-sapienza">SAPIENZA</span>
            <p class="university-title" style="margin-top: 6px;">Facoltà di Ingegneria Civile e Industriale</p>
            <h1 class="title-main">Registro Presenze & Frequenza</h1>
            <div style="font-size: 13px; color: #3a3a3c; margin-top: 2px;">Corso: <strong>${courseName}</strong></div>
          </div>
          <div class="header-meta">
            <div>Data rilascio: <strong>${currentDateFormatted}</strong></div>
            <div>Stato: <strong style="color: #10b981;">Certificato Studente</strong></div>
          </div>
        </div>

        <div class="kpi-row">
          <div class="kpi-card">
            <div class="kpi-val" style="color: #10b981;">${stats?.totalHours || 0}h</div>
            <div class="kpi-label">ORE TOTALI FREQUENZA</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #3b82f6;">${stats?.totalLessons || 0}</div>
            <div class="kpi-label">LEZIONI FREQUENTATE</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #a855f7;">${stats?.subjectsCount || 0}</div>
            <div class="kpi-label">MATERIE SEGUITE</div>
          </div>
        </div>

        <div class="section-title">Riepilogo Frequenza per Materia</div>
        <table>
          <thead>
            <tr>
              <th>Materia</th>
              <th style="text-align: center;">Lezioni</th>
              <th style="text-align: center;">Ore Totali</th>
              <th style="text-align: right;">Ultima Lezione</th>
            </tr>
          </thead>
          <tbody>
            ${subjectStatsRows}
          </tbody>
        </table>

        <div class="section-title">Calendario Dettagliato delle Presenze</div>
        ${calendarDaysHtml}

        <div class="footer">
          <span>Registro generato tramite applicazione mobile <strong>StudICI</strong></span>
          <span>Sapienza Università di Roma · Documento per uso accademico e personale</span>
        </div>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `Registro Presenze - ${courseName}`,
    });
  }
  return uri;
}
