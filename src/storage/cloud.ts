import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

const SUPABASE_URL = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON ?? '';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON);
  return client;
}

export interface SealedBlob {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export async function encryptForCloud<T>(
  record: T,
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<SealedBlob> {
  const { iv, ciphertext } = await aesEncrypt(JSON.stringify(record), key);
  return { ciphertext, iv, salt };
}

export async function decryptFromCloud<T>(
  ct: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<T> {
  const json = await aesDecrypt(ct, iv, key);
  return JSON.parse(json) as T;
}

export async function ensureAnonymousAuth(): Promise<string> {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed');
  return data.user.id;
}

export async function pushBlob(
  type: 'patient' | 'note',
  id: string,
  sealed: SealedBlob,
): Promise<void> {
  const userId = await ensureAnonymousAuth();
  const { error } = await getSupabase().from('ward_helper_backup').upsert(
    {
      user_id: userId,
      blob_type: type,
      blob_id: id,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      salt: sealed.salt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,blob_type,blob_id' },
  );
  if (error) throw error;
}
