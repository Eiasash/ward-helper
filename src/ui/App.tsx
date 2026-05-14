import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import {
  loadPersistedLoginPassword,
  getLastLoginPasswordOrNull,
  subscribeAuthChanges,
} from '@/auth/auth';
import { attemptPhiUnlock, clearPhiKeyOnLogout } from '@/auth/phiUnlock';
import { ageOutRoster } from '@/storage/roster';
import { pushLatestDaySnapshotIfEnabled } from '@/storage/daySnapshotsCloud';
import { pushBreadcrumb } from './components/MobileDebugPanel';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { NoteEditor } from './screens/NoteEditor';
import { Save } from './screens/Save';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { Consult } from './screens/Consult';
import OrthoQuickref from './screens/OrthoQuickref';
import { HeaderStrip } from './components/HeaderStrip';
import { PostLoginRestorePrompt } from './components/PostLoginRestorePrompt';
import { MobileDebugPanel } from './components/MobileDebugPanel';
import { MorningArchivePrompt } from './components/MorningArchivePrompt';

// Lazy-loaded routes. Cold start usually lands on /today or /capture; the
// three below are not on the hot path, so splitting them out trims the
// entry chunk by ~15-20 kB. Census is brand-new and additionally pulls in
// a bigger extract prompt + table editor — must stay out of the entry
// chunk to keep mobile cold-start budget.
const History = lazy(() =>
  import('./screens/History').then((m) => ({ default: m.History })),
);
const NoteViewer = lazy(() =>
  import('./screens/NoteViewer').then((m) => ({ default: m.NoteViewer })),
);
const Census = lazy(() =>
  import('./screens/Census').then((m) => ({ default: m.Census })),
);
// Reset-password is the cold-path entry from the password-recovery email link.
// Lazy-load to keep it out of the entry chunk — almost no one hits it.
const PasswordReset = lazy(() =>
  import('./screens/PasswordReset').then((m) => ({ default: m.PasswordReset })),
);

