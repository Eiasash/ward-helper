/**
 * Glanceable-state event emitters — split out from `useGlanceable.ts` so the
 * storage layer can dispatch UI refresh events without statically importing a
 * module that itself imports from `@/storage/indexed` (which would create a
 * circular dependency and force a Vite mixed static/dynamic-import warning).
 *
 * These are pure `window.dispatchEvent` calls — zero React, zero IndexedDB —
 * safe to import from any layer.
 */

/**
 * Notify same-tab listeners that the notes collection changed (created /
 * updated / deleted / sentToEmrAt bumped). The header pending-sync count and
 * any other "list of notes" subscribers refresh on this event.
 *
 * Wrapped in try/catch because `window` is undefined under SSR / Node test
 * runners that don't shim it — the storage layer must never crash because a
 * UI nudge can't fire.
 */
export function notifyNotesChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ward-helper:notes-changed'));
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Notify same-tab listeners that the active patient changed (sessionStorage
 * `validated` blob was rewritten). Mirrors `notifyNotesChanged`'s contract —
 * cross-tab updates already arrive via the native `storage` event; this is
 * the same-tab nudge.
 */
export function notifyPatientChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ward-helper:patient'));
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Notify same-tab listeners that the active note type changed (sessionStorage
 * `noteType` was rewritten). Same contract as above.
 */
export function notifyNoteTypeChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ward-helper:notetype'));
    }
  } catch {
    /* non-fatal */
  }
}

const LAST_SYNC_KEY = 'ward-helper.lastSyncAt';

/**
 * Persist + read the last successful cloud-push timestamp. saveBoth() calls
 * `markSyncedNow()` on a successful push; the header reads back via
 * `useLastSync()`.
 */
export function markSyncedNow(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    // Notify same-tab listeners — `storage` event only fires cross-tab.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ward-helper:lastsync'));
    }
  } catch {
    /* localStorage may be disabled in private mode — non-fatal */
  }
}

export function readLastSync(): number | null {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
