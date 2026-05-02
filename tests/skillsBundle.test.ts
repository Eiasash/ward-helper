import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The v1.16.0 → v1.17.0 incident was partly caused by
 * public/skills/azma-ui/SKILL.md being a six-line pointer to a separate
 * AZMA_REFERENCE.md that was never committed, so the deployed bundle
 * shipped with effectively no AZMA-layout reference. The vision
 * extractor then read the AZMA title bar ("Eitan 4 <doctor> <pcode>") as
 * the patient card.
 *
 * This test enforces a floor on skill content so that regression class
 * can't recur. The numbers here are conservative — the real SKILL.md
 * files are all well above — but tight enough that a rename-to-pointer
 * or accidental truncation fails CI before deploy.
 */

const SKILLS_ROOT = resolve(__dirname, '..', 'public', 'skills');

interface SkillFloor {
  name: string;
  /** Minimum bytes of SKILL.md combined content. */
  minBytes: number;
  /** Substrings that must appear literally in SKILL.md (or its references). */
  mustContain: string[];
}

const FLOORS: SkillFloor[] = [
  {
    name: 'azma-ui',
    // R4 (2026-05-02) bundles SKILL.md + AZMA_REFERENCE.md + azma_reference.json
    // — combined ~71 KB. Stub was 350 bytes. 5 KB floor rejects the stub and
    // any near-empty regression without being so tight that a legitimate
    // tightening of the reference would flunk CI.
    minBytes: 5000,
    // R4-specific substrings that prove substantive content. If any
    // disappear, the skill has been rewritten in a way that drops an
    // essential anchor — investigate, don't paper over.
    mustContain: [
      'ניהול מחלקה',          // the main dept-mgmt screen name (§3, §4)
      'הוראות תרופתיות',      // the order-grid screen (§7) — new in R4
      'blue pen',              // manifest-grade Q5 answer (unsigned admission)
      'blood bank',            // color-code reference (col 12)
      'isolation',             // red-diagnosis = isolation rule (§6)
      'גיל',                  // patient-grid age column (still present)
    ],
  },
  {
    name: 'szmc-clinical-notes',
    // Currently ~20 KB. 5 KB floor.
    minBytes: 5000,
    mustContain: ['Chameleon', 'קבלה'],
  },
  {
    name: 'szmc-interesting-cases',
    minBytes: 2000,
    mustContain: ['Case Summary', 'ישיבת מקרים'],
  },
  {
    name: 'hebrew-medical-glossary',
    minBytes: 1000,
    mustContain: ['Hebrew'],
  },
  {
    name: 'geriatrics-knowledge',
    // SKILL.md is ~16 KB. Stub would be < 1 KB.
    minBytes: 5000,
    mustContain: [
      'STOPP',              // STOPP/START framework
      'Beers',              // Beers criteria
      'inline-table',       // proves the project_knowledge_search → inline-table patch landed
    ],
  },
];

function readSkillCombined(name: string): string {
  const dir = resolve(SKILLS_ROOT, name);
  if (!existsSync(dir)) return '';
  // Mirror the runtime loader's file list (src/skills/loader.ts SKILL_FILES).
  // azma-ui R4 is multi-file (SKILL.md + AZMA_REFERENCE.md + azma_reference.json);
  // others are single-file. Keep this list in sync with the loader.
  const parts: string[] = [];
  const candidates = [
    'SKILL.md',
    'AZMA_REFERENCE.md',
    'azma_reference.json',
  ];
  for (const f of candidates) {
    const fp = resolve(dir, f);
    if (existsSync(fp)) parts.push(readFileSync(fp, 'utf8'));
  }
  return parts.join('\n\n');
}

describe('public/skills bundle integrity', () => {
  for (const floor of FLOORS) {
    describe(`${floor.name}`, () => {
      it(`has at least ${floor.minBytes} bytes of content`, () => {
        const content = readSkillCombined(floor.name);
        expect(
          content.length,
          `expected public/skills/${floor.name} to ship substantive content, got ${content.length} bytes`,
        ).toBeGreaterThanOrEqual(floor.minBytes);
      });

      it('does not look like a pointer stub ("See X for the full reference")', () => {
        const content = readSkillCombined(floor.name);
        // Specifically catch the exact regression pattern — a SKILL.md
        // that delegates to a sibling file that wasn't committed. If you
        // want to use a pointer-style layout, commit the pointee too;
        // this test enforces that by combining both files on read.
        const lowered = content.toLowerCase();
        const looksLikeStub =
          content.length < 800 &&
          (lowered.includes('see ') || lowered.includes('placeholder'));
        expect(looksLikeStub, 'skill reads as a pointer stub or placeholder').toBe(false);
      });

      for (const needle of floor.mustContain) {
        it(`contains required substring: ${JSON.stringify(needle)}`, () => {
          const content = readSkillCombined(floor.name);
          expect(content).toContain(needle);
        });
      }
    });
  }
});
