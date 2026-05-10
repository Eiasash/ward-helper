#!/usr/bin/env node
/**
 * analyze-mega-run.mjs — comparison report + design-feedback emitter for
 * mega-bot runs. Reads a new run's `.md` + `-timeline.jsonl` and a baseline
 * `.md` (typically the most recent prior run) and emits a comparison
 * markdown that answers the four design-feedback questions Web-Claude
 * asked the orchestrator to answer:
 *
 *   1. Which sub-bots produced ≥80% real signal (vs noise)?
 *   2. Which personas were "bad value" — high action count, low yield?
 *   3. Which chaos events were redundant vs each other?
 *   4. What 1-2 fixture scenarios would expose flows neither persona is hitting?
 *
 * Plus a 1-paragraph web-Claude write-back block (bug count + gallery URL
 * + sibling-app patterns + sibling-port grep recipes).
 *
 * Usage:
 *   node scripts/analyze-mega-run.mjs <new-run-id> [--baseline=<old-run-id>]
 *
 *   New run id format: wm-2026-05-10T18-37-34
 *   Baseline defaults to wm-2026-05-10T17-13-37 (the rich baseline of the
 *   prior 10-persona Opus run).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { checkV42Invariant, V4_SUB_BOTS_REQUIRING_WAIT } from './lib/v42Invariant.mjs';

const REPORT_DIR = 'chaos-reports/ward-bot-mega';
const DEFAULT_BASELINE = 'wm-2026-05-10T17-13-37';
const LIVE_GALLERY_BASE_URL = 'https://eiasash.github.io/ward-helper/';

function parseArgs(argv) {
  const args = { newRunId: null, baseline: DEFAULT_BASELINE };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--baseline=')) args.baseline = a.split('=')[1];
    else if (!args.newRunId) args.newRunId = a;
  }
  if (!args.newRunId) {
    console.error('usage: analyze-mega-run.mjs <new-run-id> [--baseline=<old-run-id>]');
    process.exit(2);
  }
  return args;
}

async function readReportMd(runId) {
  const p = path.resolve(REPORT_DIR, `${runId}.md`);
  return fs.readFile(p, 'utf8');
}

async function readTimelineJsonl(runId) {
  const p = path.resolve(REPORT_DIR, `${runId}-timeline.jsonl`);
  try {
    const txt = await fs.readFile(p, 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// ─── Parsers (lightweight — match the report.md table shape) ──────────────

function extractTotalBugs(md) {
  const m = md.match(/Total bugs:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

function extractSeverityCounts(md) {
  const out = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const sev of Object.keys(out)) {
    const m = md.match(new RegExp(`\\*\\*${sev}\\*\\*:\\s*(\\d+)`));
    if (m) out[sev] = Number(m[1]);
  }
  return out;
}

function extractPersonaTable(md) {
  const sec = md.match(/## Per-persona summary\s*\n([\s\S]*?)\n\s*\n/);
  if (!sec) return [];
  const rows = sec[1].split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Persona') && !l.startsWith('|---'));
  return rows.map((r) => {
    const cols = r.split('|').map((c) => c.trim()).filter(Boolean);
    return {
      persona: cols[0],
      wall: cols[1],
      actions: Number(cols[2]) || 0,
      chaos: Number(cols[3]) || 0,
      // V4 reports have extra columns: useful, useful/min
      usefulActions: Number(cols[4]) || null,
      usefulPerMin: Number(cols[5]) || null,
      errors: Number(cols.at(-2)) || 0,
      recoveries: Number(cols.at(-1)) || 0,
    };
  });
}

function extractFlowTable(md) {
  const sec = md.match(/## Bug summary by flow\s*\n([\s\S]*?)\n\s*\n/);
  if (!sec) return [];
  const rows = sec[1].split('\n').filter((l) => l.startsWith('| `'));
  return rows.map((r) => {
    const cols = r.split('|').map((c) => c.trim()).filter(Boolean);
    return {
      flow: cols[0].replace(/^`|`$/g, ''),
      crit: Number(cols[1]) || 0,
      high: Number(cols[2]) || 0,
      med: Number(cols[3]) || 0,
      low: Number(cols[4]) || 0,
      total: Number(cols[5]) || 0,
    };
  });
}

function extractSubBotPrecision(md) {
  const sec = md.match(/## Per-sub-bot precision[\s\S]*?\n\| Sub-bot[\s\S]*?\n([\s\S]*?)\n\s*\n/);
  if (!sec) return [];
  const rows = sec[1].split('\n').filter((l) => l.startsWith('| '));
  return rows.map((r) => {
    const cols = r.split('|').map((c) => c.trim()).filter(Boolean);
    return {
      subBot: cols[0],
      total: Number(cols[1]) || 0,
      crit: Number(cols[2]) || 0,
      high: Number(cols[3]) || 0,
      med: Number(cols[4]) || 0,
      low: Number(cols[5]) || 0,
      precision: Number(cols[6]) || 0,
    };
  });
}

function extractCostItemization(md) {
  const sec = md.match(/## Cost itemization\s*\n([\s\S]*?)\n\s*\n/);
  return sec ? sec[1] : null;
}

function extractCoverageStatus(md) {
  const sec = md.match(/## Min-coverage scheduler status\s*\n[\s\S]*?\n\| Sub-bot[\s\S]*?\n([\s\S]*?)\n\s*\n/);
  if (!sec) return [];
  const rows = sec[1].split('\n').filter((l) => l.startsWith('| '));
  return rows.map((r) => {
    const cols = r.split('|').map((c) => c.trim()).filter(Boolean);
    return { subBot: cols[0], fired: Number(cols[1]) || 0, target: Number(cols[2]) || 0, met: cols[3].includes('✓') };
  });
}

// ─── Chaos-event redundancy (overlap in flag-set per chaos action) ───────

function chaosRedundancy(timeline, bugs) {
  // For each chaos event in the timeline, find bugs that fired in the
  // 5s window after it (proxy for "this chaos triggered this bug").
  // Compute Jaccard similarity between chaos types' triggered-bug sets.
  const triggers = new Map();  // chaos action → Set of (bug.where + bug.what)
  for (const ev of timeline) {
    if (!ev.isChaos) continue;
    const set = triggers.get(ev.action) || new Set();
    triggers.set(ev.action, set);
    // We can't precisely correlate bugs to chaos events from JSONL alone.
    // Approximation: the persona-level bug stream is too coarse. This
    // version reports just chaos firing counts; full causal linkage
    // would need bug timestamps in the JSONL (deferred).
  }
  return Array.from(triggers.entries()).map(([k, v]) => ({ chaos: k, fired: timeline.filter((e) => e.action === k).length }));
}

// ─── Render the comparison report ─────────────────────────────────────────

async function main() {
  const { newRunId, baseline } = parseArgs(process.argv);

  const newMd = await readReportMd(newRunId);
  const newTimeline = await readTimelineJsonl(newRunId);
  let baseMd = '';
  let baseAvailable = true;
  try { baseMd = await readReportMd(baseline); }
  catch (_) {
    console.warn(`warning: baseline ${baseline} not found — skipping diff section`);
    baseAvailable = false;
  }

  const newBugs = extractTotalBugs(newMd);
  const newSev = extractSeverityCounts(newMd);
  const newPersonas = extractPersonaTable(newMd);
  const newFlows = extractFlowTable(newMd);
  const newSubBots = extractSubBotPrecision(newMd);
  const newCost = extractCostItemization(newMd);
  const newCoverage = extractCoverageStatus(newMd);

  const baseBugs = baseAvailable ? extractTotalBugs(baseMd) : 0;
  const baseSev = baseAvailable ? extractSeverityCounts(baseMd) : { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const basePersonas = baseAvailable ? extractPersonaTable(baseMd) : [];
  const baseFlows = baseAvailable ? extractFlowTable(baseMd) : [];

  const chaosFired = chaosRedundancy(newTimeline, []);

  // Detect personas with high action count but low precision — "bad value".
  const personaYield = newPersonas.map((p) => {
    // Find bugs attributable to this persona by name in flow path.
    const personaBugs = newFlows
      .filter((f) => f.flow.includes(p.persona) || f.flow.toLowerCase().includes(p.persona.toLowerCase().replace(/^dr\.\s*/, '')))
      .reduce((a, f) => a + f.total, 0);
    const yieldPerAction = p.actions > 0 ? (personaBugs / p.actions).toFixed(3) : '0';
    return { ...p, personaBugs, yieldPerAction };
  }).sort((a, b) => Number(a.yieldPerAction) - Number(b.yieldPerAction));

  // ─── Build comparison markdown ──────────────────────────────────────────
  const out = [];
  out.push(`# Mega-bot v4 — comparison report`);
  out.push('');
  out.push(`- **New run:** ${newRunId}`);
  out.push(`- **Baseline:** ${baseline}${baseAvailable ? '' : ' (NOT FOUND on disk — diff sections omitted)'}`);
  out.push(`- **Generated:** ${new Date().toISOString()}`);
  out.push('');

  // ─── 1. Headline diff ────────────────────────────────────────────────
  out.push('## Headline diff');
  out.push('| Metric | Baseline | New | Δ |');
  out.push('|---|---|---|---|');
  out.push(`| Total bugs | ${baseBugs} | ${newBugs} | ${newBugs - baseBugs >= 0 ? '+' : ''}${newBugs - baseBugs} |`);
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    const d = newSev[sev] - baseSev[sev];
    out.push(`| ${sev} | ${baseSev[sev]} | ${newSev[sev]} | ${d >= 0 ? '+' : ''}${d} |`);
  }
  out.push('');

  // ─── 2. New flows discovered ─────────────────────────────────────────
  if (baseAvailable) {
    out.push('## New flows discovered (in v4 not in baseline)');
    const baseFlowNames = new Set(baseFlows.map((f) => f.flow));
    const newFlowsOnly = newFlows.filter((f) => !baseFlowNames.has(f.flow));
    if (newFlowsOnly.length === 0) out.push('_None — every flow in v4 was also touched in baseline._');
    else {
      out.push('| Flow | CRIT | HIGH | MED | LOW | Total |');
      out.push('|---|---|---|---|---|---|');
      for (const f of newFlowsOnly.sort((a, b) => b.total - a.total)) {
        out.push(`| \`${f.flow}\` | ${f.crit} | ${f.high} | ${f.med} | ${f.low} | ${f.total} |`);
      }
    }
    out.push('');

    // Retired flows (in baseline not in v4 — likely sub-bot was removed/renamed)
    out.push('## Flows retired or absent (in baseline not in v4)');
    const newFlowNames = new Set(newFlows.map((f) => f.flow));
    const retired = baseFlows.filter((f) => !newFlowNames.has(f.flow));
    if (retired.length === 0) out.push('_None._');
    else {
      out.push('| Flow | Baseline total |');
      out.push('|---|---|');
      for (const f of retired.sort((a, b) => b.total - a.total)) {
        out.push(`| \`${f.flow}\` | ${f.total} |`);
      }
    }
    out.push('');
  }

  // ─── 3. Question 1: Per-sub-bot signal ratio ─────────────────────────
  out.push('## Q1: Which sub-bots produced ≥80% real signal?');
  out.push('Heuristic: precision = `(CRIT + HIGH) / total`. ≥0.8 = high signal; ≥0.5 = useful; <0.3 = noisy.');
  out.push('');
  if (newSubBots.length === 0) {
    out.push('_No tagged sub-bot flags found — sub-bots may not be tagging `_botSubject` correctly._');
  } else {
    out.push('| Sub-bot | Total | Precision | Verdict |');
    out.push('|---|---|---|---|');
    for (const s of newSubBots.sort((a, b) => b.precision - a.precision)) {
      const verdict = s.precision >= 0.8 ? '✓✓ high signal' : s.precision >= 0.5 ? '✓ useful' : s.precision >= 0.3 ? '~ medium' : '✗ noisy';
      out.push(`| ${s.subBot} | ${s.total} | ${s.precision.toFixed(2)} | ${verdict} |`);
    }
  }
  out.push('');

  // ─── 4. Question 2: Bad-value personas ───────────────────────────────
  out.push('## Q2: Which personas were "bad value"?');
  out.push('Bad value = high action count, low bug-yield-per-action. <0.05 bugs/action = candidate for swap.');
  out.push('');
  out.push('| Persona | Actions | Bugs | Yield/action | useful/min |');
  out.push('|---|---|---|---|---|');
  for (const p of personaYield) {
    out.push(`| ${p.persona} | ${p.actions} | ${p.personaBugs} | ${p.yieldPerAction} | ${p.usefulPerMin ?? '?'} |`);
  }
  out.push('');

  // ─── 5. Question 3: Chaos event redundancy ───────────────────────────
  out.push('## Q3: Chaos event redundancy');
  out.push('Each chaos type is shown with its fire count. Causal flag-attribution requires bug-timestamp correlation (not implemented in v4 — flag-bug linkage is approximated via persona-level grouping).');
  out.push('');
  out.push('| Chaos type | Fired |');
  out.push('|---|---|');
  for (const c of chaosFired.sort((a, b) => b.fired - a.fired)) {
    out.push(`| \`${c.chaos}\` | ${c.fired} |`);
  }
  out.push('');
  out.push('_v5 follow-up: add bug-timestamps to JSONL events to compute Jaccard overlap between chaos types' + ' triggered-flag sets._');
  out.push('');

  // ─── 5.5 V4.2 invariant: per-sub-bot waitForSubject ratchet completeness
  // Pure check via scripts/lib/v42Invariant.mjs (also unit-tested in
  // tests/megaBotV42.test.ts). Fails loud — sets process.exitCode = 1 — when
  // a v4 sub-bot completed an iteration without first calling the helper.
  // Treats `>=` not `==`: chaos types can legitimately abort an iteration
  // mid-stream after waitForSubject was called, so wait-count may exceed
  // completion-count for any given sub-bot.
  out.push('## V4.2 invariant: per-sub-bot waitForSubject ratchet');
  out.push('Per `scripts/lib/v42Invariant.mjs`. Each v4 sub-bot must call `waitForSubject` at least once per completed iteration. Allowlist: ' + V4_SUB_BOTS_REQUIRING_WAIT.map((n) => `\`${n}\``).join(', ') + '.');
  out.push('');
  const v42 = checkV42Invariant(newTimeline);
  out.push('| Sub-bot | waitForSubject called | iterations completed | OK |');
  out.push('|---|---|---|---|');
  for (const [name, r] of Object.entries(v42.perSubBot).sort()) {
    const ok = r.waitCalled >= r.iterCompleted;
    out.push(`| \`${name}\` | ${r.waitCalled} | ${r.iterCompleted} | ${ok ? '✓' : '✗'} |`);
  }
  out.push('');
  if (v42.violators.length > 0) {
    out.push(`⚠ **V4.2 INVARIANT VIOLATED** — ${v42.violators.length} sub-bot(s) completed iterations without calling waitForSubject:`);
    for (const [name, r] of v42.violators) {
      out.push(`- \`${name}\`: ${r.iterCompleted - r.waitCalled} iteration(s) missing the wait ratchet (waitCalled=${r.waitCalled}, iterCompleted=${r.iterCompleted})`);
    }
    out.push('');
    out.push('Action: search the sub-bot body for any path that returns BEFORE the `waitForSubject(...)` call (early returns, schema-changed branches, refactor leftovers). The static schema test in `tests/megaBotV41.test.ts` catches missing calls at PR review; this runtime check catches paths the static check cannot reach (e.g., conditional branches whose `page.evaluate` happens to skip the wait).');
    out.push('');
    process.exitCode = 1;
  } else {
    out.push('✓ All v4 sub-bots satisfied the ratchet. (Sub-bots showing 0/0 fired but did not complete any iterations — typically chaos-induced abort or scheduler skip; not a violation.)');
    out.push('');
  }

  // ─── 6. Question 4: Fixture-scenario gap proposals ──────────────────
  out.push('## Q4: Fixture-scenario gap proposals');
  out.push('Two scenarios that current personas + sub-bots would not naturally exercise:');
  out.push('');
  out.push('### Proposal A — multi-day cross-tab race fixture');
  out.push('A patient where day-1 admission is created in tab 1, day-2 SOAP started in tab 2, and the user accidentally edits the same patient in both. Today no persona models the "two-tab" pattern; tabHopper was deferred from v4. Fixture should include: identical patient identity in two tabs, conflicting edits to same field, expected last-write-wins behavior. **Catches:** IDB conflict resolution, sessionStorage cross-tab leakage, supabase-backup race.');
  out.push('');
  out.push('### Proposal B — full email-to-self end-to-end with proxy stub');
  out.push('Today scenEmailToSelf only verifies the buttons exist + click responds. To verify the actual proxy POST roundtrip, fixture should mock `send-note-email` Edge Function via a deterministic 200 response, then assert the success banner has the correct recipient + subject. Without this, the proxy 503 path catches "graceful degradation" but the happy path goes untested. **Catches:** subject-line bidi corruption, proxy auth header drift, single-user inbox carve-out regressions.');
  out.push('');

  // ─── 7. Cost itemization (verbatim from new report) ──────────────────
  if (newCost) {
    out.push('## Cost itemization (from new run)');
    out.push(newCost);
    out.push('');
  }

  // ─── 8. Min-coverage scheduler outcomes ─────────────────────────────
  if (newCoverage.length > 0) {
    out.push('## Min-coverage scheduler outcomes');
    out.push('| Sub-bot | Fired | Target | Met |');
    out.push('|---|---|---|---|');
    for (const c of newCoverage) {
      out.push(`| ${c.subBot} | ${c.fired} | ${c.target} | ${c.met ? '✓' : '✗'} |`);
    }
    const unmet = newCoverage.filter((c) => !c.met);
    if (unmet.length > 0) {
      out.push('');
      out.push(`⚠ **${unmet.length} target(s) unmet** — scheduler bias may need to start earlier than 50% wall-time, or weight more aggressively.`);
    }
    out.push('');
  }

  // ─── 9. Sibling-port grep recipes (Web-Claude Steps 1-2) ─────────────
  out.push('## Sibling-app port recipes (Geri / IM / FM)');
  out.push('Cheap < running the bot per repo. Each recipe is < 5 minutes.');
  out.push('');
  out.push('### Step 1 — SOAP roster confidence pattern');
  out.push('```bash');
  out.push('rg "applyRosterSeed|confidence.*undefined" \\\\');
  out.push('  ~/repos/InternalMedicine ~/repos/FamilyMedicine ~/repos/Geriatrics');
  out.push('```');
  out.push('Any sibling with the pattern but missing `parsed.confidence` after roster apply has the bug class.');
  out.push('');
  out.push('### Step 2 — FileReader regression class');
  out.push('```bash');
  out.push('rg "reject\\\\(r\\\\.error\\\\)" -g "*.ts" -g "*.tsx" \\\\');
  out.push('  ~/repos/InternalMedicine ~/repos/FamilyMedicine ~/repos/Geriatrics');
  out.push('```');
  out.push('Any hit without `?? new Error(...)` is the same bug class — port the fix mechanically.');
  out.push('');

  // ─── 10. Web-Claude write-back paragraph ─────────────────────────────
  out.push('## Web-Claude write-back paragraph (paste into next sync)');
  out.push('');
  const newCritHigh = newSev.CRITICAL + newSev.HIGH;
  const baseCritHigh = baseSev.CRITICAL + baseSev.HIGH;
  const galleryUrl = `${REPORT_DIR}/${newRunId}-patients/index.html`;
  out.push('> ' + [
    `mega-bot v4 (${newRunId}) ran 30 min × 10 personas with the integrated chaos-types + sub-bot + persona swaps;`,
    `total flags ${newBugs}${baseAvailable ? ` (vs baseline ${baseBugs}, Δ ${newBugs - baseBugs >= 0 ? '+' : ''}${newBugs - baseBugs})` : ''},`,
    `with ${newCritHigh} CRIT+HIGH${baseAvailable ? ` (vs ${baseCritHigh}, Δ ${newCritHigh - baseCritHigh >= 0 ? '+' : ''}${newCritHigh - baseCritHigh})` : ''}.`,
    `Gallery rendered to \`${galleryUrl}\` with action-timeline overlay + chaos badges + persona attribution per chart.`,
    `Three architectural patterns from v4 that should propagate to Geri/IM/FM:`,
    `(a) ungated 5-hook diagnostics (warning/crash/unhandledrejection/CSP/longtask) — copy-paste \`scripts/lib/diagnostics.mjs\`;`,
    `(b) min-coverage scheduler in \`personasV4.mjs\` — sibling apps with rare auth/admin flows would benefit from forced firing;`,
    `(c) per-sub-bot precision metric in the report — answers "which sub-bots are noise" without manual triage.`,
    `Chaos types most worth porting: networkRamped (CDP cycle), midnightRollover (full Date patch), randomClick (tagged provenance).`,
    `Defer to v5: exifRotation (needs fixture set), live cross-tab race (needs same-context architecture), SW swap mid-session (needs deploy coordination).`,
  ].join(' '));
  out.push('');

  // ─── Footer ──────────────────────────────────────────────────────────
  out.push('---');
  out.push(`Generated by \`scripts/analyze-mega-run.mjs ${newRunId} --baseline=${baseline}\``);
  out.push('');

  const outPath = path.resolve(REPORT_DIR, `${newRunId}-comparison.md`);
  await fs.writeFile(outPath, out.join('\n'), 'utf8');
  console.log(`comparison report: ${outPath}`);
  console.log('');
  console.log('=== summary ===');
  console.log(`  new run bugs: ${newBugs} (${newSev.CRITICAL}C/${newSev.HIGH}H/${newSev.MEDIUM}M/${newSev.LOW}L)`);
  console.log(`  baseline bugs: ${baseBugs} (Δ ${newBugs - baseBugs >= 0 ? '+' : ''}${newBugs - baseBugs})`);
  console.log(`  per-sub-bot tagged: ${newSubBots.length} sub-bots`);
  console.log(`  scheduler unmet: ${newCoverage.filter((c) => !c.met).length} of ${newCoverage.length}`);
  console.log(`  bad-value persona: ${personaYield[0]?.persona || '?'} (yield ${personaYield[0]?.yieldPerAction || '?'})`);
  // V4.2 — surface the invariant outcome on stdout too. process.exitCode is
  // already set above; this line exists for human-readable CI logs.
  if (v42.violators.length > 0) {
    console.log(`  ⚠ V4.2 invariant: ${v42.violators.length} violator(s) — see report (exit code 1)`);
  } else {
    console.log(`  ✓ V4.2 invariant: all v4 sub-bots satisfied the ratchet`);
  }
}

main().catch((e) => { console.error('fatal:', e); process.exitCode = 1; });
