import type { Patient } from '@/storage/indexed';
import type { DaySnapshot } from '@/storage/rounds';

export const ROOM_NAME_PREFIX_LEN = 4;
export const HANDOVER_MIN_CHARS = 5;
export const DISCHARGE_STALE_GAP_MS = 24 * 60 * 60 * 1000;

export interface PreviousDayContext {
  patient: Patient;
  matchType: 'exact' | 'name-fallback';
  handoverNote: string;
  tomorrowNotes: string[];
}

function namePrefix(s: string): string {
  // Strip BIDI marks (LRM U+200E, RLM U+200F) and lowercase. First N chars.
  return s.replace(/[\u200E\u200F]/g, '').trim().toLocaleLowerCase().slice(0, ROOM_NAME_PREFIX_LEN);
}

function filterHandover(s: string | undefined): string {
  const t = (s ?? '').trim();
  return t.length > HANDOVER_MIN_CHARS ? t : '';
}

export function buildDayContinuity(
  currentRoster: Patient[],
  snapshotHistory: DaySnapshot[], // sorted descending by archivedAt
): Map<string, PreviousDayContext> {
  const out = new Map<string, PreviousDayContext>();
  const mostRecent = snapshotHistory[0];
  if (!mostRecent) return out;

  const livingYesterdays = mostRecent.patients.filter((p) => !p.discharged);

  for (const today of currentRoster) {
    const todayPrefix = namePrefix(today.name);

    // Try exact match: same room + name prefix
    let match = livingYesterdays.find(
      (prev) => prev.room === today.room && namePrefix(prev.name) === todayPrefix,
    );
    let matchType: 'exact' | 'name-fallback' = 'exact';

    // Fallback: name prefix only (room moved)
    if (!match) {
      match = livingYesterdays.find((prev) => namePrefix(prev.name) === todayPrefix);
      matchType = 'name-fallback';
    }

    if (!match) continue;

    out.set(today.id, {
      patient: match,
      matchType,
      handoverNote: filterHandover(match.handoverNote),
      tomorrowNotes: match.tomorrowNotes ?? [],
    });
  }

  return out;
}
