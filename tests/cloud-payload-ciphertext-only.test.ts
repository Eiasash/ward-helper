/**
 * Wire-level invariant: ward_helper_backup uploads MUST contain ciphertext
 * + iv + salt only — never plaintext PHI fields like name / teudatZehut /
 * bodyHebrew / chiefComplaint / pmh / meds.
 *
 * This is the single most important PHI safety contract in the app:
 * Supabase is a third-party host and Israeli MoH guidance treats anything
 * transmitted there as outside the device boundary. Existing crypto.test.ts
 * covers the AES-GCM round-trip, and save.test.ts covers that pushBlob is
 * called the right number of times with the right username — but neither
 * directly asserts the upserted ROW PAYLOAD never contains plaintext PHI.
 *
 * If a future refactor accidentally adds a "name" or "teudatZehut" column
 * for "convenience indexing", this test catches it before it ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We capture every upsert payload here for assertion.
const upsertSpy = vi.fn();

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
  })),
}));

import { pushBlob, encryptForCloud } from '@/storage/cloud';
import { deriveAesKey } from '@/crypto/pbkdf2';

beforeEach(() => {
  upsertSpy.mockClear();
});

// PHI sentinel values — these strings (and their UTF-8 bytes) must NEVER
// appear in any payload sent to Supabase.
const SENTINEL_NAME = 'דוד כהן';
const SENTINEL_TZ = '987654321';
const SENTINEL_BODY = 'גוף ההסבה החסויה';
const SENTINEL_PMH = 'אבחנה רגישה לגזעני';
const SENTINEL_MEDS = 'Apixaban-2.5mg-bid';

const ALLOWED_KEYS = new Set([
  'user_id',
  'blob_type',
  'blob_id',
  'ciphertext',
  'iv',
  'salt',
  'updated_at',
  'username',
]);

function payloadStringify(row: Record<string, unknown>): string {
  // Replace binary buffers with placeholder so JSON.stringify doesn't blow up
  // on Uint8Array, and so the resulting string only contains the row metadata.
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) safe[k] = `<bytes:${v.byteLength}>`;
    else if (v instanceof ArrayBuffer) safe[k] = `<buffer:${v.byteLength}>`;
    else safe[k] = v;
  }
  return JSON.stringify(safe);
}

describe('pushBlob — ciphertext-only-on-wire invariant', () => {
  it('only writes ciphertext+iv+salt+meta columns; never plaintext PHI fields', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('correct horse battery staple', salt);
    const sealed = await encryptForCloud(
      {
        name: SENTINEL_NAME,
        teudatZehut: SENTINEL_TZ,
        bodyHebrew: SENTINEL_BODY,
        pmh: [SENTINEL_PMH],
        meds: [{ name: SENTINEL_MEDS, dose: '2.5', freq: 'bid' }],
      },
      key,
      salt,
    );
    await pushBlob('patient', 'blob-id-42', sealed, null);

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [row] = upsertSpy.mock.calls[0]!;
    const r = row as Record<string, unknown>;

    // 1. Schema lockdown: every key in the upsert row is on the allowlist.
    for (const k of Object.keys(r)) {
      expect(ALLOWED_KEYS.has(k), `disallowed column "${k}" in upsert payload`).toBe(true);
    }

    // 2. The three crypto byte fields are real binary, not strings.
    expect(r.ciphertext).toBeInstanceOf(Uint8Array);
    expect(r.iv).toBeInstanceOf(Uint8Array);
    expect(r.salt).toBeInstanceOf(Uint8Array);
    expect((r.iv as Uint8Array).byteLength).toBe(12); // AES-GCM IV is 12 bytes

    // 3. PHI sentinels NEVER appear in any string field.
    const stringified = payloadStringify(r);
    for (const sentinel of [SENTINEL_NAME, SENTINEL_TZ, SENTINEL_BODY, SENTINEL_PMH, SENTINEL_MEDS]) {
      expect(stringified, `payload leaked sentinel "${sentinel}"`).not.toContain(sentinel);
    }

    // 4. Ciphertext bytes also do NOT contain the UTF-8 of any sentinel
    // (sanity check that AES actually ran — a no-op encrypt would fail this).
    const ctBytes = r.ciphertext as Uint8Array;
    const ctText = new TextDecoder('utf-8', { fatal: false }).decode(ctBytes);
    for (const sentinel of [SENTINEL_NAME, SENTINEL_TZ, SENTINEL_BODY]) {
      expect(ctText, `ciphertext contains plaintext "${sentinel}" — encrypt no-op?`).not.toContain(sentinel);
    }

    // 5. Metadata is what we expect.
    expect(r.user_id).toBe('anon-uid-1');
    expect(r.blob_type).toBe('patient');
    expect(r.blob_id).toBe('blob-id-42');
  });

  it('omits the username column entirely when guest (null username)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('p', salt);
    const sealed = await encryptForCloud({ x: 1 }, key, salt);
    await pushBlob('note', 'n1', sealed, null);
    const [row] = upsertSpy.mock.calls[0]!;
    const r = row as Record<string, unknown>;
    expect('username' in r).toBe(false);
  });

  it('coerces empty/whitespace username to no column (never lands "" in DB)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('p', salt);
    const sealed = await encryptForCloud({ x: 1 }, key, salt);
    await pushBlob('note', 'n2', sealed, '   ');
    const [row] = upsertSpy.mock.calls[0]!;
    expect('username' in (row as Record<string, unknown>)).toBe(false);
  });

  it('writes username column only for authed pushes with a real value', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('p', salt);
    const sealed = await encryptForCloud({ x: 1 }, key, salt);
    await pushBlob('note', 'n3', sealed, '  eias  '); // trimmed
    const [row] = upsertSpy.mock.calls[0]!;
    expect((row as Record<string, unknown>).username).toBe('eias');
  });

  it('uses the (user_id, blob_type, blob_id) composite onConflict key', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('p', salt);
    const sealed = await encryptForCloud({ x: 1 }, key, salt);
    await pushBlob('patient', 'p1', sealed, null);
    const [, opts] = upsertSpy.mock.calls[0]!;
    expect((opts as { onConflict?: string }).onConflict).toBe('user_id,blob_type,blob_id');
  });
});

describe('encryptForCloud — sealing invariants', () => {
  it('produces non-empty AES-GCM ciphertext distinct from plaintext UTF-8', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('pass', salt);
    const plain = { name: SENTINEL_NAME, tz: SENTINEL_TZ };
    const sealed = await encryptForCloud(plain, key, salt);
    expect(sealed.ciphertext.byteLength).toBeGreaterThan(0);
    expect(sealed.iv.byteLength).toBe(12);
    expect(sealed.salt).toBe(salt); // salt is forwarded, not re-rolled

    // Encoded plaintext bytes must not appear anywhere in the ciphertext.
    const plainBytes = new TextEncoder().encode(JSON.stringify(plain));
    const ct = sealed.ciphertext;
    // brute-force search: ct must NOT contain plainBytes as a contiguous slice
    let matched = false;
    outer: for (let i = 0; i + plainBytes.length <= ct.byteLength; i++) {
      for (let j = 0; j < plainBytes.length; j++) {
        if (ct[i + j] !== plainBytes[j]) continue outer;
      }
      matched = true;
      break;
    }
    expect(matched, 'ciphertext contains plaintext bytes — encrypt no-op?').toBe(false);
  });

  it('two encrypts of the same payload yield different IVs (no IV reuse)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
    const key = await deriveAesKey('pass', salt);
    const a = await encryptForCloud({ x: 'same' }, key, salt);
    const b = await encryptForCloud({ x: 'same' }, key, salt);
    expect(new Uint8Array(a.iv)).not.toEqual(new Uint8Array(b.iv));
    expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext));
  });
});
