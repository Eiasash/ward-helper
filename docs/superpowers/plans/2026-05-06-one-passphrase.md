# One-passphrase + safety-net backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three login-time prompts in ward-helper (login password, backup passphrase, API key) into one — the user types only their login password — and add manual cloud-push and manual local-export buttons as safety nets. Replace the silent "wrong passphrase" failure with a deterministic verifier.

**Architecture:** A new on-device "cached unlock blob" stores the backup passphrase encrypted with the login password (PBKDF2-derived AES key). A new "canary" cloud blob (known plaintext encrypted with the passphrase) lets the app verify a passphrase in one decryption instead of failing on N patient rows. Three new Settings buttons trigger manual cloud push, manual encrypted local export, and import. AES-GCM-at-rest on Supabase is unchanged.

**Tech Stack:** TypeScript, React 18, Vite 7, vitest 4, idb (IndexedDB wrapper), @supabase/supabase-js (lazy-loaded), WebCrypto (AES-GCM 256, PBKDF2 600k).

**Spec:** [docs/superpowers/specs/2026-05-06-one-passphrase-design.md](../specs/2026-05-06-one-passphrase-design.md)

**Branch:** `claude/term-wh-one-passphrase-20260506` (already created, spec already committed as `eec17aa`).

---

## File map

| File | New / Mod | Responsibility |
|---|---|---|
| `supabase/migrations/0005_canary_blob_type.sql` | New | Extend `blob_type` CHECK to allow `'canary'` |
| `src/storage/indexed.ts` | Mod | Add `cachedUnlockBlob` field to `Settings` type |
| `src/crypto/unlock.ts` | New | `cacheUnlockBlob(passphrase, loginPassword)`, `tryAutoUnlock(loginPassword)`, `clearUnlockCache()`, `reencryptUnlockCache(oldPwd, newPwd)` |
| `src/storage/cloud.ts` | Mod | Add `pushCanary(key, salt, username)`, `verifyCanary(passphrase, username)` returning `'ok' \| 'wrong-passphrase' \| 'absent'` |
| `src/notes/save.ts` | Mod | `restoreFromCloud` calls `verifyCanary` first; new `wrongPassphrase: boolean` field on `RestoreResult` |
| `src/auth/auth.ts` | Mod | Wrap `auth_change_password` RPC: on success, re-encrypt cached unlock blob |
| `src/notes/manualPush.ts` | New | `pushAllToCloud(passphrase, username)` — re-pushes every local patient + note + api-key + canary |
| `src/notes/exportLocal.ts` | New | `exportLocalBackup({ encryptWithLoginPassword, loginPassword? })` — JSON file via `<a download>` |
| `src/notes/importLocal.ts` | New | `importLocalBackup(file, opts)` — counterpart, idempotent IDB upserts |
| `src/ui/screens/Settings.tsx` | Mod | Three new buttons + new "wrong passphrase" UI block; auto-unlock call on mount |
| `src/ui/components/AccountSection.tsx` | Mod | After successful login, call `tryAutoUnlock(password)` and surface result |
| `tests/canary.test.ts` | New | `pushCanary` / `verifyCanary` unit tests |
| `tests/cachedUnlock.test.ts` | New | `cacheUnlockBlob` / `tryAutoUnlock` round-trip + wrong-key + corrupt-blob |
| `tests/restoreFromCloud.canary.test.ts` | New | wrong passphrase → early exit; right passphrase → unchanged |
| `tests/passwordChange.reencrypt.test.ts` | New | login password change re-encrypts cached unlock blob |
| `tests/manualPush.test.ts` | New | `pushAllToCloud` re-pushes everything, idempotent |
| `tests/exportImportLocal.test.ts` | New | encrypted round-trip + plaintext round-trip + wrong-key import fails cleanly |
| `package.json` | Mod | version → 1.34.0 |
| `public/sw.js` | Mod | VERSION line → ward-v1.34.0 |

---

## Task 1: SQL migration — allow `canary` blob_type

**Files:**
- Create: `supabase/migrations/0005_canary_blob_type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Extend ward_helper_backup.blob_type CHECK constraint to allow 'canary'.
-- Constraint history:
--   0001: ('patient', 'note')
--   0004: + 'api-key'
--   0005: + 'canary'  ← this migration
--
-- The canary blob is a known plaintext ('ward-helper-canary' marker) encrypted
-- with the user's backup passphrase. restoreFromCloud decrypts the canary
-- before iterating any patient/note rows, so a wrong passphrase fails
-- deterministically in ~300ms instead of N×PBKDF2(600k) per row.
--
-- Non-destructive: adds an allowed value, doesn't reject existing rows.
ALTER TABLE public.ward_helper_backup
  DROP CONSTRAINT IF EXISTS ward_helper_backup_blob_type_check;

ALTER TABLE public.ward_helper_backup
  ADD CONSTRAINT ward_helper_backup_blob_type_check
  CHECK (blob_type IN ('patient', 'note', 'api-key', 'canary'));
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

The user has Supabase MCP configured. Apply through the MCP `apply_migration` tool against project `krmlzwwelqvlfslwltol`, name = `0005_canary_blob_type`. The SQL above is the value of the `query` parameter. Verify with `list_migrations` afterward — the new entry should appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_canary_blob_type.sql
git commit -m "migration(0005): allow canary blob_type"
```

---

## Task 2: Extend `Settings` type with `cachedUnlockBlob`

**Files:**
- Modify: `src/storage/indexed.ts:46-51`

- [ ] **Step 1: Write the failing test**

Create `tests/cachedUnlockSettingsField.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTests, getSettings, setSettings } from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
});

describe('Settings.cachedUnlockBlob', () => {
  it('round-trips through IDB without the field set (back-compat)', async () => {
    await setSettings({
      apiKeyXor: new Uint8Array(0),
      deviceSecret: new Uint8Array(16),
      lastPassphraseAuthAt: null,
      prefs: {},
    });
    const out = await getSettings();
    expect(out?.cachedUnlockBlob).toBeUndefined();
  });

  it('round-trips when set', async () => {
    const blob = {
      v: 1 as const,
      ciphertext: new Uint8Array([1, 2, 3]),
      iv: new Uint8Array([4, 5, 6]),
      salt: new Uint8Array([7, 8, 9]),
    };
    await setSettings({
      apiKeyXor: new Uint8Array(0),
      deviceSecret: new Uint8Array(16),
      lastPassphraseAuthAt: null,
      prefs: {},
      cachedUnlockBlob: blob,
    });
    const out = await getSettings();
    expect(out?.cachedUnlockBlob).toEqual(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cachedUnlockSettingsField.test.ts`
