/**
 * Lightweight username/password auth for ward-helper.
 *
 * Reuses the shared Supabase auth_register_user / auth_login_user /
 * auth_change_password RPCs (bcrypt via pgcrypto, RLS-enabled-no-policies on
 * app_users so direct table access is denied even with the publishable key).
 * One account works across Mishpacha + Pnimit + Geri + ward-helper — same
 * Supabase project (krmlzwwelqvlfslwltol), same `app_users` table.
 *
 * Why ward-helper has auth (post-ADR-001 reversal, 2026-04-29):
 *   - Cross-device clinical workflow consistency: log in on phone at SZMC,
 *     pick up on tablet/desktop. Cloud sync of IndexedDB is NOT shipped yet
 *     — this lays the groundwork.
 *   - Visual consistency with the three study PWAs (same Settings UX).
 *   - Future audit trail for clinical actions (when cloud sync ships).
 *
 * What auth does NOT do today:
 *   - It does not gate any clinical functionality. Logged-out (guest)
 *     usage is fully supported and is the default experience.
 *   - It does not yet sync IndexedDB to Supabase. Notes still live on-device
 *     only. Cloud sync is a separate future ticket.
 *
 * Storage keys (under the ward-helper namespace):
 *   - ward-helper.auth.user   — the auth profile JSON
 *   - ward-helper.auth.uid    — unified user id (username when authed, random per-device for guests)
 *   - ward-helper.auth.devid  — device id, used in future cloud-backup writes
 *
 * Subscribe to auth state changes by listening for the 'ward-helper:auth'
 * window event. The useAuth() hook handles this for React consumers.
 */

import { getSupabase } from '@/storage/cloud';

const AUTH_LS_KEY = 'ward-helper.auth.user';
const UID_LS_KEY = 'ward-helper.auth.uid';
const DEV_LS_KEY = 'ward-helper.auth.devid';

/** Username pattern — same as the other 3 PWAs to keep accounts portable. */
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export interface AuthUser {
  username: string;
  displayName: string | null;
  loggedInAt: number;
}

/** Result shape of the three RPCs. */
export interface RpcResult {
  ok: boolean;
  /** Present when ok=true, returned by auth_register_user / auth_login_user. */
  user?: { username: string; display_name: string | null };
  /** Present when ok=false. Examples: 'invalid_username', 'invalid_password', 'username_taken', 'locked_out', 'http_500'. */
  error?: string;
  /** Optional human-readable message; safe to surface verbatim. */
  message?: string;
}

// ───────────────────────────── state ─────────────────────────────

export function getCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.username !== 'string') return null;
    if (!USERNAME_RE.test(parsed.username)) return null;
    return {
      username: parsed.username,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
      loggedInAt: typeof parsed.loggedInAt === 'number' ? parsed.loggedInAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!getCurrentUser();
}

/**
 * Unified user identifier — username when authed, else a stable random
 * per-device id. Future cloud-backup writes will key on this.
 */
export function getUserId(): string {
  const user = getCurrentUser();
  if (user) return user.username;
  let id = localStorage.getItem(UID_LS_KEY);
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(UID_LS_KEY, id);
  }
  return id;
}

/** Stable per-device id (separate from UID — survives logout for backup attribution). */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEV_LS_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(DEV_LS_KEY, id);
  }
  return id;
}

// ───────────────────────── RPC plumbing ─────────────────────────

