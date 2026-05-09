import { useEffect, useState } from 'react';
import { archiveDay, listDaySnapshots } from '@/storage/rounds';

const LAST_ARCHIVED_KEY = 'ward-helper.lastArchivedDate';

type State =
  | { kind: 'hidden' }
  | { kind: 'visible' }
  | { kind: 'confirm-replace'; existingArchivedAt: number };

export function MorningArchivePrompt(): JSX.Element | null {
  const [state, setState] = useState<State>({ kind: 'hidden' });

  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA');
    const last = localStorage.getItem(LAST_ARCHIVED_KEY);
    const dismissed = sessionStorage.getItem(`ward-helper.bannerDismissed_${today}`) === '1';
    if (last && last < today && !dismissed) {
      setState({ kind: 'visible' });
    }
  }, []);

  const today = new Date().toLocaleDateString('en-CA');

  async function handleArchive() {
    // Q5b: confirm-but-allow-replace if today already in daySnapshots
    const snaps = await listDaySnapshots();
    const todayExisting = snaps.find((s) => s.id === today);
    if (todayExisting) {
      setState({ kind: 'confirm-replace', existingArchivedAt: todayExisting.archivedAt });
      return;
    }
    await archiveDay();
    setState({ kind: 'hidden' });
  }

  async function handleConfirmReplace() {
    await archiveDay();
    setState({ kind: 'hidden' });
  }

  function handleDismiss() {
    sessionStorage.setItem(`ward-helper.bannerDismissed_${today}`, '1');
    setState({ kind: 'hidden' });
  }

  if (state.kind === 'hidden') return null;

  if (state.kind === 'confirm-replace') {
    const at = new Date(state.existingArchivedAt).toLocaleTimeString('he-IL');
    return (
      <div className="banner banner-warn" dir="auto">
        <p>כבר ארכבת היום בשעה {at}. לארכב שוב? הארכוב הקודם יוחלף.</p>
        <button onClick={handleConfirmReplace}>ארכב שוב</button>
        <button onClick={handleDismiss}>בטל</button>
      </div>
    );
  }

  return (
    <div className="banner banner-info" dir="auto">
      <p>זוהה יום חדש. לארכב את אתמול ולהקים רשימה לבוקר?</p>
      <button onClick={handleArchive}>ארכב</button>
      <button onClick={handleDismiss}>דחה</button>
    </div>
  );
}
