/**
 * Type declarations for `./v42Invariant.mjs`. Exists because tsconfig has
 * `strict: true` (→ noImplicitAny) and `include: [...,"scripts"]`, so
 * `tests/megaBotV42.test.ts`'s import from a `.mjs` file would otherwise
 * implicitly resolve to `any` and fail typecheck.
 *
 * Keep in sync with `v42Invariant.mjs` — the `.mjs` is the source of truth
 * for runtime behavior; this file only describes its public shape to TS.
 */

export interface V42TimelineEvent {
  botSubject?: string | null;
  waitForSubjectCalled?: boolean;
  iterationCompleted?: boolean;
}

export interface V42SubBotCounts {
  waitCalled: number;
  iterCompleted: number;
}

export interface V42InvariantResult {
  /** Keyed by botSubject. Pre-populated with all V4_SUB_BOTS_REQUIRING_WAIT entries. */
  perSubBot: Record<string, V42SubBotCounts>;
  /** Subset where iterCompleted > waitCalled. Empty array = pass. */
  violators: Array<[string, V42SubBotCounts]>;
}

/**
 * Compute the per-sub-bot waitForSubject ratchet from a JSONL-decoded mega-bot
 * timeline. Pure function — no I/O.
 */
export function checkV42Invariant(timeline: ReadonlyArray<V42TimelineEvent | null | undefined>): V42InvariantResult;

/**
 * Frozen list of the four v4 sub-bots whose iterations MUST be preceded by a
 * waitForSubject() call. Co-located with sub-bot definitions in subBotsV4.mjs;
 * re-exported here for convenience and explicit-allowlist tests.
 */
export const V4_SUB_BOTS_REQUIRING_WAIT: ReadonlyArray<string>;
