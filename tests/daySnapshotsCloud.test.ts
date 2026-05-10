/**
 * Tests for the v1.42.0 daySnapshots cloud-sync feature.
 *
 * Locks the four contracts the feature is built around:
 *   1. Toggle gating — default off; persistence; the helper's 3-state guard
 *      (toggle off / guest / no-login = silent skip with structured outcome).
 *   2. Push payload — ciphertext-only on the wire; full PHI inside Patient[]
 *      never appears in any string field of the upsert row.
 *   3. Cap mirror — after each push the helper calls
 *      `ward_helper_evict_day_snapshots(p_username, p_keep_ids)` with the
 *      current local snapshot IDs.
 *   4. Restore round-trip — applyDaySnapshotFromCloudRow recovers the snapshot
 *      verbatim into IDB; corrupt-shape payload throws.
 *
 * The orphan-canary regression (day-snapshot rows count as
 * non-canary blobs) is locked separately in tests/canaryProtection.test.ts.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const upsertSpy = vi.fn();
const rpcSpy = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'anon-uid-1' } } } })),
      signInAnonymously: vi.fn(async () => ({ data: { user: { id: 'anon-uid-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      upsert: (row: unknown, opts?: unknown) => {
        upsertSpy(row, opts);
        return Promise.resolve({ data: null, error: null });
      },
    })),
    rpc: (name: string, args: unknown) => {
      rpcSpy(name, args);
      return Promise.resolve({ data: 0, error: null });
    },
  })),
}));

const { getCurrentUserMock, getLastLoginPasswordOrNullMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn<() => { username: string } | null>(() => null),
  getLastLoginPasswordOrNullMock: vi.fn<() => string | null>(() => null),
}));

vi.mock('@/auth/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/auth')>();
  return {
    ...actual,
    getCurrentUser: getCurrentUserMock,
    getLastLoginPasswordOrNull: getLastLoginPasswordOrNullMock,
  };
});

import {
  pushLatestDaySnapshotIfEnabled,
  applyDaySnapshotFromCloudRow,
  getDaySnapshotCloudSyncEnabled,
  setDaySnapshotCloudSyncEnabled,
  DAY_SNAPSHOT_CLOUD_SYNC_KEY,
} from '@/storage/daySnapshotsCloud';
import { archiveDay, putDaySnapshot, listDaySnapshots, type DaySnapshot } from '@/storage/rounds';
import { resetDbForTests, putPatient } from '@/storage/indexed';
import { encryptForCloud, type CloudBlobRow } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';

// PHI sentinels that must never appear on the wire.
const PHI_NAME = 'אסתר לוי';
const PHI_TZ = '123456789';
const PHI_HANDOVER = 'אבחנה רגישה — לא לחשוף';
const PHI_PLAN = 'תוכנית טיפול חסויה';

beforeEach(async () => {
  await resetDbForTests();
  upsertSpy.mockClear();
  rpcSpy.mockClear();
  localStorage.clear();
  getCurrentUserMock.mockReset();
  getLastLoginPasswordOrNullMock.mockReset();
  getCurrentUserMock.mockReturnValue(null);
  getLastLoginPasswordOrNullMock.mockReturnValue(null);
});

describe('toggle persistence', () => {
  it('is OFF by default', () => {
    expect(getDaySnapshotCloudSyncEnabled()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    setDaySnapshotCloudSyncEnabled(true);
    expect(localStorage.getItem(DAY_SNAPSHOT_CLOUD_SYNC_KEY)).toBe('1');
    expect(getDaySnapshotCloudSyncEnabled()).toBe(true);
  });

  it('removes the key when toggled off (no stale "0" string)', () => {
    setDaySnapshotCloudSyncEnabled(true);
    setDaySnapshotCloudSyncEnabled(false);
    expect(localStorage.getItem(DAY_SNAPSHOT_CLOUD_SYNC_KEY)).toBeNull();
    expect(getDaySnapshotCloudSyncEnabled()).toBe(false);
  });
});

describe('pushLatestDaySnapshotIfEnabled — 3-state guard', () => {
  it('skips with toggle-off when the feature flag is unset', async () => {
    getCurrentUserMock.mockReturnValue({ username: 'eias' });
    getLastLoginPasswordOrNullMock.mockReturnValue('correct horse battery staple');
    const out = await pushLatestDaySnapshotIfEnabled();
    expect(out).toEqual({ kind: 'skipped', reason: 'toggle-off' });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('skips with reason=guest when toggle on but no session', async () => {
    setDaySnapshotCloudSyncEnabled(true);
    const out = await pushLatestDaySnapshotIfEnabled();
    expect(out).toEqual({ kind: 'skipped', reason: 'guest' });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('skips with reason=no-login when toggle on, user logged in, no password in memory', async () => {
    setDaySnapshotCloudSyncEnabled(true);
    getCurrentUserMock.mockReturnValue({ username: 'eias' });
    const out = await pushLatestDaySnapshotIfEnabled();
    expect(out).toEqual({ kind: 'skipped', reason: 'no-login' });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('skips with reason=no-snapshots when local has nothing to push', async () => {
    setDaySnapshotCloudSyncEnabled(true);
    getCurrentUserMock.mockReturnValue({ username: 'eias' });
    getLastLoginPasswordOrNullMock.mockReturnValue('p');
    const out = await pushLatestDaySnapshotIfEnabled();
    expect(out).toEqual({ kind: 'skipped', reason: 'no-snapshots' });
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe('pushLatestDaySnapshotIfEnabled — happy path payload contract', () => {
  // archiveDay() derives its blob_id from new Date().toLocaleDateString('en-CA'),
  // which is TZ-dependent. Without a pinned clock the cap-mirror test below
  // collides with the hardcoded '2026-05-09' fixture whenever CI runs late
  // UTC evening. 2026-05-10T12:00:00Z lands on '2026-05-10' in any timezone.
  beforeEach(async () => {
    // Fake Date only — leaving setTimeout/setInterval real because
    // fake-indexeddb and Web Crypto async ops route through setTimeout.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    setDaySnapshotCloudSyncEnabled(true);
    getCurrentUserMock.mockReturnValue({ username: 'eias' });
    getLastLoginPasswordOrNullMock.mockReturnValue('correct horse battery staple');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes one day-snapshot blob with the correct schema and no plaintext PHI on the wire', async () => {
    await putPatient({
      id: 'p1',
      name: PHI_NAME,
      teudatZehut: PHI_TZ,
      dob: '1940-01-01',
      room: '12A',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      handoverNote: PHI_HANDOVER,
      planLongTerm: PHI_PLAN,
      planToday: '',
      tomorrowNotes: [],
      clinicalMeta: {},
      discharged: false,
    });
    await archiveDay();

    const out = await pushLatestDaySnapshotIfEnabled();
    expect(out.kind).toBe('pushed');
    if (out.kind !== 'pushed') return;
    expect(out.pushedId).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertSpy.mock.calls[0]!;
    const r = row as Record<string, unknown>;

    expect(r.blob_type).toBe('day-snapshot');
    expect(r.blob_id).toBe(out.pushedId);
    expect(r.username).toBe('eias');
    expect((opts as { onConflict?: string }).onConflict).toBe('user_id,blob_type,blob_id');
    expect(r.ciphertext).toBeInstanceOf(Uint8Array);
    expect(r.iv).toBeInstanceOf(Uint8Array);
    expect((r.iv as Uint8Array).byteLength).toBe(12);

    // No PHI sentinel anywhere in the wire payload (string fields only —
    // ciphertext bytes are checked separately below).
    const stringPart = JSON.stringify({
      ...r,
      ciphertext: '<bytes>',
      iv: '<bytes>',
      salt: '<bytes>',
    });
    for (const sentinel of [PHI_NAME, PHI_TZ, PHI_HANDOVER, PHI_PLAN]) {
      expect(stringPart, `wire-string leaked PHI "${sentinel}"`).not.toContain(sentinel);
    }

    // Defense-in-depth: AES actually ran (ciphertext is not the plaintext).
    const ctBytes = r.ciphertext as Uint8Array;
    const ctText = new TextDecoder('utf-8', { fatal: false }).decode(ctBytes);
    for (const sentinel of [PHI_NAME, PHI_HANDOVER, PHI_PLAN]) {
      expect(ctText, `ciphertext contains plaintext "${sentinel}" — encrypt no-op?`).not.toContain(sentinel);
    }
  });

  it('mirrors local cap by calling ward_helper_evict_day_snapshots with current local IDs', async () => {
    // Two pre-existing snapshots + one fresh archive = three local IDs total.
    await putDaySnapshot({
      id: '2026-05-08',
      date: '2026-05-08',
      archivedAt: Date.now() - 86400_000 * 2,
      patients: [],
    });
    await putDaySnapshot({
      id: '2026-05-09',
      date: '2026-05-09',
      archivedAt: Date.now() - 86400_000,
      patients: [],
    });
    await archiveDay();

    rpcSpy.mockClear();
    await pushLatestDaySnapshotIfEnabled();

    // Exactly one evict RPC call after the push.
    const evictCalls = rpcSpy.mock.calls.filter(
      ([name]) => name === 'ward_helper_evict_day_snapshots',
    );
    expect(evictCalls).toHaveLength(1);
    const [, args] = evictCalls[0]!;
    const a = args as { p_username: string; p_keep_ids: string[] };
    expect(a.p_username).toBe('eias');
    expect(a.p_keep_ids).toHaveLength(3);
    expect(a.p_keep_ids).toEqual(expect.arrayContaining(['2026-05-08', '2026-05-09']));
    // Today's archive ID is also in the keep set — by date format.
    expect(a.p_keep_ids.some((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))).toBe(true);
  });

  it('treats re-archive of the same date as upsert (same blob_id)', async () => {
    await archiveDay();
    const firstOut = await pushLatestDaySnapshotIfEnabled();
    if (firstOut.kind !== 'pushed') throw new Error('first push must succeed');

    upsertSpy.mockClear();
    // Second archive of the same date overwrites the local snapshot — push
    // again; blob_id must be identical (date-based) so cloud upserts in place.
    await archiveDay();
    const secondOut = await pushLatestDaySnapshotIfEnabled();
    if (secondOut.kind !== 'pushed') throw new Error('second push must succeed');
    expect(secondOut.pushedId).toBe(firstOut.pushedId);
    const [row] = upsertSpy.mock.calls[0]!;
    expect((row as Record<string, unknown>).blob_id).toBe(firstOut.pushedId);
  });
});

describe('applyDaySnapshotFromCloudRow — restore round-trip', () => {
  it('decrypts, validates shape, and writes to local IDB', async () => {
    const passphrase = 'correct horse battery staple';
    const original: DaySnapshot = {
      id: '2026-05-10',
      date: '2026-05-10',
      archivedAt: 1747843200000,
      patients: [
        {
          id: 'p1',
          name: PHI_NAME,
          teudatZehut: PHI_TZ,
          dob: '1940-01-01',
          room: '12A',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          handoverNote: PHI_HANDOVER,
          planLongTerm: PHI_PLAN,
          planToday: '',
          tomorrowNotes: [],
          clinicalMeta: {},
          discharged: false,
        },
      ],
    };
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey(passphrase, salt);
    const sealed = await encryptForCloud(original, key, salt);

    const row: CloudBlobRow = {
      blob_type: 'day-snapshot',
      blob_id: original.id,
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: new Date().toISOString(),
    };

    const ok = await applyDaySnapshotFromCloudRow(row, passphrase);
    expect(ok).toBe(true);

    const recovered = await listDaySnapshots();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.id).toBe(original.id);
    expect(recovered[0]!.archivedAt).toBe(original.archivedAt);
    expect(recovered[0]!.patients).toHaveLength(1);
    expect(recovered[0]!.patients[0]!.name).toBe(PHI_NAME);
    expect(recovered[0]!.patients[0]!.handoverNote).toBe(PHI_HANDOVER);
  });

  it('throws on shape mismatch (decryptable but not a DaySnapshot)', async () => {
    const passphrase = 'p';
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey(passphrase, salt);
    // Encrypt a non-snapshot payload: missing patients[] and archivedAt.
    const sealed = await encryptForCloud({ id: 'wrong-shape' }, key, salt);
    const row: CloudBlobRow = {
      blob_type: 'day-snapshot',
      blob_id: 'wrong-shape',
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: new Date().toISOString(),
    };
    await expect(applyDaySnapshotFromCloudRow(row, passphrase)).rejects.toThrow(
      /shape check/,
    );
    expect(await listDaySnapshots()).toHaveLength(0);
  });

  it('throws on wrong passphrase (AES-GCM auth-tag failure)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('right', salt);
    const sealed = await encryptForCloud(
      {
        id: '2026-05-10',
        date: '2026-05-10',
        archivedAt: 1,
        patients: [],
      } satisfies DaySnapshot,
      key,
      salt,
    );
    const row: CloudBlobRow = {
      blob_type: 'day-snapshot',
      blob_id: '2026-05-10',
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: new Date().toISOString(),
    };
    await expect(applyDaySnapshotFromCloudRow(row, 'wrong')).rejects.toThrow();
  });
});