Expected: TS compile error — `cachedUnlockBlob` is not a known property of `Settings`.

- [ ] **Step 3: Edit `src/storage/indexed.ts:46-51`**

Replace:

```ts
export interface Settings {
  apiKeyXor: Uint8Array<ArrayBuffer>;
  deviceSecret: Uint8Array<ArrayBuffer>;
  lastPassphraseAuthAt: number | null;
  prefs: Record<string, unknown>;
}
```

With:

```ts
export interface CachedUnlockBlob {
  v: 1;
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export interface Settings {
  apiKeyXor: Uint8Array<ArrayBuffer>;
  deviceSecret: Uint8Array<ArrayBuffer>;
  lastPassphraseAuthAt: number | null;
  prefs: Record<string, unknown>;
  /**
   * Backup passphrase encrypted with PBKDF2(loginPassword)-derived AES key.
   * Set after first successful passphrase entry; auto-unlocks on subsequent
   * logins so the user types only their login password. null/undefined
   * means "no cache, prompt for passphrase".
   */
  cachedUnlockBlob?: CachedUnlockBlob | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cachedUnlockSettingsField.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/storage/indexed.ts tests/cachedUnlockSettingsField.test.ts
git commit -m "feat(settings): add cachedUnlockBlob field to Settings type"
```

---

## Task 3: `src/crypto/unlock.ts` — cache + auto-unlock the passphrase

**Files:**
- Create: `src/crypto/unlock.ts`
- Test: `tests/cachedUnlock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cachedUnlock.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTests, setSettings } from '@/storage/indexed';
import {
  cacheUnlockBlob,
  tryAutoUnlock,
  clearUnlockCache,
  reencryptUnlockCache,
} from '@/crypto/unlock';

beforeEach(async () => {
  await resetDbForTests();
  await setSettings({
    apiKeyXor: new Uint8Array(0),
    deviceSecret: new Uint8Array(16),
    lastPassphraseAuthAt: null,
    prefs: {},
  });
});

describe('cacheUnlockBlob / tryAutoUnlock', () => {
  it('round-trips passphrase through login-password key', async () => {
    await cacheUnlockBlob('my-backup-pass', 'login-pwd');
    const out = await tryAutoUnlock('login-pwd');
    expect(out).toBe('my-backup-pass');
  });

  it('returns null on wrong login password', async () => {
    await cacheUnlockBlob('my-backup-pass', 'login-pwd');
    const out = await tryAutoUnlock('wrong-pwd');
    expect(out).toBeNull();
  });

  it('returns null when no cache exists', async () => {
    const out = await tryAutoUnlock('any-pwd');
    expect(out).toBeNull();
  });

  it('clearUnlockCache removes the blob', async () => {
    await cacheUnlockBlob('p', 'l');
    await clearUnlockCache();
    expect(await tryAutoUnlock('l')).toBeNull();
  });

  it('reencryptUnlockCache moves cache from old to new login password', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    await reencryptUnlockCache('old-pwd', 'new-pwd');
    expect(await tryAutoUnlock('old-pwd')).toBeNull();
    expect(await tryAutoUnlock('new-pwd')).toBe('my-backup-pass');
  });

  it('reencryptUnlockCache is a no-op when no cache exists', async () => {
    await reencryptUnlockCache('old-pwd', 'new-pwd');
    expect(await tryAutoUnlock('new-pwd')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cachedUnlock.test.ts`
Expected: FAIL — module `@/crypto/unlock` not found.

- [ ] **Step 3: Create `src/crypto/unlock.ts`**

```ts
import { getSettings, setSettings, type CachedUnlockBlob } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

/**
 * Encrypt the user's backup passphrase with their login password and persist
 * it on-device. After this call, tryAutoUnlock(loginPassword) returns the
 * passphrase without prompting.
 *
 * Threat model: a thief with the device + the login password gets the
 * passphrase. Same posture as iOS Keychain "available when unlocked" — the
 * device login is the gate, not a separate secret. The user accepted this
 * trade in the brainstorm to eliminate three-prompt friction.
 */
export async function cacheUnlockBlob(
  passphrase: string,
  loginPassword: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(loginPassword, salt);
  const { iv, ciphertext } = await aesEncrypt(passphrase, key);
  const existing = await getSettings();
  await setSettings({
    apiKeyXor: existing?.apiKeyXor ?? new Uint8Array(0),
    deviceSecret: existing?.deviceSecret ?? new Uint8Array(0),
    lastPassphraseAuthAt: existing?.lastPassphraseAuthAt ?? null,
    prefs: existing?.prefs ?? {},
    cachedUnlockBlob: { v: 1, ciphertext, iv, salt },
  });
}

/**
 * Try to recover the passphrase using the login password the user just typed.
 * Returns null on any failure (no cache, wrong password, corrupt blob,
 * schema mismatch). Never throws — caller falls back to the prompt UI.
 */
export async function tryAutoUnlock(loginPassword: string): Promise<string | null> {
  const s = await getSettings();
  const blob = s?.cachedUnlockBlob;
  if (!blob || blob.v !== 1) return null;
  try {
    const key = await deriveAesKey(loginPassword, blob.salt);
    const passphrase = await aesDecrypt(blob.ciphertext, blob.iv, key);
    return passphrase;
  } catch {
    // Most likely: wrong login password (AES-GCM auth tag fails).
    return null;
  }
}

/** Drop the cache so next session prompts again (used on logout). */
export async function clearUnlockCache(): Promise<void> {
  const s = await getSettings();
  if (!s) return;
  await setSettings({ ...s, cachedUnlockBlob: null });
}

/**
 * Re-encrypt the cached unlock blob with a new login password. Called by the
 * password-change flow after the server bcrypt update succeeds, so the user's
 * cached passphrase is still recoverable on next login. No-op if no cache.
 *
 * Returns true if a cache existed and was re-encrypted, false otherwise.
 * Caller can warn the user if they expected a cache to be present.
 */
export async function reencryptUnlockCache(
  oldLoginPassword: string,
  newLoginPassword: string,
): Promise<boolean> {
  const passphrase = await tryAutoUnlock(oldLoginPassword);
  if (passphrase === null) return false;
  await cacheUnlockBlob(passphrase, newLoginPassword);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cachedUnlock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/crypto/unlock.ts tests/cachedUnlock.test.ts
git commit -m "feat(crypto): add unlock-blob cache (cache + auto-unlock + re-encrypt)"
```

---

## Task 4: `pushCanary` / `verifyCanary` in cloud.ts

