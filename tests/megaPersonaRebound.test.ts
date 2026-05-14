import { describe, it, expect, vi } from 'vitest';
import {
  reboundIfOffBase,
  tryRecoverFromPageDeath,
} from '../scripts/lib/megaPersona.mjs';
import { evaluateReboundSanityBounds } from '../scripts/analyze-mega-run.mjs';

const BASE_URL = 'https://eiasash.github.io/ward-helper/';
const baseOrigin = new URL(BASE_URL).origin;
const basePathname = new URL(BASE_URL).pathname;

function newTally() {
  return {
    rebound_attempts: 0,
    rebound_successes: 0,
    layer2_recoveries: 0,
  };
}

function mockPage(opts: {
  url?: string | (() => string);
  goto?: () => Promise<unknown>;
}) {
  return {
    url: typeof opts.url === 'function' ? opts.url : () => opts.url ?? BASE_URL,
    goto: opts.goto ?? (() => Promise.resolve()),
  };
}

describe('reboundIfOffBase (Layer 1)', () => {
  it('happy path: off-base → goto called, attempts+successes both incremented', async () => {
    const tally = newTally();
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = mockPage({ url: 'about:blank', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(tally.rebound_attempts).toBe(1);
    expect(tally.rebound_successes).toBe(1);
  });

  it('on-base: no goto, no counter changes', async () => {
    const tally = newTally();
    const goto = vi.fn();
    const page = mockPage({ url: BASE_URL + '#/today', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).not.toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(0);
    expect(tally.rebound_successes).toBe(0);
  });

  it('same-origin wrong-path: triggers rebound (origin matches but pathname does not)', async () => {
    const tally = newTally();
    const goto = vi.fn().mockResolvedValue(undefined);
    // Same origin (https://eiasash.github.io) but different path — startsWith(basePathname) fails
    const page = mockPage({ url: 'https://eiasash.github.io/some-other-app/#/whatever', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(tally.rebound_attempts).toBe(1);
    expect(tally.rebound_successes).toBe(1);
  });

  it('dead context: page.url throws → swallowed silently, no counter changes', async () => {
    const tally = newTally();
    const page = {
      url: () => { throw new Error('Target page, context or browser has been closed'); },
      goto: vi.fn(),
    };
    await expect(reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally)).resolves.toBeUndefined();
    expect(page.goto).not.toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(0);
    expect(tally.rebound_successes).toBe(0);
  });

  it('goto fails after off-base detected: attempts=1, successes=0', async () => {
    const tally = newTally();
    const goto = vi.fn().mockRejectedValue(new Error('Target page has been closed'));
    const page = mockPage({ url: 'about:blank', goto });
    await reboundIfOffBase(page as any, baseOrigin, basePathname, BASE_URL, tally);
    expect(goto).toHaveBeenCalled();
    expect(tally.rebound_attempts).toBe(1);
    expect(tally.rebound_successes).toBe(0);
  });
});

describe('tryRecoverFromPageDeath (Layer 2)', () => {
  it('goto resolves: returns "recovered", recoveries=1, emits LOW page-closed-recovered', async () => {
    const tally = newTally();
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = mockPage({ goto });
    const logBug = vi.fn();
    const persona = { name: 'Dr. Test' };
    const picked = { name: 'admission' };
    const result = await tryRecoverFromPageDeath(page as any, BASE_URL, persona, picked, logBug, tally);
    expect(result).toBe('recovered');
    expect(tally.layer2_recoveries).toBe(1);
    expect(logBug).toHaveBeenCalledWith(
      'LOW',
      'chaos-infra',
      'Dr. Test/page-closed-recovered',
      expect.stringContaining('admission'),
    );
  });

  it('goto rejects: returns "unrecoverable", recoveries=0, emits HIGH page-closed-unrecoverable', async () => {
    const tally = newTally();
    const goto = vi.fn().mockRejectedValue(new Error('Target closed'));
    const page = mockPage({ goto });
    const logBug = vi.fn();
    const persona = { name: 'Dr. Test' };
    const picked = { name: 'consult' };
    const result = await tryRecoverFromPageDeath(page as any, BASE_URL, persona, picked, logBug, tally);
    expect(result).toBe('unrecoverable');
    expect(tally.layer2_recoveries).toBe(0);
    expect(logBug).toHaveBeenCalledWith(
      'HIGH',
      'chaos-infra',
      'Dr. Test/page-closed-unrecoverable',
      expect.stringContaining('consult'),
    );
  });
});

describe('evaluateReboundSanityBounds', () => {
  it('healthy persona: no breaches', () => {
    const tally = {
      actions: 1000,
      rebound_attempts: 30,
      rebound_successes: 28,
      layer2_recoveries: 1,
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches).toEqual([]);
  });

  it('high rebound rate: emits one breach', () => {
    const tally = {
      actions: 100,
      rebound_attempts: 60,
      rebound_successes: 55,
      layer2_recoveries: 2,
    };
    // (60 + 2) / 100 = 0.62 > 0.5 threshold
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]).toMatchObject({
      kind: 'rebound-rate-high',
      severity: 'MEDIUM',
    });
  });

  it('degraded success ratio with N>=10: emits one breach', () => {
    const tally = {
      actions: 500,
      rebound_attempts: 20,
      rebound_successes: 5,    // 5/20 = 25% success
      layer2_recoveries: 1,
    };
    // attempts >=10 and ratio < 0.5
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.some((b: any) => b.kind === 'rebound-success-degraded')).toBe(true);
  });

  it('layer 2 fired too much: emits one breach', () => {
    const tally = {
      actions: 1000,
      rebound_attempts: 20,
      rebound_successes: 20,
      layer2_recoveries: 7,
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.some((b: any) => b.kind === 'layer2-recoveries-high')).toBe(true);
  });

  it('multiple breaches: all reported', () => {
    const tally = {
      actions: 100,
      rebound_attempts: 70,
      rebound_successes: 10,   // 10/70 = 14% — degraded
      layer2_recoveries: 6,    // > 5
      // (70 + 6) / 100 = 0.76 > 0.5
    };
    const result = evaluateReboundSanityBounds('Dr. Test', tally);
    expect(result.breaches.length).toBe(3);
    const kinds = result.breaches.map((b) => b.kind);
    expect(kinds).toContain('rebound-rate-high');
    expect(kinds).toContain('rebound-success-degraded');
    expect(kinds).toContain('layer2-recoveries-high');
  });
});
