/**
 * deleteNoteFromCloud routing — must MIRROR the save/restore routing:
 *   - app_users session (username present) -> deleteByUsername RPC
 *   - guest / no username                  -> deleteBlob (auth.uid via RLS)
 *
 * This is the same `getCurrentUser()?.username ? byUsername : byAnon`
 * decision that src/notes/save.ts (push) and restoreFromCloud (pull) use,
 * so a note deleted while logged in reaches the same row the push created.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  deleteBlobSpy: vi.fn(),
  deleteByUsernameSpy: vi.fn(),
  currentUser: { current: null as { username: string } | null },
}));

vi.mock('@/storage/cloud', () => ({
  deleteBlob: (...args: unknown[]) => h.deleteBlobSpy(...args),
  deleteByUsername: (...args: unknown[]) => h.deleteByUsernameSpy(...args),
}));

vi.mock('@/auth/auth', () => ({
  getCurrentUser: () => h.currentUser.current,
}));

import { deleteNoteFromCloud } from '@/notes/cloudDelete';

beforeEach(() => {
  h.deleteBlobSpy.mockReset();
  h.deleteBlobSpy.mockImplementation(async () => 'deleted');
  h.deleteByUsernameSpy.mockReset();
  h.deleteByUsernameSpy.mockImplementation(async () => 'deleted');
  h.currentUser.current = null;
});

describe('deleteNoteFromCloud — routing', () => {
  it('routes to deleteByUsername when an app_users session is active', async () => {
    h.currentUser.current = { username: 'eias' };
    const status = await deleteNoteFromCloud('n-1');
    expect(h.deleteByUsernameSpy).toHaveBeenCalledTimes(1);
    expect(h.deleteByUsernameSpy).toHaveBeenCalledWith('note', 'n-1', 'eias');
    expect(h.deleteBlobSpy).not.toHaveBeenCalled();
    expect(status).toBe('deleted');
  });

  it('routes to deleteBlob (auth.uid) when guest / no username', async () => {
    h.currentUser.current = null;
    const status = await deleteNoteFromCloud('n-2');
    expect(h.deleteBlobSpy).toHaveBeenCalledTimes(1);
    expect(h.deleteBlobSpy).toHaveBeenCalledWith('note', 'n-2');
    expect(h.deleteByUsernameSpy).not.toHaveBeenCalled();
    expect(status).toBe('deleted');
  });

  it('routes to deleteBlob when the username is blank (defensive)', async () => {
    h.currentUser.current = { username: '   ' };
    await deleteNoteFromCloud('n-3');
    expect(h.deleteBlobSpy).toHaveBeenCalledWith('note', 'n-3');
    expect(h.deleteByUsernameSpy).not.toHaveBeenCalled();
  });

  it('propagates a non-fatal "error" status without throwing', async () => {
    h.currentUser.current = { username: 'eias' };
    h.deleteByUsernameSpy.mockImplementationOnce(async () => 'error');
    await expect(deleteNoteFromCloud('n-4')).resolves.toBe('error');
  });
});
