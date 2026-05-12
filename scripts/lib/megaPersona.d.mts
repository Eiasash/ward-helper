/**
 * Type declarations for `./megaPersona.mjs`. Exists because tsconfig has
 * `strict: true` (→ noImplicitAny) and `include: [...,"scripts"]`, so
 * `tests/megaPersonaRebound.test.ts`'s import from a `.mjs` file would
 * otherwise implicitly resolve to `any` and fail typecheck.
 *
 * Keep in sync with `megaPersona.mjs` — the `.mjs` is the source of truth
 * for runtime behavior; this file only describes its public shape to TS.
 */

export function reboundIfOffBase(
  page: { url(): string; goto(url: string, opts?: object): Promise<unknown> },
  baseOrigin: string,
  basePathname: string,
  baseUrl: string,
  tally: { rebound_attempts: number; rebound_successes: number },
): Promise<void>;

export function tryRecoverFromPageDeath(
  page: { goto(url: string, opts?: object): Promise<unknown> },
  baseUrl: string,
  persona: { name: string },
  picked: { name: string },
  logBug: (sev: string, cat: string, name: string, msg: string) => void,
  tally: { layer2_recoveries: number },
): Promise<'recovered' | 'unrecoverable'>;
