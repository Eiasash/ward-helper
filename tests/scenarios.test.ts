/**
 * End-to-end fictional scenarios for the four note types — admission,
 * discharge, SOAP, consult — exercising the full saveBoth pipeline:
 *   ParseFields  →  IndexedDB (patients + notes)  →  AES-GCM encrypt
 *                →  Supabase upsert (in-memory test engine)
 *
 * The Claude API generation step is skipped: each scenario carries a
 * pre-canned fictional Hebrew body that exercises Chameleon-rule
 * compliance (no arrows, no markdown bold, no q8h) without burning
 * proxy tokens. Encryption + cloud push run for real against an
 * in-memory mock of @supabase/supabase-js that records every upsert
 * so we can assert blob shape and round-trip-decrypt the ciphertext.
 *
 * Why this exists: prior tests covered each layer in isolation
 * (save.test.ts mocks crypto + cloud, cloud-restore.test.ts mocks the
 * Supabase client). Nothing exercised the four note types end-to-end
 * with real encryption against a Supabase-shaped sink, which is the
 * whole "save to supabase" path the user runs every day.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// ─────────────────────────────────────────────────────────────────────────
// In-memory Supabase test engine — mocked BEFORE saveBoth's transitive
// imports so cloud.ts picks up our createClient. Records every upsert and
// supports the auth.signInAnonymously() / auth.getSession() shape that
// ensureAnonymousAuth() expects.
// ─────────────────────────────────────────────────────────────────────────
interface UpsertRow {
  user_id: string;
  blob_type: 'patient' | 'note';
  blob_id: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  updated_at: string;
}

const engine: { rows: UpsertRow[] } = { rows: [] };
const TEST_USER_ID = 'test-user-fictional';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: TEST_USER_ID } } },
      })),
      signInAnonymously: vi.fn(async () => ({
        data: { user: { id: TEST_USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((_table: string) => ({
      upsert: vi.fn(async (row: UpsertRow) => {
        engine.rows.push(row);
        return { error: null };
      }),
    })),
  })),
}));

// Settings hook — return a fixed passphrase so the cloud-push branch fires.
vi.mock('@/ui/hooks/useSettings', () => ({
  getPassphrase: vi.fn(() => 'fictional-test-passphrase-2026'),
}));

// Costs module — saveBoth calls finalizeSessionFor; safe no-op stub.
vi.mock('@/agent/costs', () => ({
  finalizeSessionFor: vi.fn(),
}));

import { saveBoth } from '@/notes/save';
import {
  listPatients,
  listNotes,
  resetDbForTests,
  type NoteType,
} from '@/storage/indexed';
import { decryptFromCloud } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import type { ParseFields } from '@/agent/tools';

interface Scenario {
  type: NoteType;
  patient: ParseFields;
  bodyHebrew: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Four fictional scenarios. Patient identifiers are obviously synthetic
// (test-only ת.ז. that fail the Israeli check-digit). Hebrew bodies are
// short Chameleon-clean stubs — real notes are 10x longer but the goal
// here is plumbing verification, not prose realism.
// ─────────────────────────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  {
    type: 'admission',
    patient: {
      name: 'מירי לוי (פיקציה)',
      teudatZehut: '000000001',
      age: 82,
      sex: 'F',
      room: '14B',
      chiefComplaint: 'חולשה כללית, נפילות חוזרות',
      pmh: ['HTN', 'DM2', 'CKD stage 3'],
      meds: [
        { name: 'Apixaban', dose: '2.5mg', freq: 'פעמיים ביום' },
        { name: 'Metformin', dose: '500mg', freq: 'פעם ביום' },
      ],
      allergies: ['Penicillin — פריחה'],
    },
    bodyHebrew: [
      'הצגת החולה: בת 82, אלמנה, מתגוררת בבית עם מטפלת זרה, הגיעה דרך מיון.',
      '',
      'אבחנות פעילות:',
      'RECURRENT FALLS',
      'AKI ON CKD',
      '',
      'תלונה עיקרית: חולשה כללית ושתי נפילות בשבוע האחרון.',
      '',
      'המלצות:',
      '1. הידרציה IV',
      '2. בדיקת ויטמין D ו-B12',
      'חתימת רופא: ד"ר Eias Ashhab, מתמחה גריאטריה',
    ].join('\n'),
  },
  {
    type: 'discharge',
    patient: {
      name: 'יוסף ברק (פיקציה)',
      teudatZehut: '000000002',
      age: 76,
      sex: 'M',
      room: '12A',
      chiefComplaint: 'דלקת ריאות',
      pmh: ['COPD', 'HTN'],
      meds: [{ name: 'Tiotropium', dose: '18mcg', freq: 'פעם ביום' }],
    },
    bodyHebrew: [
      'אבחנות פעילות:',
      'COMMUNITY-ACQUIRED PNEUMONIA - Resolved',
      '',
      'מהלך ודיון:',
      '# זיהומי',
      'דלקת ריאות שטופלה ב-Ceftriaxone 1g כל 24 שעות למשך 5 ימים. CRP: 18.4 > 9.1 > 2.3.',
      '',
      'המלצות בשחרור:',
      '1. המשך מעקב רופא משפחה תוך שבוע',
      '2. הפניה לפיזיותרפיה בבית (יט"ב)',
      '',
      'חתימה: ד"ר Eias Ashhab, מתמחה גריאטריה',
    ].join('\n'),
  },
  {
    type: 'soap',
    patient: {
      name: 'רחל אברהם (פיקציה)',
      teudatZehut: '000000003',
      age: 88,
      sex: 'F',
      room: '15C',
      chiefComplaint: 'בלבול חדש',
      pmh: ['Dementia', 'AF', 'CHF'],
    },
    bodyHebrew: [
      'S: ללא תלונות חדשות. ישנה היטב, אכלה ארוחת בוקר חלקית.',
      '',
      'O:',
      'סימנים חיוניים: BP 132/74, HR 88, SpO2 95%, Temp 36.8.',
      'בדיקה: עירנית, מכוונת לאדם בלבד.',
      'מעבדה: Cr: 1.55 > 1.32 > 1.03 (24/04).',
      '',
      'A:',
      '# נוירולוגי - בלבול בהשתפרות',
      '# כלייתי - AKI נפתר',
      '',
      'P:',
      '1. המשך הידרציה IV עד 1.5 ליטר ביממה',
      '2. ניטור מצב הכרה כל 8 שעות',
    ].join('\n'),
  },
  {
    type: 'consult',
    patient: {
      name: 'דוד גולן (פיקציה)',
      teudatZehut: '000000004',
      age: 91,
      sex: 'M',
      room: '11A',
      chiefComplaint: 'ירידה בתפקוד',
      pmh: ['Parkinson', 'HTN'],
      meds: [
        { name: 'Levodopa-Carbidopa', dose: '100/25mg', freq: 'שלוש פעמים ביום' },
      ],
    },
    bodyHebrew: [
      'ייעוץ גריאטרי — תאריך 25/04/26 — מטופל דוד גולן — מחלקה מפנה פנימית ב — יועץ ד"ר Eias Ashhab',
      '',
      'סיבת הייעוץ: ירידה תפקודית במהלך אשפוז.',
      '',
      'הערכה: מטופל סיעודי חלקי, עצמאי בארוחות, תלוי ברחצה ולבוש. ללא סימני דליריום פעיל.',
      '',
      'המלצות תרופתיות:',
      'להפסיק:',
      'Diphenhydramine',
      'אנטיהיסטמין דור ראשון, מעלה סיכון לבלבול בקשישים.',
      '',
      'טיפול לא-תרופתי:',
      'התניידות מוקדמת, התמצאות סביבתית, שמיעה ועזרי הליכה.',
      '',
      'חתימה: ד"ר Eias Ashhab, מתמחה גריאטריה, 25/04/26',
    ].join('\n'),
  },
];

beforeEach(async () => {
  await resetDbForTests();
  engine.rows.length = 0;
});

describe('Fictional scenarios — full pipeline through Supabase test engine', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.type}: persists locally and pushes encrypted blobs`, async () => {
      const result = await saveBoth(
        scenario.patient,
        scenario.type,
        scenario.bodyHebrew,
      );

      expect(result.cloudPushed).toBe(true);
      expect(result.cloudSkippedReason).toBeNull();

      const patients = await listPatients();
      expect(patients).toHaveLength(1);
      expect(patients[0]!.name).toBe(scenario.patient.name);
      expect(patients[0]!.teudatZehut).toBe(scenario.patient.teudatZehut);

      const notes = await listNotes(result.patientId);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.type).toBe(scenario.type);
      expect(notes[0]!.bodyHebrew).toBe(scenario.bodyHebrew);

      // Two blobs hit the engine: one patient, one note. Both for our user.
      expect(engine.rows).toHaveLength(2);
      const types = engine.rows.map((r) => r.blob_type).sort();
      expect(types).toEqual(['note', 'patient']);
      for (const row of engine.rows) {
        expect(row.user_id).toBe(TEST_USER_ID);
        expect(row.ciphertext.byteLength).toBeGreaterThan(0);
        expect(row.iv.byteLength).toBe(12);
        expect(row.salt.byteLength).toBe(16);
      }
    });
  }

  it('round-trips: ciphertext pushed to engine decrypts back to the note body', async () => {
    const scenario = SCENARIOS[0]!; // admission — body is the longest fixture
    const result = await saveBoth(
      scenario.patient,
      scenario.type,
      scenario.bodyHebrew,
    );
    expect(result.cloudPushed).toBe(true);

    const noteRow = engine.rows.find((r) => r.blob_type === 'note');
    expect(noteRow).toBeDefined();

    const key = await deriveAesKey(
      'fictional-test-passphrase-2026',
      noteRow!.salt as unknown as Uint8Array<ArrayBuffer>,
    );
    const decrypted = await decryptFromCloud<{ bodyHebrew: string }>(
      noteRow!.ciphertext as unknown as Uint8Array<ArrayBuffer>,
      noteRow!.iv as unknown as Uint8Array<ArrayBuffer>,
      key,
    );
    expect(decrypted.bodyHebrew).toBe(scenario.bodyHebrew);
  }, 30_000);

  it('runs all four scenarios sequentially and accumulates 8 blobs in the engine', async () => {
    for (const scenario of SCENARIOS) {
      const result = await saveBoth(
        scenario.patient,
        scenario.type,
        scenario.bodyHebrew,
      );
      expect(result.cloudPushed).toBe(true);
    }
    expect(engine.rows).toHaveLength(SCENARIOS.length * 2);
    const patientCount = engine.rows.filter((r) => r.blob_type === 'patient').length;
    const noteCount = engine.rows.filter((r) => r.blob_type === 'note').length;
    expect(patientCount).toBe(SCENARIOS.length);
    expect(noteCount).toBe(SCENARIOS.length);

    const allPatients = await listPatients();
    expect(allPatients).toHaveLength(SCENARIOS.length);
    const names = allPatients.map((p) => p.name).sort();
    expect(names).toEqual(SCENARIOS.map((s) => s.patient.name).sort());
  }, 60_000);
});
