import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCurrentUser,
  isLoggedIn,
  getUserId,
  setAuthSession,
  logout,
  validateUsername,
  validatePassword,
  normalizeUsername,
  subscribeAuthChanges,
} from '@/auth/auth';

beforeEach(() => {
  localStorage.clear();
});

describe('auth — pure helpers', () => {
  it('validateUsername accepts the documented pattern', () => {
    expect(validateUsername('eias')).toBeNull();
    expect(validateUsername('eias_a')).toBeNull();
    expect(validateUsername('eias-a-2026')).toBeNull();
    expect(validateUsername('a23')).toBeNull(); // 3 chars, OK
  });

  it('validateUsername rejects bad shapes', () => {
    expect(validateUsername('')).not.toBeNull();
    expect(validateUsername('ab')).not.toBeNull(); // too short
    expect(validateUsername('-eias')).not.toBeNull(); // starts with -
    // Mixed-case is auto-lowercased before validation — 'Eias' is treated as 'eias'.
    expect(validateUsername('Eias')).toBeNull();
    expect(validateUsername('eias!')).not.toBeNull(); // special char
    expect(validateUsername('a'.repeat(33))).not.toBeNull(); // too long
  });

  it('validatePassword rejects below 6 chars', () => {
    expect(validatePassword('')).not.toBeNull();
    expect(validatePassword('12345')).not.toBeNull();
    expect(validatePassword('123456')).toBeNull();
    expect(validatePassword('a-very-strong-password')).toBeNull();
  });

  it('normalizeUsername lowercases and trims', () => {
    expect(normalizeUsername('  Eias  ')).toBe('eias');
    expect(normalizeUsername('EIAS_A')).toBe('eias_a');
  });
});

describe('auth — session state', () => {
  it('getCurrentUser returns null when no session', () => {
    expect(getCurrentUser()).toBeNull();
    expect(isLoggedIn()).toBe(false);
  });

  it('setAuthSession persists + getCurrentUser reads back', () => {
    setAuthSession('eias', 'Eias Ashhab');
    const u = getCurrentUser();
    expect(u).not.toBeNull();
    expect(u!.username).toBe('eias');
    expect(u!.displayName).toBe('Eias Ashhab');
    expect(typeof u!.loggedInAt).toBe('number');
    expect(isLoggedIn()).toBe(true);
  });

  it('setAuthSession with no displayName stores null', () => {
    setAuthSession('eias');
    expect(getCurrentUser()!.displayName).toBeNull();
  });

  it('getCurrentUser returns null on tampered profile (bad username shape)', () => {
    localStorage.setItem(
      'ward-helper.auth.user',
      JSON.stringify({ username: '!evil', displayName: null, loggedInAt: 0 }),
    );
    expect(getCurrentUser()).toBeNull();
  });

  it('logout clears the session and rotates uid', () => {
    setAuthSession('eias');
    const uidWhileAuthed = getUserId();
    expect(uidWhileAuthed).toBe('eias');
    logout();
    expect(getCurrentUser()).toBeNull();
    const uidAfterLogout = getUserId();
    expect(uidAfterLogout).not.toBe('eias');
    // A second call should be stable (cached random uid).
    expect(getUserId()).toBe(uidAfterLogout);
  });

  it('getUserId returns username when authed, persists random uid for guests', () => {
    expect(getUserId()).toMatch(/^u[a-z0-9]+$/); // guest before any login
    const guestId = getUserId();
    setAuthSession('eias');
    expect(getUserId()).toBe('eias');
    logout();
    // After logout, a NEW random uid is generated — must differ from old guest.
    expect(getUserId()).not.toBe(guestId);
  });
});

describe('auth — change events', () => {
  it('subscribeAuthChanges fires on setAuthSession + logout', () => {
    const handler = vi.fn();
    const unsub = subscribeAuthChanges(handler);
    setAuthSession('eias');
    expect(handler).toHaveBeenCalledTimes(1);
    logout();
    expect(handler).toHaveBeenCalledTimes(2);
    unsub();
    setAuthSession('eias');
    // After unsubscribe, no more calls.
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