**Files:**
- Modify: `src/storage/cloud.ts` (add helpers + extend types)
- Test: `tests/canary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/canary.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pullByUsernameMock, pullAllBlobsMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
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

import { deriveAesKey } from '@/crypto/pbkdf2';
import {
  pushCanary,
  verifyCanary,
  encryptForCloud,
  CANARY_BLOB_ID,
  type CloudBlobRow,
} from '@/storage/cloud';
import { aesEncrypt } from '@/crypto/aes';

beforeEach(() => {
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
});

describe('pushCanary', () => {
  it('pushes a canary blob with pinned blob_id', async () => {
    const salt = new Uint8Array(16);
    const key = await deriveAesKey('pass', salt);
    await pushCanary(key, salt, 'eiass');
    expect(pushBlobMock).toHaveBeenCalledTimes(1);
    expect(pushBlobMock.mock.calls[0]![0]).toBe('canary');
    expect(pushBlobMock.mock.calls[0]![1]).toBe(CANARY_BLOB_ID);
    expect(pushBlobMock.mock.calls[0]![3]).toBe('eiass');
  });
});

describe('verifyCanary', () => {
  it('returns "absent" when no canary row exists', async () => {
    pullByUsernameMock.mockResolvedValue([
      { blob_type: 'patient', blob_id: 'p1', ciphertext: 'AA==', iv: 'AA==', salt: 'AA==', updated_at: '' },
    ]);
    const out = await verifyCanary('any-pass', 'eiass');
    expect(out).toBe('absent');
  });

  it('returns "ok" when canary decrypts with the given passphrase', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('right-pass', salt);
    const sealed = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 1 }, key, salt);
    const row: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: '',
    } as CloudBlobRow;
    pullByUsernameMock.mockResolvedValue([row]);
    const out = await verifyCanary('right-pass', 'eiass');
    expect(out).toBe('ok');
  });

  it('returns "wrong-passphrase" when canary fails to decrypt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('right-pass', salt);
    const sealed = await encryptForCloud({ v: 1, marker: 'ward-helper-canary', createdAt: 1 }, key, salt);
    const row: CloudBlobRow = {
      blob_type: 'canary' as 'canary',
      blob_id: CANARY_BLOB_ID,
      ciphertext: btoa(String.fromCharCode(...sealed.ciphertext)),
      iv: btoa(String.fromCharCode(...sealed.iv)),
      salt: btoa(String.fromCharCode(...sealed.salt)),
      updated_at: '',
    } as CloudBlobRow;
    pullByUsernameMock.mockResolvedValue([row]);
    const out = await verifyCanary('WRONG-pass', 'eiass');
    expect(out).toBe('wrong-passphrase');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/canary.test.ts`
Expected: FAIL — `pushCanary`, `verifyCanary`, `CANARY_BLOB_ID` not exported.

- [ ] **Step 3: Edit `src/storage/cloud.ts`**

(a) Extend the `pushBlob` type union and `CloudBlobRow` type to include `'canary'`. Find:

```ts
export async function pushBlob(
  type: 'patient' | 'note' | 'api-key',
```

Replace the `type` parameter with `'patient' | 'note' | 'api-key' | 'canary'`.

Find:

```ts
export type CloudBlobRow = {
  blob_type: 'patient' | 'note' | 'api-key';
```

Replace with `'patient' | 'note' | 'api-key' | 'canary'`.

(b) Append the canary helpers at the bottom of the file:

```ts
/** Pinned blob_id for the canary row — one per user. */
export const CANARY_BLOB_ID = '__canary__';

/**
 * The canary plaintext is a known string. Decryption with the user's
 * passphrase succeeds iff the passphrase matches the one used at push time.
 * Used by restoreFromCloud and Settings.tsx to fail fast on wrong passphrase.
 */
interface CanaryPayload {
  v: 1;
  marker: 'ward-helper-canary';
  createdAt: number;
}

const CANARY_PLAINTEXT: Omit<CanaryPayload, 'createdAt'> = {
  v: 1,
  marker: 'ward-helper-canary',
};

/**
 * Push (or refresh) the canary blob. Idempotent: same blob_id, fresh IV.
 * Caller passes the already-derived AES key so we avoid re-running PBKDF2
 * just for this small blob.
 */
export async function pushCanary(
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  username: string | null,
): Promise<void> {
  const payload: CanaryPayload = { ...CANARY_PLAINTEXT, createdAt: Date.now() };
  const sealed = await encryptForCloud(payload, key, salt);
  await pushBlob('canary', CANARY_BLOB_ID, sealed, username);
}

/**
 * Probe the cloud for a canary row and try to decrypt it with the given
 * passphrase. The result tells the caller exactly what the passphrase status is:
 *
 *   'ok'                — decrypts; user has a valid backup on the cloud
 *   'wrong-passphrase'  — canary present but auth tag fails; user typed wrong
 *   'absent'            — no canary row; user has never pushed (fresh install)
 *
 * Routes through `pullByUsername` when an app_users session is active, else
 * `pullAllBlobs` (legacy per-anon path). Either way the canary row carries
 * its own salt, so we re-derive the AES key per-call.
 */
export async function verifyCanary(
  passphrase: string,
  username: string | null,
): Promise<'ok' | 'wrong-passphrase' | 'absent'> {
  const rows = username && username.trim()
    ? await pullByUsername(username)
    : await pullAllBlobs();
  const canary = rows.find(
    (r) => r.blob_type === 'canary' && r.blob_id === CANARY_BLOB_ID,
  );
  if (!canary) return 'absent';
  try {
    const salt = base64ToBytes(canary.salt);
    const iv = base64ToBytes(canary.iv);
    const ct = base64ToBytes(canary.ciphertext);
    const key = await deriveAesKey(passphrase, salt);
    const decoded = await decryptFromCloud<CanaryPayload>(ct, iv, key);
    if (decoded?.v === 1 && decoded.marker === 'ward-helper-canary') {
      return 'ok';
    }
    return 'wrong-passphrase';
  } catch {
    return 'wrong-passphrase';
  }
}
```

Add the `deriveAesKey` import at the top of the file:

```ts
import { deriveAesKey } from '@/crypto/pbkdf2';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/canary.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/storage/cloud.ts tests/canary.test.ts
git commit -m "feat(cloud): add canary blob (push + verify) for fast passphrase check"
```

---

## Task 5: `restoreFromCloud` early-exits on wrong passphrase via canary

