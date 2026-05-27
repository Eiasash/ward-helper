import { useState } from 'react';
import { archiveDay, listDaySnapshots } from '@/storage/rounds';

const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

type State =
  | { kind: 'hidden' }
  | { kind: 'visible'; error?: string }
  | { kind: 'confirm-replace'; existingArchivedAt: number; error?: string };

const bannerInfoStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--accent)',
  padding: 12,
  margin: '8px 0',
  borderRadius: 8,
};

const bannerWarnStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--warn, #f0bc6a)',
  padding: 12,
  margin: '8px 0',
  borderRadius: 8,
};

const errorStyle: React.CSSProperties = {
  color: 'var(--err, #ec7c7c)',
  marginTop: 8,
};

export function MorningArchivePrompt(): JSX.Element | null {
  // CLS fix: decide visibility synchronously in the initializer so the banner's
  // final state is committed on the first render. The earlier pattern
  // (useState({kind:'hidden'}) + useEffect that flips to 'visible' after paint)
  // caused a layout shift on every morning the banner needed to appear — the
  // app painted hidden, then mounted the banner, pushing all content below
  // it down. Lighthouse CLS = 0.108 traced partly to this transition.
  // localStorage/sessionStorage reads are synchronous and cheap, and ward-helper
  // is a client-only SPA so SSR isn't a concern.
  const [state, setState] = useState<State>(() => {
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const last = localStorage.getItem(LAST_ARCHIVED_KEY);
      const dismissed = sessionStorage.getItem(`ward-helper.bannerDismissed_${today}`) === '1';
      if (last && last < today && !dismissed) {
        return { kind: 'visible' };
      }
    } catch {
      /* storage disabled in some test envs — fall through to hidden */
    }
    return { kind: 'hidden' };
  });

  const today = new Date().toLocaleDateString('en-CA');

  async function handleArchive() {
    try {
      // Q5b: confirm-but-allow-replace if today already in daySnapshots
      const snaps = await listDaySnapshots();
      const todayExisting = snaps.find((s) => s.id === today);
      if (todayExisting) {
        setState({ kind: 'confirm-replace', existingArchivedAt: todayExisting.archivedAt });
        return;
      }
      await archiveDay();
      setState({ kind: 'hidden' });
    } catch {
      setState((prev) =>
        prev.kind === 'hidden' ? prev : { ...prev, error: 'נכשל בארכוב — נסה שוב' },
      );
    }
  }

  async function handleConfirmReplace() {
    try {
      await archiveDay();
      setState({ kind: 'hidden' });
    } catch {
      setState((prev) =>
        prev.kind === 'hidden' ? prev : { ...prev, error: 'נכשל בארכוב — נסה שוב' },
      );
    }
  }

  function handleDismiss() {
    sessionStorage.setItem(`ward-helper.bannerDismissed_${today}`, '1');
    setState({ kind: 'hidden' });
  }

  if (state.kind === 'hidden') return null;

  if (state.kind === 'confirm-replace') {
    const at = new Date(state.existingArchivedAt).toLocaleTimeString('he-IL');
    return (
      <div style={bannerWarnStyle} dir="auto">
        <p>כבר ארכבת היום בשעה {at}. לארכב שוב? הארכוב הקודם יוחלף.</p>
        <button onClick={handleConfirmReplace}>ארכב שוב</button>
        <button onClick={handleDismiss}>בטל</button>
        {state.error && <p style={errorStyle}>{state.error}</p>}
      </div>
    );
  }

  return (
    <div style={bannerInfoStyle} dir="auto">
      <p>זוהה יום חדש. לארכב את אתמול ולהקים רשימה לבוקר?</p>
      <button onClick={handleArchive}>ארכב</button>
      <button onClick={handleDismiss}>דחה</button>
      {state.error && <p style={errorStyle}>{state.error}</p>}
    </div>
  );
}
