import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveSoapMode,
  classifyRehabSubMode,
  decideSoapMode,
  loadModeChoice,
  saveModeChoice,
  isSoapModeUiEnabled,
  isHdContext,
  ESCALATION_LOOKBACK_HOURS,
} from '@/notes/soapMode';
import type { ContinuityContext } from '@/notes/continuity';
import type { Note, Patient } from '@/storage/indexed';

const HOUR_MS = 60 * 60 * 1000;

function makeSoap(opts: { ageHours: number; body: string }): Note {
  return {
    id: `soap-${opts.ageHours}`,
    patientId: 'p1',
    type: 'soap',
    bodyHebrew: opts.body,
    structuredData: {},
    createdAt: Date.now() - opts.ageHours * HOUR_MS,
    updatedAt: Date.now() - opts.ageHours * HOUR_MS,
  };
}

function makeAdmission(body: string): Note {
  return {
    id: 'adm-1',
    patientId: 'p1',
    type: 'admission',
    bodyHebrew: body,
    structuredData: {},
    createdAt: Date.now() - 5 * 24 * HOUR_MS,
    updatedAt: Date.now() - 5 * 24 * HOUR_MS,
  };
}

const STUB_PATIENT: Patient = {
  id: 'p1',
  name: 'plony',
  teudatZehut: '111111118',
  dob: '1940-01-01',
  room: null,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
};

function makeContinuity(opts: {
  admissionBody?: string;
  soaps?: Note[];
}): ContinuityContext {
  const admission = opts.admissionBody ? makeAdmission(opts.admissionBody) : null;
  const priorSoaps = opts.soaps ?? [];
  return {
    patient: STUB_PATIENT,
    admission,
    priorSoaps,
    mostRecentSoap: priorSoaps[0] ?? null,
    episodeStart: admission?.createdAt ?? null,
  };
}

describe('resolveSoapMode', () => {
  it('honors a manual override regardless of room', () => {
    expect(resolveSoapMode('שיקום-12', 'general')).toBe('general');
    expect(resolveSoapMode(null, 'rehab-HD-COMPLEX')).toBe('rehab-HD-COMPLEX');
    expect(resolveSoapMode('פנימית ב', 'rehab-FIRST')).toBe('rehab-FIRST');
  });

  it('returns rehab-auto on rehab-marked room with auto override', () => {
    expect(resolveSoapMode('שיקום-12', 'auto')).toBe('rehab-auto');
    expect(resolveSoapMode('Rehab-A', 'auto')).toBe('rehab-auto');
    expect(resolveSoapMode('REHAB ward 3', 'auto')).toBe('rehab-auto');
  });

  it('returns general on non-rehab room with auto override', () => {
    expect(resolveSoapMode('פנימית ב-12', 'auto')).toBe('general');
    expect(resolveSoapMode('ICU', 'auto')).toBe('general');
    expect(resolveSoapMode(null, 'auto')).toBe('general');
    expect(resolveSoapMode(undefined, 'auto')).toBe('general');
    expect(resolveSoapMode('', 'auto')).toBe('general');
  });

  it('defaults the manual override to auto when omitted', () => {
    expect(resolveSoapMode('שיקום')).toBe('rehab-auto');
    expect(resolveSoapMode('cardiology')).toBe('general');
  });
});

describe('isHdContext (HD pattern detector — Phase C fixup 2)', () => {
  it('matches standalone HD via ASCII word boundary', () => {
    expect(isHdContext('Pt on HD M/W/F')).toBe(true);
    expect(isHdContext('chronic HD since 2019')).toBe(true);
  });

  it('does NOT match HDL, HDR, HDPE — substring traps that \\b prevents', () => {
    expect(isHdContext('HDL 35, LDL 110')).toBe(false);
    expect(isHdContext('treated with HDR brachytherapy')).toBe(false);
    expect(isHdContext('HDPE catheter')).toBe(false);
  });

  it('matches ESRD/ESKD/dialysis/hemodialysis/fistula in English', () => {
    expect(isHdContext('ESRD on hemodialysis')).toBe(true);
    expect(isHdContext('Background ESKD')).toBe(true);
    expect(isHdContext('chronic dialysis')).toBe(true);
    expect(isHdContext('AV fistula L arm')).toBe(true);
  });

  it('matches Hebrew variants (no \\b — Hebrew terms are full words)', () => {
    expect(isHdContext('המודיאליזה כרונית פעמיים בשבוע')).toBe(true);
    expect(isHdContext('דיאליזה')).toBe(true);
    expect(isHdContext('פיסטולה ביד שמאל תקינה')).toBe(true);
    expect(isHdContext('המוד 3 פעמים בשבוע')).toBe(true);
    expect(isHdContext('מטופל על המודיאליזה')).toBe(true);
  });

  it('joins multiple fields with whitespace and detects across them', () => {
    expect(isHdContext('rehab patient', null, 'AV fistula L arm')).toBe(true);
    expect(isHdContext('admission text', undefined, 'שיקום-HD')).toBe(true);
  });

  it('returns false on empty/falsy input', () => {
    expect(isHdContext()).toBe(false);
    expect(isHdContext(null, undefined, '')).toBe(false);
  });
});

