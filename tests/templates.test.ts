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

  it('each entry is a tuple of exactly 2 skill names', () => {
    for (const skills of Object.values(NOTE_SKILL_MAP)) {
      expect(skills).toHaveLength(2);
    }
  });

  it('every note type includes the hebrew-medical-glossary skill', () => {
    for (const skills of Object.values(NOTE_SKILL_MAP)) {
      expect(skills).toContain('hebrew-medical-glossary');
    }
  });

  it('non-case types use szmc-clinical-notes', () => {
    for (const t of ['admission', 'discharge', 'consult', 'soap'] as NoteType[]) {
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
