export function generateDeviceSecret(): Uint8Array<ArrayBuffer> {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

export function xorEncrypt(plaintext: string, secret: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const pt = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(pt.length);
  for (let i = 0; i < pt.length; i++) ct[i] = pt[i]! ^ secret[i % secret.length]!;
  return ct;
}

export function xorDecrypt(ciphertext: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>): string {
  const pt = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) pt[i] = ciphertext[i]! ^ secret[i % secret.length]!;
  return new TextDecoder().decode(pt);
}
