/**
 * Visible affordance when one or more rows hit a decrypt failure
 * during this session (PR-B2.2).
 *
 * Why this exists: `decryptRowsIfEncrypted` filters out null returns,
 * so a row that fails to decrypt silently disappears from the UI. The
 * user has no signal that data is being hidden. This banner surfaces
 * the count and gives them a clear next step (log out + back in, or
 * cloud-restore).
 *
 * Render-once: mounted at App level above the routes; renders null
 * when count is zero (the common case).
 *
 * Future work: an explicit "Retry sync" button that triggers cloud-
 * restore. Out of scope for B2.2 — for now we point the user at
 * Settings where the manual restore lives.
 */
import { useEffect, useState } from 'react';
import {
  getDecryptFailureCount,
  subscribeDecryptFailureChanges,
} from '@/crypto/phiRow';

const bannerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--err, #ec7c7c)',
  padding: 12,
  margin: '8px 0',
  borderRadius: 8,
  color: 'var(--err, #ec7c7c)',
};

export function DecryptFailureBanner(): JSX.Element | null {
  const [count, setCount] = useState<number>(getDecryptFailureCount());

  useEffect(() => {
    const unsubscribe = subscribeDecryptFailureChanges(() => {
      setCount(getDecryptFailureCount());
    });
    return unsubscribe;
  }, []);

  if (count === 0) return null;

  return (
    <div role="alert" style={bannerStyle} dir="auto">
      <strong>{count}</strong>{' '}
      {count === 1
        ? 'רשומה לא נטענה — ייתכן שהסיסמה השתנתה.'
        : 'רשומות לא נטענו — ייתכן שהסיסמה השתנתה.'}{' '}
      נסה להתנתק ולהתחבר מחדש, או שחזר מהענן דרך הגדרות.
    </div>
  );
}
