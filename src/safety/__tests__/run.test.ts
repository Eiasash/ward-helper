import { describe, it, expect } from 'vitest';
import { runSafetyChecks } from '@/safety/run';
import type { Med, PatientContext } from '@/safety/types';

describe('runSafetyChecks — orchestrator integration', () => {
  it('combines all four engines on a real polypharmacy admission', () => {
    // 88-year-old with AF (no anticoag — START hits), CKD stage 3 on
    // ibuprofen (Beers + STOPP), chronic PPI > 8w (Beers + STOPP), benzo
    // for sleep (Beers), opioid no laxative (STOPP), ACB stack from
    // furosemide + ranitidine + amitriptyline.
    const meds: Med[] = [
      { name: 'ibuprofen 400mg tid' },
      { name: 'omeprazole 40mg', durationMonths: 18 },
      { name: 'lorazepam 1mg qhs' },
      { name: 'oxycodone 5mg q6h prn' },
      { name: 'furosemide 40mg' },
      { name: 'ranitidine 150mg' },
      { name: 'amitriptyline 25mg qhs' },
    ];
    const ctx: PatientContext = {
      age: 88,
      sex: 'F',
      conditions: ['atrial fibrillation', 'CKD stage 3', 'osteoporosis', 'chronic pain'],
      egfr: 42,
    };

    const r = runSafetyChecks(meds, ctx);

    // Beers fires: NSAID-CKD, BENZO-ELDER, PPI-LONG (3 minimum)
    expect(r.beers.length).toBeGreaterThanOrEqual(3);
    expect(r.beers.find((h) => h.code === 'BEERS-NSAID-CKD')).toBeTruthy();
    expect(r.beers.find((h) => h.code === 'BEERS-BENZO-ELDER')).toBeTruthy();
    expect(r.beers.find((h) => h.code === 'BEERS-PPI-LONG')).toBeTruthy();

    // STOPP fires: PPI-LONG (low), OPIOID-NO-LAX
    expect(r.stopp.find((h) => h.code === 'STOPP-OPIOID-NO-LAX')).toBeTruthy();
    expect(r.stopp.find((h) => h.code === 'STOPP-PPI-LONG')).toBeTruthy();

    // START fires: AF without anticoag, OP without bisphosphonate
    expect(r.start.find((h) => h.code === 'START-AF-NO-AC')).toBeTruthy();
    expect(r.start.find((h) => h.code === 'START-OP-NO-BISPHOS')).toBeTruthy();

    // ACB: amitriptyline (3) + furosemide (1) + ranitidine (1) = 5
    expect(r.acbScore).toBe(5);
  });

  it('returns empty hits for clean polypharmacy', () => {
    const meds: Med[] = [
      { name: 'atorvastatin 20mg' },
      { name: 'metformin 1000mg bid' },
      { name: 'apixaban 5mg bid' },
    ];
    const ctx: PatientContext = { age: 70, conditions: ['T2DM', 'AF'] };
    const r = runSafetyChecks(meds, ctx);
    expect(r.beers).toEqual([]);
    expect(r.stopp).toEqual([]);
    // T2DM age 70 is on a statin — no START hit; AF on apixaban — no AC hit.
    expect(r.start).toEqual([]);
    expect(r.acbScore).toBe(0);
  });

  it('handles empty meds + empty patient', () => {
    const r = runSafetyChecks([], {});
    expect(r).toEqual({ beers: [], stopp: [], start: [], acbScore: 0 });
  });

  it('survives null/undefined-ish input shape (defensive)', () => {
    const r = runSafetyChecks([] as unknown as Med[], undefined as unknown as PatientContext);
    expect(r.beers).toEqual([]);
    expect(r.acbScore).toBe(0);
  });
});
