/**
 * Regression guard — IDB connection-memo invalidation on connection loss.
 *
 * THE DEFECT (fresh-eye review of #176, 2026-05-17): src/storage/indexed.ts
 * memoizes the open connection in a module-level `dbPromise`. Before this
 * guard it was nulled ONLY by resetDbForTests() — no production path. The
 * openDB() call registered no `terminated` callback and the connection got
 * no `versionchange` / `close` listener. So when another context deleted
 * the DB, or the browser evicted origin storage (chaos-clear-storage /
 * chaos-idb-quota — heavy in the 2026-05-17 mega-bot run), getDb() kept
 * handing out the dead connection forever: every later IDB op on the PHI
 * surface threw until a full reload, and the leaked open connection
 * blocked the delete itself.
 *
 * THE FIX: getDb() now closes + invalidates the memo on `versionchange`
 * (another context is deleting/upgrading the DB) and invalidates on idb's
 * `terminated` callback / the raw `close` event (abnormal browser-side
 * close, e.g. storage eviction).
 *
 * SCOPE — what this test does and does NOT cover (so the verdict doesn't
 * outrun the artifact):
 *  - COVERS: the versionchange path — another context deletes the DB —
 *    deterministically, end to end. It is the dominant chaos-clear-storage
 *    shape. Pre-fix: getDb() returns the same stale handle and the delete
 *    is blocked. Post-fix: a fresh, working connection.
 *  - DOES NOT COVER: real browser-side abnormal close / storage eviction.
 *    fake-indexeddb cannot force that deterministically; the `terminated`
 *    and `close` wiring is belt-and-suspenders verified by inspection.
 *    Empirical confirmation is the #176 repro-harness.
 *  - This is a CORRECTNESS fix on its own merits. Whether it is THE
 *    2026-05-17 NotFoundError is for the #176 harness to assign — not
 *    claimed here.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { getDb, resetDbForTests } from '@/storage/indexed';

describe('IDB connection memo — invalidation on connection loss', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('getDb() re-opens a fresh connection after another context deletes the DB', async () => {
    const db1 = await getDb();
    // memo works while the connection is live
    expect(await getDb()).toBe(db1);

    // Another context deletes the DB. Pre-fix, with no versionchange
    // handler, this delete is blocked AND the memo is never cleared.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('ward-helper');
      req.onsuccess = () => resolve();
      req.onblocked = () => resolve();
      req.onerror = () => resolve();
    });

    const db2 = await getDb();
    // RED pre-fix: the stale memo hands back db1 (delete was blocked).
    expect(db2).not.toBe(db1);

    // the fresh connection is usable end to end
    await db2.put('patients', { id: 'sentinel', teudatZehut: '000' });
    expect(await db2.get('patients', 'sentinel')).toMatchObject({
      id: 'sentinel',
    });
  });
});
