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

/**
 * Supabase stores bytea as base64-encoded hex-with-backslash-x prefix, or as
 * a plain base64 string, depending on the client version and column config.
 * The @supabase/supabase-js v2 client returns bytea columns as base64
 * strings on read. Callers of pullAllBlobs get this back and must decode.
 */
export type CloudBlobRow = {
  blob_type: 'patient' | 'note';
  blob_id: string;
  ciphertext: string; // base64
  iv: string; // base64
  salt: string; // base64
  updated_at: string; // ISO
};

/**
 * Fetch every encrypted blob belonging to the current anon user.
 *
 * Used for restore: when the user installs on a new device (or clears their
 * IDB), this is the path that pulls their history back. The salt is returned
 * INSIDE each row — the caller must use that blob's salt + the user's
 * passphrase to re-derive the AES key, then decryptFromCloud() with that
 * row's iv + ciphertext.
 *
 * Returns rows in (blob_type, blob_id) order — patients and notes
 * interleaved, not separated. Caller splits them.
 */
export async function pullAllBlobs(): Promise<CloudBlobRow[]> {
  await ensureAnonymousAuth();
  const { data, error } = await getSupabase()
    .from('ward_helper_backup')
    .select('blob_type, blob_id, ciphertext, iv, salt, updated_at')
    .order('blob_type')
    .order('blob_id');
  if (error) throw error;
  return (data ?? []) as CloudBlobRow[];
}

/**
 * Convert a base64 string (as returned by Supabase for bytea columns) back
 * into a Uint8Array for crypto operations.
 */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  // Supabase sometimes prefixes hex-encoded bytea with `\x`; strip it.
  const clean = b64.startsWith('\\x') ? hexToBase64(b64.slice(2)) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBase64(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
