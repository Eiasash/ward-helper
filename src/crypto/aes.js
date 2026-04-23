export async function aesEncrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return { iv, ciphertext: new Uint8Array(ct) };
}
export async function aesDecrypt(ciphertext, iv, key) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(pt);
}
