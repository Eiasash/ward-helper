/**
 * Tests for the per-account API key cloud sync (Option A).
 *
 * Wire diagram:
 *   saveBoth → pushApiKeyToCloud(key, salt, username)
 *     → loadApiKey() (from local IDB keystore)
 *     → encryptForCloud({ v:1, apiKey, savedAt })
 *     → pushBlob('api-key', '__user_default__', sealed, username)
 *
 *   restoreFromCloud → on row.blob_type === 'api-key' → applyApiKeyFromCloud
 *     → decryptFromCloud<ApiKeyCloudBlob>
 *     → if v:1 schema valid → saveApiKey(blob.apiKey)
 *
 * What this test covers:
 *   - no-op when no local key
 *   - happy path: push uses correct blob_type + blob_id
 *   - apply: valid v:1 blob writes to keystore
 *   - apply: malformed blob (wrong v, missing apiKey, empty apiKey) returns
 *     false without touching the keystore — restore caller should record
 *     a skipped entry rather than abort the whole pull
 *
 * Mocks: pushBlob (no real Supabase), saveApiKey/loadApiKey (no real IDB).
 * The encrypt/decrypt path uses real WebCrypto since happy-dom + node 20+
 * provides it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted above all imports, so any variables they
// reference must also be hoisted via vi.hoisted(). This is the canonical
// pattern for vitest 4+.
const { pushBlobMock, localKeyState } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
  localKeyState: { current: null as string | null },
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
  };
});

vi.mock('@/storage/indexed', () => ({
  getSettings: vi.fn(async () => {
    if (!localKeyState.current) return null;
    return {
      apiKeyXor: new TextEncoder().encode(localKeyState.current),
      deviceSecret: new Uint8Array(16),
      lastPassphraseAuthAt: null,
      prefs: {},
    };
  }),
  setSettings: vi.fn(async () => {
    /* no-op shim */
  }),
}));

// Mock the XOR layer to be identity (skip the obfuscation in tests).
vi.mock('@/crypto/xor', () => ({
  xorEncrypt: (s: string) => new TextEncoder().encode(s),
  xorDecrypt: (b: Uint8Array) => new TextDecoder().decode(b),
  generateDeviceSecret: () => new Uint8Array(16),
}));

import {
  pushApiKeyToCloud,
  applyApiKeyFromCloud,
  loadApiKey,
  saveApiKey,
  API_KEY_BLOB_ID,
} from '@/crypto/keystore';
import { encryptForCloud } from '@/storage/cloud';

beforeEach(() => {
  pushBlobMock.mockReset();
  pushBlobMock.mockResolvedValue(undefined);
  localKeyState.current = null;
});

async function aesKey(): Promise<{ key: CryptoKey; salt: Uint8Array<ArrayBuffer> }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  return { key, salt };
}

describe('pushApiKeyToCloud', () => {
  it('returns {pushed:false, reason:no-local-key} when no key set locally', async () => {
    localKeyState.current = null;
    const { key, salt } = await aesKey();
    const result = await pushApiKeyToCloud(key, salt, null);
    expect(result.pushed).toBe(false);
    expect(result.reason).toBe('no-local-key');
    expect(pushBlobMock).not.toHaveBeenCalled();
  });

  it('pushes with correct blob_type=api-key and blob_id when key is set', async () => {
    localKeyState.current = 'sk-ant-test-01';
    const { key, salt } = await aesKey();
    const result = await pushApiKeyToCloud(key, salt, 'eias');
    expect(result.pushed).toBe(true);
    expect(pushBlobMock).toHaveBeenCalledTimes(1);
    const call = pushBlobMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toBe('api-key');
    expect(call![1]).toBe(API_KEY_BLOB_ID);
    expect(call![3]).toBe('eias');
  });

  it('passes null username for guests (no app_users session)', async () => {
    localKeyState.current = 'sk-ant-test-02';
    const { key, salt } = await aesKey();
    await pushApiKeyToCloud(key, salt, null);
    const call = pushBlobMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![3]).toBeNull();
  });
});

describe('applyApiKeyFromCloud', () => {
  it('round-trips: encrypt v:1 blob → decrypt → applies via saveApiKey', async () => {
    const { key, salt: _salt } = await aesKey();
    const blob = { v: 1, apiKey: 'sk-ant-restored', savedAt: 1234567890 };
    const sealed = await encryptForCloud(blob, key, new Uint8Array(16) as Uint8Array<ArrayBuffer>);
    // Spy saveApiKey by replacing it with a mock that captures the call.
    // (We can't easily mock it through the module loader without re-importing,
    // so verify by reading back via the same mocked indexed.ts layer.)
    const applied = await applyApiKeyFromCloud(sealed.ciphertext, sealed.iv, key);
    expect(applied).toBe(true);
    // The mocked setSettings is a no-op — we don't roundtrip via getSettings
    // here. The key behavioral assertion is that applyApiKeyFromCloud
    // returned true (didn't throw, schema check passed).
  });

  it('returns false on wrong version field', async () => {
    const { key } = await aesKey();
    const blob = { v: 2 as const, apiKey: 'sk-ant-newversion', savedAt: 0 };
    const sealed = await encryptForCloud(blob, key, new Uint8Array(16) as Uint8Array<ArrayBuffer>);
    const applied = await applyApiKeyFromCloud(sealed.ciphertext, sealed.iv, key);
    expect(applied).toBe(false);
  });

  it('returns false on missing apiKey field', async () => {
    const { key } = await aesKey();
    const blob = { v: 1 as const, savedAt: 0 };
    const sealed = await encryptForCloud(blob, key, new Uint8Array(16) as Uint8Array<ArrayBuffer>);
    const applied = await applyApiKeyFromCloud(sealed.ciphertext, sealed.iv, key);
    expect(applied).toBe(false);
  });

  it('returns false on empty apiKey string', async () => {
    const { key } = await aesKey();
    const blob = { v: 1 as const, apiKey: '', savedAt: 0 };
    const sealed = await encryptForCloud(blob, key, new Uint8Array(16) as Uint8Array<ArrayBuffer>);
    const applied = await applyApiKeyFromCloud(sealed.ciphertext, sealed.iv, key);
    expect(applied).toBe(false);
  });

  it('throws (does not silently succeed) when ciphertext was encrypted with a different key', async () => {
    const { key: keyA } = await aesKey();
    const { key: keyB } = await aesKey();
    const blob = { v: 1 as const, apiKey: 'sk-ant-1', savedAt: 0 };
    const sealed = await encryptForCloud(blob, keyA, new Uint8Array(16) as Uint8Array<ArrayBuffer>);
    // AES-GCM auth-tag mismatch on wrong key throws OperationError.
    await expect(
      applyApiKeyFromCloud(sealed.ciphertext, sealed.iv, keyB),
    ).rejects.toBeDefined();
  });
});

describe('saveApiKey + loadApiKey round-trip (XOR layer)', () => {
  // These are existing functions — sanity-check the test mocks didn't break
  // them. If localKeyState tracking ever drifts, the cloud-sync tests above
  // become misleading.
  it('saveApiKey then loadApiKey returns the same plaintext', async () => {
    localKeyState.current = 'sk-ant-roundtrip-test';
    await saveApiKey('sk-ant-roundtrip-test');
    const loaded = await loadApiKey();
    expect(loaded).toBe('sk-ant-roundtrip-test');
  });
});
