/**
 * Synthetic AZMA-style screenshot generators.
 *
 * Realistic enough to give the extract turn something to chew on,
 * but every identifier is fictitious. Renders via Playwright's
 * chromium so we don't need Sharp / canvas / GraphicsMagick.
 *
 * Two variants:
 *   - generatePatientChart(scenario, browser) — single-patient chart card
 *     mimicking the AZMA "ניהול מחלקה" patient detail panel. Used for the
 *     admission-emit and SOAP daily-round flows.
 *   - generateLabReportPng(scenario, browser) — Hebrew lab-report card with
 *     CBC + CMP values. Used to exercise the image+lab path.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function generatePatientChart(scenario, browser, opts = {}) {
  const d = scenario.demographics || {};
  const cc = scenario.chief_complaint || 'אשפוז דחוף';
  const adm = scenario.admission_note || {};
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 } });
  const page = await ctx.newPage();
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Arial Hebrew', Arial, sans-serif; padding: 16px; background: #f4f6fa; color: #111; }
    .chart-card { background: #fff; border: 1px solid #aab; border-radius: 8px; padding: 16px; max-width: 860px; }
    .head { background: #1f3a8a; color: #fff; padding: 8px 12px; border-radius: 4px; margin: -16px -16px 16px; font-size: 17px; }
    .row { display: flex; gap: 16px; margin: 8px 0; font-size: 15px; }
    .row > div { flex: 1; }
    .label { color: #666; font-size: 13px; margin-bottom: 2px; }
    .val { font-weight: 600; }
    .section { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #888; font-size: 14px; line-height: 1.5; }
    .section h3 { font-size: 14px; margin: 0 0 6px; color: #1f3a8a; }
    .meds { background: #fffce8; padding: 8px; border-right: 4px solid #d4a800; font-size: 13px; }
  </style>
</head>
<body>
  <div class="chart-card">
    <div class="head">ניהול מחלקה — מטופל ${escapeHtml(d.room || '00')}-${escapeHtml(d.bed || 'A')}</div>
    <div class="row">
      <div><div class="label">שם</div><div class="val">${escapeHtml(d.name_he || 'לא ידוע')}</div></div>
      <div><div class="label">ת.ז.</div><div class="val">${escapeHtml(d.tz || '000000000')}</div></div>
      <div><div class="label">גיל</div><div class="val">${escapeHtml(String(d.age || '?'))}</div></div>
      <div><div class="label">מין</div><div class="val">${escapeHtml(d.sex || '?')}</div></div>
    </div>
    <div class="row">
      <div><div class="label">חדר</div><div class="val">${escapeHtml(d.room || '00')}</div></div>
      <div><div class="label">מיטה</div><div class="val">${escapeHtml(d.bed || 'A')}</div></div>
      <div><div class="label">תאריך אשפוז</div><div class="val">2026-05-10</div></div>
      <div><div class="label">צוות</div><div class="val">גריאטריה ב'</div></div>
    </div>
    <div class="section">
      <h3>תלונה עיקרית</h3>
      <div>${escapeHtml(cc)}</div>
    </div>
    <div class="section">
      <h3>סיכום קבלה — S</h3>
      <div>${escapeHtml(adm.S || '—')}</div>
    </div>
    <div class="section">
      <h3>בדיקה — O</h3>
      <div>${escapeHtml(adm.O || '—')}</div>
    </div>
    <div class="section">
      <h3>הערכה — A</h3>
      <div>${escapeHtml(adm.A || '—')}</div>
    </div>
    <div class="section">
      <h3>תכנית — P</h3>
      <div class="meds">${escapeHtml(adm.P || '—')}</div>
    </div>
  </div>
</body>
</html>`;
  await page.setContent(html);
  await new Promise((r) => setTimeout(r, opts.fontDelayMs ?? 300));
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  await ctx.close();
  return buf;
}

export async function generateLabReportPng(scenario, browser) {
  const d = scenario.demographics || {};
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1100 } });
  const page = await ctx.newPage();
  // Plausible CBC + CMP values for a 80yo with infection.
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Arial Hebrew', Arial, sans-serif; padding: 22px; background: #fff; color: #000; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .meta { font-size: 13px; margin-bottom: 16px; color: #444; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th { background: #ccd; padding: 6px 10px; text-align: right; }
    td { padding: 6px 10px; border-bottom: 1px solid #ddd; }
    .high { color: #b00; font-weight: 700; }
    .low  { color: #02a; font-weight: 700; }
  </style>
</head>
<body>
  <h1>בדיקות מעבדה — ${escapeHtml(d.name_he || 'לא ידוע')} / ${escapeHtml(d.tz || '000000000')}</h1>
  <div class="meta">2026-05-10 06:30 — מ.מ. שערי צדק — מ.מ. ${escapeHtml(d.room || '00')}/${escapeHtml(d.bed || 'A')}</div>
  <table>
    <tr><th>פרמטר</th><th>ערך</th><th>יחידות</th><th>טווח</th></tr>
    <tr><td>WBC</td><td class="high">14.7</td><td>K/μL</td><td>4-11</td></tr>
    <tr><td>Hb</td><td class="low">10.8</td><td>g/dL</td><td>12-16</td></tr>
    <tr><td>Plt</td><td>248</td><td>K/μL</td><td>150-450</td></tr>
    <tr><td>Na</td><td class="low">132</td><td>mmol/L</td><td>135-145</td></tr>
    <tr><td>K</td><td>4.1</td><td>mmol/L</td><td>3.5-5.0</td></tr>
    <tr><td>Cr</td><td class="high">1.6</td><td>mg/dL</td><td>0.6-1.2</td></tr>
    <tr><td>BUN</td><td class="high">42</td><td>mg/dL</td><td>7-20</td></tr>
    <tr><td>CRP</td><td class="high">112</td><td>mg/L</td><td>0-5</td></tr>
    <tr><td>Glucose</td><td>148</td><td>mg/dL</td><td>70-100</td></tr>
    <tr><td>Albumin</td><td class="low">2.9</td><td>g/dL</td><td>3.5-5.0</td></tr>
  </table>
</body>
</html>`;
  await page.setContent(html);
  await new Promise((r) => setTimeout(r, 300));
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  await ctx.close();
  return buf;
}