**Files:**
- Modify: `src/notes/save.ts:139-255`
- Test: `tests/restoreFromCloud.canary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/restoreFromCloud.canary.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { verifyCanaryMock, pullByUsernameMock, pullAllBlobsMock } = vi.hoisted(() => ({
  verifyCanaryMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
  pullAllBlobsMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    verifyCanary: verifyCanaryMock,
    pullByUsername: pullByUsernameMock,
    pullAllBlobs: pullAllBlobsMock,
  };
});

vi.mock('@/auth/auth', () => ({
  getCurrentUser: () => ({ username: 'eiass', display_name: 'E' }),
}));

import { resetDbForTests } from '@/storage/indexed';
import { restoreFromCloud } from '@/notes/save';

beforeEach(async () => {
  await resetDbForTests();
  verifyCanaryMock.mockReset();
  pullByUsernameMock.mockReset();
  pullAllBlobsMock.mockReset();
});

describe('restoreFromCloud + canary', () => {
  it('returns wrongPassphrase=true and zero scans when canary fails', async () => {
    verifyCanaryMock.mockResolvedValue('wrong-passphrase');
    const out = await restoreFromCloud('bad-pass');
    expect(out.wrongPassphrase).toBe(true);
    expect(out.scanned).toBe(0);
    expect(pullByUsernameMock).not.toHaveBeenCalled();
    expect(pullAllBlobsMock).not.toHaveBeenCalled();
  });

  it('proceeds normally when canary returns "ok"', async () => {
    verifyCanaryMock.mockResolvedValue('ok');
    pullByUsernameMock.mockResolvedValue([]);
    const out = await restoreFromCloud('right-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
    expect(pullByUsernameMock).toHaveBeenCalledTimes(1);
  });

  it('proceeds when canary returns "absent" (no prior backup)', async () => {
    verifyCanaryMock.mockResolvedValue('absent');
    pullByUsernameMock.mockResolvedValue([]);
    const out = await restoreFromCloud('any-pass');
    expect(out.wrongPassphrase).toBe(false);
    expect(out.scanned).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/restoreFromCloud.canary.test.ts`
Expected: FAIL — `wrongPassphrase` is not on `RestoreResult`, and `verifyCanary` is not called from `restoreFromCloud`.

- [ ] **Step 3: Edit `src/notes/save.ts`**

(a) Add `wrongPassphrase: boolean` to `RestoreResult` (line 139):

```ts
export interface RestoreResult {
  scanned: number;
  restoredPatients: number;
  restoredNotes: number;
  restoredApiKey: 0 | 1;
  /**
   * True when the canary check failed before iterating any rows. The UI uses
   * this to show "wrong passphrase" specifically (instead of generic "N
   * skipped"). Mutually exclusive with restoredPatients/Notes/ApiKey > 0.
   */
  wrongPassphrase: boolean;
  skipped: Array<{ blob_type: string; blob_id: string; reason: string }>;
  source: 'username' | 'anon';
}
```

(b) Import `verifyCanary` (extend the existing import block from `@/storage/cloud`):

```ts
import {
  pullAllBlobs,
  pullByUsername,
  decryptFromCloud,
  base64ToBytes,
  verifyCanary,
  type CloudBlobRow,
} from '@/storage/cloud';
```

(c) In `restoreFromCloud` (line 185), insert canary check after the passphrase guard, before `pullByUsername`:

```ts
export async function restoreFromCloud(passphrase: string): Promise<RestoreResult> {
  if (!passphrase) throw new Error('passphrase required for restore');

  const user = getCurrentUser();
  const canaryStatus = await verifyCanary(passphrase, user?.username ?? null);
  if (canaryStatus === 'wrong-passphrase') {
    return {
      scanned: 0,
      restoredPatients: 0,
      restoredNotes: 0,
      restoredApiKey: 0,
      wrongPassphrase: true,
      skipped: [],
      source: user ? 'username' : 'anon',
    };
  }

  const rows: CloudBlobRow[] = user
    ? await pullByUsername(user.username)
    : await pullAllBlobs();
  const result: RestoreResult = {
    scanned: rows.length,
    restoredPatients: 0,
    restoredNotes: 0,
    restoredApiKey: 0,
    wrongPassphrase: false,
    skipped: [],
    source: user ? 'username' : 'anon',
  };
  // ... rest unchanged ...
```

(d) In the per-row loop, add a branch for `'canary'` that's a silent skip (already verified above, no need to re-decrypt):

```ts
      } else if (row.blob_type === 'canary') {
        // Already verified at the top of the function; ignore at row level.
        continue;
      } else {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/restoreFromCloud.canary.test.ts`
Expected: PASS, 3 tests. Re-run the existing restore tests too: `npx vitest run tests/`. Expected: all green; the existing tests construct `RestoreResult` literals without `wrongPassphrase` — they'll need a one-line update to `wrongPassphrase: false`. Find and update those.

- [ ] **Step 5: Commit**

```bash
git add src/notes/save.ts tests/restoreFromCloud.canary.test.ts tests/*.test.ts
git commit -m "feat(restore): canary fail-fast — wrong passphrase exits in 1 decrypt instead of N"
```

---

## Task 6: Wire login flow + first-time passphrase entry

**Files:**
- Modify: `src/ui/components/AccountSection.tsx` (login success handler)
- Modify: `src/ui/screens/Settings.tsx` (passphrase activation handler — push canary, cache unlock blob)

- [ ] **Step 1: Locate the login-success handler**

Run: `Grep -n "auth_login_user\|loginUser\|onLoginSuccess" src/ui/components/AccountSection.tsx`. Find the function that runs after a successful `auth_login_user` RPC. It currently calls `setAuthSession` and updates UI state.

- [ ] **Step 2: Add auto-unlock call**

After the successful login branch — **before** any `setAuthSession` (per the memory `feedback_react_setauthsession_unmount_race`: dependent calls go BEFORE setAuthSession, otherwise the component unmounts mid-handler) — add:

```ts
import { tryAutoUnlock } from '@/crypto/unlock';
import { setPassphrase } from '@/ui/hooks/useSettings';

// ... inside the login-success branch, BEFORE setAuthSession:
const cachedPass = await tryAutoUnlock(password);
if (cachedPass !== null) {
  setPassphrase(cachedPass);
}
// then setAuthSession(...) as before
```

This mutates only the in-memory passphrase singleton; it does not setState. So it is safe before `setAuthSession`.

- [ ] **Step 3: Modify the passphrase-activation handler in Settings.tsx**

Find the existing handler that calls `setPassphrase(p)` from the "הפעל סיסמה" button. After it sets the in-memory passphrase, push a canary and cache the unlock blob:

