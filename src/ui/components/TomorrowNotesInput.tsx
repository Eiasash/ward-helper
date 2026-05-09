import { useState } from 'react';
import { addTomorrowNote } from '@/storage/rounds';

interface Props { patientId: string; }

export function TomorrowNotesInput({ patientId }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addTomorrowNote(patientId, text.trim());
      setText('');
    } catch (err) {
      console.warn('[TomorrowNotesInput] add failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tomorrow-notes-input" dir="auto" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input
        type="text"
        value={text}
        placeholder="הוסף הערה למחר"
        onChange={e => setText(e.target.value)}
        disabled={busy}
        style={{ flex: 1 }}
      />
      <button onClick={() => void handleAdd()} disabled={busy || !text.trim()}>הוסף</button>
    </div>
  );
}
