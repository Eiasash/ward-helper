import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attachPhiBotApiIfEnabled } from '@/dev/__phiBotApi';

describe('__phiBotApi attachment gate', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __phiBotApi?: unknown }).__phiBotApi;
  });

  afterEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __phiBotApi?: unknown }).__phiBotApi;
  });

  test('without flag — no window.__phiBotApi attached', () => {
    attachPhiBotApiIfEnabled();
    expect(window.__phiBotApi).toBeUndefined();
  });

  test('with flag set to "1" — attaches the full surface', () => {
    localStorage.setItem('ward-helper.botApi', '1');
    attachPhiBotApiIfEnabled();
    expect(window.__phiBotApi).toBeDefined();
    expect(typeof window.__phiBotApi!.seedOneSealedPatient).toBe('function');
    expect(typeof window.__phiBotApi!.derivePhiKey).toBe('function');
    expect(typeof window.__phiBotApi!.setPhiKey).toBe('function');
    expect(typeof window.__phiBotApi!.clearPhiKey).toBe('function');
    expect(typeof window.__phiBotApi!.hasPhiKey).toBe('function');
    expect(typeof window.__phiBotApi!.loadOrCreatePhiSalt).toBe('function');
    expect(typeof window.__phiBotApi!.sealRow).toBe('function');
  });

  test('with flag set to any other value — does not attach', () => {
    localStorage.setItem('ward-helper.botApi', 'yes');
    attachPhiBotApiIfEnabled();
    expect(window.__phiBotApi).toBeUndefined();
  });
});
