/**
 * Glanceable-state hooks for the fixed-top header strip.
 *
 * Three signals the rounding doctor checks at a glance:
 *   - online / offline (navigator.onLine + fetch heartbeat optional)
 *   - battery level (getBattery() — Chrome / Edge only; safe fallback)
 *   - last successful cloud-sync timestamp (lifted from localStorage)
 *
 * All three are pull-only (no PHI, no network calls) — the header is read
 * in a phone-glance "is this thing alive?" pattern.
 */

import { useEffect, useState } from 'react';
import { listAllNotes } from '@/storage/indexed';

export interface BatteryInfo {
  /** 0..1, or null when the API is unavailable. */
  level: number | null;
  charging: boolean;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

/**
 * Returns the current battery info, refreshed on level/charging events.
 * Resolves to `{ level: null, charging: false }` on browsers that don't
 * expose getBattery (Safari, Firefox) — so callers can render "—%" rather
 * than crash. Listener cleanup avoids the tab-close memory leak the
 * battery API is famous for.
 */
export function useBattery(): BatteryInfo {
  const [info, setInfo] = useState<BatteryInfo>({ level: null, charging: false });

  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') return;
    let cancelled = false;
    let mgr: BatteryManagerLike | null = null;

    const update = () => {
      if (!mgr || cancelled) return;
      setInfo({ level: mgr.level, charging: mgr.charging });
    };

    nav.getBattery()
      .then((m) => {
        if (cancelled) return;
        mgr = m;
        update();
        m.addEventListener('levelchange', update);
        m.addEventListener('chargingchange', update);
      })
      .catch(() => {
        /* permission denied / unsupported — keep null */
      });

    return () => {
      cancelled = true;
      if (mgr) {
        mgr.removeEventListener('levelchange', update);
        mgr.removeEventListener('chargingchange', update);
      }
    };
  }, []);

  return info;
}

/**
 * navigator.onLine + window online/offline events. Chrome on a captive-
 * portal LAN still reports `true` even when API calls fail — this is a
 * UI-level hint, not a definitive connectivity check.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
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
    window.dispatchEvent(new CustomEvent('ward-helper:lastsync'));
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

export function useLastSync(): number | null {
  const [ts, setTs] = useState<number | null>(() => readLastSync());
  useEffect(() => {
    const refresh = () => setTs(readLastSync());
    window.addEventListener('storage', refresh);
    window.addEventListener('ward-helper:lastsync', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ward-helper:lastsync', refresh);
    };
  }, []);
  return ts;
}

/**
 * Track the "current patient name" the user is operating on, lifted from
 * sessionStorage's `validated` blob (set by Review.tsx). The header
 * surfaces the name so a one-glance check confirms which patient is in
 * the active flow — the #1 wrong-patient guardrail beyond the
 * confirmation gate.
 *
 * Returns trimmed name or null. Truncation is a UI concern.
 */
export function useCurrentPatientName(): string | null {
  const [name, setName] = useState<string | null>(() => readPatientName());
  useEffect(() => {
    const refresh = () => setName(readPatientName());
    window.addEventListener('storage', refresh);
    window.addEventListener('ward-helper:patient', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ward-helper:patient', refresh);
    };
  }, []);
  return name;
}

function readPatientName(): string | null {
  try {
    const raw = sessionStorage.getItem('validated');
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: string };
    const n = v?.name?.trim();
    return n && n.length > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Manually nudge useCurrentPatientName subscribers (sessionStorage doesn't
 * fire `storage` events for same-tab writes). Call this after writing
 * `validated` from any new code path.
 */
export function notifyPatientChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('ward-helper:patient'));
  } catch {
    /* SSR / no window — non-fatal */
  }
}

/**
 * Track the active note type from sessionStorage.
 * Used by the HeaderStrip to render a note-type badge with the right tone.
 *
 * Subscribes to a custom event since same-tab sessionStorage writes don't
 * trigger the native `storage` event.
 */
export function useActiveNoteType(): string | null {
  const [t, setT] = useState<string | null>(() => {
    try { return sessionStorage.getItem('noteType'); } catch { return null; }
  });
  useEffect(() => {
    const refresh = () => {
      try { setT(sessionStorage.getItem('noteType')); } catch { setT(null); }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('ward-helper:notetype', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ward-helper:notetype', refresh);
    };
  }, []);
  return t;
}

export function notifyNoteTypeChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('ward-helper:notetype'));
  } catch {
    /* non-fatal */
  }
}

/**
 * Pending-sync depth — the count of locally-saved notes that have NOT yet
 * been marked as copied to Chameleon (sentToEmrAt is null/undefined). The
 * doctor's "queue waiting for me" — they wrote it locally but haven't
 * paste-ack'd it into the EMR. Header strip surfaces this so a forgotten
 * paste gets caught the next time the doctor opens the app.
 *
 * Refreshes on a custom event the save flow + markNoteSent fire. Initial
 * value is 0 until the IDB read resolves — keeps render synchronous.
 */
export function usePendingSyncCount(): number {
  const [n, setN] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const all = await listAllNotes();
        if (cancelled) return;
        const pending = all.reduce((acc, note) => acc + (note.sentToEmrAt ? 0 : 1), 0);
        setN(pending);
      } catch {
        /* IDB unavailable — show 0 rather than crash */
      }
    };
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener('storage', handler);
    window.addEventListener('ward-helper:notes-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', handler);
      window.removeEventListener('ward-helper:notes-changed', handler);
    };
  }, []);
  return n;
}

export function notifyNotesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('ward-helper:notes-changed'));
  } catch {
    /* non-fatal */
  }
}

/**
 * Render a battery level (0..1) as a Hebrew-friendly short string,
 * e.g. 0.42 → "42%". null → "—".
 */
export function formatBatteryPct(level: number | null): string {
  if (level == null) return '—';
  return `${Math.round(level * 100)}%`;
}

/**
 * Format an ms timestamp as a relative "now / 5m / 2h / yesterday / DD/MM"
 * — micro-copy length so the header strip stays tight.
 */
export function formatRelative(ts: number | null, now: number = Date.now()): string {
  if (ts == null) return 'אף פעם';
  const diff = now - ts;
  if (diff < 0) return 'עכשיו';
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'עכשיו';
  if (sec < 60) return `${sec}ש׳`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}ד׳`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}ש`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'אתמול';
  if (day < 7) return `${day}י׳`;
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}
