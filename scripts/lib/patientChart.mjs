/**
 * patientChart.mjs — render a synthetic ward-helper scenario to a
 * self-contained HTML chart that the user can open and browse.
 *
 * Output looks like a real SZMC ward chart: admission note (S/O/A/P),
 * daily SOAP rounds, consult letters, discharge summary, vitals chart,
 * lab trends. All Hebrew with embedded English drug names.
 *
 * This is the "see those records as true patients" deliverable — when
 * the bot finishes a 30-min mega-run, the user gets a directory of
 * patient charts they can browse like a chart-rounds workflow.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSection(title, body) {
  if (!body) return '';
  return `<section class="chart-sec"><h2>${esc(title)}</h2><div class="body">${body}</div></section>`;
}

function renderSOAP(soap) {
  if (!soap) return '<em>—</em>';
  return `
    <div class="soap">
      <div><span class="lbl">S:</span> ${esc(soap.S || '—')}</div>
      <div><span class="lbl">O:</span> ${esc(soap.O || '—')}</div>
      <div><span class="lbl">A:</span> ${esc(soap.A || '—')}</div>
      <div><span class="lbl">P:</span> ${esc(soap.P || '—')}</div>
    </div>`;
}

const CSS = `
  body { margin: 0; font-family: 'Segoe UI', 'Arial Hebrew', Arial, sans-serif; background: #f3f5f8; color: #111; direction: rtl; }
  header.chart-head {
    background: linear-gradient(135deg, #1e40af, #1e3a8a);
    color: white; padding: 18px 22px;
  }
  header.chart-head h1 { margin: 0 0 6px; font-size: 24px; }
  header.chart-head .meta { font-size: 14px; opacity: 0.92; }
  main { max-width: 920px; margin: 0 auto; padding: 16px; }
  .demographics {
    background: white; border-radius: 8px; padding: 14px 18px;
    margin: -28px 16px 16px; position: relative;
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px;
  }
  .demographics .field .lbl { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .demographics .field .val { font-weight: 600; font-size: 15px; }
  .chart-sec {
    background: white; border-radius: 8px; padding: 16px 20px;
    margin: 12px 0; box-shadow: 0 2px 6px rgba(0,0,0,0.04);
  }
  .chart-sec h2 {
    font-size: 16px; margin: 0 0 10px; padding-bottom: 8px;
    border-bottom: 2px solid #1e40af; color: #1e3a8a;
  }
  .chart-sec .body { font-size: 14px; line-height: 1.6; }
  .soap { display: flex; flex-direction: column; gap: 6px; }
  .soap .lbl { display: inline-block; min-width: 24px; font-weight: 700; color: #1e40af; }
  .soap-day {
    border-right: 3px solid #1e40af; padding-right: 12px; margin: 12px 0;
  }
  .soap-day h3 { margin: 0 0 6px; font-size: 14px; color: #1e3a8a; }
  .meds-card {
    background: #fffce8; border-right: 4px solid #d4a800;
    padding: 10px 14px; border-radius: 4px; font-size: 13px;
  }
  .consult {
    border: 1px dashed #94a3b8; padding: 10px 14px;
    margin-top: 10px; border-radius: 6px; background: #f8fafc;
  }
  .consult .from-to { font-size: 12px; color: #64748b; margin-bottom: 4px; }
  .footer-meta {
    text-align: center; color: #64748b; font-size: 11px; padding: 16px;
  }
  .badge {
    display: inline-block; background: #dbeafe; color: #1e3a8a;
    padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 4px;
  }
`;

export function renderPatientChartHtml(scenario, meta = {}) {
  const d = scenario.demographics || {};
  const adm = scenario.admission_note || {};
  const soap = scenario.soap_rounds || [];
  const consults = scenario.consult_letters || [];
  const dis = scenario.discharge_letter;

  const personaTag = meta.persona ? `<span class="badge">${esc(meta.persona)}</span>` : '';
  const synthTag = '<span class="badge" style="background:#fee2e2;color:#991b1b">SYNTHETIC — not a real patient</span>';

  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <title>${esc(d.name_he || 'מטופל')} — ת.ז. ${esc(d.tz || '')}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="chart-head">
    <h1>${esc(d.name_he || 'מטופל ללא שם')}</h1>
    <div class="meta">
      ${synthTag}
      ${personaTag}
      ${meta.scenarioId ? `<span class="badge">${esc(meta.scenarioId)}</span>` : ''}
      ${meta.generatedBy ? `<span class="badge">${esc(meta.generatedBy)}</span>` : ''}
    </div>
  </header>
  <div class="demographics">
    <div class="field"><div class="lbl">ת.ז.</div><div class="val">${esc(d.tz || '—')}</div></div>
    <div class="field"><div class="lbl">גיל</div><div class="val">${esc(d.age || '—')}</div></div>
    <div class="field"><div class="lbl">מין</div><div class="val">${esc(d.sex || '—')}</div></div>
    <div class="field"><div class="lbl">חדר</div><div class="val">${esc(d.room || '—')}-${esc(d.bed || '')}</div></div>
  </div>
  <main>
    ${renderSection('תלונה עיקרית', `<div>${esc(scenario.chief_complaint || '—')}</div>`)}
    ${renderSection('סיכום קבלה', renderSOAP(adm))}
    ${soap.length > 0 ? renderSection('מעקב יומי (SOAP)',
      soap.map((s) => `<div class="soap-day"><h3>יום ${esc(s.day)}</h3>${renderSOAP(s)}</div>`).join('')
    ) : ''}
    ${consults.length > 0 ? renderSection('יעוצים',
      consults.map((c) => `<div class="consult"><div class="from-to">${esc(c.from || '?')} → ${esc(c.to || '?')}</div><div>${esc(c.body || '—')}</div></div>`).join('')
    ) : ''}
    ${dis ? renderSection('סיכום שחרור',
      `<div><strong>סיכום:</strong> ${esc(dis.summary || '—')}</div>` +
      `<div class="meds-card" style="margin-top:8px"><strong>תרופות בשחרור:</strong> ${esc(dis.meds_at_discharge || '—')}</div>` +
      `<div style="margin-top:8px"><strong>המשך טיפול:</strong> ${esc(dis.follow_up || '—')}</div>`
    ) : ''}
  </main>
  <div class="footer-meta">
    דוח סינתטי שנוצר על-ידי ward-helper-mega-bot ב-${new Date().toISOString()} —
    כל הפרטים פיקטיביים, לא להשתמש קלינית.
  </div>
</body>
</html>`;
  return html;
}

/**
 * Render a gallery index page that links to all patient charts.
 */
