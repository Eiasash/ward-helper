import { describe, it, expect, beforeEach, vi } from 'vitest';

// Phase B: tests below at "restoreFromCloud — Phase B" exercise the canary
// wiring in src/notes/save.ts. We mock both cloud and canary modules:
//
//   - @/storage/cloud  → control pushBlob (asserts the backfill canary push)
//   - @/storage/canary → control verifyCanary directly. Mocking only cloud
//     doesn't propagate through the cloud↔canary import cycle (canary.ts's
//     import of pullByUsername binds to the original module, not the mock —
//     same hazard called out in tests/canary.test.ts:21-26). The
//     transitive call from restoreFromCloud→verifyCanary→pullByUsername
//     would otherwise hit real Supabase. Mocking verifyCanary at its
//     own module is the simplest way to make the test deterministic.
const {
  pushBlobMock,
  pullByUsernameMock,
  pullAllBlobsMock,
  verifyCanaryMock,
  pushCanaryMock,
} = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
  verifyCanaryMock: vi.fn(),
  pushCanaryMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
  };
});

// Both verifyCanary and pushCanary mocked at the canary module level —
// the cloud↔canary cycle means canary.ts's internal pushBlob binding
// stays unmocked even when @/storage/cloud is mocked, so we'd never
// see the backfill push otherwise.
vi.mock('@/storage/canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/canary')>();
  return {
    ...actual,
    verifyCanary: verifyCanaryMock,
    pushCanary: pushCanaryMock,
  };
});

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

  it('passes the action discriminator to subscribers', () => {
    const seen: string[] = [];
    const unsub = subscribeAuthChanges((action) => seen.push(action));

    // setAuthSession with no action arg falls back to 'unknown'
    setAuthSession('eias');
    setAuthSession('eias', null, 'login');
    setAuthSession('eias', null, 'register');
    logout();

    expect(seen).toEqual(['unknown', 'login', 'register', 'logout']);
    unsub();
  });

  it('back-compat: a nullary handler still receives all events', () => {
    // Existing code (useAuth, HeaderStrip) passes () => void handlers.
    // The new subscribeAuthChanges sig is (action) => void; JS arity is
    // tolerant, but we pin the contract so a future TS narrowing can't
    // silently break consumers.
    const handler = vi.fn(() => {});
    const unsub = subscribeAuthChanges(handler);
    setAuthSession('eias', null, 'login');
    logout();
    expect(handler).toHaveBeenCalledTimes(2);
    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase B — fresh-device cache-clear survival regression tests
//
// These are the four cases the v1.36.0 spec calls out:
//   1. fresh + correct password                  → restores, no backfill
//   2. fresh + wrong password                    → wrongPassphrase fast-fail
//   3. pre-existing + no canary + correct        → restores AND backfills canary
//   4. pre-existing + no canary + wrong          → no fail-fast, all rows skipped
//                                                  (documents the known
//                                                  limitation that pre-Phase-B
//                                                  data lacks the fail-fast
//                                                  affordance until first
//                                                  successful restore arms it)
// ─────────────────────────────────────────────────────────────────────────

import { restoreFromCloud, _resetCanaryStateForTests } from '@/notes/save';
import { resetDbForTests, type Patient, type Note } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { encryptForCloud, type CloudBlobRow } from '@/storage/cloud';
import { CANARY_BLOB_ID } from '@/storage/canary';

const RIGHT_PASS = 'correct-horse-battery-staple';
const WRONG_PASS = 'incorrect-mule-lithium-ion';

const TEST_PATIENT: Patient = {
  id: 'p-test-1',
  name: 'Test Patient',
  teudatZehut: '123456789',
  dob: '1940-01-01',
  room: '601',
  tags: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const TEST_NOTE: Note = {
  id: 'n-test-1',
  patientId: 'p-test-1',
  type: 'admission',
  bodyHebrew: 'שלום עולם',
  structuredData: {},
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

function bytesToB64(b: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...b));
}

async function makeRow(
  blob_type: 'canary' | 'patient' | 'note',
  blob_id: string,
  payload: unknown,
  pass: string,
): Promise<CloudBlobRow> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(pass, salt);
  const sealed = await encryptForCloud(payload, key, salt);
  return {
    blob_type,
    blob_id,
    ciphertext: bytesToB64(sealed.ciphertext),
    iv: bytesToB64(sealed.iv),
    salt: bytesToB64(sealed.salt),
    updated_at: new Date().toISOString(),
  };
}

describe('restoreFromCloud — Phase B fresh-device cache-clear survival', () => {
  beforeEach(async () => {
    pushBlobMock.mockReset();
    pushBlobMock.mockResolvedValue(undefined);
    pullByUsernameMock.mockReset();
    pullAllBlobsMock.mockReset();
    verifyCanaryMock.mockReset();
    pushCanaryMock.mockReset();
    pushCanaryMock.mockResolvedValue(undefined);
    await resetDbForTests();
    _resetCanaryStateForTests();
    localStorage.clear();
    // Authed path so restoreFromCloud uses pullByUsername (the cross-device
    // route) — the spec scenario is "log in on new device".
    setAuthSession('test-user');
  });

  it('Case 1 — fresh device + correct password: restores without backfill', async () => {
    const rows = [
      await makeRow('canary', CANARY_BLOB_ID, {
        v: 1,
        marker: 'ward-helper-canary',
        createdAt: 1,
      }, RIGHT_PASS),
      await makeRow('patient', TEST_PATIENT.id, TEST_PATIENT, RIGHT_PASS),
      await makeRow('note', TEST_NOTE.id, TEST_NOTE, RIGHT_PASS),
    ];
    verifyCanaryMock.mockResolvedValue('ok');
    pullByUsernameMock.mockResolvedValue(rows);

    const result = await restoreFromCloud(RIGHT_PASS);

    expect(result.wrongPassphrase).toBe(false);
    expect(result.restoredPatients).toBe(1);
    expect(result.restoredNotes).toBe(1);
    expect(result.skipped).toEqual([]);
    // Canary already in cloud → no backfill push.
    expect(pushCanaryMock).not.toHaveBeenCalled();
  });

  it('Case 2 — fresh device + wrong password: wrongPassphrase fast-fail', async () => {
    verifyCanaryMock.mockResolvedValue('wrong-passphrase');
    // No bulk-pull rows needed — restoreFromCloud short-circuits.

    const result = await restoreFromCloud(WRONG_PASS);

    expect(result.wrongPassphrase).toBe(true);
    expect(result.scanned).toBe(0);
    expect(result.restoredPatients).toBe(0);
    expect(result.restoredNotes).toBe(0);
    expect(pushCanaryMock).not.toHaveBeenCalled();
    expect(pullByUsernameMock).not.toHaveBeenCalled();
  });

  it('Case 3 — pre-existing data, no canary, correct password: restores AND backfills canary', async () => {
    const rows = [
      // No canary blob in this batch — simulates pre-Phase-B account.
      await makeRow('patient', TEST_PATIENT.id, TEST_PATIENT, RIGHT_PASS),
      await makeRow('note', TEST_NOTE.id, TEST_NOTE, RIGHT_PASS),
    ];
    verifyCanaryMock.mockResolvedValue('absent');
    pullByUsernameMock.mockResolvedValue(rows);

    const result = await restoreFromCloud(RIGHT_PASS);

    expect(result.wrongPassphrase).toBe(false);
    expect(result.restoredPatients).toBe(1);
    expect(result.restoredNotes).toBe(1);
    // Eager backfill fired exactly one canary push.
    expect(pushCanaryMock).toHaveBeenCalledTimes(1);
    const [, , username] = pushCanaryMock.mock.calls[0]!;
    expect(username).toBe('test-user');
  });

  it('Case 4 — pre-existing data, no canary, wrong password: no fail-fast, all rows skipped (known limitation)', async () => {
    const rows = [
      // Again no canary — pre-Phase-B account.
      await makeRow('patient', TEST_PATIENT.id, TEST_PATIENT, RIGHT_PASS),
      await makeRow('note', TEST_NOTE.id, TEST_NOTE, RIGHT_PASS),
    ];
    verifyCanaryMock.mockResolvedValue('absent');
    pullByUsernameMock.mockResolvedValue(rows);

    const result = await restoreFromCloud(WRONG_PASS);

    // Known limitation: with no canary, verifyCanary returns 'absent', the
    // function falls through to bulk pull, every row's AES-GCM decrypt
    // fails, all rows land in `skipped`. UI surfaces "N skipped" rather
    // than the helpful "wrong passphrase" — the trade-off is acceptable
    // because every successful restore arms the canary going forward, so
    // this state is observable at most once per account.
    expect(result.wrongPassphrase).toBe(false);
    expect(result.restoredPatients).toBe(0);
    expect(result.restoredNotes).toBe(0);
    expect(result.skipped.length).toBe(2);
    // No backfill: zero successful decrypts means we don't know our
    // passphrase is right, so we mustn't write a disagreeing canary.
    expect(pushCanaryMock).not.toHaveBeenCalled();
  });
});
