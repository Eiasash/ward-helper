/**
 * #193 regression — Consult `emailNote` in-flight state.
 *
 * Before the fix, tapping "send email" on an emitted-note card awaited
 * `sendNoteEmail` with no in-flight feedback: the button kept its idle
 * label, stayed enabled, and gave no signal until success/error landed.
 * This test holds the email promise open and asserts the button flips to
 * a disabled "sending" state for the duration, then to "sent".
 *
 * Screen-test pattern follows tests/Unlock.test.tsx.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const { sendNoteEmailMock, getEmailTargetMock } = vi.hoisted(() => ({
  sendNoteEmailMock: vi.fn(),
  getEmailTargetMock: vi.fn(),
}));

vi.mock('@/notes/email', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendNoteEmail: sendNoteEmailMock,
}));
vi.mock('@/ui/hooks/useSettings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEmailTarget: getEmailTargetMock,
}));
vi.mock('@/notes/consult', () => ({
  runConsultTurn: vi.fn(),
  runConsultEmit: vi.fn(),
}));

import { Consult } from '@/ui/screens/Consult';

const THREAD_KEY = 'ward-helper.consult.thread.v1';
const TARGET = 'doc@szmc.org';

/** Seed sessionStorage so an emitted-note card renders on first paint. */
function seedEmittedNote(): void {
  sessionStorage.setItem(
    THREAD_KEY,
    JSON.stringify({
      messages: [],
      emitted: {
        0: { noteType: 'consult', text: 'גוף ההערה לבדיקה', ts: 1_700_000_000_000 },
      },
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  getEmailTargetMock.mockReturnValue(TARGET);
  sendNoteEmailMock.mockReset();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('Consult — email in-flight state (#193)', () => {
  it('disables the email button and shows a sending label while the send is in flight', async () => {
    // Hold the email promise open so we can observe the in-flight window.
    let resolveSend!: (value: unknown) => void;
    sendNoteEmailMock.mockImplementation(
      () => new Promise((res) => { resolveSend = res; }),
    );

    seedEmittedNote();
    render(<Consult />);

    const idleButton = screen.getByRole('button', {
      name: `✉ שלח ל-${TARGET}`,
    });
    expect(idleButton).toBeEnabled();

    fireEvent.click(idleButton);

    // In-flight: label flips to "sending" and the button is disabled.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '✉ שולח…' }),
      ).toBeDisabled();
    });

    // Resolve the send — button settles into the "sent" state.
    await act(async () => {
      resolveSend({ ok: true });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: `✉ נשלח ל-${TARGET}` }),
      ).toBeInTheDocument();
    });

    expect(sendNoteEmailMock).toHaveBeenCalledTimes(1);
  });
});
