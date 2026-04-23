import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aesEncrypt, aesDecrypt } from '@/crypto/aes';

/**
 * Supabase credentials resolution order:
 *   1. VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY  (canonical per project spec)
 *   2. VITE_SUPABASE_URL / VITE_SUPABASE_ANON              (legacy alias)
 *   3. Hardcoded fallback to the shared "Toranot" project  (publishable key only)
 *
 * The publishable key is not a secret — it only grants what RLS policies allow.
 * Hardcoding a fallback ensures the PWA works on GitHub Pages even if the
 * build environment doesn't inject env vars.
 */
const FALLBACK_URL = 'https://krmlzwwelqvlfslwltol.supabase.co';
const FALLBACK_KEY = 'sb_publishable_tUuqQQ8RKMvLDwTz5cKkOg_o_y-rHtw';

function readEnv(name: string): string | undefined {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.[name];
}

const SUPABASE_URL =
  readEnv('VITE_SUPABASE_URL')?.trim() || FALLBACK_URL;
const SUPABASE_KEY =
  readEnv('VITE_SUPABASE_PUBLISHABLE_KEY')?.trim() ||
  readEnv('VITE_SUPABASE_ANON')?.trim() ||
  FALLBACK_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Supabase not configured — VITE_SUPABASE_URL/KEY missing and fallback unavailable');
    }
    client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return client;
}

/** For tests: exposed so specs can assert which project the app will talk to. */
export function getSupabaseConfig(): { url: string; keyPrefix: string } {
  return { url: SUPABASE_URL, keyPrefix: SUPABASE_KEY.slice(0, 16) };
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
