/**
 * Type declarations for the testable surface of `./ward-helper-mega-bot.mjs`.
 * Exists because tsconfig has `strict: true` (→ noImplicitAny) and
 * `include: [...,"scripts"]`, so `tests/megaBotKnownIssueTrigger.test.ts`'s
 * import from a `.mjs` would otherwise resolve to `any` and fail typecheck.
 * Same pattern as `scripts/analyze-mega-run.d.mts`.
 *
 * Keep in sync with `ward-helper-mega-bot.mjs` — the `.mjs` is the source
 * of truth for runtime behavior; this file only describes its public shape.
 */

export interface Bug {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  scenario_id: string;
  where: string;
  what: string;
  evidence?: unknown;
  at: string;
}

export interface KnownIssueTrigger {
  match: RegExp;
  label: string;
  kickoff: string;
}

export const KNOWN_ISSUE_TRIGGERS: KnownIssueTrigger[];

export const BUGS: Bug[];

export function logBug(
  severity: Bug['severity'],
  scenario_id: string,
  where: string,
  what: string,
  evidence?: unknown,
): void;

export function matchedKnownIssues(
  bugs?: Bug[],
): Array<{ t: KnownIssueTrigger; hits: Bug[] }>;

export function knownIssueReportLines(bugs?: Bug[]): string[];
