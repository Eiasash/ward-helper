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
import { reencryptUnlockCache } from '@/crypto/unlock';
// ESM cycle with @/notes/save — save.ts imports getCurrentUser +
// getLastLoginPasswordOrNull from this module. Both directions are runtime
// function refs only, NEVER invoked at module-eval time. Adding a top-level
// call to either side will trigger TDZ on the cycle binding — relocate it.
import { resetCanaryArmed } from '@/notes/save';

const AUTH_LS_KEY = 'ward-helper.auth.user';
const UID_LS_KEY = 'ward-helper.auth.uid';
const DEV_LS_KEY = 'ward-helper.auth.devid';

// In-memory + IDB-persisted stash of the user's login password. v1.35.0+ uses
// it as the cloud encryption key — without persistence, every page reload
// broke cloud backup until logout/login. Persistence uses XOR with the
// deviceSecret (same posture as apiKeyXor): protects against casual IDB
// inspection / backup-tool sweeps; a determined attacker with same-profile
// devtools recovers it. The trade-off is acceptable because PHI is already
// in IDB plaintext — adding the login password doesn't widen the attack
// surface beyond what's already there.
let _lastLoginPassword: string | null = null;

export function stashLastLoginPassword(p: string): void {
  _lastLoginPassword = p;
}
export function getLastLoginPasswordOrNull(): string | null {
  return _lastLoginPassword;
}
export function clearLastLoginPassword(): void {
  _lastLoginPassword = null;
}

/**
 * Write the login password to IDB (XOR-obfuscated). Called after a successful
 * authLogin so the next page reload can resume cloud backup without forcing
 * the user to re-authenticate.
 */
export async function persistLoginPassword(p: string): Promise<void> {
  // Lazy-loaded IDB + xor — keeps the auth.ts entry-chunk weight down for
  // guests who never trigger any of this.
  const [{ getSettings, setSettings }, { xorEncrypt, generateDeviceSecret }] =
    await Promise.all([
      import('@/storage/indexed'),
      import('@/crypto/xor'),
    ]);
  const existing = await getSettings();
  const deviceSecret = existing?.deviceSecret ?? generateDeviceSecret();
  const loginPwdXor = xorEncrypt(p, deviceSecret);
  await setSettings({
    apiKeyXor: existing?.apiKeyXor ?? new Uint8Array(0),
    deviceSecret,
    lastPassphraseAuthAt: existing?.lastPassphraseAuthAt ?? null,
    prefs: existing?.prefs ?? {},
    cachedUnlockBlob: existing?.cachedUnlockBlob ?? null,
    loginPwdXor,
  });
}

/**
 * Read the persisted login password from IDB and stash it in memory. Called
 * at app boot for the auth-session-resume path. Returns the password (also
 * stashed) or null if none persisted / read failed.
 */
export async function loadPersistedLoginPassword(): Promise<string | null> {
  try {
    const [{ getSettings }, { xorDecrypt }] = await Promise.all([
      import('@/storage/indexed'),
      import('@/crypto/xor'),
    ]);
    const s = await getSettings();
    if (!s?.loginPwdXor || s.loginPwdXor.length === 0) return null;
    const p = xorDecrypt(s.loginPwdXor, s.deviceSecret);
    _lastLoginPassword = p;
    return p;
  } catch {
    return null;
  }
}

/** Wipe the persisted copy. Called on logout. */
export async function clearPersistedLoginPassword(): Promise<void> {
  try {
    const { getSettings, setSettings } = await import('@/storage/indexed');
    const s = await getSettings();
    if (!s) return;
    await setSettings({ ...s, loginPwdXor: null });
  } catch {
    // Worst case: stale persisted password. Next login overwrites it.
  }
}

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
  /**
   * Personal Anthropic API key, returned by auth_login_user when the user has
   * one set server-side (auth_set_api_key RPC). Mirrors shlav-a-mega's pattern
   * (samega_apikey + login response field). When present, the AccountSection
   * login flow stamps it into localStorage `wardhelper_apikey` so the BYOK
   * path is active immediately on a fresh device login.
   */
  api_key?: string | null;
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
    const sb = await getSupabase();
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

