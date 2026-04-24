import { describe, it, expect } from 'vitest';
import {
  assertExtractIsSafe,
  ExtractCapturedDoctorError,
  ExtractCapturedPatientCodeError,
  ExtractLowConfidenceError,
} from '@/notes/orchestrate';
import type { ParseResult } from '@/agent/tools';

/**
 * These tests encode the v1.17.0 incident: the SOAP generator produced a note
 * starting "חולה בן 62" for a 92-year-old female patient (עיני שרה), because
 * the vision extractor read the AZMA title bar (which shows the logged-in
 * doctor) as the patient card. The guard here is the defense-in-depth layer
 * that would have blocked the emit even if the extractor got confused.
 *
 * Keep these tests tight: false positives are expensive — a legitimate note
 * blocked is still a ward-round interruption. Each rule should only fire on
 * patterns that are provably interface chrome, never on patient data.
 */

function mk(fields: Partial<ParseResult['fields']>, confidence: ParseResult['confidence'] = {}): ParseResult {
  return { fields, confidence };
}

describe('assertExtractIsSafe — rule 1: doctor-name capture', () => {
  it('blocks when fields.name equals the logged-in SZMC geriatrics fellow ("אשרב איאס")', () => {
    // This is the exact incident that motivated the guard — the v1.16.0 SOAP
    // was generated from extract that read "אשרב איאס" off the AZMA title bar.
    expect(() => assertExtractIsSafe('soap', mk({ name: 'אשרב איאס', age: 62 })))
      .toThrow(ExtractCapturedDoctorError);
  });

  it('blocks on other known SZMC doctors (אבו זיד גיהאד / אסלן אורי / אחמרו מאלק)', () => {
    for (const doc of ['אבו זיד גיהאד', 'אסלן אורי', 'אחמרו מאלק']) {
      expect(
        () => assertExtractIsSafe('admission', mk({ name: doc })),
        `expected ${doc} to trigger the doctor-name guard`,
      ).toThrow(ExtractCapturedDoctorError);
    }
  });

  it('matches on substring so "אשרב איאס," (trailing punctuation) still trips', () => {
    expect(() => assertExtractIsSafe('soap', mk({ name: 'אשרב איאס,' })))
      .toThrow(ExtractCapturedDoctorError);
  });

  it('matches on substring so "ד״ר אשרב איאס" (with title prefix) still trips', () => {
    expect(() => assertExtractIsSafe('soap', mk({ name: 'ד״ר אשרב איאס' })))
      .toThrow(ExtractCapturedDoctorError);
  });

  it('normalizes collapsed whitespace — "אשרב  איאס" (two spaces) still trips', () => {
    expect(() => assertExtractIsSafe('soap', mk({ name: 'אשרב  איאס' })))
      .toThrow(ExtractCapturedDoctorError);
  });

  it('does NOT block on a legitimate patient named "עיני שרה"', () => {
    expect(() => assertExtractIsSafe('soap', mk({ name: 'עיני שרה', age: 92 })))
      .not.toThrow();
  });

  it('does NOT block on a similar-but-different name not on the blocklist', () => {
    // Guard is deliberately narrow. A patient literally named "אשרב" without
    // the surname "איאס" (theoretical) should not be blocked — the hard
    // blocklist is paired-name only to keep false positives to zero.
    expect(() => assertExtractIsSafe('soap', mk({ name: 'אשרב כהן' }))).not.toThrow();
  });

  it('tolerates missing name entirely (empty extract)', () => {
    expect(() => assertExtractIsSafe('soap', mk({}))).not.toThrow();
  });

  it('error message is Hebrew and names the captured value', () => {
    try {
      assertExtractIsSafe('soap', mk({ name: 'אשרב איאס' }));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ExtractCapturedDoctorError;
      expect(err.message).toContain('אשרב איאס');
      expect(err.message).toContain('צלם שוב');
      expect(err.capturedName).toBe('אשרב איאס');
    }
  });
});

