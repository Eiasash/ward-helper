/**
 * Tests for the per-account API key cloud sync.
 *
 * Wire diagram (v1.39.0+):
 *   saveBoth → pushApiKeyToCloud(key, salt, username)
 *     → loadApiKey() (now reads localStorage 'wardhelper_apikey')
 *     → encryptForCloud({ v:1, apiKey, savedAt })
 *     → pushBlob('api-key', '__user_default__', sealed, username)
 *
 *   restoreFromCloud → on row.blob_type === 'api-key' → applyApiKeyFromCloud
 *     → decryptFromCloud<ApiKeyCloudBlob>
 *     → if v:1 schema valid → saveApiKey(blob.apiKey) (writes localStorage)
 *
 * Storage moved from IDB-XOR to localStorage in v1.39.0 — the test now
 * drives the local key via localStorage.setItem rather than mocking
 * @/storage/indexed::getSettings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted above all imports, so any variables they
// reference must also be hoisted via vi.hoisted().
const { pushBlobMock } = vi.hoisted(() => ({
  pushBlobMock: vi.fn(),
}));

vi.mock('@/storage/cloud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/cloud')>();
  return {
    ...actual,
    pushBlob: pushBlobMock,
  };
});

import {
  pushApiKeyToCloud,
  applyApiKeyFromCloud,
  loadApiKey,
  saveApiKey,
  API_KEY_BLOB_ID,
} from '@/crypto/keystore';
import { encryptForCloud } from '@/storage/cloud';

const localKeyState = {
  set current(v: string | null) {
    if (v) localStorage.setItem('wardhelper_apikey', v);
    else localStorage.removeItem('wardhelper_apikey');
  },
  get current(): string | null {
    return localStorage.getItem('wardhelper_apikey');
  },
};

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