/**
 * Server-side `auth_register_user` and `auth_login_user` return the success
 * shape FLAT — `{ok: true, username, display_name}` — not nested under
 * `user`. The RPCs are shared across Geri/IM/FM/ward-helper so we can't
 * change the server shape without coordinating across all four apps.
 *
 * This normalizer wraps the flat shape into `{ok: true, user: {...}}` so
 * the rest of the client (which type-checks against `RpcResult.user`) sees
 * a consistent shape regardless of whether the RPC was updated to nest the
 * fields. If the server ever does start returning nested, this is a no-op.
 *
 * Without this, every successful login/register silently fell through to
 * the `errorMessage(undefined, undefined)` → bare 'שגיאה' branch — the
 * server marked the user logged in (last_login updated) while the client
 * never called setAuthSession. Bug observed 2026-05-02 across the entire
 * auth history of the app.
 */
function normalizeUserShape(res: RpcResult & Record<string, unknown>): RpcResult {
  let next: RpcResult = res;
  if (res.ok && !res.user && typeof res.username === 'string') {
    next = {
      ...res,
      user: {
        username: res.username,
        display_name: typeof res.display_name === 'string' ? res.display_name : null,
      },
    };
  }
  // Server may return api_key flat or nested. Surface it at the top level
  // either way so callers don't have to dig — same idea as the user.username
  // flattening above. Empty/undefined → field stays absent.
  if (next.ok && next.api_key === undefined && typeof res.api_key === 'string') {
    next = { ...next, api_key: res.api_key };
  }
  return next;
}

/**
 * Push the api_key from a login RPC response into localStorage so the BYOK
 * path is active on the very next callClaude call. Empty/null/whitespace
 * value clears the localStorage entry — server is the source of truth.
 *
 * Called from authLogin's success path. Idempotent.
 */
function applyApiKeyFromLoginResponse(api_key: string | null | undefined): void {
  if (typeof localStorage === 'undefined') return;
  if (typeof api_key === 'string' && api_key.trim()) {
    localStorage.setItem('wardhelper_apikey', api_key.trim());
  } else if (api_key === '' || api_key === null) {
    localStorage.removeItem('wardhelper_apikey');
  }
  // api_key === undefined: server didn't return the field on this login —
  // don't disturb whatever the client already has. Older deployments of the
  // shared RPC predate the api_key column.
}

export async function authRegister(
  username: string,
  password: string,
  displayName?: string | null,
): Promise<RpcResult> {
  const res = await _rpc('auth_register_user', {
    p_username: username,
    p_password: password,
    p_display_name: displayName ?? null,
  });
  return normalizeUserShape(res as RpcResult & Record<string, unknown>);
}