async function _rpc(fn: string, body: Record<string, unknown>): Promise<RpcResult> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc(fn, body);
    if (error) {
      return { ok: false, error: 'rpc_error', message: error.message };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'bad_response' };
    }
    return data as RpcResult;
  } catch (e) {
    return {
      ok: false,
      error: 'network',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ───────────────────── auth actions (programmatic) ─────────────────────

export async function authRegister(
  username: string,
  password: string,
  displayName?: string | null,
): Promise<RpcResult> {
  return _rpc('auth_register_user', {
    p_username: username,
    p_password: password,
    p_display_name: displayName ?? null,
  });
}

export async function authLogin(username: string, password: string): Promise<RpcResult> {
  return _rpc('auth_login_user', {
    p_username: username,
    p_password: password,
  });
}

export async function authChangePassword(
  username: string,
  oldPwd: string,
  newPwd: string,
): Promise<RpcResult> {
  return _rpc('auth_change_password', {
    p_username: username,
    p_old_password: oldPwd,
    p_new_password: newPwd,
  });
}

/**
 * Persist a successful auth result. Caller must invoke only after `result.ok`.
 * Fires 'ward-helper:auth' so subscribers (HeaderStrip, useAuth hook) refresh.
 *
 * The optional `action` argument lets callers tell downstream listeners
 * whether this was a fresh login or a register — useful for the
 * post-login restore prompt (we only want to suggest a cloud restore on
 * login, never on register: a brand-new account has no cloud data yet).
 * Defaults to 'unknown' for back-compat with existing callers.
 */
export function setAuthSession(
  username: string,
  displayName?: string | null,
  action: AuthChangeAction = 'unknown',
): AuthUser {
  const profile: AuthUser = {
    username,
    displayName: displayName ?? null,
    loggedInAt: Date.now(),
  };
  localStorage.setItem(AUTH_LS_KEY, JSON.stringify(profile));
  // Logged-in username takes over as the unified uid. Future cloud-backup
  // writes will key on this — the user's notes will follow them between
  // devices once sync ships.
  localStorage.setItem(UID_LS_KEY, username);
  notifyAuthChanged(action);
  return profile;
}

/**
 * Clear the auth profile and regenerate fresh guest IDs. The old guest uid
 * is dropped so no data is silently shared between accounts on the same
 * device.
 */
export function logout(): void {
  localStorage.removeItem(AUTH_LS_KEY);
  // Fresh random uid; do NOT reuse a prior guest uid.
  localStorage.setItem(UID_LS_KEY, 'u' + Math.random().toString(36).slice(2, 10));
  // And fresh device id, so any future cloud-backup writes don't accidentally
  // attach to the previous account's row.
  localStorage.setItem(DEV_LS_KEY, 'dev_' + Math.random().toString(36).slice(2, 12));
  notifyAuthChanged('logout');
}

// ───────────────────── change events ─────────────────────

const AUTH_CHANGE_EVENT = 'ward-helper:auth';

/**
 * Discriminator on the `ward-helper:auth` CustomEvent.detail.
 *   - 'login'           — successful login via authLogin
 *   - 'register'        — successful registration via authRegister
 *   - 'logout'          — explicit logout()
 *   - 'change-password' — password rotation (session preserved)
 *   - 'unknown'         — programmatic setAuthSession with no action arg
 *                         (back-compat fallback)
 *
 * Listeners that don't care about the cause can ignore the arg; the
 * subscribeAuthChanges handler signature accepts a unary fn but is
 * tolerant of nullary fns thanks to JS's lenient arity contract.
 */
export type AuthChangeAction =
  | 'login'
  | 'register'
  | 'logout'
  | 'change-password'
  | 'unknown';

export interface AuthChangeDetail {
  action: AuthChangeAction;
}

export function notifyAuthChanged(action: AuthChangeAction = 'unknown'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AuthChangeDetail>(AUTH_CHANGE_EVENT, {
      detail: { action },
    }),
  );
}

export function subscribeAuthChanges(
  handler: (action: AuthChangeAction) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapper = (e: Event) => {
    // Defensive: any event without a detail (or with a malformed one) maps to
    // 'unknown'. Keeps existing test code that constructs raw Events working.
    const detail = (e as CustomEvent<AuthChangeDetail>).detail;
    handler(detail?.action ?? 'unknown');
  };
  window.addEventListener(AUTH_CHANGE_EVENT, wrapper);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, wrapper);
}

// ───────────────────── validation helpers (pre-RPC) ─────────────────────

export function validateUsername(username: string): string | null {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) return 'נדרש שם משתמש';
  if (!USERNAME_RE.test(trimmed))
    return 'שם משתמש: 3-32 תווים, אנגלית קטנה + מספרים + מקפים, מתחיל באות/ספרה';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'נדרשת סיסמה';
  if (password.length < 6) return 'סיסמה: לפחות 6 תווים';
  return null;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
