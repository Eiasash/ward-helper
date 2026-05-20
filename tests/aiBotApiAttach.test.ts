import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attachAiBotApiIfEnabled } from '@/dev/__aiBotApi';

describe('__aiBotApi attachment gate', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __aiBotApi?: unknown }).__aiBotApi;
  });

  afterEach(() => {
    try {
      localStorage.removeItem('ward-helper.botApi');
    } catch {
      /* localStorage disabled — nothing to clear */
    }
    delete (window as { __aiBotApi?: unknown }).__aiBotApi;
  });

  test('without flag — no window.__aiBotApi attached', () => {
    attachAiBotApiIfEnabled();
    expect(window.__aiBotApi).toBeUndefined();
  });

  test('with flag set to "1" — attaches the full surface', () => {
    localStorage.setItem('ward-helper.botApi', '1');
    attachAiBotApiIfEnabled();
    expect(window.__aiBotApi).toBeDefined();
    expect(typeof window.__aiBotApi!.callClaude).toBe('function');
    expect(typeof window.__aiBotApi!.installAiFetchInterceptor).toBe('function');
    expect(typeof window.__aiBotApi!.uninstallAiFetchInterceptor).toBe('function');
    expect(typeof window.__aiBotApi!.getFetchCount).toBe('function');
    expect(typeof window.__aiBotApi!.resetFetchCount).toBe('function');
    expect(window.__aiBotApi!.getFetchCount()).toBe(0);
  });

  test('with flag set to any other value — does not attach', () => {
    localStorage.setItem('ward-helper.botApi', 'yes');
    attachAiBotApiIfEnabled();
    expect(window.__aiBotApi).toBeUndefined();
  });
});