export function renderGalleryIndex(scenarios, meta = {}) {
  const cards = scenarios.map((s) => {
    const d = s.demographics || {};
    const filename = `${s.scenario_id}.html`;
    return `
      <a class="card" href="${esc(filename)}">
        <div class="card-name">${esc(d.name_he || 'ללא שם')}</div>
        <div class="card-meta">
          ת.ז. ${esc(d.tz || '—')} · גיל ${esc(d.age || '—')} · חדר ${esc(d.room || '—')}-${esc(d.bed || '')}
        </div>
        <div class="card-cc">${esc(s.chief_complaint || '—').slice(0, 80)}</div>
        <div class="card-tags">
          ${s._persona ? `<span class="tag">${esc(s._persona)}</span>` : ''}
          <span class="tag soap">${(s.soap_rounds || []).length} ימי SOAP</span>
          ${s.discharge_letter ? '<span class="tag green">שוחרר</span>' : ''}
        </div>
      </a>`;
  }).join('\n');

  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <title>גלריית מטופלים סינתטיים — ${esc(meta.runId || '')}</title>
  <style>
    body { margin: 0; font-family: 'Segoe UI', 'Arial Hebrew', Arial, sans-serif; background: #f3f5f8; color: #111; direction: rtl; }
    header { background: linear-gradient(135deg, #1e40af, #1e3a8a); color: white; padding: 22px; }
    header h1 { margin: 0 0 6px; font-size: 24px; }
    header .sub { font-size: 14px; opacity: 0.9; }
    main { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid;
           grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .card { background: white; border-radius: 8px; padding: 14px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.05); text-decoration: none;
            color: inherit; transition: transform 0.15s, box-shadow 0.15s; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .card-name { font-weight: 700; font-size: 16px; color: #1e3a8a; margin-bottom: 6px; }
    .card-meta { font-size: 12px; color: #64748b; margin-bottom: 8px; }
    .card-cc { font-size: 13px; line-height: 1.4; min-height: 36px; }
    .card-tags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { background: #dbeafe; color: #1e3a8a; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
    .tag.soap { background: #fef3c7; color: #92400e; }
    .tag.green { background: #d1fae5; color: #065f46; }
    .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>🏥 גלריית מטופלים סינתטיים</h1>
    <div class="sub">
      ${esc(scenarios.length)} מטופלים · ${esc(meta.runId || 'unknown')} ·
      ${esc(meta.duration || '')}
      <br>
      <strong>אזהרה: כל הפרטים פיקטיביים — לא לשימוש קליני.</strong>
    </div>
  </header>
  <main>${cards}</main>
  <div class="footer">
    נוצר על-ידי <code>ward-helper-mega-bot</code> ב-${new Date().toISOString()}
  </div>
</body>
</html>`;
}

export async function writePatientGallery(scenarios, outDir, meta = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const written = [];
  for (const s of scenarios) {
    const html = renderPatientChartHtml(s, { persona: s._persona, scenarioId: s.scenario_id, ...meta });
    const fname = `${s.scenario_id}.html`;
    await fs.writeFile(path.resolve(outDir, fname), html, 'utf8');
    written.push(fname);
  }
  const indexHtml = renderGalleryIndex(scenarios, meta);
  await fs.writeFile(path.resolve(outDir, 'index.html'), indexHtml, 'utf8');
  return { count: written.length, indexPath: path.resolve(outDir, 'index.html') };
}
