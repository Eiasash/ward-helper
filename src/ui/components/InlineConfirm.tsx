import { useEffect, useRef } from 'react';

/**
 * Inline confirm modal — replaces `window.confirm(...)` in hot-path UI.
 *
 * Why this exists (per directive 2026-05-26):
 *   `window.confirm()` silently fails in Android Chrome PWA standalone mode
 *   (the OS blocks the alert/confirm dialogs from the in-standalone webview).
 *   Doctors on the rounds tap "שחרר" / "מחק" and nothing happens — they
 *   conclude the app is broken. Replacing with an inline dialog rendered by
 *   our own React tree sidesteps the OS gate entirely.
 *
 * Out of scope for this component:
 *   - The Settings.tsx destructive-admin confirms (canary override, change
 *     passphrase, etc.) — those run from a screen the doctor explicitly
 *     navigated into, the failure mode is recoverable, and the keep-as-is
 *     budget is acceptable per the directive ("acceptable for destructive
 *     admin ops").
 *
 * Container styles match RosterImportModal so the look is consistent across
 * any modal surface in the app.
 */
export interface InlineConfirmProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Use 'danger' for destructive actions (delete/discharge). Tints the confirm button. */
  variant?: 'default' | 'danger';
}

export function InlineConfirm({
  open,
  message,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  onConfirm,
  onCancel,
  variant = 'default',
}: InlineConfirmProps) {
  // Focus the confirm button when the modal opens. Required for keyboard
  // users — without this, Enter on the modal doesn't fire anything because
  // focus is still on the trigger button (which is now obscured).
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) {
      // Defer one tick so the dialog is in the DOM before focus().
      const t = setTimeout(() => confirmRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc closes — matches native confirm UX.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmBg =
    variant === 'danger' ? 'var(--red, #b91c1c)' : 'var(--accent, #1aa9b3)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inline-confirm-msg"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg, #1a1a1a)',
          color: 'var(--fg, #f0f0f0)',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          borderRadius: 12,
          width: '100%',
          maxWidth: 360,
          padding: '20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <p
          id="inline-confirm-msg"
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            unicodeBidi: 'plaintext',
          }}
        >
          {message}
        </p>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="ghost"
            onClick={onCancel}
            style={{ minHeight: 36, padding: '6px 14px', fontSize: 13 }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              minHeight: 36,
              padding: '6px 14px',
              fontSize: 13,
              background: confirmBg,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
