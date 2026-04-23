import {
  listNotesByTeudatZehut,
  type Note,
  type Patient,
} from '@/storage/indexed';

export const EPISODE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ContinuityContext {
  patient: Patient | null;
  admission: Note | null;
  priorSoaps: Note[];
  mostRecentSoap: Note | null;
  episodeStart: number | null;
}

export async function resolveContinuity(teudatZehut: string): Promise<ContinuityContext> {
  const empty: ContinuityContext = {
    patient: null,
    admission: null,
    priorSoaps: [],
    mostRecentSoap: null,
    episodeStart: null,
  };

  const { patient, notes } = await listNotesByTeudatZehut(teudatZehut);
  if (!patient) return empty;

  const admissions = notes
    .filter((n) => n.type === 'admission')
    .sort((a, b) => b.createdAt - a.createdAt);
  const admission = admissions[0] ?? null;

  const soaps = notes
    .filter((n) => n.type === 'soap')
    .sort((a, b) => b.createdAt - a.createdAt);

  const episodeStart = admission?.createdAt ?? null;
  const stale = episodeStart !== null && Date.now() - episodeStart > EPISODE_WINDOW_MS;

  if (stale) {
    return { ...empty, patient };
  }

  return {
    patient,
    admission,
    priorSoaps: soaps,
    mostRecentSoap: soaps[0] ?? null,
    episodeStart,
  };
}
