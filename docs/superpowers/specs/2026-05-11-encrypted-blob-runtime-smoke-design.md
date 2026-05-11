# ward-helper encrypted-blob runtime smoke layer — design

**Date:** 2026-05-11
**Status:** approved (brainstorming gate); ready for implementation plan
**Predecessors:** PR #56 (api-key cloud sync), PR #208 (Geri runtime smoke template), `feedback_invariant_triad.md` (canonical 3-layer invariant pattern)

## Goal

Add a runtime layer to ward-helper's encrypted-blob invariant triad. Today the layer has developer-time (TypeScript) + CI-time (`tests/apiKeyCloudSync.test.ts`, 9 tests) coverage. Runtime layer is missing — Geri PR #208 closed the equivalent gap for `auth_login_user.api_key → samega_apikey`, but that template does NOT transfer because Geri's wire is plaintext and ward-helper's wire is AES-GCM ciphertext gated by a user passphrase.

Smoke must catch: wire-format regressions, decrypt-path regressions, and persistence-step regressions across 4 user-data blob types (`patient`, `note`, `api-key`, `day-snapshot`).

## A. Architecture

**Location:** `scripts/smoke-blob-runtime.mjs` (new file). Shape mirrors Geri's `scripts/smoke-api-key-restore.mjs` from PR #208.

**Invocation:** `npm run smoke:blob-runtime` (new package.json script). Manual gate, NOT in `npm run check` or any pre-push hook. Same posture as Geri: developer runs after substantive cloud-sync changes; CI doesn't auto-gate (Supabase write smoke is too slow for every PR).

**Driver:** Playwright (already in devDependencies at `^1.59.1`). Single test file using `@playwright/test`. Runs against `npm run build && npm run preview` so the production code path is exercised, not the dev-server middleware.

**Scope of blob_types covered:**
- ✅ `patient`, `note`, `api-key`, `day-snapshot` — 4 user-data types, parameterized
- ⏭️ `canary` — **excluded by default**. Integrity probe with login-time write semantics, not a user-data round-trip; covered separately by `src/storage/canary.ts` and `src/storage/canaryProtection.ts`. Including it here would conflate two test scopes.

**Why two observations, not three:** the canonical Geri triad (`feedback_invariant_triad.md`) has obs 1 (network), obs 2 (deserialized JS value), obs 3 (persistence). For ward-helper, **obs 2 is dropped** because the deserialized JS value is the post-decrypt plaintext, and ward-helper has no `window`-exposed surfaces today (verified: `Object.assign(window, ...)` returns 0 matches across `src/`). Adding `__SMOKE__` window globals to preserve obs 2 was deliberately rejected — Geri's obs 2 is a coincidence of architecture (`window.authLogin` exists for auth UI reasons), not a design principle. The 2-observation chain (obs 1 + obs 3) has no middle step where a bug can lurk un-caught: fetch-broken fails obs 1, decrypt-broken or persistence-broken both fail obs 3. We lose diagnostic precision (obs-3 failure can't distinguish decrypt-vs-persistence at the assertion site), but catching power is intact.

## B. Fixtures + seeding

```
tests/fixtures/blob-seeds.ts     (new, exports BLOB_SEEDS object)
scripts/lib/seed-blobs.mjs       (new, seedAll + cleanup helpers)
scripts/smoke-blob-runtime.mjs   (new, the smoke driver)
```

**Fixture shape:**

```ts
export const BLOB_SEEDS: Record<BlobType, BlobSeed> = {
  'api-key':     { blobId: '__user_default__', plaintext: { v:1, apiKey: 'sk-ant-FAKE-FOR-SMOKE-DO-NOT-USE', savedAt: 1234567890 }, idbAssertion: /* IDB settings.apiKeyXor reader */ },
  'patient':     { blobId: 'smoke-patient-001',  plaintext: { /* PHI struct shape */ }, idbAssertion: /* IDB patients store getter */ },
  'note':        { blobId: 'smoke-note-001',     plaintext: { /* note shape */ },       idbAssertion: /* IDB notes store getter */ },
  'day-snapshot':{ blobId: '2026-05-11',          plaintext: { /* day state */ },        idbAssertion: /* IDB daySnapshots store getter */ },
};
```

