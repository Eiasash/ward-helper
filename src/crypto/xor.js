export function generateDeviceSecret() {
    const s = new Uint8Array(32);
    crypto.getRandomValues(s);
    return s;
}
export function xorEncrypt(plaintext, secret) {
    const pt = new TextEncoder().encode(plaintext);
    const ct = new Uint8Array(pt.length);
    for (let i = 0; i < pt.length; i++)
        ct[i] = pt[i] ^ secret[i % secret.length];
    return ct;
}
export function xorDecrypt(ciphertext, secret) {
    const pt = new Uint8Array(ciphertext.length);
    for (let i = 0; i < ciphertext.length; i++)
        pt[i] = ciphertext[i] ^ secret[i % secret.length];
    return new TextDecoder().decode(pt);
}
