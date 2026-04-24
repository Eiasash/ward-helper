import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage/cloud BEFORE importing email.ts — email.ts resolves
// ensureAnonymousAuth + getSupabase through the mocked module.
const invokeSpy = vi.fn();
vi.mock('@/storage/cloud', () => ({
  ensureAnonymousAuth: vi.fn(async () => 'fake-user-id'),
  getSupabase: vi.fn(() => ({
    functions: { invoke: invokeSpy },
  })),
}));

import { sendNoteEmail, defaultEmailSubject } from '@/notes/email';
import * as cloud from '@/storage/cloud';

beforeEach(() => {
  invokeSpy.mockReset();
  (cloud.ensureAnonymousAuth as ReturnType<typeof vi.fn>).mockResolvedValue('fake-user-id');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('defaultEmailSubject', () => {
  it('formats with Hebrew label + patient name + ISO-localized Hebrew date', () => {
    const s = defaultEmailSubject('קבלה', 'דוד כהן');
    // Label and name must be present with the ' · ' separator pattern.
    expect(s.startsWith('קבלה · דוד כהן · ')).toBe(true);
    // Date portion should be non-empty and contain digits.
    const datePart = s.split(' · ')[2];
    expect(datePart).toBeTruthy();
    expect(datePart).toMatch(/\d/);
  });

  it('falls back to "ללא שם" when the patient name is empty or whitespace', () => {
    expect(defaultEmailSubject('שחרור', '')).toMatch(/^שחרור · ללא שם · /);
    expect(defaultEmailSubject('שחרור', '   ')).toMatch(/^שחרור · ללא שם · /);
    expect(defaultEmailSubject('שחרור', undefined)).toMatch(/^שחרור · ללא שם · /);
  });
});

describe('sendNoteEmail — validation (fails fast before network call)', () => {
  it('throws on empty to', async () => {
    await expect(sendNoteEmail('', 'subj', 'body')).rejects.toThrow(/כתובת דוא״ל לא הוגדרה/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('throws on whitespace-only to', async () => {
    await expect(sendNoteEmail('   ', 'subj', 'body')).rejects.toThrow(/כתובת דוא״ל/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('throws on empty subject', async () => {
    await expect(sendNoteEmail('a@b.co', '', 'body')).rejects.toThrow(/נושא חסר/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('throws on empty body', async () => {
    await expect(sendNoteEmail('a@b.co', 'subj', '')).rejects.toThrow(/גוף ההערה ריק/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe('sendNoteEmail — happy path', () => {
  it('calls the edge function with trimmed to/subject + raw body, returns ids', async () => {
    invokeSpy.mockResolvedValueOnce({
      data: { ok: true, messageId: 'msg-123', threadId: 'thr-456' },
      error: null,
    });

    const result = await sendNoteEmail('  doc@example.com  ', '  קבלה  ', 'גוף מלא\nשורה 2');
    expect(result).toEqual({ messageId: 'msg-123', threadId: 'thr-456' });

    expect(cloud.ensureAnonymousAuth).toHaveBeenCalled();
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [fnName, opts] = invokeSpy.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe('send-note-email');
    expect(opts.body).toEqual({
      to: 'doc@example.com',
      subject: 'קבלה',
      // Body is NOT trimmed — clinical notes can have leading/trailing blank lines
      // that carry structure. Only to/subject get the trim.
      body: 'גוף מלא\nשורה 2',
    });
  });

  it('requires an anonymous-auth session before invoking the function', async () => {
    invokeSpy.mockResolvedValueOnce({
      data: { ok: true, messageId: 'm', threadId: 't' },
      error: null,
    });
    await sendNoteEmail('a@b.co', 'subj', 'body');
    // ensureAnonymousAuth must be called BEFORE invoke, so the JWT is in place
    // for the verify_jwt=true check on the function side.
    const authOrder = (cloud.ensureAnonymousAuth as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const invokeOrder = invokeSpy.mock.invocationCallOrder[0]!;
    expect(authOrder).toBeLessThan(invokeOrder);
  });
});

describe('sendNoteEmail — error surfacing', () => {
  it('rethrows supabase-js transport errors unchanged', async () => {
    invokeSpy.mockResolvedValueOnce({
      data: null,
      error: new Error('FunctionsHttpError: 401 Unauthorized'),
    });
    await expect(sendNoteEmail('a@b.co', 'subj', 'body')).rejects.toThrow(/401 Unauthorized/);
  });

  it('throws on {ok:false} with the function-provided error message', async () => {
    invokeSpy.mockResolvedValueOnce({
      data: { ok: false, error: 'Gmail OAuth not configured' },
      error: null,
    });
    await expect(sendNoteEmail('a@b.co', 'subj', 'body')).rejects.toThrow(/Gmail OAuth not configured/);
  });

  it('throws on unexpected empty response', async () => {
    invokeSpy.mockResolvedValueOnce({ data: null, error: null });
    await expect(sendNoteEmail('a@b.co', 'subj', 'body')).rejects.toThrow(/empty response/);
  });
});