**Seeding contract — `seedAll(supabase, passphrase, seeds)`:**

1. **Imports `src/crypto/pbkdf2.ts` + `src/crypto/aes.ts` directly** (Node-side execution). This is a deliberate wire-format coupling — when the wire format bumps to `v:2`, fixtures stop decrypting → harness fails → developer updates fixtures → diff documents the migration. Schema-version drift becomes detectable rather than silent. **This coupling is a feature, not a cost** (per Eias gate-2 reasoning: "with Option 1 you couple to the wire format, which is what's actually being tested; with Option 2 you couple to the runtime behavior of the system you're trying to test, which is the worst possible coupling").
2. For each `[blob_type, { blobId, plaintext }]`: derive AES key via PBKDF2(passphrase, fresh 16-byte random salt), AES-GCM encrypt JSON-stringified plaintext with fresh 12-byte IV, INSERT into `ward_helper_backup (user_id, blob_type, blob_id, ciphertext, iv, salt, updated_at)` via `INSERT ... ON CONFLICT (user_id, blob_type, blob_id) DO UPDATE SET ...`.
3. Returns the seeded `{ ciphertext, iv, salt }` per blob_type so the obs-1 oracle has reference values. Salts are NOT pre-determined — they're random per encryption (matching the production code path) and recorded for the assertion.

**Why the oracle problem matters here** (per Eias gate-2 reasoning): if the harness used the system's own output as the expected value (Options B/C in the seeding gate), `aes.ts` could silently regress (wrong IV nonce, key derivation drift, garbage padding) and the smoke would match the regression bit-for-bit. The whole point of a smoke test is a reference outside the system being tested. SQL-seeded ciphertext gives us that external reference.

**Cleanup contract — `cleanupAll(supabase, userId)`:** `DELETE FROM ward_helper_backup WHERE user_id = $1`. Runs on test exit (success or failure).

## C. Per-blob_type observation contract (obs 1 + obs 3)

For each of the 4 blob_types, the parameterized test asserts **two observations of one expected value**. Numbering preserves the Geri canonical triad (1 = wire, 3 = persistence) so cross-references to PR #208 stay clean; obs 2 is dropped per §A.

**Obs 1 — wire layer** (tight oracle, per Eias gate-3 refinement):

```js
const response = await page.waitForResponse(r =>
  r.url().includes('/rest/v1/ward_helper_backup') && r.request().method() === 'GET'
);
expect(response.headers()['content-type']).toMatch(/application\/json/);
const body = await response.json();
const row = body.find(r => r.blob_type === blobType && r.blob_id === fixture.blobId);
expect(row.ciphertext).toBe(seededCiphertext);  // exact match against what seedAll produced
expect(row.iv).toBe(seededIv);
expect(row.salt).toBe(seededSalt);
```

Catches: server returned wrong row, RLS denied (empty body 200), wire format regression, ciphertext corrupted in transit. The exact-match against seeded values is non-optional — a `200 OK` with empty body would silently pass a `status === 200` check.

**Use `page.waitForResponse`, NOT `page.route`.** `route()` lets you stub/transform, defeating runtime observation. The next maintainer will instinctively reach for `route()`; an in-line warning comment is mandatory in the smoke script.

**Obs 3 — persistence layer** (deterministic wait, per Eias gate-3 refinement):

```js
await page.waitForFunction(
  ([store, key, expected]) => /* IDB getter; deep-equal against expected */,
  [fixture.idbStore, fixture.idbKey, fixture.plaintext],
  { timeout: 10_000 }
);
```

Catches: decrypt threw (no plaintext lands → timeout), decrypt produced garbage (deep-equal fails → timeout), persistence step skipped (no IDB write → timeout). **No `page.waitForTimeout`, no fixed sleeps.** Both observations are await-on-condition. Flaky tests train developers to ignore them.

