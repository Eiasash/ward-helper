import { describe, it, expect } from 'vitest';
import { NOTE_SKILL_MAP, NOTE_LABEL } from '@/notes/templates';
import type { NoteType } from '@/storage/indexed';

// Derive the full set of note types from the source-of-truth map so the list
// stays in sync automatically if new note types are added.
const ALL_TYPES = Object.keys(NOTE_SKILL_MAP) as NoteType[];

describe('NOTE_SKILL_MAP', () => {
  it('has an entry for every note type', () => {
    for (const t of ALL_TYPES) {
      expect(NOTE_SKILL_MAP).toHaveProperty(t);
    }
  });

  it('each entry has at least 1 skill and no duplicates', () => {
    for (const skills of Object.values(NOTE_SKILL_MAP)) {
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(new Set(skills).size).toBe(skills.length);
    }
  });

  it('every note type includes the hebrew-medical-glossary skill', () => {
    for (const skills of Object.values(NOTE_SKILL_MAP)) {
      expect(skills).toContain('hebrew-medical-glossary');
    }
  });

  // SOAP is driven by orchestrate.ts SOAP_STYLE prefix; it doesn't need
  // the 23 KB clinical-notes skill. Keep this test around so a future
  // well-meaning "add clinical-notes back to SOAP" bloat regression
  // is caught — that would cost ~\$0.018 more per SOAP.
  it('SOAP does NOT load szmc-clinical-notes (token cost saver)', () => {
    expect(NOTE_SKILL_MAP.soap).not.toContain('szmc-clinical-notes');
  });

  it('non-case, non-soap types use szmc-clinical-notes', () => {
    for (const t of ['admission', 'discharge', 'consult'] as NoteType[]) {
      expect(NOTE_SKILL_MAP[t]).toContain('szmc-clinical-notes');
    }
  });

  it('case type uses szmc-interesting-cases', () => {
    expect(NOTE_SKILL_MAP.case).toContain('szmc-interesting-cases');
  });
});

describe('NOTE_LABEL', () => {
  it('has a label for every note type', () => {
    for (const t of ALL_TYPES) {
      expect(NOTE_LABEL).toHaveProperty(t);
      expect(typeof NOTE_LABEL[t]).toBe('string');
      expect(NOTE_LABEL[t].length).toBeGreaterThan(0);
    }
  });

  it('uses the correct Hebrew labels', () => {
    expect(NOTE_LABEL.admission).toBe('קבלה');
    expect(NOTE_LABEL.discharge).toBe('שחרור');
    expect(NOTE_LABEL.consult).toBe('ייעוץ');
    expect(NOTE_LABEL.case).toBe('מקרה מעניין');
    expect(NOTE_LABEL.soap).toBe('SOAP יומי');
  });
});
