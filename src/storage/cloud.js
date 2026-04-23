import { createClient } from '@supabase/supabase-js';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON = import.meta.env?.VITE_SUPABASE_ANON ?? '';
let client = null;
export function getSupabase() {
    if (!client)
        client = createClient(SUPABASE_URL, SUPABASE_ANON);
    return client;
}
export async function encryptForCloud(record, key, salt) {
    const { iv, ciphertext } = await aesEncrypt(JSON.stringify(record), key);
    return { ciphertext, iv, salt };
}
export async function decryptFromCloud(ct, iv, key) {
    const json = await aesDecrypt(ct, iv, key);
    return JSON.parse(json);
}
export async function ensureAnonymousAuth() {
    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (session)
        return session.user.id;
    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.user)
        throw error ?? new Error('anonymous sign-in failed');
    return data.user.id;
}
export async function pushBlob(type, id, sealed) {
    const userId = await ensureAnonymousAuth();
    const { error } = await getSupabase().from('ward_helper_backup').upsert({
        user_id: userId,
        blob_type: type,
        blob_id: id,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        salt: sealed.salt,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,blob_type,blob_id' });
    if (error)
        throw error;
}
