import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ScheduleData } from './scraper';
import { AttendanceRecord, AttendanceStats } from './attendance';

const SAPIENZA_RED = '#822433';
const DAYS_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
const ACCENT_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

/**
 * Genera ed esporta il PDF dell'orario delle lezioni settimanali strutturato a calendario.
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

  const columnsHtml = schedule.days
    .map((dayClasses, dayIdx) => {
      const dayName = DAYS_NAMES[dayIdx];
      const classesHtml =
        dayClasses.length === 0
          ? `<div class="empty-day">Nessuna lezione</div>`
          : dayClasses
              .map((cls, i) => {
                const color = ACCENT_COLORS[i % ACCENT_COLORS.length];
                return `
                  <div class="class-card" style="border-left: 4px solid ${color};">
                    <div class="class-time-row">
                      <span class="class-time">${cls.startTime} - ${cls.endTime}</span>
                      <span class="class-duration">${cls.duration}h</span>
                    </div>
                    <div class="class-title">${cls.subject?.toUpperCase()}</div>
                    ${
                      cls.teacher
                        ? `<div class="class-teacher">👤 ${cls.teacher}</div>`
                        : ''
                    }
                    ${
                      cls.room
                        ? `<div class="class-room">📍 ${cls.room}</div>`
                        : ''
                    }
                  </div>
                `;
              })
              .join('');

      return `
        <div class="calendar-day-col">
          <div class="day-col-header">
            <span class="day-col-title">${dayName.toUpperCase()}</span>
            <span class="day-col-count">${dayClasses.length} ${dayClasses.length === 1 ? 'lezione' : 'lezioni'}</span>
          </div>
          <div class="day-col-content">
            ${classesHtml}
          </div>
        </div>
      `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>Orario Lezioni - ${courseName}</title>
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
            padding: 0;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid ${SAPIENZA_RED};
            padding-bottom: 12px;
            margin-bottom: 16px;
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
          /* Calendar 5-Column Grid */
          .calendar-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 10px;
          }
          .calendar-day-col {
            background: #f9f9fb;
            border-radius: 10px;
            border: 1px solid #e5e5ea;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .day-col-header {
            background: #ebebf0;
            padding: 8px 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e5e5ea;
          }
          .day-col-title {
            font-size: 12px;
            font-weight: 800;
            color: #1c1c1e;
            letter-spacing: 0.5px;
          }
          .day-col-count {
            font-size: 10px;
            font-weight: 600;
            color: #8e8e93;
          }
          .day-col-content {
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex: 1;
          }
          .class-card {
            background: #ffffff;
            border-radius: 8px;
            padding: 8px 10px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            border: 1px solid #e5e5ea;
          }
          .class-time-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
          }
          .class-time {
            font-size: 11px;
            font-weight: 800;
            color: ${SAPIENZA_RED};
          }
          .class-duration {
            font-size: 9.5px;
            background: #f2f2f7;
            padding: 2px 5px;
            border-radius: 4px;
            font-weight: 700;
            color: #636366;
          }
          .class-title {
            font-size: 11.5px;
            font-weight: 700;
            line-height: 14px;
            color: #1c1c1e;
            margin-bottom: 4px;
          }
          .class-teacher, .class-room {
            font-size: 10px;
            color: #636366;
            margin-top: 2px;
          }
          .empty-day {
            text-align: center;
            padding: 24px 8px;
            color: #aeaeb2;
            font-size: 11px;
            font-style: italic;
          }
          .footer {
            margin-top: 14px;
            border-top: 1px solid #e5e5ea;
            padding-top: 6px;
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
              <h1 class="course-title">${courseName}</h1>
            </div>
          </div>
          <div class="header-meta">
            ${channelName ? `<div>Canale / Anno: <strong>${channelName}</strong></div>` : ''}
            ${schedule?.info?.semester ? `<div>Periodo: <strong>${schedule.info.semester}</strong></div>` : ''}
            <div class="meta-pill">Aggiornato al: ${currentDateFormatted}</div>
          </div>
        </div>

        <div class="calendar-grid">
          ${columnsHtml}
        </div>

        <div class="footer">
          <span>Generato dall'app mobile <strong>StudICI</strong> per Sapienza Università di Roma</span>
          <span>Orario Ufficiale Didattica ICI · Pagina 1 di 1</span>
        </div>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `Orario Lezioni - ${courseName}`,
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
            padding: 0;
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
