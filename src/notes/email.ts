/**
 * Send the generated Hebrew note to a configured email address via the
 * shared-project `send-note-email` edge function.
 *
 * Wire:
 *   client → ensureAnonymousAuth() → supabase.functions.invoke('send-note-email')
 *   Supabase validates JWT (verify_jwt=true) → function refreshes Gmail OAuth
 *   → sends as `GMAIL_FROM` → returns {ok, messageId, threadId}.
 *
 * PHI: body text contains full clinical content. It's transmitted:
 *   - over TLS to Supabase (standard)
 *   - through the edge function runtime in-memory only (function logs metadata only, never body)
 *   - to Gmail's API (TLS, Google's infra — same trust level as any Gmail send)
 * No ciphertext-at-rest step like ward_helper_backup, because Gmail needs
 * readable MIME. That's the unavoidable tradeoff of "email me the note".
 */

import { getSupabase, ensureAnonymousAuth } from '@/storage/cloud';

export interface SendNoteEmailResult {
  messageId: string;
  threadId: string;
}

interface FnOk { ok: true; messageId: string; threadId: string; }
interface FnErr { ok: false; error: string; }

/**
 * Invoke the edge function. Throws on any failure, including network,
 * auth, and Gmail-side errors — callers should surface the `.message` to
 * the user (they're Hebrew-friendly already from the function's error
 * strings, but the network-layer messages are English).
 */
export async function sendNoteEmail(
  to: string,
  subject: string,
  body: string,
): Promise<SendNoteEmailResult> {
  if (!to.trim()) throw new Error('כתובת דוא״ל לא הוגדרה (הגדרות → שליחה במייל)');
  if (!subject.trim()) throw new Error('נושא חסר');
  if (!body.trim()) throw new Error('גוף ההערה ריק');

  await ensureAnonymousAuth();
  const sb = await getSupabase();

  const { data, error } = await sb.functions.invoke<FnOk | FnErr>('send-note-email', {
    body: { to: to.trim(), subject: subject.trim(), body },
  });

  if (error) {
    // supabase-js wraps HTTP errors here. error.message already contains a
    // diagnostic; the caller can surface it verbatim.
    throw error;
  }
  if (!data) throw new Error('empty response from send-note-email');
  if (!data.ok) throw new Error(data.error || 'Gmail send failed');

  return { messageId: data.messageId, threadId: data.threadId };
}

/**
 * Default subject for a saved note. Format: "<Hebrew note type> · <patient> · <date>".
 * Patient name may be empty (anonymous quick note) — we fall back to "ללא שם".
 */
export function defaultEmailSubject(
  noteTypeLabel: string,
  patientName: string | undefined,
): string {
  const name = (patientName ?? '').trim() || 'ללא שם';
  const date = new Date().toLocaleDateString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${noteTypeLabel} · ${name} · ${date}`;
}
