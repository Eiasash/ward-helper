export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

export async function aesEncrypt(plaintext: string, key: CryptoKey): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aesDecrypt(
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(pt);
}