```ts
import { pushCanary, verifyCanary } from '@/storage/cloud';
import { cacheUnlockBlob } from '@/crypto/unlock';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { getCurrentUser } from '@/auth/auth';

// inside the "הפעל סיסמה" handler, after setPassphrase(p):
const username = getCurrentUser()?.username ?? null;
const status = await verifyCanary(p, username);
if (status === 'wrong-passphrase') {
  setError('הסיסמה שגויה (לא הסיסמה ששמרה את הגיבויים בענן).');
  return;
}
if (status === 'absent') {
  // First time the user sets a passphrase, OR they're rotating to a fresh
  // one. Push a canary so future verifications work.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(p, salt);
  await pushCanary(key, salt, username);
}
// Cache the unlock blob so next login doesn't prompt. The login password
// is the user's app_users password; we read it from the auth session if
// available, otherwise we ask once. Simplest: only cache when a login
// password is captured at login time. See the AccountSection handler in
// Step 2 — it stashes a transient `lastLoginPassword` in a session-only
// closure (memory only, never persisted). Alternative: prompt once.
const loginPwd = getLastLoginPasswordOrNull();
if (loginPwd) {
  await cacheUnlockBlob(p, loginPwd);
}
```

The "transient session" stash is a single module-level variable in `src/auth/auth.ts`:

```ts
// In src/auth/auth.ts:
let _lastLoginPassword: string | null = null;
export function stashLastLoginPassword(p: string): void { _lastLoginPassword = p; }
export function getLastLoginPasswordOrNull(): string | null { return _lastLoginPassword; }
export function clearLastLoginPassword(): void { _lastLoginPassword = null; }
```

In the AccountSection login-success handler, call `stashLastLoginPassword(password)` immediately after a successful RPC and before any state update. On logout, call `clearLastLoginPassword()`.

- [ ] **Step 4: Add a unit test for the activation flow**

Create `tests/passphraseActivation.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock, pullByUsernameMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  pullByUsernameMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return { ...actual, pushBlob: pushBlobMock, pullByUsername: pullByUsernameMock };
});

import { resetDbForTests, getSettings } from '@/storage/indexed';
import { verifyCanary, pushCanary } from '@/storage/cloud';
import { cacheUnlockBlob, tryAutoUnlock } from '@/crypto/unlock';
import { deriveAesKey } from '@/crypto/pbkdf2';

beforeEach(async () => {
  await resetDbForTests();
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  pullByUsernameMock.mockReset();
});

describe('passphrase activation end-to-end', () => {
  it('first activation: absent canary → push, cache unlock blob', async () => {
    pullByUsernameMock.mockResolvedValue([]);  // no canary
    const status = await verifyCanary('my-pass', 'eiass');
    expect(status).toBe('absent');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('my-pass', salt);
    await pushCanary(key, salt, 'eiass');
    await cacheUnlockBlob('my-pass', 'my-login-pwd');

    expect(pushBlobMock).toHaveBeenCalledWith('canary', '__canary__', expect.anything(), 'eiass');
    expect(await tryAutoUnlock('my-login-pwd')).toBe('my-pass');
  });
});
```

- [ ] **Step 5: Run tests + commit**

```bash
npx vitest run tests/passphraseActivation.test.ts
git add src/ui/components/AccountSection.tsx src/ui/screens/Settings.tsx src/auth/auth.ts tests/passphraseActivation.test.ts
git commit -m "feat(auth): wire login auto-unlock + first-time canary push"
```

---

## Task 7: Re-encrypt cached unlock blob on login-password change

**Files:**
- Modify: `src/auth/auth.ts` (wrap `auth_change_password`)
- Test: `tests/passwordChange.reencrypt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/passwordChange.reencrypt.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    getSupabase: async () => ({ rpc: rpcMock }),
  };
});

import { resetDbForTests } from '@/storage/indexed';
import { changePasswordWithReencrypt } from '@/auth/auth';
import { cacheUnlockBlob, tryAutoUnlock } from '@/crypto/unlock';

beforeEach(async () => {
  await resetDbForTests();
  rpcMock.mockReset();
});

describe('changePasswordWithReencrypt', () => {
  it('re-encrypts cached blob to new password on RPC success', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const out = await changePasswordWithReencrypt('eiass', 'old-pwd', 'new-pwd');
    expect(out.ok).toBe(true);
    expect(await tryAutoUnlock('old-pwd')).toBeNull();
    expect(await tryAutoUnlock('new-pwd')).toBe('my-backup-pass');
  });

  it('does not re-encrypt when RPC fails', async () => {
    await cacheUnlockBlob('my-backup-pass', 'old-pwd');
    rpcMock.mockResolvedValue({ data: { ok: false, error: 'invalid_password' }, error: null });
    const out = await changePasswordWithReencrypt('eiass', 'wrong-old', 'new-pwd');
    expect(out.ok).toBe(false);
    expect(await tryAutoUnlock('old-pwd')).toBe('my-backup-pass');
    expect(await tryAutoUnlock('new-pwd')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/passwordChange.reencrypt.test.ts`
Expected: FAIL — `changePasswordWithReencrypt` not exported.

- [ ] **Step 3: Edit `src/auth/auth.ts`**

Add a wrapper near the existing `changePassword` function (line ~184):

```ts
import { reencryptUnlockCache } from '@/crypto/unlock';

/**
 * Change the user's login password AND re-encrypt the cached unlock blob with
 * the new password — so the user's auto-unlock keeps working after the change.
 * Without the re-encrypt step, the user would silently lose their auto-unlock
 * and have to retype the backup passphrase on next login.
 */
export async function changePasswordWithReencrypt(
  username: string,
  oldPwd: string,
  newPwd: string,
): Promise<RpcResult> {
  const result = await changePassword(username, oldPwd, newPwd);
  if (result.ok) {
    await reencryptUnlockCache(oldPwd, newPwd);
  }
  return result;
}
```

Update Settings.tsx (or wherever the change-password button lives) to call `changePasswordWithReencrypt` instead of `changePassword`. Run `Grep -n "changePassword(" src/` to find call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/passwordChange.reencrypt.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.ts src/ui/screens/Settings.tsx tests/passwordChange.reencrypt.test.ts
git commit -m "feat(auth): re-encrypt cached unlock blob on password change"
```

---

## Task 8: Manual cloud push button (`pushAllToCloud`)

**Files:**
- Create: `src/notes/manualPush.ts`
- Test: `tests/manualPush.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/manualPush.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { pushBlobMock } = vi.hoisted(() => ({ pushBlobMock: vi.fn() }));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return { ...actual, pushBlob: pushBlobMock };
});

import { resetDbForTests, putPatient, putNote } from '@/storage/indexed';
import { saveApiKey } from '@/crypto/keystore';
import { pushAllToCloud } from '@/notes/manualPush';

beforeEach(async () => {
  await resetDbForTests();
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
});

