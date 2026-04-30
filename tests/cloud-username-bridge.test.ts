/**
 * Cloud sync — option-2 hybrid bridge wiring tests.
 *
 * These cover the client side of migration 0003
 * (`ward_helper_backup.username` column + `ward_helper_pull_by_username` RPC).
 *
 * Server-side (already verified live in PR #29):
 *   - Column exists, partial index created, RPC SECURITY DEFINER, GRANT
 *     EXECUTE on anon + authenticated.
 *
 * Client side (this file):
 *   - pushBlob with a username string lands `username` in the upsert row.
 *   - pushBlob without a username (guest) does NOT include `username` —
 *     the column stays null.
 *   - Empty / whitespace usernames are coerced to "no username", never
 *     a literal '' (which would group all empties under one bucket).
 *   - pullByUsername calls the correct RPC name with `p_username` param.
 *   - pullByUsername returns `[]` for empty/blank input without hitting
 *     the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories run BEFORE module-level const declarations, so we need
// vi.hoisted to declare the spies in a way the factory can see. Without
// this, the factory closes over `undefined` and assertions fail with
// "spy not called".
const h = vi.hoisted(() => ({
  upsertSpy: vi.fn(),
  rpcSpy: vi.fn(),
  MOCK_RPC_ROWS: { current: [] as unknown[] },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'anon-1' } } } })),
      signInAnonymously: vi.fn(async () => ({ data: { user: { id: 'anon-1' } }, error: null })),
    },
    // `from()` returns a fresh object each call → closes over h.upsertSpy
    // at invocation time, picks up the latest beforeEach replacement.
    from: vi.fn(() => ({
      upsert: (...args: unknown[]) => h.upsertSpy(...args),
    })),
    // `rpc` is read once at createClient time. Wrap in an arrow that
    // forwards to the live spy reference instead of capturing it.
    rpc: (...args: unknown[]) => h.rpcSpy(...args),
  })),
}));

import { pushBlob, pullByUsername } from '@/storage/cloud';

beforeEach(() => {
  h.upsertSpy.mockReset();
  h.upsertSpy.mockImplementation(async () => ({ error: null }));
  h.rpcSpy.mockReset();
  h.rpcSpy.mockImplementation(async () => ({ data: h.MOCK_RPC_ROWS.current, error: null }));
  h.MOCK_RPC_ROWS.current = [];
});

const sealed = {
  ciphertext: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>,
  iv: new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>,
  salt: new Uint8Array([7, 8, 9]) as Uint8Array<ArrayBuffer>,
};

describe('pushBlob — username column wiring', () => {
  it('includes username in the upsert when authed', async () => {
    await pushBlob('patient', 'p-id-1', sealed, 'eias');
    expect(h.upsertSpy).toHaveBeenCalledTimes(1);
    const [row, opts] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>, unknown];
    expect(row.username).toBe('eias');
    expect(row.user_id).toBe('anon-1');
    expect(row.blob_type).toBe('patient');
    expect(row.blob_id).toBe('p-id-1');
    // onConflict key did NOT change — backward compat with the existing
    // 20-row dataset that has no username.
    expect(opts).toEqual({ onConflict: 'user_id,blob_type,blob_id' });
  });

  it('omits username entirely when guest (null)', async () => {
    await pushBlob('note', 'n-id-1', sealed, null);
    const [row] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>];
    // Critical: not present, not '' — absent. Letting null land would set
    // the column to NULL on conflict, but since this is an INSERT for a
    // brand-new (user_id, blob_type, blob_id), absence means the column
    // takes its default (NULL). Both are fine; absence is cleaner.
    expect('username' in row).toBe(false);
  });

  it('omits username entirely when caller passes undefined (default)', async () => {
    await pushBlob('note', 'n-id-2', sealed);
    const [row] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>];
    expect('username' in row).toBe(false);
  });

  it('coerces empty string to absent — never lets "" group rows', async () => {
    await pushBlob('patient', 'p-id-3', sealed, '');
    const [row] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>];
    expect('username' in row).toBe(false);
  });

  it('coerces whitespace-only string to absent', async () => {
    await pushBlob('patient', 'p-id-4', sealed, '   ');
    const [row] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>];
    expect('username' in row).toBe(false);
  });

  it('trims surrounding whitespace from real usernames', async () => {
    await pushBlob('patient', 'p-id-5', sealed, '  eias  ');
    const [row] = h.upsertSpy.mock.calls[0]! as [Record<string, unknown>];
    expect(row.username).toBe('eias');
  });

  it('throws on supabase error so caller catch-block surfaces it', async () => {
    h.upsertSpy.mockImplementationOnce(async () => ({ error: new Error('PGRST205: relation missing') }));
    await expect(pushBlob('patient', 'p-id-6', sealed, 'eias')).rejects.toThrow(/PGRST205/);
  });
});

describe('pullByUsername — cross-device pull RPC', () => {
  it('calls the migration-0003 RPC with p_username param', async () => {
    h.MOCK_RPC_ROWS.current = [
      {
        blob_type: 'patient',
        blob_id: 'p1',
        ciphertext: 'AAA=',
        iv: 'AAA=',
        salt: 'AAA=',
        updated_at: '2026-04-30T00:00:00Z',
      },
    ];
    const rows = await pullByUsername('eias');
    expect(h.rpcSpy).toHaveBeenCalledTimes(1);
    expect(h.rpcSpy).toHaveBeenCalledWith('ward_helper_pull_by_username', {
      p_username: 'eias',
    });
    expect(rows).toHaveLength(1);
    expect((rows[0] as { blob_id: string }).blob_id).toBe('p1');
  });

  it('trims username before calling the RPC', async () => {
    await pullByUsername('  eias  ');
    expect(h.rpcSpy).toHaveBeenCalledWith('ward_helper_pull_by_username', {
      p_username: 'eias',
    });
  });

  it('returns [] without hitting the RPC for empty input', async () => {
    expect(await pullByUsername('')).toEqual([]);
    expect(h.rpcSpy).not.toHaveBeenCalled();
  });

  it('returns [] without hitting the RPC for whitespace-only input', async () => {
    expect(await pullByUsername('   ')).toEqual([]);
    expect(h.rpcSpy).not.toHaveBeenCalled();
  });

  it('returns [] when the RPC reports zero rows for the user', async () => {
    h.MOCK_RPC_ROWS.current = [];
    const rows = await pullByUsername('nobody-here');
    expect(rows).toEqual([]);
    expect(h.rpcSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when the RPC returns an error so callers can surface it', async () => {
    h.rpcSpy.mockImplementationOnce(async () => ({
      data: null,
      error: new Error('22023: invalid_username'),
    }));
    await expect(pullByUsername('eias')).rejects.toThrow(/22023/);
  });
});
