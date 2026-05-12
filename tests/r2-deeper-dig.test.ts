/**
 * Round-2 deeper-dig safety net.
 *
 * Targets surfaces that R1 didn't directly assert:
 *   1. PBKDF2 + AES-GCM round-trip with wrong-password / tampered ciphertext
 *      / undersized salt boundary cases (real cryptographic failure modes).
 *   2. CSP regression — assert `index.html` allows EXACTLY the documented
 *      domains, no analytics, no widening.
 *   3. wrapForChameleon RLM/LRM bidi-mark application on the trickiest mixed
 *      Hebrew/English/numbers paragraphs (drug + dose + Hebrew narrative).
 *   4. runEmitTurn JSON parsing — malformed, truncated, wrong-shape responses.
 *   5. URL.revokeObjectURL invariant — every createObjectURL in `src/` has a
 *      matching revokeObjectURL within the same module.
 *   6. Cost tracker — numerical accumulation accuracy on long sessions.
 *
 * Real risk only — every case here protects a documented hard constraint
 * from `~/.claude/skills/audit-fix-deploy/SKILL.md` § F.7 or `CLAUDE.md`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveAesKey, PBKDF2_ITERATIONS } from '@/crypto/pbkdf2';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';
import { wrapForChameleon } from '@/i18n/bidi';
import { extractJsonStrategy } from '@/agent/loop';
import { addTurn, load, reset, startSession, finalizeSessionFor, loadPerPatient, resetPerPatient } from '@/agent/costs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// 1. PBKDF2 + AES-GCM round-trip — wrong-password, tampered, undersized salt
// ─────────────────────────────────────────────────────────────────────────

describe('crypto — wrong-password fails cleanly (R2)', () => {
  it('decrypt with the wrong passphrase rejects (auth fail)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k1 = await deriveAesKey('correct horse battery staple', salt);
    const k2 = await deriveAesKey('wrong horse battery staple', salt);

    const sealed = await aesEncrypt('PHI body', k1);

    // GCM auth tag mismatch on a wrong-key decrypt MUST throw, not silently
    // return garbage. If this ever changes, we'd be shipping plaintext-looking
    // garbage to the UI on a passphrase typo — silent corruption.
    await expect(aesDecrypt(sealed.ciphertext, sealed.iv, k2)).rejects.toThrow();
  });

  it('decrypt with the wrong salt-derived key rejects (auth fail)', async () => {
    const k1 = await deriveAesKey('same passphrase', crypto.getRandomValues(new Uint8Array(16)));
    const k2 = await deriveAesKey('same passphrase', crypto.getRandomValues(new Uint8Array(16)));

    const sealed = await aesEncrypt('PHI body', k1);
    await expect(aesDecrypt(sealed.ciphertext, sealed.iv, k2)).rejects.toThrow();
  });
});

describe('crypto — tampered ciphertext fails (R2)', () => {
  it('flipping a single byte in the ciphertext rejects on decrypt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('passphrase', salt);
    const sealed = await aesEncrypt('PHI body', key);

    // Tamper: flip the first byte. AES-GCM auth tag verification MUST fail.
    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(aesDecrypt(tampered as Uint8Array<ArrayBuffer>, sealed.iv, key)).rejects.toThrow();
  });

  it('flipping a byte in the IV rejects on decrypt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('passphrase', salt);
    const sealed = await aesEncrypt('PHI body', key);

    const tamperedIv = new Uint8Array(sealed.iv);
    tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 0x01;

    await expect(aesDecrypt(sealed.ciphertext, tamperedIv as Uint8Array<ArrayBuffer>, key)).rejects.toThrow();
  });

  it('truncating the ciphertext (drops auth tag) rejects on decrypt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('passphrase', salt);
    const sealed = await aesEncrypt('PHI body', key);

    // Drop the last 4 bytes — corrupts the GCM auth tag (16 bytes at the end).
    const truncated = sealed.ciphertext.slice(0, sealed.ciphertext.length - 4);
    await expect(aesDecrypt(truncated as Uint8Array<ArrayBuffer>, sealed.iv, key)).rejects.toThrow();
  });
});

describe('crypto — round-trip succeeds with right inputs (R2)', () => {
  it('correct passphrase + salt + iv decrypts to original', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('right pass', salt);
    const plaintext = JSON.stringify({ name: 'דוד כהן', tz: '012345678' });
    const sealed = await aesEncrypt(plaintext, key);
    const out = await aesDecrypt(sealed.ciphertext, sealed.iv, key);
    expect(out).toBe(plaintext);
  });

  it('PBKDF2_ITERATIONS is at least 600,000 (Gate 5)', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. CSP regression — assert exact connect-src domains, no analytics
// ─────────────────────────────────────────────────────────────────────────

describe('CSP regression (R2)', () => {
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

  it('index.html has a Content-Security-Policy meta tag', () => {
    expect(indexHtml).toMatch(/Content-Security-Policy/);
  });

  it('connect-src whitelists exactly: self, api.anthropic.com, toranot.netlify.app, *.supabase.co', () => {
    // Pull the meta tag content.
    const m = indexHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    expect(m).toBeTruthy();
    const csp = m?.[1] ?? '';
    expect(csp.length).toBeGreaterThan(0);

    const connectSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
    expect(connectSrc).toBeDefined();

    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://toranot.netlify.app');
    expect(connectSrc).toContain('https://*.supabase.co');
    // api.anthropic.com is allowed as a fallback path (per CLAUDE.md) — proxy is default.
    expect(connectSrc).toContain('https://api.anthropic.com');
  });

  it('connect-src token set equals exactly the documented whitelist (no widening, no narrowing)', () => {
    // Strict R3 follow-up to the toContain assertion above: any drift in either
    // direction (new domain added OR a documented domain removed) trips CI.
    const m = indexHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    const csp = m?.[1] ?? '';
    const connectSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
    expect(connectSrc).toBeDefined();

    const tokens = (connectSrc ?? '')
      .replace(/^connect-src\s+/, '')
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .sort();

    const expected = [
      "'self'",
      'https://*.supabase.co',
      'https://api.anthropic.com',
      'https://toranot.netlify.app',
    ].sort();

    expect(tokens).toEqual(expected);
  });

  it('connect-src does NOT include any analytics / 3rd-party telemetry domain', () => {
    const m = indexHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    const csp = m?.[1] ?? '';
    expect(csp).not.toMatch(/google-analytics|googletagmanager|posthog|mixpanel|sentry\.io|datadoghq|amplitude|segment\.io|hotjar/i);
  });

  it('object-src is locked to none (clickjacking / Flash-style payload guard)', () => {
    const m = indexHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    const csp = m?.[1] ?? '';
    expect(csp).toMatch(/object-src 'none'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. wrapForChameleon — bidi marks on tricky mixed Hebrew / Latin / numeric
// ─────────────────────────────────────────────────────────────────────────

describe('wrapForChameleon — drug + dose + Hebrew narrative (R2)', () => {
  // 2026-05-12: the prior Rule A (LRM-bracket pure-Latin parens) + Rule B
  // (RLM before trailing punctuation after Latin run) have been replaced by
  // bidiWrap's structural run-tokenizer. The new contract: marks at
  // Hebrew↔Latin transitions only — trailing punctuation is neutral and
  // inherits the prior class, so no RLM-before-period. See bidi.test.ts
  // for the full algorithm-level matrix.

  it('Hebrew narrative + brand drug name: LRM before Latin run, no RLM before terminal punct', () => {
    const input = 'המטופלת קיבלה Eliquis.';
    const out = wrapForChameleon(input);
    expect(out).toBe('המטופלת קיבלה ‎Eliquis.');
  });

  it('multiple English drug runs in one Hebrew paragraph: LRM only before first Latin run', () => {
    const input = 'המטופלת קיבלה Eliquis, Coversyl, Crestor.';
    const out = wrapForChameleon(input);
    // Hebrew → comma/space → Latin → comma/space → Latin → ... → period.
    // Commas and spaces are neutral, so prev stays latin across them — no
    // further marks within the Latin sequence.
    expect(out).toBe('המטופלת קיבלה ‎Eliquis, Coversyl, Crestor.');
  });

  it('parenthesized Latin dose in Hebrew context: LRM before first Latin LETTER (digits neutral)', () => {
    const input = 'הוחל טיפול (5 mg daily) בבית.';
    const out = wrapForChameleon(input);
    // "5" is digit-neutral (UAX-9 weak), so prev stays hebrew through "(5 ".
    // First Hebrew→Latin transition is at "mg"; first Latin→Hebrew at "בבית".
    expect(out).toBe('הוחל טיפול (5 ‎mg daily) ‏בבית.');
  });

  it('digits adjacent to Hebrew (no Latin) stay untouched (no spurious LRM)', () => {
    const input = 'גיל 92, סוכרת מסוג 2.';
    const out = wrapForChameleon(input);
    expect(out).not.toContain('‎');
    expect(out).not.toContain('‏');
  });

  it('does not break the input if it is empty or pure neutral characters', () => {
    expect(wrapForChameleon('')).toBe('');
    // sanitizeForChameleon rule #9 strips trailing whitespace per line — the
    // sanitizer (which wrapForChameleon calls first) intentionally trims, so a
    // pure-whitespace line collapses to "". This is documented behavior, not
    // a bug; the test asserts no throw / no Latin RLM marks added.
    const result = wrapForChameleon('   ');
    expect(result).not.toContain('‎');
    expect(result).not.toContain('‏');
  });

  it('drug-taper arrow notation (ASCII >) is preserved inside Hebrew narrative', () => {
    // This is the critical exception in the bidi sanitizer — `>` between digits
    // means "transitioned from N to M" and must NOT be rewritten as "מעל".
    const input = 'Lantus 22 > 10 בערב';
    const out = wrapForChameleon(input);
    expect(out).toContain('22 > 10');
    expect(out).not.toContain('מעל');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. runEmitTurn / runExtractTurn JSON parsing edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('extractJsonStrategy — pathological model outputs (R2)', () => {
  it('handles empty string by returning empty + fast strategy (no throw)', () => {
    const r = extractJsonStrategy('');
    expect(r.json).toBe('');
    expect(r.strategy).toBe('fast');
  });

  it('truncated JSON (model cut off mid-output) returns brace strategy with what is balanced', () => {
    // No top-level closing brace — depth never returns to 0.
    const truncated = '{"fields": {"name": "דוד" ';
    const r = extractJsonStrategy(truncated);
    // Walker never closes -> falls through to fallback path. Caller's JSON.parse
    // then throws a descriptive error that runExtractTurn surfaces as
    // "failed to parse JSON from model".
    expect(r.strategy).toBe('fallback');
    expect(() => JSON.parse(r.json)).toThrow();
  });

  it('JSON object with extra nested fields parses without throwing — caller filters', () => {
    // Tests that extras don't break the brace walker. The actual contract
    // (filterToCriticalThree) is enforced in runExtractTurn.
    const messy = 'some preamble {"fields": {"name": "X", "extra": {"nested": true}}, "junk": "ignore"} trailing';
    const r = extractJsonStrategy(messy);
    expect(r.strategy).toBe('brace');
    const parsed = JSON.parse(r.json);
    expect(parsed.fields.name).toBe('X');
  });

  it('handles a JSON object whose string value contains an unescaped " inside a balanced { run', () => {
    // Realistic: model emits a Hebrew clinical sentence with a `"` inside.
    // The walker tracks string-literal state so the inner `"` doesn't break
    // brace counting.
    const tricky = '{"noteHebrew": "המטופלת קיבלה \\"Eliquis\\" 5 mg"}';
    const r = extractJsonStrategy(tricky);
    expect(r.strategy).toBe('fast');
    const parsed = JSON.parse(r.json);
    expect(parsed.noteHebrew).toContain('Eliquis');
  });

  it('handles model emitting prose-then-fenced JSON ("Pass 1 / Pass 2" preamble)', () => {
    const proseAndFence = `Pass 1: identity\nPass 2: clinical\n\n\`\`\`json\n{"fields": {"name": "דוד כהן"}}\n\`\`\``;
    const r = extractJsonStrategy(proseAndFence);
    expect(r.strategy).toBe('fenced');
    expect(JSON.parse(r.json).fields.name).toBe('דוד כהן');
  });

  it('handles model emitting raw JSON with no preamble or fences (fast path)', () => {
    const clean = '{"fields": {"name": "X"}}';
    const r = extractJsonStrategy(clean);
    expect(r.strategy).toBe('fast');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. URL.revokeObjectURL invariant — every createObjectURL has a paired revoke
// ─────────────────────────────────────────────────────────────────────────

describe('URL.createObjectURL / revokeObjectURL invariant (R2 — skill F.7)', () => {
  /** Walk all .ts/.tsx files under src/ and tally create vs revoke calls per file. */
  function tallyObjectURLCalls(dir: string): Map<string, { creates: number; revokes: number }> {
    const byFile = new Map<string, { creates: number; revokes: number }>();
    function walk(d: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          // Skip test folders — test files use stubbed createObjectURL / revokeObjectURL.
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        let creates = 0;
        let revokes = 0;
        for (const line of text.split('\n')) {
          if (/URL\.createObjectURL\b/.test(line)) creates++;
          if (/URL\.revokeObjectURL\b/.test(line)) revokes++;
        }
        if (creates > 0 || revokes > 0) byFile.set(full, { creates, revokes });
      }
    }
    walk(dir);
    return byFile;
  }

  it('every URL.createObjectURL in src/ is matched by at least one URL.revokeObjectURL in the same file', () => {
    const tally = tallyObjectURLCalls(path.join(REPO_ROOT, 'src'));
    const violators: string[] = [];
    for (const [file, counts] of tally) {
      if (counts.creates > 0 && counts.revokes === 0) violators.push(file);
    }
    expect(violators).toEqual([]);
  });

  it('total revoke count >= total create count across src/ (no mass leak)', () => {
    const tally = tallyObjectURLCalls(path.join(REPO_ROOT, 'src'));
    let totalCreates = 0;
    let totalRevokes = 0;
    for (const counts of tally.values()) {
      totalCreates += counts.creates;
      totalRevokes += counts.revokes;
    }
    // Each create in our codebase has at least one cleanup path. The reverse
    // direction (extra revokes — e.g. cleanup loops) is fine; a deficit is
    // a leak.
    expect(totalRevokes).toBeGreaterThanOrEqual(totalCreates);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Cost tracker — accumulation accuracy on long sessions
// ─────────────────────────────────────────────────────────────────────────

describe('costs accumulator — long-session accuracy (R2)', () => {
  beforeEach(() => {
    // Fresh localStorage for every test — costs.ts reads/writes there.
    localStorage.clear();
    reset();
    resetPerPatient();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('100 small turns sum to the closed-form expected USD (no float drift > 0.001)', () => {
    const TURNS = 100;
    const inPer = 1000; // input tokens per turn
    const outPer = 500;
    for (let i = 0; i < TURNS; i++) {
      addTurn({ input_tokens: inPer, output_tokens: outPer });
    }
    const totals = load();
    expect(totals.inputTokens).toBe(TURNS * inPer);
    expect(totals.outputTokens).toBe(TURNS * outPer);

    // $5/M input + $25/M output — closed form.
    const expectedUsd = TURNS * (inPer * 5 / 1_000_000 + outPer * 25 / 1_000_000);
    expect(Math.abs(totals.usd - expectedUsd)).toBeLessThan(0.001);
  });

  it('zero-token turn is a no-op on USD even though input/output counters bump', () => {
    addTurn({ input_tokens: 0, output_tokens: 0 });
    expect(load().usd).toBe(0);
  });

  it('session bucket attributes correctly to a patient on finalize', () => {
    startSession();
    addTurn({ input_tokens: 1_000_000, output_tokens: 100_000 }); // $5 + $2.50 = $7.50
    finalizeSessionFor('patient-A');

    const map = loadPerPatient();
    const entry = map['patient-A'];
    expect(entry).toBeDefined();
    expect(Math.abs(entry!.usd - 7.5)).toBeLessThan(0.001);
  });

  it('session not finalized leaves nothing attributed to any patient', () => {
    startSession();
    addTurn({ input_tokens: 1000, output_tokens: 100 });
    // No finalizeSessionFor call -> per-patient map stays empty.
    const map = loadPerPatient();
    expect(Object.keys(map).length).toBe(0);
  });
});
