/**
 * NoteEditor — section-by-section copy.
 *
 * The user spec covers four scenarios for the `splitIntoSections` parser
 * (used to drive the row of per-section copy buttons), plus an integration
 * check that the Chameleon sanitizer runs on each per-section copy. The
 * sanitizer is the clinical-safety net — every clipboard write must flow
 * through it, including these new per-section ones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

import { splitIntoSections } from '@/notes/sections';
import { NoteEditor } from '@/ui/screens/NoteEditor';

vi.mock('@/notes/orchestrate', () => ({
  generateNote: vi.fn(),
}));

import { generateNote } from '@/notes/orchestrate';

async function flushEffects() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(async () => {
  await flushEffects();
  cleanup();
  vi.clearAllMocks();
});

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/edit']}>
      <NoteEditor />
    </MemoryRouter>,
  );
}

describe('splitIntoSections — pure parser', () => {
  it('returns an empty array for empty body', () => {
    expect(splitIntoSections('')).toEqual([]);
    expect(splitIntoSections('   ')).toEqual([]);
  });

  it('returns a single פתיחה section when body has no headers', () => {
    const out = splitIntoSections('body without headers\nsecond line');
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('פתיחה');
    expect(out[0]!.body).toContain('body without headers');
    expect(out[0]!.body).toContain('second line');
  });

  it('splits a body with three headers into four sections (intro + 3)', () => {
    const body = [
      'intro line',
      '# רקע',
      'background line 1',
      'background line 2',
      '# מהלך אשפוז',
      'course line',
      '# המלצות',
      'recs line',
    ].join('\n');
    const out = splitIntoSections(body);
    expect(out).toHaveLength(4);
    expect(out[0]!.name).toBe('פתיחה');
    expect(out[0]!.body).toBe('intro line');
    expect(out[1]!.name).toBe('רקע');
    expect(out[1]!.body).toBe('# רקע\nbackground line 1\nbackground line 2');
    expect(out[2]!.name).toBe('מהלך אשפוז');
    expect(out[2]!.body).toBe('# מהלך אשפוז\ncourse line');
    expect(out[3]!.name).toBe('המלצות');
    expect(out[3]!.body).toBe('# המלצות\nrecs line');
  });

  it('preserves Chameleon-forbidden chars verbatim — sanitization is the caller’s job', () => {
    const body = '# רקע\nCr 2.1 → 1.8 **bold** q8h';
    const out = splitIntoSections(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain('→');
    expect(out[0]!.body).toContain('**bold**');
    expect(out[0]!.body).toContain('q8h');
  });
});

describe('NoteEditor — section copy buttons', () => {
  it('renders one button per section and runs sanitizeForChameleon on click', async () => {
    // Stub the model call to return a deterministic 3-section body with
    // one Chameleon-forbidden char per section.
    vi.mocked(generateNote).mockResolvedValue(
      '# רקע\nCr 2.1 → 1.8\n# המלצות\n**continue plan**',
    );
    sessionStorage.setItem('noteType', 'admission');
    sessionStorage.setItem('validated', JSON.stringify({}));

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderEditor();
    await flushEffects();

    // Header chips for the two sections (no intro since body starts with #).
    const rekaBtn = await screen.findByRole('button', { name: 'רקע' });
    expect(rekaBtn).toBeInTheDocument();
    const recsBtn = screen.getByRole('button', { name: 'המלצות' });
    expect(recsBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(rekaBtn);
    });
    await flushEffects();

    expect(writeText).toHaveBeenCalledTimes(1);
    const callArgs = writeText.mock.calls[0] as unknown as [string];
    const written = callArgs[0];
    // Arrow → must have been replaced by " > " by sanitizeForChameleon.
    expect(written).not.toContain('→');
    expect(written).toContain(' > ');
    // The section's header line is included.
    expect(written).toContain('# רקע');
  });

  it('does not render the section row when body has no headers (single section)', async () => {
    vi.mocked(generateNote).mockResolvedValue('plain body without headers');
    sessionStorage.setItem('noteType', 'admission');
    sessionStorage.setItem('validated', JSON.stringify({}));

    renderEditor();
    await flushEffects();

    // The "העתק הכל" button still renders, but the per-section row does not
    // (single section = no chips).
    expect(
      screen.queryByRole('toolbar', { name: 'העתק לפי קטע' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /העתק הכל/ })).toBeInTheDocument();
  });
});
