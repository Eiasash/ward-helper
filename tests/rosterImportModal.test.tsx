import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RosterImportModal } from '@/ui/components/RosterImportModal';

describe('RosterImportModal — smoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <RosterImportModal isOpen={false} onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders 3 tabs when open (paste / צילום / ידני)', () => {
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    expect(screen.getByRole('tab', { name: 'הדבקה' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'צילום' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ידני' })).toBeInTheDocument();
  });

  it('paste tab live-counts parsed rows + preview button enables', () => {
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    const textarea = screen.getByLabelText('טקסט להדבקה');
    fireEvent.change(textarea, {
      target: {
        value:
          '123456782 | רוזנברג מרים | 87 | 12 | A | 5 | Hip\n' +
          '234567890 | לוי דוד | 79 | 14 | B | 3 | CHF',
      },
    });
    expect(screen.getByText(/זוהו 2 שורות/)).toBeInTheDocument();
  });

  it('paste → preview → commit fires onCommit with parsed rows', () => {
    const onCommit = vi.fn();
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={onCommit} />,
    );
    const textarea = screen.getByLabelText('טקסט להדבקה');
    fireEvent.change(textarea, {
      target: { value: '123456782 | רוזנברג מרים | 87 | 12 | A | 5 | Hip' },
    });
    fireEvent.click(screen.getByText('תצוגה מקדימה ←'));
    // Preview phase: header changes + ייבא button appears
    expect(screen.getByText(/אישור ייבוא/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ייבא \(1\)/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rows = onCommit.mock.calls[0]?.[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('רוזנברג מרים');
    expect(rows[0].tz).toBe('123456782');
  });

  it('manual tab adds and parses rows; submitting moves to preview', () => {
    const onCommit = vi.fn();
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'ידני' }));
    const nameInput = screen.getByLabelText('שם');
    fireEvent.change(nameInput, { target: { value: 'מטופל ידני' } });
    fireEvent.click(screen.getByText('תצוגה מקדימה ←'));
    expect(screen.getByText(/אישור ייבוא/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ייבא \(1\)/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rows = onCommit.mock.calls[0]?.[0];
    expect(rows[0].name).toBe('מטופל ידני');
    expect(rows[0].sourceMode).toBe('manual');
  });

  it('preview-step "drop row" button removes a row before commit', () => {
    const onCommit = vi.fn();
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={onCommit} />,
    );
    fireEvent.change(screen.getByLabelText('טקסט להדבקה'), {
      target: {
        value:
          '123456782 | רוזנברג מרים | 87 | 12 | A | 5 | Hip\n' +
          '234567890 | לוי דוד | 79 | 14 | B | 3 | CHF',
      },
    });
    fireEvent.click(screen.getByText('תצוגה מקדימה ←'));
    fireEvent.click(screen.getByRole('button', { name: 'הסר שורה 2' }));
    fireEvent.click(screen.getByRole('button', { name: /ייבא \(1\)/ }));
    expect(onCommit).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'רוזנברג מרים' })]),
    );
    expect(onCommit.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('cancel button fires onClose without onCommit', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<RosterImportModal isOpen={true} onClose={onClose} onCommit={onCommit} />);
    fireEvent.click(screen.getByText('ביטול'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('back button on preview returns to input phase', () => {
    render(
      <RosterImportModal isOpen={true} onClose={vi.fn()} onCommit={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('טקסט להדבקה'), {
      target: { value: '123456782 | רוזנברג מרים | 87 | 12 | A | 5 | Hip' },
    });
    fireEvent.click(screen.getByText('תצוגה מקדימה ←'));
    expect(screen.getByText(/אישור ייבוא/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('← חזרה'));
    // Back to input phase — paste textarea is visible again
    expect(screen.getByLabelText('טקסט להדבקה')).toBeInTheDocument();
  });
});

// suppress unused-import warning when act isn't actually invoked
void act;
