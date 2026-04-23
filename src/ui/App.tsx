import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { NoteEditor } from './screens/NoteEditor';
import { Save } from './screens/Save';
import { History } from './screens/History';
import { Settings } from './screens/Settings';

export function App() {
  return (
    <HashRouter>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Capture />} />
          <Route path="/review" element={<Review />} />
          <Route path="/edit" element={<NoteEditor />} />
          <Route path="/save" element={<Save />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Capture />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        <NavLink to="/" end>צלם</NavLink>
        <NavLink to="/history">היסטוריה</NavLink>
        <NavLink to="/settings">הגדרות</NavLink>
      </nav>
    </HashRouter>
  );
}
