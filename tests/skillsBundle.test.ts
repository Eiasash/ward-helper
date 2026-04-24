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
    // Real content ~5 KB. Stub was 350 bytes. 2 KB floor rejects the
    // stub and any near-empty regression without being so tight that
    // a legitimate tightening of the reference would flunk CI.
    minBytes: 2000,
    // These strings name the two vision traps the extractor must warn
    // against. If either disappears, the skill has been rewritten in a
    // way that drops the essential guard — regenerate, don't paper over.
    mustContain: [
      'Doctor name',       // title-bar / patient-card distinction must survive rewrites
      'שם מטופל',          // authoritative patient-card label must be referenced
      'גיל',               // explicit age-label usage
      'משקל',              // explicit weight-label usage (the 62-vs-92 mix-up)
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
];

function readSkillCombined(name: string): string {
  const dir = resolve(SKILLS_ROOT, name);
  if (!existsSync(dir)) return '';
  // Match the runtime loader — primary SKILL.md plus any well-known
  // reference files joined. Today azma-ui is the only skill with a
  // multi-file layout (SKILL.md + AZMA_REFERENCE.md); others are
  // single-file, so they just read SKILL.md.
  const parts: string[] = [];
  const skillMd = resolve(dir, 'SKILL.md');
  if (existsSync(skillMd)) parts.push(readFileSync(skillMd, 'utf8'));
  const azmaRef = resolve(dir, 'AZMA_REFERENCE.md');
  if (existsSync(azmaRef)) parts.push(readFileSync(azmaRef, 'utf8'));
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
