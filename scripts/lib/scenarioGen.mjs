/**
 * scenarioGen.mjs — Opus 4.7 adaptive-max scenario generator for ward-helper bots.
 *
 * Extracted from ward-helper-bot-v1.mjs so both v1 and the mega-bot can call
 * the same code path. The mega-bot needs this to produce richer, less
 * repetitive synthetic patients than the hardcoded fixtures.
 *
 * Cost: ~$1.50-2.00 per scenario at effort=high (Opus 4.7 + adaptive thinking).
 * Cost-cap is enforced by the caller — this module just tracks tokens used.
 *
 * Israeli MOH tz checksum: weights [1,2,1,2,1,2,1,2,1], sum digits if >9,
 * total mod 10 must equal 0 to be valid. Generator MUST emit invalid-checksum
 * tzs (caller validates).
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const COST_RATE = { in: 15.0 / 1_000_000, out: 75.0 / 1_000_000 };

export class CostTracker {
  constructor(capUsd) { this.calls = 0; this.inTok = 0; this.outTok = 0; this.capUsd = capUsd; }
  total() { return this.inTok * COST_RATE.in + this.outTok * COST_RATE.out; }
  add(usage) {
    this.calls += 1;
    this.inTok += usage?.input_tokens || 0;
    this.outTok += usage?.output_tokens || 0;
  }
  capExceeded() { return this.total() >= this.capUsd; }
}

export const SCENARIO_SEEDS = [
  'hip fracture s/p ORIF, post-op delirium, geriatric',
  'decompensated CHF NYHA III, acute on chronic kidney disease',
  'urinary tract infection with delirium in 88yo, polypharmacy',
  'post-stroke rehab, dysphagia, aspiration risk',
  'end-stage pancreatic cancer, palliative admission for pain',
  'severe sepsis from urinary source in nursing home patient',
  'COPD exacerbation with hypercapnic respiratory failure',
  'GI bleed — melena, anemia (Hb 6.8), age 82 on apixaban',
  'community-acquired pneumonia + new AFib RVR in 78yo',
  'acute confusion + falls — multifactorial geriatric workup',
];

export const SCENARIO_SYSTEM = `You are a board-grade Israeli geriatric medicine attending generating SYNTHETIC patient scenarios for a chart-software stress-test bot.

CRITICAL constraints:
- All identifiers are FICTITIOUS. Hebrew first name + Hebrew last name from the synthetic name pool. NEVER use a real public-figure name.
- Israeli ID (teudat zehut) MUST be a 9-digit string with INTENTIONALLY INVALID checksum. The Israeli MOH algorithm validates: weights [1,2,1,2,1,2,1,2,1], sum digits if >9, total sum mod 10 must equal 0. Make sure your tz fails this.
- Demographics realistic: age 70-95, sex F/M, room number 1-50, bed letter A/B.
- Clinical course must be plausible — no contradictory diagnoses, no impossible vitals.
- Hebrew clinical text must use proper Israeli medical Hebrew with embedded English drug names + lab abbreviations (do NOT transliterate).
- Day-1 admission note + day-2..N daily SOAP rounds + 1-2 consult letters + 1 discharge letter.
- Lab values must be realistic: WBC 4-25, Hb 6-16, Cr 0.5-4.5, Na 125-150, K 2.5-6.0, glucose 60-500.

Output ONLY valid JSON matching the shape requested. No prose outside the JSON block.`;

export function extractJsonBlock(text) {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
  let depth = 0; let start = -1;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) {
      try { return JSON.parse(stripped.slice(start, i + 1)); } catch (_) { /* fall through */ }
    }}
  }
  // Repair: slice from first '{' to last balanced '}'.
  const firstBrace = stripped.indexOf('{');
  if (firstBrace < 0) throw new Error(`No JSON object: ${text.slice(0, 200)}`);
  let d2 = 0, lastOk = -1;
  for (let i = firstBrace; i < stripped.length; i++) {
    if (stripped[i] === '{') d2++;
    else if (stripped[i] === '}') { d2--; if (d2 === 0) lastOk = i; }
  }
  if (lastOk > 0) {
    try { return JSON.parse(stripped.slice(firstBrace, lastOk + 1)); } catch (_) {}
  }
  throw new Error(`No parseable JSON: ${text.slice(0, 200)}`);
}