## D. Burner account + ward_helper_backup lifecycle + env vars

Three env vars (parallel to Geri smoke):

```
TEST_USER         - burner username, e.g. 'smoke-runtime-001'
TEST_PASS         - auth password for the burner
TEST_PASSPHRASE   - encryption passphrase for the encrypted-blob layer
```

### D.1 — `app_users` (burner account) lifecycle

**Create** — SQL `INSERT ... ON CONFLICT` against `app_users` using `extensions.crypt`/`gen_salt`:

```sql
INSERT INTO app_users (username, password_hash)
VALUES ($1, extensions.crypt($2, extensions.gen_salt('bf', 10)))
ON CONFLICT (username) DO UPDATE
SET password_hash = extensions.crypt($2, extensions.gen_salt('bf', 10));
```

Setup deliberately does NOT call the `auth_register_user` RPC (per canonical shape: setup must not exercise subsystems the smoke excludes).

**Cleanup** — `DELETE FROM app_users WHERE username = $TEST_USER` after smoke run.

**Concurrency safety** — for parallel CI runs, suffix `TEST_USER` with `${process.env.GITHUB_RUN_ID || Date.now()}` so burners don't collide.

### D.2 — `ward_helper_backup` (encrypted-blob fixtures) lifecycle

This is the larger lifecycle step — bigger in lines of code than D.1.

**Salt strategy:** per-row random, stored in `ward_helper_backup.salt bytea` (migration 0001 schema). **There is no per-user salt to coordinate** — `encryptForCloud` (in `src/storage/cloud.ts:62`) generates fresh 16-byte random salt + fresh 12-byte IV per encryption call; `cloud.ts:140-141` confirms decrypt reads salt back from the row. So the harness mints fresh `(salt, iv, ciphertext)` per fixture per run, INSERTs all three, and the obs-1 oracle compares against the values it minted.

**Seed** — for each blob_type fixture in `BLOB_SEEDS`:

```js
// In Node, using src/crypto primitives directly:
const salt = crypto.getRandomValues(new Uint8Array(16));
const key  = await deriveAesKey(TEST_PASSPHRASE, salt);  // PBKDF2 600k iter
const iv   = crypto.getRandomValues(new Uint8Array(12));
const pt   = new TextEncoder().encode(JSON.stringify(fixture.plaintext));
const ct   = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));

await supabase.from('ward_helper_backup').upsert({
  user_id: testUserId,
  blob_type: blobType,
  blob_id:   fixture.blobId,
  ciphertext: btoa(String.fromCharCode(...ct)),  // base64 per cloud.ts:128 typing
  iv:         btoa(String.fromCharCode(...iv)),
  salt:       btoa(String.fromCharCode(...salt)),
  updated_at: new Date().toISOString(),
}, { onConflict: 'user_id,blob_type,blob_id' });

seededValues[blobType] = { ciphertext, iv, salt };  // record for obs-1 oracle
```

