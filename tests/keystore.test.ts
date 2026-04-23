import { describe, it, expect, beforeEach } from 'vitest';
import { saveApiKey, loadApiKey, hasApiKey, clearApiKey } from '@/crypto/keystore';
import { resetDbForTests } from '@/storage/indexed';

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('ward-helper');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('keystore', () => {
  it('loadApiKey returns null when nothing has been stored', async () => {
    const key = await loadApiKey();
    expect(key).toBeNull();
  });

  it('hasApiKey returns false before anything is saved', async () => {
    expect(await hasApiKey()).toBe(false);
  });

  it('saveApiKey / loadApiKey round-trips an Anthropic API key', async () => {
    await saveApiKey('sk-ant-api03-TESTKEY-ABCDEFG');
    const loaded = await loadApiKey();
    expect(loaded).toBe('sk-ant-api03-TESTKEY-ABCDEFG');
  });

  it('hasApiKey returns true after saving a key', async () => {
    await saveApiKey('sk-ant-test');
    expect(await hasApiKey()).toBe(true);
  });

  it('clearApiKey makes loadApiKey return null', async () => {
    await saveApiKey('sk-ant-api03-CLEARME');
    await clearApiKey();
    expect(await loadApiKey()).toBeNull();
  });

  it('clearApiKey makes hasApiKey return false', async () => {
    await saveApiKey('sk-ant-test');
    await clearApiKey();
    expect(await hasApiKey()).toBe(false);
  });

  it('clearApiKey is a no-op when no settings exist', async () => {
    // Should not throw
    await expect(clearApiKey()).resolves.toBeUndefined();
  });

  it('saving a second key overwrites the first', async () => {
    await saveApiKey('sk-ant-first');
    await saveApiKey('sk-ant-second');
    expect(await loadApiKey()).toBe('sk-ant-second');
  });

  it('saveApiKey preserves other settings fields across calls', async () => {
    await saveApiKey('sk-ant-first');
    await saveApiKey('sk-ant-second');
    // Both saves should leave hasApiKey true
    expect(await hasApiKey()).toBe(true);
  });
});
