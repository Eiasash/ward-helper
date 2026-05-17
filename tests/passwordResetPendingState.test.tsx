/**
 * 2026-05-17 — empirical close of the `resetPassword/silent-on-fake-token`
 * finding. Code review proved the bot's HIGH was a fixed-sleep race
 * (see botResetPasswordPoll.test.ts), not an app defect. But "app is
 * correct" must not bury a real lower-severity truth: does the form give
 * IN-FLIGHT feedback during the (potentially slow, cold-Supabase) RPC, or
 * does a slow-link user stare at a dead form for the same window the bot
 * tripped on?
 *
 * This pins both halves of the contract:
 *   1. Pending state EXISTS while authResetPasswordWithToken is in flight
 *      — submit disabled + label "מאפס…", inputs disabled. (The answer to
 *      the gating question: app is correct AND the slow-link UX is sound.)
 *   2. Specific error banner arrives once the RPC resolves !ok — the
 *      feedback_auth_error_specificity (#40) contract, verified at the
 *      app, not assumed from source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/auth/auth', () => ({
  authResetPasswordWithToken: vi.fn(),
}));

import { PasswordReset } from '@/ui/screens/PasswordReset';
import { authResetPasswordWithToken } from '@/auth/auth';

const mockAuth = vi.mocked(authResetPasswordWithToken);

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password?token=${token}`]}>
      <PasswordReset />
    </MemoryRouter>,
  );
}

describe('PasswordReset — in-flight pending state + error specificity', () => {
  beforeEach(() => {
    cleanup();
    mockAuth.mockReset();
  });

  it('shows a pending state (disabled submit + "מאפס…", disabled inputs) while the RPC is in flight', async () => {
    // Deferred promise — never resolves during the assertion window, so we
    // observe the exact in-flight state a slow-link user would see.
    let release!: (v: { ok: false; error: string }) => void;
    mockAuth.mockReturnValue(new Promise((res) => { release = res; }) as never);

    renderAt('a'.repeat(64)); // well-formed fake token (the bot's case)

    const inputs = screen.getAllByPlaceholderText(/סיסמה/);
    fireEvent.change(inputs[0]!, { target: { value: 'TestPass123!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'TestPass123!' } });

    const submit = screen.getByRole('button', { name: /אפס סיסמה/ });
    fireEvent.click(submit);

    // setBusy(true) runs synchronously before the await — pending feedback
    // must be visible immediately, not only after the RPC resolves.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /מאפס…/ })).toBeDisabled();
    });
    expect((inputs[0] as HTMLInputElement).disabled).toBe(true);
    expect((inputs[1] as HTMLInputElement).disabled).toBe(true);

    release({ ok: false, error: 'invalid_token' });
  });

  it('surfaces the specific Hebrew error banner once the RPC resolves !ok (the #40 specificity contract)', async () => {
    mockAuth.mockResolvedValue({ ok: false, error: 'invalid_token' } as never);

    renderAt('a'.repeat(64));
    const inputs = screen.getAllByPlaceholderText(/סיסמה/);
    fireEvent.change(inputs[0]!, { target: { value: 'TestPass123!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'TestPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /אפס סיסמה/ }));

    // Not a bare "שגיאה" dead-end — the invalid_token-specific message.
    await waitFor(() => {
      expect(screen.getByText(/הקישור לא תקין\. ייתכן שהוא נשבר/)).toBeInTheDocument();
    });
  });
});