export async function authLogin(username: string, password: string): Promise<RpcResult> {
  const res = await _rpc('auth_login_user', {
    p_username: username,
    p_password: password,
  });
  const normalized = normalizeUserShape(res as RpcResult & Record<string, unknown>);
  if (normalized.ok) {
    applyApiKeyFromLoginResponse(normalized.api_key);
  }
  return normalized;
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
 * Persist the user's personal Anthropic API key server-side via the shared
 * `auth_set_api_key` RPC (defined in the Toranot Supabase project, mirrors
 * shlav-a-mega's setter). The server stores the key on the app_users row
 * and surfaces it back via `api_key` on subsequent auth_login_user calls,
 * which is how a fresh device gets the key without depending on cloud
 * blob restore. Sensitive op — re-prompts for the current password.
 *
 * Pass an empty string to clear the server-side copy. Local localStorage
 * cleanup is the caller's responsibility.
 */
export async function authSetApiKey(
  username: string,
  password: string,
  apiKey: string,
): Promise<RpcResult> {
  return _rpc('auth_set_api_key', {
    p_username: username,
    p_password: password,
    p_api_key: apiKey,
  });
}

/**
 * Change the user's login password AND re-encrypt the cached unlock blob with
 * the new password — so the user's auto-unlock keeps working after the change.
 * Without the re-encrypt step, the user would silently lose their auto-unlock
 * and have to retype the backup passphrase on next login.
 */
export async function changePasswordWithReencrypt(
  username: string,
  oldPwd: string,
  newPwd: string,
): Promise<RpcResult> {
  const result = await authChangePassword(username, oldPwd, newPwd);
  if (result.ok) {
    await reencryptUnlockCache(oldPwd, newPwd);
  }
  return result;
}

// ───────── Password recovery (Tier 2, 2026-05-02) ─────────

/** Result shape for set-email RPC. Includes `email` on success (normalized). */
export interface SetEmailResult extends RpcResult {
  email?: string;
}

/**
 * Set or update the email on an existing account. The user must re-enter
 * their current password — this is a sensitive operation that gates the
 * password-recovery channel.
 *
 * Error codes: missing_field, invalid_email, invalid_credentials, email_taken
 */
export async function authSetEmail(
  username: string,
  password: string,
  email: string,
): Promise<SetEmailResult> {
  return _rpc('auth_set_email', {
    p_username: username,
    p_password: password,
    p_email: email,
  }) as Promise<SetEmailResult>;
}

/**
 * Request a password-reset email. The Edge Function `send-password-reset`
 * applies anti-enumeration: it returns ok=true regardless of whether the
 * email matches a known account, only sending mail when matched. The client
 * should always show the same "check your email" confirmation — never
 * "we don't know that email."
 *
 * Error codes (ok=false): function_error, bad_response, invalid_email,
 *   invalid_json, email_not_configured, email_send_failed, network.
 */
export async function authRequestPasswordReset(
  email: string,
): Promise<RpcResult> {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.functions.invoke('send-password-reset', {
      body: { email },
    });
    if (error) {
      return { ok: false, error: 'function_error', message: error.message };
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

/**
 * Apply a new password using the token from a password-reset email link.
 *
 * Error codes: missing_field, weak_password, invalid_token, token_used,
 *   token_expired
 */
export async function authResetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<RpcResult> {
  return _rpc('auth_reset_password_with_token', {
    p_token: token,
    p_new_password: newPassword,
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
 * Clear the auth profile, password stashes, canary state, and regenerate
 * fresh guest IDs. The old guest uid is dropped so no data is silently
 * shared between accounts on the same device.
 *
 * v1.36.1: clearLastLoginPassword + clearPersistedLoginPassword + resetCanaryArmed
 * are all called from INSIDE logout (was previously: caller-orchestrated in
 * AccountSection.tsx). Defensive: any future logout entry point (auto-logout,
 * switch-user, session-expiry) inherits the full cleanup automatically — no
 * one can forget a step. Same shape as the resetCanaryArmed wire-in from #69.
 *
 * Async because clearPersistedLoginPassword is async (writes to IDB). Sync
 * callers that don't await still get all the synchronous portions
 * (in-memory clear, localStorage clear, canary reset, notification) before
 * the function returns its Promise — only the IDB clear continues in the
 * background. Awaiting callers (e.g. tests) get full completion.
 */
export async function logout(): Promise<void> {
  // All synchronous cleanup happens FIRST so callers that don't await still
  // see the full sync state transition (memory cleared, localStorage rotated,
  // canary reset, listeners notified) in the same tick. Pre-v1.36.1, the IDB
  // clear was a fire-and-forget `void clearPersistedLoginPassword()` in
  // AccountSection, so the notification fired before the IDB clear completed
  // anyway — preserving that ordering keeps existing listeners well-behaved.
  clearLastLoginPassword();
  // Cross-user safety: the canary-armed flag is a JS module global and
  // survives logout/login on the same tab. Without this reset, user B
  // logging in after user A on the same device skips their first canary
  // push, regressing into the pre-v1.36.0 state where wrong-password
  // attempts silently bulk-skip on the next fresh-device restore.
  resetCanaryArmed();
  // Same cross-user concern for the personal Anthropic key — A's key
  // must not bleed into B's session. Next login rehydrates from the
  // auth_login_user response if B has one set server-side.
  try {
    localStorage.removeItem('wardhelper_apikey');
  } catch {
    // ignore — DOM not available (test env, SSR)
  }
  localStorage.removeItem(AUTH_LS_KEY);
  // Fresh random uid; do NOT reuse a prior guest uid.
  localStorage.setItem(UID_LS_KEY, 'u' + Math.random().toString(36).slice(2, 10));
  // And fresh device id, so any future cloud-backup writes don't accidentally
  // attach to the previous account's row.
  localStorage.setItem(DEV_LS_KEY, 'dev_' + Math.random().toString(36).slice(2, 12));
  notifyAuthChanged('logout');
  // IDB clear is the only async step. Awaiting callers (e.g. tests asserting
  // post-logout IDB state) get full completion; fire-and-forget callers just
  // get the IDB clear queued — that matches the pre-v1.36.1 production
  // semantics from AccountSection.
  try {
    await clearPersistedLoginPassword();
  } catch {
    // Best-effort — IDB clear failure is non-fatal. Next login overwrites
    // the stash anyway.
  }
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