**Cleanup** — `DELETE FROM ward_helper_backup WHERE user_id = $TEST_USER_ID` (via the burner's user_id, looked up from `app_users`).

## E. Forced-fail dry-run + ops

Per the canonical shape: a smoke that always passes is worse than no smoke. The spec ships three forced-fail modes, each with a distinct **regression class** so the failure report is individually actionable:

| Mode | Trigger | Expected failure | Regression class |
|------|---------|------------------|------------------|
| `SMOKE_FORCE_FAIL=ciphertext` | flip a byte in the seeded ciphertext after INSERT | obs 1 fails: `ciphertext mismatch` | wire layer (server returned wrong/corrupted row) |
| `SMOKE_FORCE_FAIL=passphrase` | pass wrong passphrase to the browser session | obs 3 times out: `IDB plaintext never landed` | production decrypt path broken (real bug class — what the smoke exists to catch) |
| `SMOKE_FORCE_FAIL=plaintext` | mutate `BLOB_SEEDS[*].plaintext` after seeding INSERT | obs 3 times out: `IDB plaintext mismatch` | fixture drift / harness self-test (test-side bug, not production bug) |

Modes 2 and 3 BOTH fail obs 3, but the regression-class annotation distinguishes them in the failure message — the production decrypt regression (mode 2) and the fixture drift (mode 3) lead to different fixes. Without the annotation they'd be functionally redundant in the failure report.

**Meta-test** — `npm run smoke:blob-runtime:dry-fail-all` runs all three, asserts each fails with the expected regression-class string, exits 0 only if 3/3 fail correctly. This is the test-the-test that prevents silent rot (assertions that fire-but-don't-actually-assert, mocks that swallow errors).

## F. Deliberately NOT in scope

- **Push leg** — covered by existing CI tests in `tests/apiKeyCloudSync.test.ts` (9 tests). The smoke covers the unobserved surface (apply leg in a real browser); the push leg is well-covered by unit tests.
- **`canary` blob_type** — its own subsystem (`src/storage/canary.ts`, `src/storage/canaryProtection.ts`) with its own tests. Smoking it would conflate test scopes.
- **`src/crypto` refactor** — Eias gate-1 explicitly rejected refactor-without-coverage. The runtime layer's purpose is to test what exists, not to motivate a refactor. A `src/crypto` refactor needs its own independent justification (specific drift, specific bug, specific maintenance burden) — not implied by this work. **The runtime smoke is the safety net that makes a future refactor attemptable**, not a trigger for it.
- **Conflict resolution / multi-device race semantics** — not part of "the chain works" runtime invariant. If multi-device race conditions become a real bug class, that gets its own design.
- **Refactoring the `src/notes/save.ts:398-443` if/else dispatch ladder** — centralization could be tighter, but no current bug forces it. YAGNI.
- **Adding window-exposed diagnostic globals** — explicitly rejected at gate 3 (cargo-cult; the smoke catches what it needs to without them).
- **A 4th forced-fail mode** — three modes cover the three regression classes (wire / production-decrypt / fixture-drift). Adding more is over-engineering.

## Open items for the implementation plan

These are the first things to verify when writing the harness, not blockers to the spec:

1. **Patient / note / day-snapshot plaintext shapes** — fill in `BLOB_SEEDS` placeholders by reading `src/notes/save.ts:398-443` to see what each apply branch expects, plus the IDB schema in `src/storage/` for the persistence-side reads.
2. **PBKDF2 in Node** — ward-helper's `pbkdf2.ts` uses `crypto.subtle` (browser API). Node 22+ has `crypto.subtle` natively, so the same module import should work; verify on the Node version the smoke runs against.
3. **Supabase service-role key vs anon key** — seedAll needs to bypass RLS to INSERT ciphertext on behalf of the burner. Confirm test env has a service-role key (probably already does, from the existing canary protection tests).
4. **TEST_USER suffix collision behavior** — verify `INSERT ... ON CONFLICT (username)` actually replaces password_hash so re-running with the same env vars works. Already in the spec but worth a manual check before the harness ships.

## Reasoning provenance (why the spec looks like this)

Brainstorming gate 1 (scope): chose Option 2 = parameterize across 4 blob_types. Rejected Option 1 (api-key-only) as parochial; rejected Option 3 (`src/crypto` refactor) as refactor-without-coverage anti-pattern.

Brainstorming gate 2 (seeding): chose Option 1 = SQL-seed pre-encrypted ciphertext via Node-side import of `src/crypto`. Rejected Options 2/3 (browser-bootstrapped fixtures) as oracle-problem violations — using the system's own output as the expected value defeats the smoke.

Brainstorming gate 3 (observations): chose Option 1 = two-observation smoke (obs 1 + obs 3, drop obs 2). Rejected Option 2 (add `__SMOKE__` window globals) as cargo-cult preservation of canonical shape; rejected Option 3 (UI-driven) as confusing the smoke/integration boundary.
