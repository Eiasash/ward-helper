import { describe, it, expect } from 'vitest';
import { splitSoapFields } from '@/notes/soapFields';
import { SOAP_SAMPLE_BODY } from './fixtures/soap-sample';

// Phase-1 regression: AZMA's SOAP entry has four separate pre-labeled
// fields. splitSoapFields must produce four header-less, correctly-bounded
// strings — each pasteable straight into its AZMA field — fixing the two
// confirmed defects on a real de-identified note:
//   1. header duplication (copied section carried its own header line)
//   2. mis-segmentation (A split into capsule + בעיות; "תוכנית טיפול
//      (יעדי טיפול)" swallowed into P by the generic parser's regex).

describe('splitSoapFields — real de-identified note', () => {
  const f = splitSoapFields(SOAP_SAMPLE_BODY)!;

  it('returns four fields (not null) for a conforming SOAP body', () => {
    expect(f).not.toBeNull();
    expect(Object.keys(f).sort()).toEqual(['a', 'o', 'p', 's']);
  });

  it('S = patient report, header-less', () => {
    expect(f.s.startsWith('מרגיש סביר')).toBe(true);
    expect(f.s).not.toContain('דיווח המטופל:');
    expect(f.s).toContain('משתף פעולה עם הצוות');
  });

  it('O = bedside exam, header-less, no A/P bleed', () => {
    expect(f.o.startsWith('חום 37.0')).toBe(true);
    expect(f.o).not.toContain('בדיקה גופנית וממצאי עזר:');
    expect(f.o).toContain('DP מורגש דו"צ');
    expect(f.o).not.toContain('מסקנה והערכה');
    expect(f.o).not.toContain('בעיות:');
  });

  it('A = capsule + בעיות + *bullets + goal, together; outer label stripped', () => {
    // Outer "מסקנה והערכה:" label is gone (collides with AZMA's A label)…
    expect(f.a).not.toContain('מסקנה והערכה:');
    // …but the capsule text it introduced is present.
    expect(f.a.startsWith('בן 62, נשוי')).toBe(true);
    // Inner "בעיות:" sub-label is KEPT (assessment structure, not a field label).
    expect(f.a).toContain('בעיות:');
    // Every *domain bullet survives.
    expect(f.a).toContain('*זיהומית - זיהום פצע ניתוחי MRSA');
    expect(f.a).toContain('*נוגדי קרישה - ENOXAPARIN מוחזק');
    // The goal block is peeled OUT of P and lives in A.
    expect(f.a).toContain('תוכנית טיפול (יעדי טיפול):');
    expect(f.a).toContain('מטרה לטיפול אנטיביוטי ממוקד וריפוי פצע');
  });

  it('P = לביצוע body only, header-less, WITHOUT the goal block', () => {
    expect(f.p.startsWith('המשך VANCOMYCIN IV')).toBe(true);
    expect(f.p).not.toContain('לביצוע:');
    expect(f.p).toContain('דיאליזה לפי תוכנית');
    // The goal must NOT bleed into P (it belongs with A).
    expect(f.p).not.toContain('תוכנית טיפול (יעדי טיפול):');
    expect(f.p).not.toContain('מטרה לטיפול אנטיביוטי');
    // …and no capsule / problems bleed.
    expect(f.p).not.toContain('בעיות:');
    expect(f.p).not.toContain('*זיהומית');
  });
});

describe('splitSoapFields — guards & robustness', () => {
  it('null for empty / whitespace-only input', () => {
    expect(splitSoapFields('')).toBeNull();
    expect(splitSoapFields('   \n\n  ')).toBeNull();
  });

  it('null for a non-SOAP (admission-style) body → caller falls back', () => {
    const admission = [
      'הצגת החולה:',
      'בן 80 עם רקע של...',
      '',
      'אבחנות פעילות:',
      '# אי ספיקת לב',
      'דיון ותוכנית:',
      'המשך טיפול.',
    ].join('\n');
    expect(splitSoapFields(admission)).toBeNull();
  });

  it('null when a header is present but its section body is empty (airtight)', () => {
    // All four anchor headers exist but P has no content after it. The
    // presence-based gate alone would pass and yield p:'' — a "P" button
    // that copies an empty string into AZMA. The content-based gate must
    // catch this and fall back to the generic UI (spec R1: each field
    // pastes WITH correct content).
    const emptyP = [
      'דיווח המטופל:',
      'מרגיש טוב.',
      'בדיקה גופנית וממצאי עזר:',
      'חום 36.8.',
      'מסקנה והערכה:',
      'בן 70, יציב.',
      'לביצוע:',
      '', // P header present, body empty
    ].join('\n');
    expect(splitSoapFields(emptyP)).toBeNull();
  });

  it('null when the P anchor is missing (incomplete body)', () => {
    const noPlan = [
      'דיווח המטופל:',
      'מרגיש טוב.',
      'בדיקה גופנית וממצאי עזר:',
      'חום 36.8.',
      'מסקנה והערכה:',
      'בן 70, יציב.',
    ].join('\n');
    expect(splitSoapFields(noPlan)).toBeNull();
  });

  it('tolerates the optional Latin "S "/"O "/"A "/"P " header prefix', () => {
    const prefixed = [
      'S דיווח המטופל:',
      'ישן טוב.',
      'O בדיקה גופנית וממצאי עזר:',
      'חום 37.0.',
      'A מסקנה והערכה:',
      'בן 65, יציב.',
      'P לביצוע:',
      'המשך מעקב.',
    ].join('\n');
    const r = splitSoapFields(prefixed)!;
    expect(r).not.toBeNull();
    expect(r.s).toBe('ישן טוב.');
    expect(r.o).toBe('חום 37.0.');
    expect(r.a).toBe('בן 65, יציב.');
    expect(r.p).toBe('המשך מעקב.');
  });

  it('subsequent follow-up: synthesis + bullets, no capsule/בעיות label', () => {
    // Per SOAP_STYLE: subsequent rounds open A with a one-line synthesis and
    // go straight to bullets — no "בעיות:" sub-label. Still 4 valid fields.
    const followup = [
      'דיווח המטופל:',
      'ללא תלונות.',
      'בדיקה גופנית וממצאי עזר:',
      'יציב המודינמית.',
      'מסקנה והערכה:',
      'בשיקום לאחר ניתוח — מתקדם.',
      '*אורתופדית - יציב, ממשיך פיזיותרפיה.',
      'לביצוע:',
      'המשך טיפול שיקומי.',
    ].join('\n');
    const r = splitSoapFields(followup)!;
    expect(r).not.toBeNull();
    expect(r.a.startsWith('בשיקום לאחר ניתוח')).toBe(true);
    expect(r.a).toContain('*אורתופדית');
    expect(r.p).toBe('המשך טיפול שיקומי.');
  });
});
