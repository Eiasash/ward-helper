import { describe, it, expect } from 'vitest';
import { splitIntoSections } from '@/notes/sections';

// Section parsing pins both header styles the model emits today:
//
//   1. `# label` — markdown-style, used inside the discussion section for
//      problem-list items ("# חשד לפרכוס", "# פגיעה כלייתית חריפה").
//   2. `<hebrew label>:` on its own line — used for the major structural
//      sections of admission notes ("הצגת החולה:", "אבחנות פעילות:",
//      "רקע רפואי:", "תרופות בבית:", "דיון ותוכנית:", "חתימה:").
//
// Both must split into sections so the per-section copy buttons cover the
// whole note, not just the discussion. Regression: pre-2026-05-02 the parser
// only saw `# `, so the entire HPI/PMH/meds/plan would lump into "פתיחה"
// (the intro chunk) instead of being individually copyable.

describe('splitIntoSections', () => {
  it('returns empty array for empty / whitespace-only input', () => {
    expect(splitIntoSections('')).toEqual([]);
    expect(splitIntoSections('   \n  \n')).toEqual([]);
  });

  it('returns a single פתיחה section when no headers present', () => {
    const out = splitIntoSections('סתם טקסט\nשורה שנייה');
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('פתיחה');
    expect(out[0]!.body).toBe('סתם טקסט\nשורה שנייה');
  });

  it('splits on `# `-prefixed problem-list headers (existing behavior)', () => {
    const note = `intro line\n# חשד לפרכוס\nplan a\nplan b\n# פגיעה כלייתית\nplan c`;
    const out = splitIntoSections(note);
    expect(out.map((s) => s.name)).toEqual(['פתיחה', 'חשד לפרכוס', 'פגיעה כלייתית']);
    expect(out[1]!.body).toBe('# חשד לפרכוס\nplan a\nplan b');
    expect(out[2]!.body).toBe('# פגיעה כלייתית\nplan c');
  });

  it('splits on Hebrew-label-colon major-section headers', () => {
    const note = [
      'הצגת החולה:',
      'בן 84',
      '',
      'אבחנות פעילות:',
      'SUSPECTED SEIZURES',
      '',
      'רגישויות:',
      'לא ידוע על רגישות',
    ].join('\n');
    const out = splitIntoSections(note);
    expect(out.map((s) => s.name)).toEqual([
      'הצגת החולה',
      'אבחנות פעילות',
      'רגישויות',
    ]);
    // Header line is preserved in the body so paste reproduces verbatim
    expect(out[0]!.body).toBe('הצגת החולה:\nבן 84');
  });

  it('handles a realistic admission note with both header styles', () => {
    // Truncated reproduction of a real admission note from the wild
    const note = [
      'הצגת החולה:',
      'בן 84, הגיע בעקבות חשד לפרכוס.',
      '',
      'אבחנות פעילות:',
      'SUSPECTED SEIZURES',
      'ASPIRATION PNEUMONIA',
      '',
      'דיון ותוכנית:',
      '',
      '# חשד לפרכוס',
      'בירור מטבולי',
      'CT מוח',
      '',
      '# פגיעה כלייתית חריפה',
      'ניטור תפוקת שתן',
      '',
      'חתימה:',
      'ד"ר Eias Ashhab',
    ].join('\n');
    const out = splitIntoSections(note);
    expect(out.map((s) => s.name)).toEqual([
      'הצגת החולה',
      'אבחנות פעילות',
      'דיון ותוכנית',
      'חשד לפרכוס',
      'פגיעה כלייתית חריפה',
      'חתימה',
    ]);
  });

  it('does NOT treat content lines that incidentally end with ":" as headers', () => {
    // "חתימת רופא:" is a content line — it has more text before/after it
    // and is not on its own line as a structural header.
    const note = [
      'חתימה:',
      'חתימת רופא: ד"ר Eias Ashhab, מתמחה גריאטריה',
    ].join('\n');
    const out = splitIntoSections(note);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('חתימה');
    // The "חתימת רופא:" line is content under the "חתימה" header — not its
    // own section. The regex excludes it because it has content after the colon.
    expect(out[0]!.body).toContain('חתימת רופא:');
  });

  it('strips trailing blank lines from each section body', () => {
    const note = `הצגת החולה:\nבן 84\n\n\n\nאבחנות פעילות:\nX`;
    const out = splitIntoSections(note);
    expect(out[0]!.body).toBe('הצגת החולה:\nבן 84');
    expect(out[1]!.body).toBe('אבחנות פעילות:\nX');
  });

  it('handles an empty intro (note starting directly with a header)', () => {
    const note = `הצגת החולה:\nבן 84\n# חשד\nplan`;
    const out = splitIntoSections(note);
    // No "פתיחה" section because there's no content before the first header
    expect(out.map((s) => s.name)).toEqual(['הצגת החולה', 'חשד']);
  });
});
