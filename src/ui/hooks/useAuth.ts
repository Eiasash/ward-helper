import { useEffect, useState } from 'react';
import {
  getCurrentUser,
  subscribeAuthChanges,
  type AuthUser,
} from '@/auth/auth';

/**
 * Returns the current authenticated user (or null) and re-renders subscribers
 * whenever auth state changes. State is sourced from localStorage on mount and
 * kept in sync via the 'ward-helper:auth' window event fired by setAuthSession
 * and logout.
 */
export function useAuth(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(() => getCurrentUser());

  useEffect(() => {
    const refresh = () => setUser(getCurrentUser());
    const unsub = subscribeAuthChanges(refresh);
    // Also refresh on cross-tab storage events (logout in tab A → tab B sees it).
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ward-helper.auth.user') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsub();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return user;
}
