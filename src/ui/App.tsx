import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { NoteEditor } from './screens/NoteEditor';
import { NoteViewer } from './screens/NoteViewer';
import { Save } from './screens/Save';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';

// Injected at build time by vite.config.ts (reads package.json). Kept in a
// single place so any screen that needs the version can import it — and the
// footer is the one place it actually gets rendered.
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function App() {
  return (
    <HashRouter>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/today" element={<Today />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/review" element={<Review />} />
          <Route path="/edit" element={<NoteEditor />} />
          <Route path="/save" element={<Save />} />
          <Route path="/note/:id" element={<NoteViewer />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Today />} />
        </Routes>
        <footer className="app-version" aria-hidden="true">
          v{APP_VERSION}
        </footer>
      </main>
      <nav className="bottom-nav">
        <NavLink to="/capture">צלם</NavLink>
        <NavLink to="/today" end>היום</NavLink>
        <NavLink to="/history">היסטוריה</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
    </HashRouter>
  );
}