describe('classifyRehabSubMode', () => {
  it('returns rehab-FIRST when no prior SOAPs exist', () => {
    expect(classifyRehabSubMode(null, 'שיקום')).toBe('rehab-FIRST');
    expect(classifyRehabSubMode(makeContinuity({ soaps: [] }), 'שיקום')).toBe(
      'rehab-FIRST',
    );
  });

  it('returns rehab-HD-COMPLEX when admission body mentions HD or fistula', () => {
    const ctx = makeContinuity({
      admissionBody: 'מטופל לאחר ניתוח. רקע HD פעמיים בשבוע. פיסטולה תקינה.',
      soaps: [makeSoap({ ageHours: 10, body: 'יציב' })],
    });
    expect(classifyRehabSubMode(ctx, 'שיקום')).toBe('rehab-HD-COMPLEX');

    const ctx2 = makeContinuity({
      admissionBody: 'דיאליזה כרונית.',
      soaps: [makeSoap({ ageHours: 10, body: 'יציב' })],
    });
    expect(classifyRehabSubMode(ctx2, 'שיקום')).toBe('rehab-HD-COMPLEX');
  });

  it('returns rehab-HD-COMPLEX when room hint mentions HD', () => {
    const ctx = makeContinuity({
      admissionBody: 'אדמיסיון לאחר ניתוח אורתופדי.',
      soaps: [makeSoap({ ageHours: 10, body: 'יציב' })],
    });
    expect(classifyRehabSubMode(ctx, 'שיקום-HD')).toBe('rehab-HD-COMPLEX');
  });

  it('returns rehab-COMPLEX when a recent SOAP shows escalation', () => {
    const ctx = makeContinuity({
      admissionBody: 'אדמיסיון לאחר ניתוח אורתופדי. ללא רקע נפרולוגי משמעותי.',
      soaps: [
        makeSoap({ ageHours: 6, body: 'החמרה במצב, חום 38.9. התחלנו אנטיביוטיקה חדשה.' }),
      ],
    });
    expect(classifyRehabSubMode(ctx, 'שיקום')).toBe('rehab-COMPLEX');
  });

  it('does not flag escalation when the SOAP is older than the lookback window', () => {
    const ctx = makeContinuity({
      admissionBody: 'אדמיסיון לאחר ניתוח אורתופדי. ללא רקע נפרולוגי משמעותי.',
      soaps: [
        makeSoap({ ageHours: ESCALATION_LOOKBACK_HOURS + 24, body: 'החמרה לפני שלושה ימים' }),
      ],
    });
    expect(classifyRehabSubMode(ctx, 'שיקום')).toBe('rehab-STABLE');
  });

  it('returns rehab-STABLE for an unremarkable recent SOAP', () => {
    const ctx = makeContinuity({
      admissionBody: 'אדמיסיון לאחר ניתוח אורתופדי. ללא רקע נפרולוגי משמעותי.',
      soaps: [makeSoap({ ageHours: 5, body: 'יציב, מתקדם בטיפול שיקומי' })],
    });
    expect(classifyRehabSubMode(ctx, 'שיקום')).toBe('rehab-STABLE');
  });
});

describe('ESCALATION_LOOKBACK_HOURS (Phase C fixup 3)', () => {
  it('is exported as a named constant set to 48', () => {
    expect(ESCALATION_LOOKBACK_HOURS).toBe(48);
  });
});

