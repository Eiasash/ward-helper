import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase BEFORE the auth.ts import so the module-level getSupabase()
// resolves to our controlled stub. Each test reassigns rpcImpl / invokeImpl
// to drive the response shape.
let rpcImpl: (fn: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let invokeImpl: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: (fn: string, body: Record<string, unknown>) => rpcImpl(fn, body),
    functions: {
      invoke: (fn: string, opts: { body: unknown }) => invokeImpl(fn, opts),
    },
  })),
}));

import {
  authSetEmail,
  authRequestPasswordReset,
  authResetPasswordWithToken,
} from '@/auth/auth';

beforeEach(() => {
  // Default: every call rejects loudly so tests that forget to wire up
  // their own impl fail fast rather than passing on undefined data.
  rpcImpl = () => Promise.reject(new Error('rpcImpl not configured for this test'));
  invokeImpl = () => Promise.reject(new Error('invokeImpl not configured for this test'));
});

// ─────────────── authSetEmail ───────────────

describe('authSetEmail', () => {
  it('passes username/password/email to the auth_set_email RPC', async () => {
    const calls: Array<{ fn: string; body: Record<string, unknown> }> = [];
    rpcImpl = async (fn, body) => {
      calls.push({ fn, body });
      return { data: { ok: true, email: 'eias@example.com' }, error: null };
    };

    const res = await authSetEmail('eias', 'pwd123', 'EIAS@Example.com');
    expect(calls).toEqual([
      { fn: 'auth_set_email', body: { p_username: 'eias', p_password: 'pwd123', p_email: 'EIAS@Example.com' } },
    ]);
    // Server-normalized email (returned in `email`) is preserved on the result.
    expect(res.ok).toBe(true);
    expect(res.email).toBe('eias@example.com');
  });

  it('surfaces server error codes verbatim (invalid_credentials)', async () => {
    rpcImpl = async () => ({ data: { ok: false, error: 'invalid_credentials' }, error: null });
    const res = await authSetEmail('eias', 'wrong', 'eias@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_credentials');
  });

  it('surfaces email_taken from the server', async () => {
    rpcImpl = async () => ({ data: { ok: false, error: 'email_taken' }, error: null });
    const res = await authSetEmail('eias', 'pwd123', 'taken@example.com');
    expect(res).toEqual({ ok: false, error: 'email_taken' });
  });

  it('maps RPC-level errors to {ok: false, error: rpc_error}', async () => {
    rpcImpl = async () => ({ data: null, error: { message: 'connection refused' } });
    const res = await authSetEmail('eias', 'pwd123', 'eias@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rpc_error');
    expect(res.message).toBe('connection refused');
  });

  it('maps non-object responses to bad_response', async () => {
    rpcImpl = async () => ({ data: null, error: null });
    const res = await authSetEmail('eias', 'pwd123', 'eias@example.com');
    expect(res).toEqual({ ok: false, error: 'bad_response' });
  });

  it('maps thrown errors to {ok: false, error: network}', async () => {
    rpcImpl = async () => { throw new Error('fetch failed'); };
    const res = await authSetEmail('eias', 'pwd123', 'eias@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network');
    expect(res.message).toBe('fetch failed');
  });
});

// ─────────────── authRequestPasswordReset ───────────────

describe('authRequestPasswordReset', () => {
  it('invokes the send-password-reset Edge Function with {email} body', async () => {
    const calls: Array<{ fn: string; body: unknown }> = [];
    invokeImpl = async (fn, opts) => {
      calls.push({ fn, body: opts.body });
      return { data: { ok: true }, error: null };
    };

    const res = await authRequestPasswordReset('eias@example.com');
    expect(calls).toEqual([
      { fn: 'send-password-reset', body: { email: 'eias@example.com' } },
    ]);
    expect(res.ok).toBe(true);
  });

  it('returns ok:true when server reports no match (anti-enumeration)', async () => {
    // Edge Function never reveals whether email matched; always returns ok:true.
    invokeImpl = async () => ({ data: { ok: true }, error: null });
    const res = await authRequestPasswordReset('not-registered@example.com');
    expect(res).toEqual({ ok: true });
  });

  it('passes email_not_configured through verbatim', async () => {
    // Until RESEND_API_KEY is set on Supabase, the function returns 503 with
    // this code. The UI maps it to a clear admin-facing message.
    invokeImpl = async () => ({ data: { ok: false, error: 'email_not_configured' }, error: null });
    const res = await authRequestPasswordReset('eias@example.com');
    expect(res).toEqual({ ok: false, error: 'email_not_configured' });
  });

  it('maps Edge Function transport errors to function_error', async () => {
    invokeImpl = async () => ({ data: null, error: { message: 'function timed out' } });
    const res = await authRequestPasswordReset('eias@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('function_error');
    expect(res.message).toBe('function timed out');
  });

  it('maps non-object responses to bad_response', async () => {
    invokeImpl = async () => ({ data: 'unexpected string', error: null });
    const res = await authRequestPasswordReset('eias@example.com');
    expect(res.ok).toBe(false);
    // Non-object response (string) is bad_response, not the data verbatim.
    expect(res.error).toBe('bad_response');
  });

  it('maps thrown errors to network', async () => {
    invokeImpl = async () => { throw new TypeError('Failed to fetch'); };
    const res = await authRequestPasswordReset('eias@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network');
    expect(res.message).toBe('Failed to fetch');
  });
});

// ─────────────── authResetPasswordWithToken ───────────────

describe('authResetPasswordWithToken', () => {
  it('passes token + new_password to the auth_reset_password_with_token RPC', async () => {
    const calls: Array<{ fn: string; body: Record<string, unknown> }> = [];
    rpcImpl = async (fn, body) => {
      calls.push({ fn, body });
      return { data: { ok: true, username: 'eias' }, error: null };
    };

    const res = await authResetPasswordWithToken('abc-token-123', 'newpass');
    expect(calls).toEqual([
      {
        fn: 'auth_reset_password_with_token',
        body: { p_token: 'abc-token-123', p_new_password: 'newpass' },
      },
    ]);
    expect(res.ok).toBe(true);
    expect((res as { username?: string }).username).toBe('eias');
  });

  it('surfaces invalid_token verbatim (link broken/expired/used)', async () => {
    rpcImpl = async () => ({ data: { ok: false, error: 'invalid_token' }, error: null });
    const res = await authResetPasswordWithToken('bogus', 'newpass');
    expect(res).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('surfaces token_used (one-shot enforcement)', async () => {
    // Server marks the token as used_at on first successful reset; reusing
    // the same link returns this code.
    rpcImpl = async () => ({ data: { ok: false, error: 'token_used' }, error: null });
    const res = await authResetPasswordWithToken('reused', 'newpass');
    expect(res.error).toBe('token_used');
  });

  it('surfaces token_expired after the 24hr window', async () => {
    rpcImpl = async () => ({ data: { ok: false, error: 'token_expired' }, error: null });
    const res = await authResetPasswordWithToken('old', 'newpass');
    expect(res.error).toBe('token_expired');
  });

  it('surfaces weak_password from the server-side length gate', async () => {
    rpcImpl = async () => ({ data: { ok: false, error: 'weak_password' }, error: null });
    const res = await authResetPasswordWithToken('valid-token', 'short');
    expect(res.error).toBe('weak_password');
  });

  it('maps thrown errors to network', async () => {
    rpcImpl = async () => { throw new Error('socket hang up'); };
    const res = await authResetPasswordWithToken('valid-token', 'newpass');
    expect(res.error).toBe('network');
  });
});