// Injected at build time by vite.config.ts (reads package.json). Kept in a
// single place so any screen that needs the version can import it — and the
// footer is the one place it actually gets rendered.
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function App() {
  // v1.35.2: rehydrate the in-memory login-password stash from IDB on app
  // boot. The auth session is already persisted in localStorage so the user
  // appears logged in across reloads — but the cloud encryption key (login
  // password) was previously memory-only, which broke cloud backup until
  // the user logged out + back in.
  //
  // v1.35.3: also request persistent storage on boot. Without this, Android
  // Chrome may auto-evict site data under storage pressure or after PWA
  // reinstall flows — which is exactly what the user hit on 2026-05-06,
  // where 4 patients + 4 notes silently disappeared between sessions and
  // every cloudPush returned `patients:0 notes:0`. navigator.storage.persist
  // returns true if granted; PWAs installed to homescreen usually get it
  // automatically. We don't gate on the result — the user can keep using
  // the app even if Chrome refuses; we just log the outcome so future
  // mobile diagnoses see whether the site is in 'best effort' or 'persistent'
  // storage policy.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage
        .persisted()
        .then((alreadyPersistent) => {
          if (alreadyPersistent) {
            pushBreadcrumb('boot.storagePersist', { granted: true, alreadyHad: true });
            return alreadyPersistent;
          }
          return navigator.storage.persist().then((granted) => {
            pushBreadcrumb('boot.storagePersist', { granted, alreadyHad: false });
            return granted;
          });
        })
        .catch((e: unknown) => {
          pushBreadcrumb('boot.storagePersist.err', (e as Error).message ?? 'unknown');
        });
    } else {
      pushBreadcrumb('boot.storagePersist', { unsupported: true });
    }

    // Phase D: drop roster rows older than 24h on every boot. Cheap
    // (<50 rows, full scan) and runs in the background — failure is
    // non-fatal (worst case the roster section shows yesterday's rows
    // until a new import replaces them). Logged so a stuck roster
    // can be diagnosed from the breadcrumb stream.
    void ageOutRoster()
      .then((dropped) => {
        if (dropped > 0) pushBreadcrumb('boot.roster.ageOut', { dropped });
      })
      .catch((e: unknown) => {
        pushBreadcrumb('boot.roster.ageOut.err', (e as Error).message ?? 'unknown');
      });

    // Cold-start PHI unlock chain (PR-B2.2):
    //   1. Ensure the login password is in memory (already there, or
    //      restored from IDB via loadPersistedLoginPassword).
    //   2. Run attemptPhiUnlock — derives the PHI key from
    //      (password, persisted salt), sets it in memory, runs the
    //      sentinel-gated backfill if this install hasn't yet sealed
    //      its plaintext PHI rows.
    //   3. No-op for guests + for logged-in users whose persisted
    //      password is missing (private window, profile reset) — the
    //      cold-start Unlock.tsx gate (commit-4) surfaces that case.
    const ensurePwdInMemory: Promise<unknown> =
      getLastLoginPasswordOrNull() !== null
        ? Promise.resolve()
        : loadPersistedLoginPassword().then((p) => {
            pushBreadcrumb('boot.loadPersistedPwd', { hadPersisted: p !== null });
          });
    void ensurePwdInMemory
      .then(() => attemptPhiUnlock())
      .then((outcome) => {
        pushBreadcrumb('boot.phiUnlock', { kind: outcome.kind });
        if (outcome.kind === 'ok' && outcome.report.sentinelSet) {
          pushBreadcrumb('boot.phiBackfill', {
            examined: outcome.report.examined,
            sealed: outcome.report.sealed,
          });
        } else if (outcome.kind === 'backfill-failed') {
          pushBreadcrumb('boot.phiBackfill.err', outcome.error.message);
        }
      })
      .catch((e: unknown) => {
        pushBreadcrumb('boot.phiUnlock.err', (e as Error).message ?? 'unknown');
      });

    // Auth subscriber (PR-B2.2): warm transitions.
    //   - On login/register: derive the PHI key from the just-stashed
    //     password and run the backfill. Idempotent — if a key is
    //     already set (e.g. cold-start beat the subscriber), skipped.
    //   - On logout: clear the in-memory key. Encrypted rows on disk
    //     stay sealed; next login of any user re-derives.
    //   - On change-password: deliberately NOT clearing the key here.
    //     The password-rotation guard (commit-5) refuses the rotation
    //     when sealed rows exist, so this branch is unreachable in
    //     that case. If the guard ever ships a re-encrypt sweep, that
    //     code owns its own key lifecycle.
    const unsubscribeAuth = subscribeAuthChanges((action) => {
      if (action === 'login' || action === 'register') {
        void attemptPhiUnlock().then((outcome) => {
          pushBreadcrumb('auth.phiUnlock', { kind: outcome.kind, action });
        });
      } else if (action === 'logout') {
        clearPhiKeyOnLogout();
        pushBreadcrumb('auth.phiKey.cleared');
      }
    });
    return unsubscribeAuth;
  }, []);

  // v1.42.0: opt-in cloud sync for daySnapshots. The helper itself enforces
  // the 3-state guard (toggle off / guest / no-password = silent skip), so
  // this subscriber stays trivial: every archive pings the helper and the
  // helper decides whether to push. Errors are breadcrumbed by the helper —
  // never crash the archive flow over a transient network blip.
  useEffect(() => {
    function onDayArchived(): void {
      void pushLatestDaySnapshotIfEnabled();
    }
    window.addEventListener('ward-helper:day-archived', onDayArchived);
    return () => {
      window.removeEventListener('ward-helper:day-archived', onDayArchived);
    };
  }, []);

  return (
    <HashRouter>
      {/* Skip-to-content link — visible only when keyboard-focused. Lets keyboard
         users bypass the fixed header strip + bottom nav and jump straight into
         the main content. */}
      <a className="skip-link" href="#main-content">דלג לתוכן</a>
      <HeaderStrip />
      <main className="shell" id="main-content" tabIndex={-1}>
        {/* Morning-rounds-prep banner — self-gated on lastArchivedDate <
           today. Renders null on every other day, so it's safe to mount
           App-wide. Surfaces above all routes so a doctor entering the
           PWA on a fresh morning is offered the archive-yesterday flow
           regardless of which screen is active. */}
        <MorningArchivePrompt />
        <Suspense fallback={<section><h1>טוען...</h1></section>}>
          <Routes>
            <Route path="/" element={<Capture />} />
            <Route path="/consult" element={<Consult />} />
            <Route path="/today" element={<Today />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/review" element={<Review />} />
            <Route path="/edit" element={<NoteEditor />} />
            <Route path="/save" element={<Save />} />
            <Route path="/note/:id" element={<NoteViewer />} />
            <Route path="/history" element={<History />} />
            <Route path="/census" element={<Census />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/ortho" element={<OrthoQuickref />} />
            <Route path="/reset-password" element={<PasswordReset />} />
            <Route path="*" element={<Capture />} />
          </Routes>
        </Suspense>
        <footer className="app-version" aria-hidden="true">
          v{APP_VERSION}
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="ניווט ראשי">
        <NavLink to="/capture" end>צלם</NavLink>
        <NavLink to="/today">היום</NavLink>
        <NavLink to="/consult">ייעוץ</NavLink>
        <NavLink to="/history">היסטוריה</NavLink>
        <NavLink to="/ortho">אורתו</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
      {/* Surfaces a one-shot cloud-restore offer when a fresh-device login
         lands on a zero-state IndexedDB. Mounted at router level so the
         modal renders above any active route. Self-suppresses after the
         first dismissal/restore per (username, device). */}
      <PostLoginRestorePrompt />
      {/* On-device debug breadcrumb panel — no-op unless ?debug=1 in URL or
         the existing localStorage debug toggle is on. Surfaces silent click
         failures on mobile where DevTools isn't reachable. */}
      <MobileDebugPanel />
    </HashRouter>
  );
}