export async function callOpusGenerate({ apiKey, model, effort, maxTokens, system, user, costTracker }) {
  if (costTracker?.capExceeded()) {
    throw new Error(`cost-cap exceeded: $${costTracker.total().toFixed(2)} >= $${costTracker.capUsd}`);
  }
  const body = {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: effort || 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  if (costTracker) costTracker.add(data.usage);
  const textBlocks = (data.content || []).filter((b) => b.type === 'text');
  return { text: textBlocks.map((b) => b.text).join('\n'), usage: data.usage };
}

/**
 * Generate one Opus 4.7 scenario. Returns the parsed JSON + injects helper
 * fields (`_seed`, `_dayCount`, fallback `scenario_id`).
 *
 * @param {object} opts
 * @param {string} opts.apiKey   - Anthropic key (108 chars).
 * @param {string} opts.model    - 'claude-opus-4-7' usually.
 * @param {string} opts.effort   - 'low' | 'medium' | 'high'. Use 'high' for richer charts.
 * @param {number} opts.seedIdx  - index into SCENARIO_SEEDS.
 * @param {string} opts.runId    - run id, used for scenario_id fallback.
 * @param {CostTracker} opts.costTracker
 * @param {function} [opts.onLog]
 */
export async function generateScenarioOpus({ apiKey, model, effort, seedIdx, runId, costTracker, onLog }) {
  const seed = SCENARIO_SEEDS[seedIdx % SCENARIO_SEEDS.length];
  const dayCount = 3 + Math.floor(Math.random() * 2); // 3-4 days
  const userPrompt = `Generate ONE synthetic scenario for: "${seed}" with ${dayCount} day SOAP rounds.

Return JSON exactly matching this shape:
{
  "scenario_id": "syn-${runId}-${seedIdx}",
  "demographics": {
    "name_he": "string (Hebrew, fictitious)",
    "tz": "9 digits, INVALID checksum",
    "age": int,
    "sex": "M" | "F",
    "room": "1-50",
    "bed": "A" | "B"
  },
  "chief_complaint": "Hebrew, 1-2 sentences",
  "admission_note": { "S": "Hebrew", "O": "Hebrew with English drug names", "A": "Hebrew", "P": "Hebrew with English meds" },
  "soap_rounds": [{ "day": int, "S": "...", "O": "...", "A": "...", "P": "..." }, ...],
  "consult_letters": [{ "from": "Geriatrics", "to": "Cardiology" | "Nephrology" | etc, "body": "Hebrew" }],
  "discharge_letter": { "summary": "Hebrew", "meds_at_discharge": "...", "follow_up": "..." }
}

The scenario MUST be ready to copy-paste into a real clinical workflow. Any obvious AI-isms (e.g. "this is a synthetic patient") should NOT appear in the clinical text fields. The clinical text should read as if a tired geriatrics fellow at 03:00 typed it.`;

  if (onLog) onLog(`  → opus scenario ${seedIdx + 1}: "${seed}" (${dayCount}d, effort=${effort})`);
  const { text } = await callOpusGenerate({
    apiKey, model, effort,
    maxTokens: 96000,
    system: SCENARIO_SYSTEM,
    user: userPrompt,
    costTracker,
  });
  const scenario = extractJsonBlock(text);
  if (!scenario.scenario_id) scenario.scenario_id = `syn-${runId}-${seedIdx}`;
  scenario._seed = seed;
  scenario._dayCount = dayCount;
  return scenario;
}
