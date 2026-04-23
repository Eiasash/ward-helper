import { describe, it, expect } from 'vitest';
import { xorEncrypt, xorDecrypt, generateDeviceSecret } from '@/crypto/xor';
import { deriveAesKey, PBKDF2_ITERATIONS } from '@/crypto/pbkdf2';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

describe('xor api-key cipher', () => {
  it('round-trips an anthropic key', () => {
    const secret = generateDeviceSecret();
    const key = 'sk-ant-api03-REDACTED-REDACTED';
    const ct = xorEncrypt(key, secret);
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(ct);
    expect(asText).not.toContain('sk-ant');
    const pt = xorDecrypt(ct, secret);
    expect(pt).toBe(key);
  });

  it('device secret is 32 bytes', () => {
    const s = generateDeviceSecret();
    expect(s.byteLength).toBe(32);
  });
});

describe('pbkdf2', () => {
  it('iteration count is >= 600000', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('derives a 256-bit AES-GCM key from passphrase + salt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('correct-horse-battery-staple', salt);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('same passphrase + salt produces same key material', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k1 = await deriveAesKey('pass', salt);
    const k2 = await deriveAesKey('pass', salt);
    const raw1 = await crypto.subtle.exportKey('raw', k1);
    const raw2 = await crypto.subtle.exportKey('raw', k2);
    expect(new Uint8Array(raw1)).toEqual(new Uint8Array(raw2));
  });
});

describe('aes-gcm', () => {
  it('round-trips a JSON note', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const plaintext = JSON.stringify({ name: 'דוד כהן', age: 82, note: 'קבלה' });
    const { iv, ciphertext } = await aesEncrypt(plaintext, key);
    expect(iv.byteLength).toBe(12);
    expect(ciphertext.byteLength).toBeGreaterThan(0);
    const out = await aesDecrypt(ciphertext, iv, key);
    expect(out).toBe(plaintext);
  });

  it('different IVs produce different ciphertexts for same plaintext', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey('pass', salt);
    const a = await aesEncrypt('x', key);
    const b = await aesEncrypt('x', key);
    expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext));
  });
});
