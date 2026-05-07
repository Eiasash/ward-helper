// Lazy-load supabase-js: type-only import at top (zero runtime cost),
// dynamic `await import('@supabase/supabase-js')` inside getSupabase().
// This defers the ~30 kB gz client off the entry chunk until first cloud
// operation. Earmarked in IMPROVEMENTS.md R2 ("if entry climbs past
// ~165 kB"); we're at 159.97 kB now and proactively splitting before
// the next feature lands and crosses the trigger.
import type { SupabaseClient } from '@supabase/supabase-js';
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

export async function getSupabase(): Promise<SupabaseClient> {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Supabase not configured — VITE_SUPABASE_URL/KEY missing and fallback unavailable');
    }
    const { createClient } = await import('@supabase/supabase-js');
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
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed');
  return data.user.id;
}

export async function pushBlob(
  type: 'patient' | 'note' | 'api-key' | 'canary',
  id: string,
  sealed: SealedBlob,
  username?: string | null,
): Promise<void> {
  const userId = await ensureAnonymousAuth();
  // The `username` column is the cross-device routing key added by migration
  // 0003. We populate it only when the caller passes a real username — that
  // is, when an app_users session is active. Guests pass null/undefined and
  // their rows stay null-username, reachable only via the existing
  // per-anon-user-id SELECT path. Empty/whitespace strings are coerced to
  // null so a misuse never lands an empty username in the DB (the RPC
  // matches on equality, so empty would silently group all such rows).
  const cleanUsername =
    typeof username === 'string' && username.trim().length > 0
      ? username.trim()
      : null;
  const row: Record<string, unknown> = {
    user_id: userId,
    blob_type: type,
    blob_id: id,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    salt: sealed.salt,
    updated_at: new Date().toISOString(),
  };
  if (cleanUsername !== null) row.username = cleanUsername;
  const sb = await getSupabase();
  const { error } = await sb
    .from('ward_helper_backup')
    .upsert(row, { onConflict: 'user_id,blob_type,blob_id' });
  if (error) throw error;
}

/**
 * Supabase stores bytea as base64-encoded hex-with-backslash-x prefix, or as
 * a plain base64 string, depending on the client version and column config.
 * The @supabase/supabase-js v2 client returns bytea columns as base64
 * strings on read. Callers of pullAllBlobs get this back and must decode.
 */
export type CloudBlobRow = {
  blob_type: 'patient' | 'note' | 'api-key' | 'canary';
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
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('ward_helper_backup')
    .select('blob_type, blob_id, ciphertext, iv, salt, updated_at')
    .order('blob_type')
    .order('blob_id');
  if (error) throw error;
  return (data ?? []) as CloudBlobRow[];
}

/**
 * Cross-device pull: fetch every encrypted blob attributed to a given
 * app_users username, regardless of which Supabase anon user pushed them.
 *
 * This is the cross-device sync path. The per-anon-user `pullAllBlobs`
 * above can never see another device's rows because each device has its
 * own `auth.uid()`. The `ward_helper_pull_by_username(p_username)` RPC
 * (migration 0003, SECURITY DEFINER) bypasses that boundary by looking
 * up the `username` column populated when the user was logged in via
 * app_users at push time.
 *
 * Threat model: knowing the username is enough to fetch the encrypted
 * blobs — but the AES-GCM payload is bound to a PBKDF2(600k)-derived
 * key from the user's separate cloud passphrase. The DB hands out
 * ciphertext; the passphrase is the actual lock. Same posture as the
 * Phase 2 *_backups RPC for the study PWAs.
 */
export async function pullByUsername(username: string): Promise<CloudBlobRow[]> {
  if (!username || !username.trim()) return [];
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('ward_helper_pull_by_username', {
    p_username: username.trim(),
  });
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
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new Error('cloud restore: malformed bytea (expected base64 or \\xHEX)');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBase64(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  // A valid bytea hex stream must have an even number of nibbles. An odd
  // length means the payload is truncated — fail loudly rather than silently
  // drop the last half-byte.
  if (clean.length % 2 !== 0) {
    throw new Error('cloud restore: odd-length hex bytea (truncated payload)');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Canary helpers live in a sibling module (./canary) so they can call
// pushBlob / pullByUsername / pullAllBlobs through normal cross-module
// imports. That makes them mockable via `vi.mock('@/storage/cloud', ...)`
// in tests — lexical intra-module references would bypass the mock and
// the canary unit tests would silently call real Supabase.
//
// Public API contract is preserved: callers still
// `import { pushCanary, verifyCanary, CANARY_BLOB_ID } from '@/storage/cloud'`.
export { pushCanary, verifyCanary, verifyCanaryFromRows, CANARY_BLOB_ID } from '@/storage/canary';

