/**
 * Pure-render tests for the small presentational components in src/ui/components.
 * These were previously only mounted via the screen-level tests in
 * src/ui/screens/__tests__/, which exercised them transitively but never
 * pinned down their per-prop rendering contract. A regression in pill colors,
 * threshold conditions, or banner gating could slip through unnoticed.
 *
 * Each component is also a clinical-safety surface — Beers/STOPP/ACB pills
 * drive the doctor's at-a-glance read on a patient's polypharmacy risk, the
 * confidence pill drives the manual-confirm gate, and the continuity banner
 * controls whether an admission body bleeds into a SOAP prompt. Worth pinning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ConfidencePill } from '@/ui/components/ConfidencePill';
import { FieldRow, isRowConfirmed } from '@/ui/components/FieldRow';
import { SafetyPills } from '@/ui/components/SafetyPills';
import { ContinuityBanner } from '@/ui/components/ContinuityBanner';
import type { ContinuityContext } from '@/notes/continuity';
import type { Note, Patient } from '@/storage/indexed';

afterEach(() => cleanup());

function mkPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'p',
    name: 'דוד לוי',
    teudatZehut: '012345678',
    dob: '1944-03-01',
    room: '3-12',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function mkNote(overrides: Partial<Note>): Note {
  return {
    id: 'n',
    patientId: 'p',
    type: 'admission',
    bodyHebrew: '',
    structuredData: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('ConfidencePill', () => {
  it('renders the level text verbatim', () => {
    render(<ConfidencePill level="high" />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders med', () => {
    render(<ConfidencePill level="med" />);
    expect(screen.getByText('med')).toBeInTheDocument();
  });

  it('renders low', () => {
    render(<ConfidencePill level="low" />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('falls back to low when level is undefined (extract turns can omit this for non-critical fields)', () => {
    render(<ConfidencePill level={undefined} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });
});

describe('isRowConfirmed (pure)', () => {
  it('low confidence is never auto-confirmed', () => {
    expect(isRowConfirmed('low', false, false)).toBe(false);
    expect(isRowConfirmed('low', true, false)).toBe(false);
  });

  it('low confidence becomes confirmed after explicit confirm', () => {
    expect(isRowConfirmed('low', false, true)).toBe(true);
  });

  it('med/high confidence is auto-confirmed regardless of critical flag', () => {
    expect(isRowConfirmed('med', false, false)).toBe(true);
    expect(isRowConfirmed('med', true, false)).toBe(true);
    expect(isRowConfirmed('high', true, false)).toBe(true);
  });

  it('critical+missing confidence (undefined) is NOT auto-confirmed — extract turn must emit confidence for the critical-3', () => {
    expect(isRowConfirmed(undefined, true, false)).toBe(false);
    expect(isRowConfirmed(undefined, true, true)).toBe(true);
  });

  it('non-critical+missing confidence is fine without manual confirm', () => {
    expect(isRowConfirmed(undefined, false, false)).toBe(true);
  });
});

describe('FieldRow', () => {
  it('shows the confirm button only when needsConfirm and not yet confirmed', () => {
    render(
      <FieldRow
        label="שם"
        value="דוד"
        confidence="low"
        critical
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /אישור ידני נדרש/ })).toBeInTheDocument();
  });

  it('clicking the confirm button hides it', () => {
    render(
      <FieldRow
        label="שם"
        value="דוד"
        confidence="low"
        critical
        onChange={() => undefined}
      />,
    );
    const btn = screen.getByRole('button', { name: /אישור ידני נדרש/ });
    fireEvent.click(btn);
    expect(screen.queryByRole('button', { name: /אישור ידני נדרש/ })).not.toBeInTheDocument();
  });

  it('does not render the confirm button at high confidence', () => {
    render(
      <FieldRow
        label="גיל"
        value="82"
        confidence="high"
        critical
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /אישור ידני נדרש/ })).not.toBeInTheDocument();
  });

  it('fires onChange with the new value when the input changes', () => {
    const onChange = vi.fn();
    render(
      <FieldRow
        label="שם"
        value="דוד"
        confidence="high"
        onChange={onChange}
      />,
    );
    const input = screen.getByDisplayValue('דוד') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'דוד לוי' } });
    expect(onChange).toHaveBeenCalledWith('דוד לוי');
  });
});

describe('SafetyPills', () => {
  it('returns null when no note has safetyFlags', () => {
    const { container } = render(<SafetyPills notes={[mkNote({})]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when flags are all empty / below ACB threshold', () => {
    const note = mkNote({
      safetyFlags: { beers: [], stopp: [], start: [], acbScore: 2 },
    });
    const { container } = render(<SafetyPills notes={[note]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Beers ×N when beers list is non-empty', () => {
    const note = mkNote({
      safetyFlags: {
        beers: [
          { code: 'BEERS-DIAZEPAM', drug: 'Diazepam', recommendation: 'הימנע', severity: 'high' },
          { code: 'BEERS-DIPHEN', drug: 'Diphenhydramine', recommendation: 'הימנע', severity: 'high' },
        ],
        stopp: [],
        start: [],
        acbScore: 0,
      },
    });
    render(<SafetyPills notes={[note]} />);
    expect(screen.getByText('Beers ×2')).toBeInTheDocument();
    expect(screen.queryByText(/STOPP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ACB=/)).not.toBeInTheDocument();
  });

  it('renders STOPP ×N when stopp list is non-empty', () => {
    const note = mkNote({
      safetyFlags: {
        beers: [],
        stopp: [
          { code: 'STOPP-B7', drug: 'Aspirin + Apixaban', recommendation: 'הפסק אחת', severity: 'high' },
        ],
        start: [],
        acbScore: 0,
      },
    });
    render(<SafetyPills notes={[note]} />);
    expect(screen.getByText('STOPP ×1')).toBeInTheDocument();
  });

  it('shows ACB pill at score 3 (amber) but not at score 2', () => {
    const at2 = mkNote({
      safetyFlags: { beers: [], stopp: [], start: [], acbScore: 2 },
    });
    const at3 = mkNote({
      safetyFlags: { beers: [], stopp: [], start: [], acbScore: 3 },
    });
    const { rerender } = render(<SafetyPills notes={[at2]} />);
    expect(screen.queryByText(/ACB=/)).not.toBeInTheDocument();
    rerender(<SafetyPills notes={[at3]} />);
    expect(screen.getByText('ACB=3')).toBeInTheDocument();
  });

  it('shows ACB pill in white text at score >= 6 (delirium/falls risk threshold)', () => {
    const note = mkNote({
      safetyFlags: { beers: [], stopp: [], start: [], acbScore: 7 },
    });
    render(<SafetyPills notes={[note]} />);
    const pill = screen.getByText('ACB=7');
    // At score >= 6 the pill flips to white-on-red; below 6 it's black-on-amber.
    // White text is the cleanest happy-dom-friendly proxy for "red bucket".
    expect(pill.style.color).toBe('white');
  });

  it('shows ACB pill in black text at score 3-5 (amber bucket)', () => {
    const note = mkNote({
      safetyFlags: { beers: [], stopp: [], start: [], acbScore: 4 },
    });
    render(<SafetyPills notes={[note]} />);
    const pill = screen.getByText('ACB=4');
    expect(pill.style.color).toBe('black');
  });

  it('uses the newest note that carries flags (linear scan, not aggregation)', () => {
    const noflags = mkNote({ id: 'old' });
    const flagged = mkNote({
      id: 'new',
      safetyFlags: {
        beers: [{ code: 'BEERS-DIAZEPAM', drug: 'Diazepam', recommendation: 'הימנע', severity: 'high' }],
        stopp: [],
        start: [],
        acbScore: 0,
      },
    });
    render(<SafetyPills notes={[noflags, flagged]} />);
    expect(screen.getByText('Beers ×1')).toBeInTheDocument();
  });
});

describe('ContinuityBanner', () => {
  function emptyCtx(over: Partial<ContinuityContext> = {}): ContinuityContext {
    return {
      patient: null,
      admission: null,
      priorSoaps: [],
      mostRecentSoap: null,
      episodeStart: null,
      ...over,
    };
  }

  it('returns null when no patient is resolved', () => {
    const { container } = render(
      <ContinuityBanner ctx={emptyCtx()} enabled={false} onToggle={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when patient exists but episode is stale (no admission, no priors)', () => {
    const ctx = emptyCtx({ patient: mkPatient() });
    const { container } = render(
      <ContinuityBanner ctx={ctx} enabled={false} onToggle={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders admission line when admission exists', () => {
    const adm = mkNote({ type: 'admission', createdAt: Date.parse('2026-04-20') });
    const ctx = emptyCtx({ patient: mkPatient(), admission: adm });
    render(<ContinuityBanner ctx={ctx} enabled={false} onToggle={() => undefined} />);
    expect(screen.getByText(/קבלה מ-/)).toBeInTheDocument();
    expect(screen.getByText(/דוד לוי/)).toBeInTheDocument();
  });

  it('renders SOAP count when priorSoaps is non-empty', () => {
    const adm = mkNote({ type: 'admission', createdAt: 1 });
    const s1 = mkNote({ type: 'soap', createdAt: 2, id: 's1' });
    const s2 = mkNote({ type: 'soap', createdAt: 3, id: 's2' });
    const ctx = emptyCtx({
      patient: mkPatient(),
      admission: adm,
      priorSoaps: [s2, s1],
      mostRecentSoap: s2,
    });
    render(<ContinuityBanner ctx={ctx} enabled={false} onToggle={() => undefined} />);
    expect(screen.getByText(/2 SOAP קודמים/)).toBeInTheDocument();
  });

  it('checkbox reflects the enabled prop and fires onToggle', () => {
    const adm = mkNote({ type: 'admission', createdAt: 1 });
    const ctx = emptyCtx({ patient: mkPatient(), admission: adm });
    const onToggle = vi.fn();
    render(<ContinuityBanner ctx={ctx} enabled={false} onToggle={onToggle} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
