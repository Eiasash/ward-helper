/**
 * "Share the note to whatever the device has" — two infra-free paths that
 * sit alongside the Gmail-API send (src/notes/email.ts).
 *
 * openMailCompose: builds a mailto: URL and navigates to it. Uses the
 *   device's default mail app, no network, no auth. Body is capped at
 *   ~6 KB because many mail apps quietly truncate beyond that on mobile.
 *
 * openShareSheet: Web Share API (navigator.share). Lets the user pick any
 *   share target their OS exposes — WhatsApp, Signal, Gmail app, Notes,
 *   etc. Returns false when the API is absent so the caller can hide the
 *   button. AbortError means the user dismissed the sheet — we treat that
 *   as success, not a real failure.
 */

const BODY_MAILTO_LIMIT = 6000;

export function openMailCompose(args: {
  to: string;
  subject: string;
  body: string;
}): void {
  let body = args.body;
  if (body.length > BODY_MAILTO_LIMIT) {
    body =
      body.slice(0, BODY_MAILTO_LIMIT) +
      '\n\n…[קוצץ — פתח באפליקציה לטקסט המלא]';
  }
  const params = new URLSearchParams({ subject: args.subject, body });
  const url = `mailto:${encodeURIComponent(args.to)}?${params.toString()}`;
  window.location.href = url;
}

export async function openShareSheet(args: {
  title: string;
  text: string;
}): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('share' in navigator)) return false;
  try {
    await (navigator as Navigator & {
      share: (data: { title?: string; text?: string }) => Promise<void>;
    }).share({ title: args.title, text: args.text });
    return true;
  } catch (e) {
    // AbortError = user dismissed the sheet, not a real failure.
    if ((e as { name?: string })?.name === 'AbortError') return true;
    return false;
  }
}
