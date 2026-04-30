import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { NoteEditor } from './screens/NoteEditor';
import { Save } from './screens/Save';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { Consult } from './screens/Consult';
import { HeaderStrip } from './components/HeaderStrip';
import { PostLoginRestorePrompt } from './components/PostLoginRestorePrompt';

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

// Injected at build time by vite.config.ts (reads package.json). Kept in a
// single place so any screen that needs the version can import it — and the
// footer is the one place it actually gets rendered.
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function App() {
  return (
    <HashRouter>
      {/* Skip-to-content link — visible only when keyboard-focused. Lets keyboard
         users bypass the fixed header strip + bottom nav and jump straight into
         the main content. */}
      <a className="skip-link" href="#main-content">דלג לתוכן</a>
      <HeaderStrip />
      <main className="shell" id="main-content" tabIndex={-1}>
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
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
      {/* Surfaces a one-shot cloud-restore offer when a fresh-device login
         lands on a zero-state IndexedDB. Mounted at router level so the
         modal renders above any active route. Self-suppresses after the
         first dismissal/restore per (username, device). */}
      <PostLoginRestorePrompt />
    </HashRouter>
  );
}