describe('assertExtractIsSafe — rule 2: Chameleon patient-code in teudatZehut', () => {
  it('blocks when teudatZehut is a p-prefixed internal code ("p15695")', () => {
    expect(() => assertExtractIsSafe('soap', mk({ teudatZehut: 'p15695' })))
      .toThrow(ExtractCapturedPatientCodeError);
  });

  it('blocks on case-insensitive p prefix', () => {
    expect(() => assertExtractIsSafe('soap', mk({ teudatZehut: 'P12345' })))
      .toThrow(ExtractCapturedPatientCodeError);
  });

  it('does NOT block on a real 9-digit Israeli ת.ז.', () => {
    expect(() => assertExtractIsSafe('soap', mk({ teudatZehut: '073777617' })))
      .not.toThrow();
  });

  it('does NOT block on missing teudatZehut', () => {
    expect(() => assertExtractIsSafe('soap', mk({ name: 'פלוני אלמוני' })))
      .not.toThrow();
  });

  it('error message is Hebrew and names the captured code', () => {
    try {
      assertExtractIsSafe('soap', mk({ teudatZehut: 'p15695' }));
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ExtractCapturedPatientCodeError;
      expect(err.message).toContain('p15695');
      expect(err.message).toContain('9 ספרות');
      expect(err.code).toBe('p15695');
    }
  });
});

describe('assertExtractIsSafe — rule 3: low-confidence on Chameleon-bound notes', () => {
  it('blocks SOAP when confidence.name is "low"', () => {
    expect(() =>
      assertExtractIsSafe(
        'soap',
        mk({ name: 'פלוני אלמוני' }, { name: 'low' }),
      ),
    ).toThrow(ExtractLowConfidenceError);
  });

  it('blocks admission when confidence.age is "low"', () => {
    expect(() =>
      assertExtractIsSafe(
        'admission',
        mk({ age: 80 }, { age: 'low' }),
      ),
    ).toThrow(ExtractLowConfidenceError);
  });

  it('blocks discharge and consult too', () => {
    expect(() =>
      assertExtractIsSafe('discharge', mk({ age: 80 }, { age: 'low' })),
    ).toThrow(ExtractLowConfidenceError);
    expect(() =>
      assertExtractIsSafe('consult', mk({ age: 80 }, { age: 'low' })),
    ).toThrow(ExtractLowConfidenceError);
  });

  it('does NOT block case-conference (not Chameleon-bound, Eias reviews visually)', () => {
    expect(() =>
      assertExtractIsSafe('case', mk({ name: 'x', age: 80 }, { name: 'low', age: 'low' })),
    ).not.toThrow();
  });

  it('does NOT block when confidence is "med" or "high"', () => {
    expect(() =>
      assertExtractIsSafe('soap', mk({ name: 'פ.א.' }, { name: 'med' })),
    ).not.toThrow();
    expect(() =>
      assertExtractIsSafe('soap', mk({ name: 'פ.א.' }, { name: 'high' })),
    ).not.toThrow();
  });

  it('does NOT block when confidence is missing entirely (older session / direct nav)', () => {
    // Rule 3 degrades gracefully so older saved sessions still work; the
    // doctor-name and patient-code rules remain active even without confidence.
    expect(() => assertExtractIsSafe('soap', mk({ name: 'פ.א.' }))).not.toThrow();
  });

  it('collects multiple low-confidence fields into a single Hebrew error', () => {
    try {
      assertExtractIsSafe(
        'soap',
        mk({ name: 'x', age: 70 }, { name: 'low', age: 'low' }),
      );
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ExtractLowConfidenceError;
      expect(err.message).toContain('שם');
      expect(err.message).toContain('גיל');
      expect(err.fields).toEqual(['שם', 'גיל']);
    }
  });
});

describe('assertExtractIsSafe — ordering and combinations', () => {
  it('doctor-name check fires before low-confidence check', () => {
    // Both would trigger; the error class should be the doctor-name one
    // because that's the more specific (and more actionable) diagnosis.
    expect(() =>
      assertExtractIsSafe(
        'soap',
        mk({ name: 'אשרב איאס', age: 62 }, { name: 'low' }),
      ),
    ).toThrow(ExtractCapturedDoctorError);
  });

  it('the exact v1.16.0 incident is rejected', () => {
    // Reconstructed from the SOAP screenshot Eias shipped on 24.04.2026:
    //   name: "אשרב איאס" (doctor name mis-read off title bar)
    //   teudatZehut: "p15695" (Chameleon internal patient code)
    //   age: 62 (weight 62.00 kg mis-read as age; real age was 92)
    // With the guard in place, this entire extract should never have
    // reached the emit turn.
    expect(() =>
      assertExtractIsSafe(
        'soap',
        mk({ name: 'אשרב איאס', teudatZehut: 'p15695', age: 62, sex: 'M' }),
      ),
    ).toThrow(ExtractCapturedDoctorError);
  });
});
