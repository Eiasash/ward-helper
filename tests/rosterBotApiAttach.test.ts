import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attachRosterBotApiIfEnabled } from '@/dev/__rosterBotApi';

describe('__rosterBotApi attachment gate', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __rosterBotApi?: unknown }).__rosterBotApi;
  });

  afterEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __rosterBotApi?: unknown }).__rosterBotApi;
  });

  test('without flag — no window.__rosterBotApi attached', () => {
    attachRosterBotApiIfEnabled();
    expect(window.__rosterBotApi).toBeUndefined();
  });

  test('with flag set to "1" — attaches the full surface', () => {
    localStorage.setItem('ward-helper.botApi', '1');
    attachRosterBotApiIfEnabled();
    expect(window.__rosterBotApi).toBeDefined();
    expect(typeof window.__rosterBotApi!.seedAdversarialAzmaTsv).toBe('function');
    expect(typeof window.__rosterBotApi!.importViaPaste).toBe('function');
    expect(typeof window.__rosterBotApi!.normalizeIsraeliTz).toBe('function');
    expect(typeof window.__rosterBotApi!.setRoster).toBe('function');
    expect(typeof window.__rosterBotApi!.getRoster).toBe('function');
    expect(typeof window.__rosterBotApi!.clearRoster).toBe('function');
    expect(typeof window.__rosterBotApi!.listPatientsByTzMap).toBe('function');
    expect(typeof window.__rosterBotApi!.putPatient).toBe('function');
    expect(typeof window.__rosterBotApi!.clearPatients).toBe('function');
  });

  test('with flag set to any other value — does not attach', () => {
    localStorage.setItem('ward-helper.botApi', 'yes');
    attachRosterBotApiIfEnabled();
    expect(window.__rosterBotApi).toBeUndefined();
  });
});