describe('pushAllToCloud', () => {
  it('pushes every patient + every note + canary + api-key', async () => {
    await putPatient({
      id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
      tags: [], createdAt: 1, updatedAt: 1,
    });
    await putNote({
      id: 'n1', patientId: 'p1', type: 'admission', bodyHebrew: 'x',
      structuredData: {}, createdAt: 1, updatedAt: 1,
    });
    await saveApiKey('sk-ant-test');

    const out = await pushAllToCloud('my-pass', 'eiass');
    expect(out.pushedPatients).toBe(1);
    expect(out.pushedNotes).toBe(1);
    expect(out.pushedApiKey).toBe(true);
    expect(out.pushedCanary).toBe(true);
    expect(out.failed).toEqual([]);

    // Calls: 1 patient + 1 note + 1 api-key + 1 canary = 4
    expect(pushBlobMock).toHaveBeenCalledTimes(4);
  });

  it('continues past per-row failures and reports them', async () => {
    await putPatient({
      id: 'p1', name: 'A', teudatZehut: '1', dob: '', room: null,
      tags: [], createdAt: 1, updatedAt: 1,
    });
    pushBlobMock.mockRejectedValueOnce(new Error('network'));
    pushBlobMock.mockResolvedValue(undefined);
    const out = await pushAllToCloud('p', 'eiass');
    expect(out.failed.length).toBe(1);
    expect(out.failed[0]).toMatchObject({ blob_type: 'patient', blob_id: 'p1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manualPush.test.ts`
Expected: FAIL — module `@/notes/manualPush` not found.

- [ ] **Step 3: Create `src/notes/manualPush.ts`**

```ts
import { listPatients, listAllNotes } from '@/storage/indexed';
import { encryptForCloud, pushBlob, pushCanary } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { pushApiKeyToCloud, hasApiKey } from '@/crypto/keystore';

export interface PushAllResult {
  pushedPatients: number;
  pushedNotes: number;
  pushedApiKey: boolean;
  pushedCanary: boolean;
  failed: Array<{ blob_type: string; blob_id: string; reason: string }>;
}

/**
 * Re-push every local patient + note + api-key + canary to Supabase under
 * the given passphrase. Used by the "גיבוי לענן עכשיו" Settings button.
 *
 * Idempotent: each blob_id is upserted (onConflict on user_id+blob_type+blob_id).
 * A second call within seconds re-pushes with fresh IVs but the same row count.
 *
 * Per-row errors don't abort the whole push — they're collected in `failed`
 * so the UI can surface a partial-success report. Same posture as
 * restoreFromCloud's `skipped` field.
 */
export async function pushAllToCloud(
  passphrase: string,
  username: string | null,
): Promise<PushAllResult> {
  const result: PushAllResult = {
    pushedPatients: 0,
    pushedNotes: 0,
    pushedApiKey: false,
    pushedCanary: false,
    failed: [],
  };

  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(passphrase, salt);

  // Push canary first so verifyCanary works even if the patient/note loop
  // explodes mid-way through.
  try {
    await pushCanary(key, salt, username);
    result.pushedCanary = true;
  } catch (e) {
    result.failed.push({
      blob_type: 'canary',
      blob_id: '__canary__',
      reason: (e as Error).message ?? 'unknown',
    });
  }

  for (const patient of await listPatients()) {
    try {
      const sealed = await encryptForCloud(patient, key, salt);
      await pushBlob('patient', patient.id, sealed, username);
      result.pushedPatients++;
    } catch (e) {
      result.failed.push({
        blob_type: 'patient',
        blob_id: patient.id,
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  for (const note of await listAllNotes()) {
    try {
      const sealed = await encryptForCloud(note, key, salt);
      await pushBlob('note', note.id, sealed, username);
      result.pushedNotes++;
    } catch (e) {
      result.failed.push({
        blob_type: 'note',
        blob_id: note.id,
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  if (await hasApiKey()) {
    try {
      const out = await pushApiKeyToCloud(key, salt, username);
      result.pushedApiKey = out.pushed;
    } catch (e) {
      result.failed.push({
        blob_type: 'api-key',
        blob_id: '__user_default__',
        reason: (e as Error).message ?? 'unknown',
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manualPush.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/notes/manualPush.ts tests/manualPush.test.ts
git commit -m "feat(notes): add pushAllToCloud — manual cloud-backup-now button"
```

---

## Task 9: Local export — `exportLocalBackup`

**Files:**
- Create: `src/notes/exportLocal.ts`
- Test: `tests/exportImportLocal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/exportImportLocal.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetDbForTests,
  putPatient,
  putNote,
  listPatients,
  listAllNotes,
} from '@/storage/indexed';
import { exportLocalBackup } from '@/notes/exportLocal';
import { importLocalBackup } from '@/notes/importLocal';

beforeEach(async () => {
  await resetDbForTests();
});

async function seed() {
  await putPatient({
    id: 'p1', name: 'A', teudatZehut: '1', dob: '1950-01-01', room: null,
    tags: [], createdAt: 1, updatedAt: 1,
  });
  await putNote({
    id: 'n1', patientId: 'p1', type: 'admission', bodyHebrew: 'גוף',
    structuredData: { foo: 'bar' }, createdAt: 1, updatedAt: 1,
  });
}

describe('exportLocalBackup / importLocalBackup', () => {
  it('plaintext round-trip', async () => {
    await seed();
    const blob = await exportLocalBackup({ encryptWithLoginPassword: false });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    const out = await importLocalBackup(file, {});
    expect(out.imported.patients).toBe(1);
    expect(out.imported.notes).toBe(1);
    expect((await listPatients())[0]?.name).toBe('A');
    expect((await listAllNotes())[0]?.bodyHebrew).toBe('גוף');
  });

  it('encrypted round-trip', async () => {
    await seed();
    const blob = await exportLocalBackup({
      encryptWithLoginPassword: true,
      loginPassword: 'pwd',
    });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    const out = await importLocalBackup(file, { loginPassword: 'pwd' });
    expect(out.imported.patients).toBe(1);
    expect(out.imported.notes).toBe(1);
  });

  it('encrypted import with wrong password fails cleanly', async () => {
    await seed();
    const blob = await exportLocalBackup({
      encryptWithLoginPassword: true,
      loginPassword: 'pwd',
    });
    await resetDbForTests();
    const text = await blob.text();
    const file = new File([text], 'b.json', { type: 'application/json' });
    await expect(
      importLocalBackup(file, { loginPassword: 'WRONG' }),
    ).rejects.toThrow(/decrypt/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exportImportLocal.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/notes/exportLocal.ts`**

```ts
import { listPatients, listAllNotes, getSettings } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesEncrypt } from '@/crypto/aes';

export interface ExportOpts {
  /** When true, the file is encrypted with the user's login password. */
  encryptWithLoginPassword: boolean;
  /** Required when encryptWithLoginPassword=true. */
  loginPassword?: string;
}

interface PlainBackup {
  v: 1;
  exportedAt: number;
  encrypted: false;
  patients: unknown[];
  notes: unknown[];
  settings: { apiKeyXor: number[]; deviceSecret: number[] };
}

interface EncryptedBackup {
  v: 1;
  exportedAt: number;
  encrypted: true;
  payload: string;  // base64 ciphertext
  iv: string;       // base64
  salt: string;     // base64
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/**
 * Build a Blob containing the user's full local state. Default flow is
 * encrypted-with-login-password (per spec §7.2 option d). Caller is expected
 * to wire it to `<a download>` — this function does not touch the DOM.
 *
 * Plaintext export is opt-in: the caller must explicitly pass
 * `encryptWithLoginPassword: false` to acknowledge that the file will contain
 * unprotected PHI.
 */
export async function exportLocalBackup(opts: ExportOpts): Promise<Blob> {
  const patients = await listPatients();
  const notes = await listAllNotes();
  const settingsRow = await getSettings();
  const settings = {
    apiKeyXor: Array.from(settingsRow?.apiKeyXor ?? new Uint8Array(0)),
    deviceSecret: Array.from(settingsRow?.deviceSecret ?? new Uint8Array(0)),
  };

  if (!opts.encryptWithLoginPassword) {
    const body: PlainBackup = {
      v: 1,
      exportedAt: Date.now(),
      encrypted: false,
      patients,
      notes,
      settings,
    };
    return new Blob([JSON.stringify(body)], { type: 'application/json' });
  }

  if (!opts.loginPassword) {
    throw new Error('loginPassword required when encryptWithLoginPassword=true');
  }

  const inner = JSON.stringify({ patients, notes, settings });
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveAesKey(opts.loginPassword, salt);
  const { iv, ciphertext } = await aesEncrypt(inner, key);
  const body: EncryptedBackup = {
    v: 1,
    exportedAt: Date.now(),
    encrypted: true,
    payload: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}
```

- [ ] **Step 4: Create `src/notes/importLocal.ts`**

```ts
import { putPatient, putNote, type Patient, type Note } from '@/storage/indexed';
import { deriveAesKey } from '@/crypto/pbkdf2';
import { aesDecrypt } from '@/crypto/aes';

export interface ImportOpts {
  /** Required if the file's `encrypted` flag is true. */
  loginPassword?: string;
}

export interface ImportResult {
  imported: { patients: number; notes: number };
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Restore from a file produced by exportLocalBackup. Each patient + note goes
 * through putPatient/putNote so IDB upsert semantics overwrite local rows
 * with the same IDs (matching restoreFromCloud's behavior).
 */
export async function importLocalBackup(
  file: File,
  opts: ImportOpts,
): Promise<ImportResult> {
  const text = await file.text();
  const body = JSON.parse(text) as
    | { v: 1; encrypted: false; patients: Patient[]; notes: Note[] }
    | { v: 1; encrypted: true; payload: string; iv: string; salt: string };
  if (body.v !== 1) {
    throw new Error('unsupported backup file version');
  }

  let patients: Patient[];
  let notes: Note[];

  if (body.encrypted) {
    if (!opts.loginPassword) {
      throw new Error('loginPassword required to decrypt this backup');
    }
    const salt = base64ToBytes(body.salt);
    const iv = base64ToBytes(body.iv);
    const ct = base64ToBytes(body.payload);
    const key = await deriveAesKey(opts.loginPassword, salt);
    let inner: string;
    try {
      inner = await aesDecrypt(ct, iv, key);
    } catch {
      throw new Error('decrypt failed — wrong login password?');
    }
    const parsed = JSON.parse(inner) as { patients: Patient[]; notes: Note[] };
    patients = parsed.patients;
    notes = parsed.notes;
  } else {
    patients = body.patients;
    notes = body.notes;
  }

  for (const p of patients) await putPatient(p);
  for (const n of notes) await putNote(n);

  return { imported: { patients: patients.length, notes: notes.length } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/exportImportLocal.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/notes/exportLocal.ts src/notes/importLocal.ts tests/exportImportLocal.test.ts
git commit -m "feat(notes): exportLocalBackup + importLocalBackup (encrypted default + plaintext opt-in)"
```

---

## Task 10: Settings.tsx UI — three buttons + new error UI

**Files:**
- Modify: `src/ui/screens/Settings.tsx`

- [ ] **Step 1: Add the three buttons after the existing "סיסמת גיבוי" block**

Find the JSX block containing `הפעל סיסמה` / `נקה סיסמה`. After the closing `</div>` of that block, add:

```tsx
{passphraseActive && (
  <section className="cloud-actions" dir="rtl">
    <h3>גיבויים</h3>
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        try {
          const out = await pushAllToCloud(passphrase, currentUser?.username ?? null);
          setMessage(`נשלחו לענן: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות${out.failed.length > 0 ? ` (${out.failed.length} נכשלו)` : ''}.`);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
    >
      גיבוי לענן עכשיו
    </button>

    <button
      type="button"
      onClick={async () => {
        const wantPlain = !window.confirm('להצפין עם סיסמת הכניסה (מומלץ)?\n\nאישור = הצפן (אבטוח). ביטול = טקסט גלוי (לחירום בלבד).');
        const blob = await exportLocalBackup({
          encryptWithLoginPassword: !wantPlain,
          loginPassword: !wantPlain ? (getLastLoginPasswordOrNull() ?? '') : undefined,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ward-helper-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      ייצא גיבוי מקומי
    </button>

    <input
      type="file"
      accept="application/json"
      ref={importInputRef}
      style={{ display: 'none' }}
      onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          const out = await importLocalBackup(f, {
            loginPassword: getLastLoginPasswordOrNull() ?? '',
          });
          setMessage(`יובאו ${out.imported.patients} מטופלים ו-${out.imported.notes} הערות.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          e.target.value = '';
        }
      }}
    />
    <button type="button" onClick={() => importInputRef.current?.click()}>
      ייבא גיבוי מקומי
    </button>
  </section>
)}
```

Add the missing imports + state:

```ts
import { useRef } from 'react';
import { pushAllToCloud } from '@/notes/manualPush';
import { exportLocalBackup } from '@/notes/exportLocal';
import { importLocalBackup } from '@/notes/importLocal';
import { getLastLoginPasswordOrNull } from '@/auth/auth';

// inside the component:
const importInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Update the restore-from-cloud handler to read `wrongPassphrase`**

Find the existing `restoreFromCloud` call and the JSX block currently rendering `דילוג: {restoreResult.skipped.length} רשומות (סיסמה שגויה / פורמט לא תואם)`. Replace with:

```tsx
{restoreResult?.wrongPassphrase ? (
  <p className="restore-error">
    הסיסמה שגויה (לא הסיסמה ששמרה את הגיבויים בענן).{' '}
    <button onClick={() => setShowRetry(true)}>נסה סיסמה אחרת</button>{' '}
    <button onClick={async () => {
      const ok = window.confirm('פעולה זו תחליף את הגיבוי בענן בכל המטופלים וההערות שיש לך עכשיו במכשיר. להמשיך?');
      if (!ok) return;
      const out = await pushAllToCloud(passphrase, currentUser?.username ?? null);
      setMessage(`גיבוי הוחלף: ${out.pushedPatients} מטופלים, ${out.pushedNotes} הערות.`);
    }}>התחל מחדש (יחליף בענן)</button>
  </p>
) : (
  <>
    {/* existing skipped-count UI */}
    {restoreResult.skipped.length > 0 && (
      <>
        <br />
        דילוג: {restoreResult.skipped.length} רשומות (פורמט לא נתמך). ראה console.
      </>
    )}
  </>
)}
```

- [ ] **Step 3: Build**

Run: `npm run check && npm run build`
Expected: tsc + Vite build pass. New types resolve.

- [ ] **Step 4: Local manual smoke test**

Run: `npm run dev`. Open `http://localhost:5173/ward-helper/`. Log in. Activate a passphrase — confirm the canary call lands (Network tab → Supabase POST with `blob_type=canary`). Tap "גיבוי לענן עכשיו" — confirm patient + note + canary + api-key rows in Supabase Table Editor. Tap "ייצא גיבוי מקומי" — confirm a file downloads. Sign out + sign back in — confirm the passphrase prompt does **not** appear (auto-unlocked).

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Settings.tsx
git commit -m "feat(settings): three new buttons (manual push / export / import) + wrong-passphrase UI"
```

---

## Task 11: Version bump + verify

**Files:**
- Modify: `package.json` (version → 1.34.0)
- Modify: `public/sw.js` (VERSION line → ward-v1.34.0)

- [ ] **Step 1: Bump versions**

Edit `package.json`:

```json
"version": "1.34.0",
```

Edit `public/sw.js` — find the `VERSION = 'ward-v1.33.1'` (or similar) line and replace with:

```js
const VERSION = 'ward-v1.34.0';
```

(Source line is rewritten by the Vite plugin at build but the source must contain a `VERSION` line or build throws.)

- [ ] **Step 2: Run the full pre-push gate**

```bash
npm run check && npm test && npm run build
```

Expected: tsc clean, all vitest cases passing (including ~6 new ones), Vite build emits `dist/sw.js` with `ward-v1.34.0`.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin claude/term-wh-one-passphrase-20260506
gh pr create --title "v1.34.0: one passphrase + safety-net backups" --body "$(cat <<'EOF'
## Summary
- Backup passphrase cached on-device, encrypted with login password — auto-unlocks on subsequent logins (no more 3-prompt friction).
- Canary blob makes wrong-passphrase fail in 1 decrypt instead of N×PBKDF2(600k).
- Three new Settings buttons: גיבוי לענן עכשיו / ייצא גיבוי מקומי / ייבא גיבוי מקומי.
- Migration 0005 extends `blob_type` CHECK to allow `'canary'`.
- Login password change re-encrypts the cached unlock blob.

Spec: docs/superpowers/specs/2026-05-06-one-passphrase-design.md

## Test plan
- [x] `npm run check && npm test && npm run build` green locally
- [ ] CI 13 gates green
- [ ] After merge: `bash scripts/verify-deploy.sh` confirms ward-v1.34.0 on Pages
- [ ] On real device: log in → no passphrase prompt; manual push → 4 blob rows in Supabase; export → file downloads
EOF
)"
```

- [ ] **Step 4: Wait for CI, merge when green**

Watch `gh pr checks --watch`. Merge with `gh pr merge --squash` when 13/13 green. Direct push to main is forbidden by branch protection.

- [ ] **Step 5: Verify deploy live**

```bash
bash scripts/verify-deploy.sh
```

Expected: `ward-v1.34.0` line is live at `https://eiasash.github.io/ward-helper/sw.js`. If absent, wait 90s for Pages to publish, then retry.

- [ ] **Step 6: Update CLAUDE.md memory**

Add a one-line entry to the memory index for the v1.34.0 ship and the new "one passphrase" architecture, so a future session knows the threat-model trade was deliberate. (See `~/.claude/projects/C--Users-User\memory\MEMORY.md` and write a new `project_ward_helper_one_passphrase.md`.)

---

## Self-review

**1. Spec coverage**
- §3 architecture overview → Tasks 2, 3, 6 (cache + auto-unlock + login wiring)
- §5 data types `CachedUnlockBlob`/`CanaryBlob`/`LocalBackupFile` → Tasks 2, 4, 9
- §6 error-handling table → Task 5 (early-exit) + Task 10 (UI for wrongPassphrase)
- §7.1 manual cloud-push → Task 8
- §7.2/§7.3 export/import → Task 9
- §8 migration plan → Task 1 (SQL) + Task 7 (password change re-encrypt) + Task 6 (existing-user upgrade flow naturally works because cachedUnlockBlob starts undefined)
- §9 testing strategy → Tasks 2, 3, 4, 5, 6, 7, 8, 9 each have a dedicated test file
- §12 release checklist → Task 11

**2. Placeholder scan**
- No "TBD" / "TODO" / "implement later" in any task.
- Every "edit this file" step shows the exact code to insert/replace.
- Test code is complete vitest cases, not "write a test for X".
- No "similar to Task N" stubs.

**3. Type consistency**
- `CachedUnlockBlob` defined in Task 2, used in Task 3 — same property names (`v`, `ciphertext`, `iv`, `salt`).
- `pushBlob` signature extended to include `'canary'` in Task 4, then used in Task 4's `pushCanary` and Task 8's `pushAllToCloud`.
- `verifyCanary` returns `'ok' | 'wrong-passphrase' | 'absent'` consistently across Tasks 4, 5, 6.
- `RestoreResult.wrongPassphrase` added in Task 5, surfaced in Task 10.
- `getLastLoginPasswordOrNull` introduced in Task 6 step 3, used in Tasks 6 + 10.

No issues found. Plan is ready.
