/**
 * Cloud-delete primitives — closes the orphaned-PHI gap where deleting a
 * note left its AES-GCM ciphertext in ward_helper_backup forever.
 *
 * Covers the client side of migration 0009:
 *   - deleteBlob: same-device path. `.from().delete().match({blob_type,
 *     blob_id})`, scoped to auth.uid by RLS. Best-effort: returns a status,
 *     never throws.
 *   - deleteByUsername: cross-device path. Calls the SECURITY DEFINER RPC
 *     ward_helper_delete_v2 with (p_token, p_blob_type,
 *     p_blob_id). Blank usernames are 'skipped' without hitting the network.
 *
 * Mirrors the mock harness in cloud-username-bridge.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setAuthSession, getCloudSessionToken } from '@/auth/auth';

const h = vi.hoisted(() => ({
  deleteSpy: vi.fn(),
  matchSpy: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'anon-1' } } } })),
      signInAnonymously: vi.fn(async () => ({ data: { user: { id: 'anon-1' } }, error: null })),
    },
    // `.from('...').delete().match(...)` — delete() returns a thenable-ish
    // builder whose .match() resolves to { error }. We capture both the
    // delete() invocation and the .match() args.
    from: vi.fn(() => ({
      delete: (...dArgs: unknown[]) => {
        h.deleteSpy(...dArgs);
        return { match: (...mArgs: unknown[]) => h.matchSpy(...mArgs) };
      },
    })),
    rpc: (...args: unknown[]) => h.rpcSpy(...args),
  })),
}));

import { deleteBlob, deleteByUsername } from '@/storage/cloud';

beforeEach(() => {
  localStorage.clear();
  setAuthSession('eias', null, 'login', 'test-session-token');
  h.deleteSpy.mockReset();
  h.matchSpy.mockReset();
  h.matchSpy.mockImplementation(async () => ({ error: null }));
  h.rpcSpy.mockReset();
  h.rpcSpy.mockImplementation(async () => ({ data: 1, error: null }));
});

describe('deleteBlob — same-device auth.uid-scoped delete', () => {
  it('issues delete().match() with blob_type + blob_id and returns "deleted"', async () => {
    const status = await deleteBlob('note', 'n-id-1');
    expect(h.deleteSpy).toHaveBeenCalledTimes(1);
    expect(h.matchSpy).toHaveBeenCalledTimes(1);
    // RLS scopes by auth.uid — no explicit user_id in the match.
    expect(h.matchSpy).toHaveBeenCalledWith({ blob_type: 'note', blob_id: 'n-id-1' });
    expect(status).toBe('deleted');
  });

  it('returns "error" (does NOT throw) when supabase reports an error', async () => {
    h.matchSpy.mockImplementationOnce(async () => ({ error: new Error('PGRST301: rls denied') }));
    const status = await deleteBlob('note', 'n-id-2');
    expect(status).toBe('error');
  });

  it('returns "error" (does NOT throw) when the call rejects', async () => {
    h.matchSpy.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    await expect(deleteBlob('note', 'n-id-3')).resolves.toBe('error');
  });

  it('works for the other blob types it must serve', async () => {
    await deleteBlob('patient', 'p-1');
    expect(h.matchSpy).toHaveBeenCalledWith({ blob_type: 'patient', blob_id: 'p-1' });
  });
});

describe('deleteByUsername — cross-device SECURITY DEFINER RPC delete', () => {
  it('calls ward_helper_delete_v2 with the 3 params and returns "deleted"', async () => {
    const status = await deleteByUsername('note', 'n-id-1', 'eias');
    expect(h.rpcSpy).toHaveBeenCalledTimes(1);
    expect(h.rpcSpy).toHaveBeenCalledWith('ward_helper_delete_v2', {
      p_token: 'test-session-token',
      p_blob_type: 'note',
      p_blob_id: 'n-id-1',
    });
    expect(status).toBe('deleted');
  });

  it('trims the username before calling the RPC', async () => {
    await deleteByUsername('note', 'n-id-2', '  eias  ');
    expect(h.rpcSpy).toHaveBeenCalledWith('ward_helper_delete_v2', {
      p_token: 'test-session-token',
      p_blob_type: 'note',
      p_blob_id: 'n-id-2',
    });
  });

  it('returns "skipped" without hitting the RPC for empty username', async () => {
    expect(await deleteByUsername('note', 'n-id-3', '')).toBe('skipped');
    expect(h.rpcSpy).not.toHaveBeenCalled();
  });

  it('returns "skipped" without hitting the RPC for whitespace-only username', async () => {
    expect(await deleteByUsername('note', 'n-id-4', '   ')).toBe('skipped');
    expect(h.rpcSpy).not.toHaveBeenCalled();
  });

  it('returns "error" (does NOT throw) when the RPC reports an error', async () => {
    h.rpcSpy.mockImplementationOnce(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));
    const status = await deleteByUsername('note', 'n-id-5', 'eias');
    expect(status).toBe('error');
  });

  it('returns "error" (does NOT throw) when the RPC call rejects', async () => {
    h.rpcSpy.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    await expect(deleteByUsername('note', 'n-id-6', 'eias')).resolves.toBe('error');
  });
});


describe('delete session boundary and rollout fallback', () => {
  it.each([
    { status: 404, code: '' },
    { status: 400, code: 'PGRST202' },
    { status: 400, code: '42883' },
  ])('falls back only for missing function: %j', async ({ status, code }) => {
    h.rpcSpy.mockResolvedValueOnce({ status, error: { code } });
    expect(await deleteByUsername('note', 'n1', 'eias')).toBe('deleted');
    expect(h.rpcSpy).toHaveBeenCalledTimes(2);
    expect(h.rpcSpy).toHaveBeenLastCalledWith('ward_helper_delete_by_username', {
      p_username: 'eias', p_blob_type: 'note', p_blob_id: 'n1',
    });
  });

  it.each([
    { status: 401, code: '28000' },
    { status: 403, code: '42501' },
    { status: 500, code: 'XX000' },
    { status: 0, code: '' },
    // An authentication rejection must outrank an inconsistent HTTP 404.
    { status: 404, code: '28000' },
  ])('never downgrades other failures: %j', async ({ status, code }) => {
    h.rpcSpy.mockResolvedValueOnce({ status, error: { code } });
    expect(await deleteByUsername('note', 'n1', 'eias')).toBe('error');
    expect(h.rpcSpy).toHaveBeenCalledTimes(1);
    expect(getCloudSessionToken('eias')).toBe(code === '28000' ? null : 'test-session-token');
  });

  it('requires a matching session before attempting either RPC', async () => {
    expect(await deleteByUsername('note', 'n1', 'other-user')).toBe('error');
    setAuthSession('eias');
    expect(await deleteByUsername('note', 'n1', 'eias')).toBe('error');
    expect(h.rpcSpy).not.toHaveBeenCalled();
  });

  it('returns error if the legacy fallback also fails', async () => {
    h.rpcSpy.mockResolvedValueOnce({ status: 404, error: { code: 'PGRST202' } });
    h.rpcSpy.mockResolvedValueOnce({ error: { code: '42501' } });
    expect(await deleteByUsername('note', 'n1', 'eias')).toBe('error');
  });

  it('does not fall back after the account changes in flight', async () => {
    h.rpcSpy.mockImplementationOnce(async () => {
      setAuthSession('other-user', null, 'login', 'other-session');
      return { status: 404, error: { code: 'PGRST202' } };
    });
    expect(await deleteByUsername('note', 'n1', 'eias')).toBe('error');
    expect(h.rpcSpy).toHaveBeenCalledTimes(1);
  });
});