describe('decideSoapMode', () => {
  it('short-circuits to manual override even when continuity could classify differently', () => {
    const ctx = makeContinuity({
      admissionBody: 'HD פעמיים בשבוע',
      soaps: [makeSoap({ ageHours: 10, body: 'יציב' })],
    });
    expect(
      decideSoapMode({
        roomHint: 'שיקום',
        manualOverride: 'general',
        continuity: ctx,
      }),
    ).toBe('general');
    expect(
      decideSoapMode({
        roomHint: 'שיקום',
        manualOverride: 'rehab-STABLE',
        continuity: ctx,
      }),
    ).toBe('rehab-STABLE');
  });

  it('classifies into a rehab sub-mode when manual override is auto and room hints rehab', () => {
    const ctx = makeContinuity({
      admissionBody: 'אדמיסיון לאחר ניתוח אורתופדי.',
      soaps: [],
    });
    expect(
      decideSoapMode({
        roomHint: 'שיקום-12',
        manualOverride: 'auto',
        continuity: ctx,
      }),
    ).toBe('rehab-FIRST');
  });

  it('returns general when no rehab signal and no manual override', () => {
    expect(
      decideSoapMode({
        roomHint: 'פנימית ב',
        manualOverride: 'auto',
        continuity: null,
      }),
    ).toBe('general');
  });
});

describe('persistence helpers (Phase C fixup 1 — hashed key, no PII)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a choice keyed by hashed teudatZehut', async () => {
    await saveModeChoice('111111118', 'rehab-HD-COMPLEX');
    expect(await loadModeChoice('111111118')).toBe('rehab-HD-COMPLEX');
  });

  it('hashes teudatZehut into storage key — no PII reaches localStorage', async () => {
    const tz = '123456789';
    await saveModeChoice(tz, 'rehab-HD-COMPLEX');
    const allKeys = Object.keys(localStorage);
    expect(allKeys.some((k) => k.includes(tz))).toBe(false);
    expect(allKeys.some((k) => k.startsWith('soap-mode:'))).toBe(true);
  });

  it('produces a stable key across calls for the same tz', async () => {
    await saveModeChoice('123456789', 'rehab-FIRST');
    const keysAfterFirst = Object.keys(localStorage).filter((k) =>
      k.startsWith('soap-mode:'),
    );
    await saveModeChoice('123456789', 'rehab-COMPLEX');
    const keysAfterSecond = Object.keys(localStorage).filter((k) =>
      k.startsWith('soap-mode:'),
    );
    expect(keysAfterFirst).toEqual(keysAfterSecond);
    expect(keysAfterSecond.length).toBe(1);
  });

  it('produces distinct keys for distinct tz values', async () => {
    await saveModeChoice('111111118', 'rehab-FIRST');
    await saveModeChoice('222222226', 'rehab-COMPLEX');
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('soap-mode:'),
    );
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('returns auto for an unknown patient', async () => {
    expect(await loadModeChoice('222222226')).toBe('auto');
  });

  it('is a no-op when teudatZehut is missing', async () => {
    await saveModeChoice(null, 'rehab-FIRST');
    expect(await loadModeChoice(null)).toBe('auto');
    expect(Object.keys(localStorage).length).toBe(0);
  });

  it('rejects garbage values stored externally', async () => {
    // Compute the same hashed key the helper would produce, then poison it.
    await saveModeChoice('111111118', 'rehab-FIRST');
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith('soap-mode:'),
    );
    expect(keys).toHaveLength(1);
    localStorage.setItem(keys[0]!, 'not-a-real-mode');
    expect(await loadModeChoice('111111118')).toBe('auto');
  });
});

describe('isSoapModeUiEnabled', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false by default', () => {
    expect(isSoapModeUiEnabled()).toBe(false);
  });

  it('returns true when the batch_features flag is set to "1"', () => {
    localStorage.setItem('batch_features', '1');
    expect(isSoapModeUiEnabled()).toBe(true);
  });

  it('returns false for any other flag value', () => {
    localStorage.setItem('batch_features', 'true');
    expect(isSoapModeUiEnabled()).toBe(false);
    localStorage.setItem('batch_features', '0');
    expect(isSoapModeUiEnabled()).toBe(false);
  });
});
