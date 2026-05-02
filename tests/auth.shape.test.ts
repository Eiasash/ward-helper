import { describe, it, expect, vi, beforeEach } from 'vitest';

// See tests/auth.passwordRecovery.test.ts for the mock pattern. Reassign
// rpcImpl per test to control the response shape.
let rpcImpl: (fn: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: (fn: string, body: Record<string, unknown>) => rpcImpl(fn, body),
    functions: { invoke: vi.fn() },
  })),
}));

import { authLogin, authRegister } from '@/auth/auth';

beforeEach(() => {
  rpcImpl = () => Promise.reject(new Error('rpcImpl not configured for this test'));
});

// ─────────── Server response-shape normalization ───────────
//
// The shared SQL RPCs `auth_login_user` and `auth_register_user` return
// the success shape FLAT — `{ok: true, username, display_name}` — not
// nested under `user`. The client `RpcResult` interface declares `user`
// as the canonical place. Without normalization, every successful auth
// silently fell through `if (res.ok && res.user)` to the error branch
// and the user saw bare 'שגיאה' even though the server had logged them
// in. Regression bug observed 2026-05-02. These tests pin the contract.

describe('authLogin — server response shape normalization', () => {
  it('wraps flat {ok, username, display_name} into {ok, user: {...}}', async () => {
    rpcImpl = async () => ({
      data: { ok: true, username: 'eiasashhab55555', display_name: 'eiasss' },
      error: null,
    });
    const res = await authLogin('eiasashhab55555', 'pwd');
    expect(res.ok).toBe(true);
    expect(res.user).toEqual({ username: 'eiasashhab55555', display_name: 'eiasss' });
  });

  it('preserves an already-nested {ok, user: {...}} shape unchanged', async () => {
    // Defensive: if the SQL RPC is ever updated to nest, the normalizer is a no-op.
    rpcImpl = async () => ({
      data: { ok: true, user: { username: 'eiasashhab55555', display_name: 'eiasss' } },
      error: null,
    });
    const res = await authLogin('eiasashhab55555', 'pwd');
    expect(res.user).toEqual({ username: 'eiasashhab55555', display_name: 'eiasss' });
  });

  it('coerces missing display_name to null when synthesizing user', async () => {
    rpcImpl = async () => ({
      data: { ok: true, username: 'someone' /* display_name absent */ },
      error: null,
    });
    const res = await authLogin('someone', 'pwd');
    expect(res.user).toEqual({ username: 'someone', display_name: null });
  });

  it('does NOT synthesize a user object when ok=false (failure path is unaffected)', async () => {
    rpcImpl = async () => ({
      data: { ok: false, error: 'invalid_credentials', message: 'Invalid username or password' },
      error: null,
    });
    const res = await authLogin('eiasashhab55555', 'wrong');
    expect(res.ok).toBe(false);
    expect(res.user).toBeUndefined();
    expect(res.error).toBe('invalid_credentials');
    expect(res.message).toBe('Invalid username or password');
  });
});

describe('authRegister — server response shape normalization', () => {
  it('wraps flat {ok, username, display_name} into {ok, user: {...}}', async () => {
    rpcImpl = async () => ({
      data: { ok: true, username: 'newuser', display_name: 'New User' },
      error: null,
    });
    const res = await authRegister('newuser', 'pwd123', 'New User');
    expect(res.ok).toBe(true);
    expect(res.user).toEqual({ username: 'newuser', display_name: 'New User' });
  });

  it('passes username_taken (server failure) through unchanged', async () => {
    rpcImpl = async () => ({
      data: { ok: false, error: 'username_taken', message: 'This username is already in use' },
      error: null,
    });
    const res = await authRegister('eiasashhab55555', 'pwd123');
    expect(res.ok).toBe(false);
    expect(res.user).toBeUndefined();
    expect(res.error).toBe('username_taken');
    expect(res.message).toBe('This username is already in use');
  });
});
