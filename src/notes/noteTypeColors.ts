/**
 * Color tokens per note type. Reduces wrong-template mistakes by giving
 * each type a consistent visual signature: top border on the editor,
 * button accent, small badge in the header strip.
 *
 * Spec mapping (2026-04-28 visual overhaul):
 *   admission → blue
 *   discharge → green
 *   consult   → amber
 *   case      → purple
 *   soap      → teal (existing accent — daily handoff sits in the "default" lane)
 *   census    → grey (administrative — never a clinical-paste mistake)
 */
import type { NoteType } from '@/storage/indexed';

export interface NoteTypeColor {
  /** Hex/rgb fill, used for borders + badge backgrounds. */
  color: string;
  /** Soft variant for backgrounds. */
  soft: string;
  /** Foreground color when overlaid on the soft variant. */
  fg: string;
  /** 2-character Hebrew badge label (fits in the header strip). */
  badge: string;
}

// `color` doubles as a button background paired with white text, so each value
// must hit ≥ 4.5:1 contrast against #fff (WCAG AA normal text). Tailwind 500
// shades fail (blue-500 = 3.67, emerald-500 = 2.54, amber-500 = 1.95,
// purple-500 = 3.05); 600/700 shades pass.
export const NOTE_TYPE_COLORS: Record<NoteType, NoteTypeColor> = {
  admission: {
    color: '#2563eb', // blue-600 · 5.17:1 on white
    soft: 'rgba(59, 130, 246, 0.16)',
    fg: '#93c5fd',
    badge: 'קב',
  },
  discharge: {
    color: '#047857', // emerald-700 · 5.51:1 on white
    soft: 'rgba(16, 185, 129, 0.16)',
    fg: '#6ee7b7',
    badge: 'שח',
  },
  consult: {
    color: '#b45309', // amber-700 · 5.16:1 on white
    soft: 'rgba(245, 158, 11, 0.18)',
    fg: '#fcd34d',
    badge: 'יע',
  },
  case: {
    color: '#7e22ce', // purple-700 · 5.93:1 on white
    soft: 'rgba(168, 85, 247, 0.18)',
    fg: '#d8b4fe',
    badge: 'מק',
  },
  soap: {
    color: '#14919B', // 4.59:1 on white
    soft: 'rgba(20, 145, 155, 0.16)',
    fg: '#5eead4',
    badge: 'SOAP',
  },
  census: {
    color: '#4b5563', // gray-600 · 7.38:1 on white
    soft: 'rgba(107, 114, 128, 0.16)',
    fg: '#9ca3af',
    badge: 'רש',
  },
};

export function colorForNoteType(type: NoteType): NoteTypeColor {
  return NOTE_TYPE_COLORS[type];
}
