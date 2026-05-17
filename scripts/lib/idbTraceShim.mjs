/**
 * idbTraceShim — spec R2's "thin tracing shim for the harness run only".
 *
 * Exported as a STRING LITERAL (not app source imported into the page).
 * The no-PHI-in-logs invariant is satisfied BY CONSTRUCTION: the shim
 * records only { op, store, mode, ts } — operation name, object-store /
 * index NAME, transaction mode, timestamp. It never reads, serializes,
 * or logs any record value or key. Spec R2 asks for exactly this and no
 * more. It is installed via page.addInitScript() in the harness ONLY and
 * is physically absent from the app bundle.
 *
 * Ring buffer window.__harnessTrace (cap 200) so an error handler can
 * answer "what was the last IDB op attempted" — the H1/H2/H3 fault
 * assignment the spec says is unassignable without it.
 */

export const TRACE_SHIM_SRC = `(function () {
  if (window.__harnessTraceInstalled) return;
  window.__harnessTraceInstalled = true;
  var CAP = 200;
  window.__harnessTrace = [];
  function rec(op, store, mode) {
    var t = window.__harnessTrace;
    t.push({ op: op, store: store, mode: mode || null, ts: Date.now() });
    if (t.length > CAP) t.splice(0, t.length - CAP);
  }
  try {
    var dbProto = IDBDatabase.prototype;
    var origTx = dbProto.transaction;
    dbProto.transaction = function (storeNames, mode) {
      var s = Array.isArray(storeNames) ? storeNames.join(',') : String(storeNames);
      rec('transaction', s, mode || 'readonly');
      return origTx.apply(this, arguments);
    };
    var osProto = IDBObjectStore.prototype;
    ['get', 'getAll', 'getAllKeys', 'count', 'openCursor', 'put', 'delete', 'add'].forEach(function (m) {
      if (typeof osProto[m] !== 'function') return;
      var orig = osProto[m];
      osProto[m] = function () {
        try { rec(m, this.name, this.transaction && this.transaction.mode); } catch (e) {}
        return orig.apply(this, arguments);
      };
    });
    var idxProto = (typeof IDBIndex !== 'undefined') ? IDBIndex.prototype : null;
    if (idxProto) {
      ['get', 'getAll', 'count', 'openCursor'].forEach(function (m) {
        if (typeof idxProto[m] !== 'function') return;
        var orig = idxProto[m];
        idxProto[m] = function () {
          try { rec('index.' + m, this.objectStore && this.objectStore.name, null); } catch (e) {}
          return orig.apply(this, arguments);
        };
      });
    }
    var factory = IDBFactory.prototype;
    var origOpen = factory.open;
    factory.open = function (name, ver) { rec('open', String(name), ver != null ? ('v' + ver) : null); return origOpen.apply(this, arguments); };
    var origDel = factory.deleteDatabase;
    factory.deleteDatabase = function (name) { rec('deleteDatabase', String(name), null); return origDel.apply(this, arguments); };
  } catch (e) {
    window.__harnessTraceError = String(e && e.message || e);
  }
})();`;

/** Drain the last n trace entries from a page (post-error fault assignment). */
export async function drainTrace(page, n = 30) {
  try {
    return await page.evaluate(
      (count) => (window.__harnessTrace || []).slice(-count),
      n,
    );
  } catch {
    return [];
  }
}

/** Live IDB schema snapshot for R2 ("indexedDB.databases() + store/index names"). */
export async function snapshotIdb(page) {
  try {
    return await page.evaluate(async () => {
      const out = { databases: [], wardHelper: null };
      const withTimeout = (p, ms, label) => Promise.race([
        p, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
      ]);
      try { out.databases = await withTimeout(indexedDB.databases(), 3000, 'databases-timeout-3s'); }
      catch (e) { out.databasesError = String(e && (e.name || e.message)); }
      try {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('ward-helper');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('blocked'));
          // A plain open() queued behind a pending/blocked deleteDatabase
          // never fires success/error/blocked — it waits forever. That
          // state IS the pre-fix leaked-connection deadlock the spec
          // describes; the harness must CAPTURE it, not hang (an un-timed
          // open hung the v1 calibration run ~7min). The timeout message
          // is itself R2 fault-assignment evidence.
          setTimeout(() => rej(new Error(
            'open-timeout-3s (open queued behind a blocked deleteDatabase — ' +
            'pre-fix stale-connection deadlock signature)')), 3000);
        });
        const stores = Array.from(db.objectStoreNames).sort();
        if (stores.length === 0) {
          // Just-deleted DB before any reopen materializes the schema —
          // db.transaction([]) throws InvalidAccessError. Guard it so the
          // R2 snapshot reports the real state instead of a harness bug.
          out.wardHelper = { version: db.version, stores: [], indexes: {}, note: 'empty (post-delete, pre-reopen)' };
          db.close();
          return out;
        }
        const idx = {};
        const tx = db.transaction(stores, 'readonly');
        for (const s of stores) idx[s] = Array.from(tx.objectStore(s).indexNames);
        out.wardHelper = { version: db.version, stores, indexes: idx };
        db.close();
      } catch (e) { out.wardHelperError = (e && e.name) + ': ' + (e && e.message); }
      return out;
    });
  } catch (e) {
    return { snapshotError: String(e && e.message || e) };
  }
}
