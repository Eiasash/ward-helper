# Encrypted-blob Runtime Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the runtime smoke layer for ward-helper's encrypted-blob invariant triad as specified in `docs/superpowers/specs/2026-05-11-encrypted-blob-runtime-smoke-design.md` (with corrections in PR #140's Edits block). Parameterized over 4 user-data blob_types (`patient`, `note`, `api-key`, `day-snapshot`); SQL-seeded ciphertext via Node-side `src/crypto` import; two-observation contract (wire RPC response + IDB/localStorage persistence); three forced-fail dry-run modes annotated by distinct regression class.

**Architecture:** **Bare Node ESM script using raw `playwright` (chromium.launch), NOT `@playwright/test` framework.** This mirrors Geri's verified shape (`~/repos/Geriatrics/scripts/smoke-api-key-restore.mjs`, PR #208): single async script, no config file, no `test()` blocks, runs against the live URL by default with `SMOKE_URL` override. Service-role Supabase client used ONLY for `ward_helper_backup` seed/cleanup (RLS bypass for the encrypted-blob table); burner row in `app_users` is pre-seeded ONCE via manual SQL paste, reused across runs.

**Tech Stack:** TypeScript (`tests/fixtures/blob-seeds.ts`), Node 22+ ESM (`scripts/*.mjs`), `playwright ^1.59.x` (raw — same major version already in devDependencies as `@playwright/test`), `@supabase/supabase-js ^2.45.0` with service-role key, `crypto.subtle` (Node-native in 22+). **No bcrypt dep, no playwright.config.ts, no `@playwright/test` framework.**

---

## Why this plan looks the way it does

This plan was rewritten on 2026-05-11 after the first draft overshot architecturally. The first draft assumed `@playwright/test` framework + bcrypt-in-Node + programmatic `app_users` UPSERT via service-role + per-run username suffix — a substantial stack that would *work* but was much heavier than necessary. Reading Geri's smoke (the citation the spec already named) confirmed Geri does it in ~200 lines of bare Node + raw playwright + one-time SQL paste. This rewrite collapses the harness to that shape.

Two memory rules captured today informed the rewrite:
- `feedback_design_gate_option_3_bias.md` — when proposing 2-3-option gates, the simpler option is right ~95% of the time when extending a disciplined existing system
- `feedback_view_source_before_cite.md` — when a plan cites a reference implementation, open it BEFORE writing the dependent section; memory-reconstruction accumulates "distance from reality"

The first draft violated both rules silently. This rewrite respects them.

---

## Pre-flight requirements

Before starting Task 2, confirm:

- `TEST_USER` — burner username (e.g. `ward-smoke-burner-001`). **Single, fixed, reused across all runs** (no per-run suffix; concurrency comes from running serially OR scoping per-CI-environment).
- `TEST_PASS` — auth password for the burner (`app_users.password_hash`).
- `TEST_PASSPHRASE` — encryption passphrase for the encrypted-blob layer (separate from `TEST_PASS`).
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — service-role bypasses RLS so `seedAll`/`cleanupAll` can INSERT/DELETE on `ward_helper_backup` regardless of the burner's runtime auth.uid(). **Service-role NOT used for `app_users` writes** — the burner row is pre-seeded once manually.

### One-time burner pre-seed (manual SQL — once per Supabase project)

Before the first smoke run in a given Supabase project, paste this in the Supabase SQL Editor for project `krmlzwwelqvlfslwltol`. Same shape as Geri's smoke pre-seed (verified in Geri's smoke header comment):

```sql
INSERT INTO app_users (username, password_hash)
VALUES (
  'ward-smoke-burner-001',
  extensions.crypt('REPLACE-WITH-TEST_PASS-VALUE', extensions.gen_salt('bf', 10))
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash;
```

The smoke does NOT mutate `app_users` — it just authenticates against the pre-seeded row. If the password needs to rotate, re-run this SQL with the new password. If the burner ever locks out (5 failed login attempts → 15 min lockout per existing app_users behavior), re-running the UPSERT resets the row.

### Schema reality (why the burner pre-seed shape works)

- `app_users` lives in a sibling repo's migration (shared Supabase project), not ward-helper. Confirmed columns: `username`, `password_hash`. **No `anon_user_id` column links app_users → Supabase auth.uid().**
- The binding between an app_users login and the encrypted-blob rows is implicit via the `username` column on `ward_helper_backup` (added by ward-helper migration 0003). When ward-helper pushes a blob while logged in, it sets `username = <app_users.username>` on the row alongside `user_id = auth.uid()`. When restoring, `pullByUsername(username)` SECURITY DEFINER RPC returns rows matching the username column, regardless of which auth.uid() owns them.
- **Implication for `seedAll`:** mints a synthetic UUID for the seeded rows' `user_id`. The smoke's runtime UI login generates a different anon UUID — that doesn't matter, because `pullByUsername` matches on `username`.

---

## Spec corrections — already shipped in PR #140

The spec's first-merged version (`7a0a0e9`) had 4 substantive errors I caught while writing this plan. They are corrected via a dated `Edits` block in **PR #140 (open as draft)**:

1. obs-1 URL is `/rest/v1/rpc/ward_helper_pull_by_username` POST, not `/rest/v1/ward_helper_backup` GET
2. canary is a precondition for restore (must seed alongside fixtures, even though excluded from assertion loop)
3. api-key persists to `localStorage.wardhelper_apikey`, not IDB `settings.apiKeyXor` (moved in v1.39.0)
4. "Mirrors Geri's smoke" cited but not verified — Geri uses raw `playwright`, not `@playwright/test` framework

**Land PR #140 before this plan's PR** so the spec on main is consistent with what this plan implements. The spec corrections are independent of plan architecture and don't depend on this plan landing.

---

### Task 1: BLOB_SEEDS fixture file (4 user-data + canary precondition)

**Files:**
- Create: `tests/fixtures/blob-seeds.ts`
- Create: `tests/fixtures/blob-seeds.test.ts`

This task is unchanged from the first draft — the fixture shape is independent of harness architecture (bare-script vs framework). Writing it first because Tasks 2-5 import from it.

- [ ] **Step 1: Write a failing schema test**

Create `tests/fixtures/blob-seeds.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES, CANARY_PRECONDITION } from './blob-seeds';

describe('BLOB_SEEDS', () => {
  it('covers exactly the 4 user-data blob_types', () => {
    expect(Object.keys(BLOB_SEEDS).sort()).toEqual(
      ['api-key', 'day-snapshot', 'note', 'patient']
    );
  });

  it('USER_DATA_BLOB_TYPES is the parameterized iteration order', () => {
    expect(USER_DATA_BLOB_TYPES).toEqual(['patient', 'note', 'api-key', 'day-snapshot']);
    USER_DATA_BLOB_TYPES.forEach((t) => expect(BLOB_SEEDS[t]).toBeDefined());
  });

  it('every fixture has blobId, plaintext, and persistenceLayer/Key', () => {
    for (const [type, seed] of Object.entries(BLOB_SEEDS)) {
      expect(seed.blobId, `${type}.blobId`).toMatch(/.+/);
      expect(seed.plaintext, `${type}.plaintext`).toBeDefined();
      expect(['idb', 'localStorage']).toContain(seed.persistenceLayer);
      expect(typeof seed.persistenceKey, `${type}.persistenceKey`).toBe('string');
    }
  });

  it('CANARY_PRECONDITION carries the canonical canary plaintext shape', () => {
    expect(CANARY_PRECONDITION.blobId).toBe('__canary__');
    expect(CANARY_PRECONDITION.plaintext.v).toBe(1);
    expect(CANARY_PRECONDITION.plaintext.marker).toBe('ward-helper-canary');
  });

  it('api-key fixture targets localStorage, not IDB (v1.39.0+ change)', () => {
    expect(BLOB_SEEDS['api-key'].persistenceLayer).toBe('localStorage');
    expect(BLOB_SEEDS['api-key'].persistenceKey).toBe('wardhelper_apikey');
  });

  it('non-api-key fixtures target IDB stores', () => {
    expect(BLOB_SEEDS['patient'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['patient'].persistenceKey).toBe('patients');
    expect(BLOB_SEEDS['note'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['note'].persistenceKey).toBe('notes');
    expect(BLOB_SEEDS['day-snapshot'].persistenceLayer).toBe('idb');
    expect(BLOB_SEEDS['day-snapshot'].persistenceKey).toBe('daySnapshots');
  });
});
```

- [ ] **Step 2: Run the test, expect failure (file doesn't exist yet)**

Run: `cd ~/repos/ward-helper && npm test -- tests/fixtures/blob-seeds.test.ts`
Expected: FAIL — `Cannot find module './blob-seeds'` or similar.

- [ ] **Step 3: Create `tests/fixtures/blob-seeds.ts`**

```ts
/**
 * Encrypted-blob runtime smoke fixtures.
 *
 * The 4 user-data blob_types are parameterized in the smoke. Canary is a
 * SYSTEM PRECONDITION (restoreFromCloud fast-fails on bad canary at
 * src/notes/save.ts:367) — seeded by seedAll, NOT in the parameterized
 * assertion loop.
 *
 * Plaintext shapes are minimal-valid per src/storage/indexed.ts and
 * src/storage/rounds.ts. Implementations evolve; if the apply ladder in
 * src/notes/save.ts:398-443 starts rejecting any of these, the fixture
 * needs to grow the missing field — that's the smoke catching a
 * production schema change, which is its job.
 */

export type UserDataBlobType = 'patient' | 'note' | 'api-key' | 'day-snapshot';

export interface BlobSeed {
  blobId: string;
  plaintext: unknown;
  /** Where the post-restore plaintext lands. */
  persistenceLayer: 'idb' | 'localStorage';
  /**
   * IDB store name (when persistenceLayer === 'idb') OR localStorage key
   * (when persistenceLayer === 'localStorage'). For IDB stores, the
   * persistence check looks up the row by the fixture's blob_id.
   */
  persistenceKey: string;
}

/** Iteration order for the parameterized smoke. Stable so reports stay diffable. */
export const USER_DATA_BLOB_TYPES: UserDataBlobType[] = [
  'patient',
  'note',
  'api-key',
  'day-snapshot',
];

const SMOKE_API_KEY_FIXTURE = {
  v: 1 as const,
  apiKey: 'sk-ant-FAKE-FOR-SMOKE-DO-NOT-USE',
  savedAt: 1234567890,
};

const SMOKE_PATIENT_FIXTURE = {
  id: 'smoke-patient-001',
  name: 'Smoke Patient',
  teudatZehut: '000000000',
  dob: '1950-01-01',
  room: null,
  tags: ['smoke'],
  createdAt: 1234567890,
  updatedAt: 1234567890,
};

const SMOKE_NOTE_FIXTURE = {
  id: 'smoke-note-001',
  patientId: 'smoke-patient-001',
  type: 'admission' as const,
  bodyHebrew: 'בדיקת smoke — לא לקלינית',
  structuredData: {},
  createdAt: 1234567890,
  updatedAt: 1234567890,
};

const SMOKE_DAY_SNAPSHOT_FIXTURE = {
  id: '2026-05-11',
  date: '2026-05-11',
  archivedAt: 1234567890,
  patients: [SMOKE_PATIENT_FIXTURE],
};

export const BLOB_SEEDS: Record<UserDataBlobType, BlobSeed> = {
  patient: {
    blobId: SMOKE_PATIENT_FIXTURE.id,
    plaintext: SMOKE_PATIENT_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'patients',
  },
  note: {
    blobId: SMOKE_NOTE_FIXTURE.id,
    plaintext: SMOKE_NOTE_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'notes',
  },
  'api-key': {
    blobId: '__user_default__',
    plaintext: SMOKE_API_KEY_FIXTURE,
    persistenceLayer: 'localStorage',
    persistenceKey: 'wardhelper_apikey',
  },
  'day-snapshot': {
    blobId: SMOKE_DAY_SNAPSHOT_FIXTURE.id,
    plaintext: SMOKE_DAY_SNAPSHOT_FIXTURE,
    persistenceLayer: 'idb',
    persistenceKey: 'daySnapshots',
  },
};

/**
 * Canary precondition: NOT a fixture under test, but MUST be seeded
 * alongside the 4 user-data fixtures or restoreFromCloud fast-fails
 * with wrongPassphrase: true at src/notes/save.ts:367.
 *
 * Shape per src/storage/canary.ts:32-41 (CanaryPayload + CANARY_PLAINTEXT
 * spread). createdAt is timestamped at seed time, not fixture-baked.
 */
export const CANARY_PRECONDITION = {
  blobType: 'canary' as const,
  blobId: '__canary__',
  plaintext: {
    v: 1 as const,
    marker: 'ward-helper-canary' as const,
    createdAt: 0, // overwritten at seed time
  },
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd ~/repos/ward-helper && npm test -- tests/fixtures/blob-seeds.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/blob-seeds.ts tests/fixtures/blob-seeds.test.ts
git commit -m "feat(smoke): BLOB_SEEDS fixtures for the 4 user-data blob_types

Typed fixture object keyed by blob_type with minimal-valid plaintext
per src/storage/indexed.ts + src/storage/rounds.ts. CANARY_PRECONDITION
exported separately — system precondition for restore, NOT in the
parameterized assertion loop.

api-key fixture correctly targets localStorage.wardhelper_apikey per
v1.39.0 storage migration; the other 3 target IDB stores.

6 schema-validity tests pin the contract. Persistence-check functions
live in the smoke driver script (Task 3), not the fixture file —
keeps the fixture import-safe in vitest (no playwright dependency).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: seed-blobs.mjs — encrypt + seed ward_helper_backup, cleanup

**Files:**
- Create: `scripts/lib/seed-blobs.mjs`

Pure Node ESM helper. **No bcrypt, no app_users provisioning** (the burner is pre-seeded once per Pre-flight). Service-role Supabase client used only for `ward_helper_backup` writes.

- [ ] **Step 1: Create `scripts/lib/seed-blobs.mjs`**

```js
// @ts-check
/**
 * Encrypted-blob smoke seeding. Pure Node ESM (no browser imports).
 *
 * Imports src/crypto primitives directly so the harness reproduces the
 * production wire format. When the format bumps to v:2 (or src/crypto's
 * AES-GCM signature changes), this module fails first — that's the
 * intended schema-version drift detection per spec §B.
 *
 * Usage:
 *   const ctx = await initContext();
 *   const seeded = await seedAll(ctx, process.env.TEST_PASSPHRASE);
 *   // ... drive the smoke against ctx.username ...
 *   await cleanupAll(ctx);
 *
 * setupBurner is intentionally absent — burner is pre-seeded ONCE in
 * Supabase via manual SQL paste (see plan Pre-flight section). This
 * mirrors Geri's smoke shape; programmatic burner provisioning was
 * ruled out as overshoot.
 */

import { createClient } from '@supabase/supabase-js';
import { deriveAesKey } from '../../src/crypto/pbkdf2.ts';
import { aesEncrypt } from '../../src/crypto/aes.ts';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES, CANARY_PRECONDITION } from '../../tests/fixtures/blob-seeds.ts';

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Establish Supabase service-role client + burner identity.
 * Mints a synthetic UUID for seeded rows' user_id; pullByUsername
 * matches on the username column (per migration 0003), so binding
 * to a real auth.uid() is unnecessary.
 */
export async function initContext() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TEST_USER', 'TEST_PASS', 'TEST_PASSPHRASE'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`seed-blobs initContext: missing env vars: ${missing.join(', ')}`);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return {
    supabase,
    username: process.env.TEST_USER,
    syntheticUserId: crypto.randomUUID(),
  };
}

/**
 * Seed canary + the 4 user-data fixtures. Returns the seeded
 * { ciphertext, iv, salt } per blob_type so obs 1 can compare exact
 * byte-equal values.
 *
 * Order matters: canary first so restoreFromCloud's line-367 fast-fail
 * check has a valid canary to verify. Without this, the smoke exits
 * with wrongPassphrase: true and obs 3 times out for wrong reasons.
 */
export async function seedAll(ctx, passphrase) {
  const { supabase, username, syntheticUserId } = ctx;
  const seeded = {};

  // 1. Canary precondition
  const canarySealed = await encryptOne(
    { ...CANARY_PRECONDITION.plaintext, createdAt: Date.now() },
    passphrase,
  );
  await insertBlob(supabase, syntheticUserId, username, 'canary', CANARY_PRECONDITION.blobId, canarySealed);

  // 2. The 4 user-data fixtures
  for (const blobType of USER_DATA_BLOB_TYPES) {
    const fixture = BLOB_SEEDS[blobType];
    const sealed = await encryptOne(fixture.plaintext, passphrase);
    await insertBlob(supabase, syntheticUserId, username, blobType, fixture.blobId, sealed);
    seeded[blobType] = sealed;
  }

  return seeded;
}

async function encryptOne(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(passphrase, salt);
  const { iv, ciphertext } = await aesEncrypt(JSON.stringify(plaintext), key);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

async function insertBlob(supabase, userId, username, blobType, blobId, sealed) {
  const { error } = await supabase
    .from('ward_helper_backup')
    .upsert({
      user_id: userId,
      username,
      blob_type: blobType,
      blob_id: blobId,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      salt: sealed.salt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,blob_type,blob_id' });
  if (error) throw new Error(`insertBlob ${blobType}/${blobId} failed: ${error.message}`);
}

/**
 * Tear down: delete every ward_helper_backup row carrying the burner's
 * username. Catches both seedAll's rows AND any rows the smoke's runtime
 * UI login pushed (canary auto-arm at login, etc.). Idempotent.
 *
 * Does NOT delete the app_users row — that's pre-seeded and reused.
 */
export async function cleanupAll(ctx) {
  const { supabase, username } = ctx;
  const { error } = await supabase
    .from('ward_helper_backup')
    .delete()
    .eq('username', username);
  if (error) console.warn(`cleanupAll: ${error.message} (ignored — re-run if needed)`);
}
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `cd ~/repos/ward-helper && node --check scripts/lib/seed-blobs.mjs`
Expected: silent success.

- [ ] **Step 3: Verify Node 22+ has crypto.subtle + crypto.randomUUID natively**

Run: `cd ~/repos/ward-helper && node -e "console.log(typeof crypto.subtle, typeof crypto.getRandomValues, typeof crypto.randomUUID)"`
Expected: `object function function`. If any are `undefined`, upgrade Node.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/seed-blobs.mjs
git commit -m "feat(smoke): seed-blobs helper — encrypts + INSERTs the 5 fixtures

Pure Node ESM helper that imports src/crypto primitives directly to
mint deterministic ciphertext+iv+salt. Service-role Supabase client
used ONLY for ward_helper_backup writes (RLS bypass for the encrypted-
blob table); burner row in app_users is pre-seeded once per Pre-flight,
not provisioned programmatically. Mirrors Geri's smoke shape (raw
script + manual burner pre-seed).

seedAll seeds canary first (precondition for restoreFromCloud's
fast-fail check at src/notes/save.ts:367) then the 4 user-data
fixtures, returning the sealed bytes for obs-1 byte-equal comparison.

Seeded rows use a synthetic user_id; pullByUsername matches on the
username column (migration 0003), so the smoke's runtime UI login
generates a different anon UUID without breaking the assertion path.

cleanupAll deletes by username (catches both seeded rows AND any
runtime canary/note pushes from the smoke's UI login). Burner row
in app_users is preserved across runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Smoke driver — bare Node script with raw playwright

**Files:**
- Create: `scripts/smoke-blob-runtime.mjs`
- Modify: `package.json` (add `smoke:blob-runtime` script + `playwright` to devDependencies if not already present as a peer of `@playwright/test`)

This task converts the spec's design intent into a bare Node script following Geri's verified shape. **No `playwright.config.ts`, no `@playwright/test` framework, no `test()` blocks.**

- [ ] **Step 1: Confirm `playwright` is available (peer of `@playwright/test`)**

Run: `cd ~/repos/ward-helper && npm ls playwright @playwright/test`
Expected: both listed (often `playwright` is a peer dep of `@playwright/test`). If `playwright` is missing, install: `npm install --save-dev playwright`. The smoke uses `import { chromium } from 'playwright'` directly.

- [ ] **Step 2: Add npm script to package.json**

In the `"scripts"` block (currently ends with `"test:coverage"`), add:

```json
    "test:coverage": "cross-env TZ=Asia/Jerusalem vitest run --coverage",
    "smoke:blob-runtime": "node scripts/smoke-blob-runtime.mjs",
    "smoke:blob-runtime:dry-fail-all": "node scripts/smoke-blob-runtime-dry-fail-all.mjs"
```

(`dry-fail-all` script is created in Task 5.)

- [ ] **Step 3: Create `scripts/smoke-blob-runtime.mjs`**

```js
#!/usr/bin/env node
// @ts-check
/**
 * smoke-blob-runtime.mjs — ward-helper runtime invariant for the 4
 * encrypted-blob types (patient, note, api-key, day-snapshot). Closes
 * the runtime-layer gap of the dev/CI/runtime triad for the encrypted-
 * blob chain. Mirrors the bare-script shape of Geri's
 * scripts/smoke-api-key-restore.mjs (PR #208).
 *
 * What this asserts (per blob_type, looped — see spec §C with PR #140 Edits):
 *
 *   (1) WIRE — page.waitForResponse on
 *       /rest/v1/rpc/ward_helper_pull_by_username POST. The matching row
 *       in the response body has ciphertext+iv+salt EXACTLY equal to what
 *       seedAll produced. Catches: server returned wrong row, RLS denied
 *       (empty body 200), wire format regression, ciphertext corrupted
 *       in transit.
 *
 *   (3) PERSIST — page.waitForFunction on the IDB store / localStorage key
 *       returns the decrypted plaintext deep-equal to the fixture. Catches:
 *       decrypt threw, decrypt produced garbage, persistence step skipped.
 *
 * Obs 2 (deserialized JS value) is dropped — ward-helper has no
 * window-exposed surfaces, so the post-decrypt plaintext can only be
 * observed via persistence side-effect. Documented in spec §A.
 *
 * Why page.waitForResponse, NOT page.route: route() lets you stub /
 * transform, defeating runtime observation. Resist the next-maintainer
 * instinct to switch to route() for "easier mocking" — the whole point
 * is the REAL Supabase RPC fires and we look at it.
 *
 * Exit codes
 *   0 — all blob_types' assertions held
 *   1 — at least one blob_type failed (or harness threw)
 *   2 — setup error (missing env vars, browser launch failure)
 */

import { chromium } from 'playwright';
import { initContext, seedAll, cleanupAll } from './lib/seed-blobs.mjs';
import { BLOB_SEEDS, USER_DATA_BLOB_TYPES } from '../tests/fixtures/blob-seeds.ts';

const URL = process.env.SMOKE_URL || 'https://eiasash.github.io/ward-helper/';
const HEADLESS = process.env.SMOKE_HEADLESS !== '0';
const NAV_TIMEOUT_MS = Number(process.env.SMOKE_NAV_TIMEOUT_MS || 30_000);
const RPC_TIMEOUT_MS = Number(process.env.SMOKE_RPC_TIMEOUT_MS || 15_000);
const PERSIST_TIMEOUT_MS = Number(process.env.SMOKE_PERSIST_TIMEOUT_MS || 10_000);

let ctx;
let exitCode = 0;
const failures = [];

(async () => {
  // Setup. Throws on missing env vars (exit 2 below).
  try {
    ctx = await initContext();
  } catch (e) {
    console.error('smoke-blob-runtime: setup failed:', e.message);
    process.exit(2);
  }

  console.log(`smoke-blob-runtime: seeding 5 fixtures (canary + 4 user-data) for username=${ctx.username}`);
  let seeded;
  try {
    seeded = await seedAll(ctx, process.env.TEST_PASSPHRASE);
  } catch (e) {
    console.error('smoke-blob-runtime: seedAll failed:', e.message);
    await safeCleanup();
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const browserCtx = await browser.newContext();
  const page = await browserCtx.newPage();

  try {
    console.log(`smoke-blob-runtime: opening ${URL} (headless=${HEADLESS})`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Arm obs 1 BEFORE the login that triggers the RPC. Predicate is per
    // PR #140's Edits §1 — pullByUsername is the cross-device path used
    // for logged-in users.
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/rpc/ward_helper_pull_by_username') &&
        res.request().method() === 'POST',
      { timeout: RPC_TIMEOUT_MS }
    );

    // Drive login + restore via page.evaluate against ward-helper's
    // production code path. UI-selector form fills are intentionally
    // avoided — they're brittle. Instead we call the RPCs the UI calls,
    // through their public window surfaces if exposed, or via supabase
    // client direct otherwise. The Login screen and PostLoginRestorePrompt
    // both call `_rpc('auth_login_user', ...)` then `restoreFromCloud(passphrase)`.
    //
    // NOTE: ward-helper exposes NEITHER auth nor restore on window today
    // (verified during plan-writing). Two options:
    //   (a) UI-driven via page.fill / page.click — brittle to UI refactors.
    //   (b) Add minimal __SMOKE__ window globals in ward-helper for these
    //       two functions only (small src/ change, gated to dev mode if desired).
    //
    // First-pass: option (a). The implementing engineer iterates selectors
    // on first run. If selectors prove unstable across UI refactors, reach
    // for (b) — it's a small targeted change that doesn't expand to
    // exposing every internal as the spec's gate-3 decision feared.
    await driveLoginAndRestore(page);

    const response = await responsePromise;
    const networkBody = await response.json();

    // Loop blob_types. Each iteration runs both observations. First
    // failure within an iteration is captured to `failures[]`; we do
    // NOT abort the loop, so each blob's status is reported per run.
    for (const blobType of USER_DATA_BLOB_TYPES) {
      const fixture = BLOB_SEEDS[blobType];
      const expectedSealed = seeded[blobType];

      // OBS 1: wire — exact-match against seeded values.
      try {
        const row = networkBody.find((r) => r.blob_type === blobType && r.blob_id === fixture.blobId);
        if (!row) {
          throw new Error(`obs 1: row for ${blobType}/${fixture.blobId} missing from RPC response`);
        }
        if (row.ciphertext !== expectedSealed.ciphertext) {
          throw new Error(`obs 1: ciphertext mismatch [regression class: wire layer]`);
        }
        if (row.iv !== expectedSealed.iv) {
          throw new Error(`obs 1: iv mismatch [regression class: wire layer]`);
        }
        if (row.salt !== expectedSealed.salt) {
          throw new Error(`obs 1: salt mismatch [regression class: wire layer]`);
        }
        console.log(`  ✓ ${blobType} obs 1 (wire) passed`);
      } catch (e) {
        failures.push({ blobType, observation: 1, message: e.message });
        console.error(`  ✗ ${blobType} obs 1: ${e.message}`);
        continue; // skip obs 3 if obs 1 failed
      }

      // OBS 3: persistence — deterministic wait on the IDB / localStorage value.
      try {
        const expectedFailureClass = process.env.SMOKE_FORCE_FAIL === 'plaintext'
          ? 'fixture drift / harness self-test'
          : 'production decrypt path OR persistence step';

        if (fixture.persistenceLayer === 'localStorage') {
          await page.waitForFunction(
            ({ key, expected }) => localStorage.getItem(key) === expected,
            { key: fixture.persistenceKey, expected: fixture.plaintext.apiKey },
            { timeout: PERSIST_TIMEOUT_MS },
          );
        } else {
          // IDB. Open the 'ward-helper' DB, look up by blobId in the
          // fixture's persistenceKey store, deep-equal against plaintext.
          await page.waitForFunction(
            ({ store, id, expected }) =>
              new Promise((resolve) => {
                const req = indexedDB.open('ward-helper');
                req.onsuccess = () => {
                  try {
                    const tx = req.result.transaction(store, 'readonly');
                    const get = tx.objectStore(store).get(id);
                    get.onsuccess = () => {
                      const row = get.result;
                      if (!row) return resolve(false);
                      // Deep-equal via JSON round-trip; sufficient for the fixture shapes.
                      resolve(JSON.stringify(row) === JSON.stringify(expected));
                    };
                    get.onerror = () => resolve(false);
                  } catch { resolve(false); }
                };
                req.onerror = () => resolve(false);
              }),
            { store: fixture.persistenceKey, id: fixture.blobId, expected: fixture.plaintext },
            { timeout: PERSIST_TIMEOUT_MS },
          );
        }
        console.log(`  ✓ ${blobType} obs 3 (persistence) passed`);
      } catch (e) {
        const expectedFailureClass = process.env.SMOKE_FORCE_FAIL === 'plaintext'
          ? 'fixture drift / harness self-test'
          : 'production decrypt path OR persistence step';
        const msg = `obs 3: plaintext never landed in ${fixture.persistenceLayer}.${fixture.persistenceKey} [regression class: ${expectedFailureClass}]`;
        failures.push({ blobType, observation: 3, message: msg });
        console.error(`  ✗ ${blobType} ${msg}`);
      }
    }
  } catch (e) {
    console.error('smoke-blob-runtime: harness threw:', e);
    exitCode = 1;
  } finally {
    await browser.close();
    await safeCleanup();
  }

  if (failures.length > 0) {
    console.error(`\nsmoke-blob-runtime: ${failures.length} failure(s) across ${USER_DATA_BLOB_TYPES.length} blob_types`);
    for (const f of failures) console.error(`  - ${f.blobType}/obs ${f.observation}: ${f.message}`);
    exitCode = 1;
  } else if (exitCode === 0) {
    console.log(`\nsmoke-blob-runtime: all ${USER_DATA_BLOB_TYPES.length} blob_types passed both observations.`);
  }

  process.exit(exitCode);
})();

async function driveLoginAndRestore(page) {
  // First-pass UI selectors — adjust to live UI on first run. The form is
  // ward-helper's login screen; submit triggers _rpc('auth_login_user', ...)
  // and the post-login restore prompt with a passphrase input.
  await page.fill('input[name="username"], input[type="text"]', process.env.TEST_USER);
  await page.fill('input[name="password"], input[type="password"]:not([name*="passphrase" i])', process.env.TEST_PASS);
  await page.click('button[type="submit"], button:has-text("Login"), button:has-text("התחבר")');
  // Restore prompt may appear post-login; passphrase input + Restore CTA.
  // If SMOKE_FORCE_FAIL=passphrase, deliberately use a wrong value.
  const passphrase = process.env.SMOKE_FORCE_FAIL === 'passphrase'
    ? 'WRONG-PASSPHRASE-FOR-DRY-FAIL-TEST'
    : process.env.TEST_PASSPHRASE;
  await page.fill('input[type="password"][placeholder*="ססמ" i], input[name*="passphrase" i]', passphrase);
  await page.click('button:has-text("Restore"), button:has-text("שחזר")');
}

async function safeCleanup() {
  if (!ctx) return;
  try { await cleanupAll(ctx); }
  catch (e) { console.warn(`safeCleanup: ${e.message}`); }
}
```

- [ ] **Step 4: Verify the script parses + first-run drives end-to-end**

```bash
cd ~/repos/ward-helper
node --check scripts/smoke-blob-runtime.mjs
# Then with all env vars set:
export SUPABASE_URL=https://krmlzwwelqvlfslwltol.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<from team vault>
export TEST_USER=ward-smoke-burner-001
export TEST_PASS=<value matching the manual SQL pre-seed>
export TEST_PASSPHRASE=<burner passphrase>
npm run smoke:blob-runtime
```

Expected outcomes (in priority order):
- **All 4 blob_types pass both observations** → smoke works. Move to Task 4.
- **Login UI selector errors** (e.g. `input[name="username"]` not found) → adjust selectors to match the live UI; commit corrections as part of this task.
- **`obs 1: row for X missing`** → check that seedAll actually committed to Supabase; check `username` column population by hand: `SELECT blob_type, blob_id, username FROM ward_helper_backup WHERE username='ward-smoke-burner-001'`.
- **`obs 3: plaintext never landed`** with valid passphrase → check that the burner's pre-seeded password matches `TEST_PASS` (locked-out users get rejected before restore fires).

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-blob-runtime.mjs package.json
git commit -m "feat(smoke): bare Node + raw playwright smoke driver

Mirrors Geri's scripts/smoke-api-key-restore.mjs shape (PR #208):
single async script, chromium.launch directly, no playwright.config.ts,
no @playwright/test framework. Loops the 4 user-data blob_types,
collecting failures-per-iteration so a single regression doesn't mask
others in the same run.

Obs 1 predicate is per PR #140 Edits §1
(/rest/v1/rpc/ward_helper_pull_by_username POST). Obs 3 deterministic
wait via page.waitForFunction, branched by persistenceLayer (IDB
deep-equal vs localStorage exact-match). UI selectors are first-pass
best-guesses; engineer iterates on first run.

Forced-fail mode plumbing (passphrase / plaintext) wired here; mode
'ciphertext' lives in the meta-test (Task 5) since it requires a
post-seedAll mutation. Each observation's failure message includes
the regression class so 'wire layer' / 'production decrypt path' /
'fixture drift' are individually actionable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Forced-fail mode `ciphertext` (the post-seedAll mutation)

**Files:**
- Modify: `scripts/lib/seed-blobs.mjs` (add `applyForcedFailMutation` export)
- Modify: `scripts/smoke-blob-runtime.mjs` (call mutation after `seedAll`)

Modes `passphrase` and `plaintext` are already wired in Task 3 (passphrase: wrong value passed to login form; plaintext: would require fixture mutation, deferred to Task 5 meta-test mode discipline). Mode `ciphertext` requires mutating a seeded row AFTER seedAll committed it.

- [ ] **Step 1: Add `applyForcedFailMutation` to seed-blobs.mjs**

```js
/**
 * Apply the SMOKE_FORCE_FAIL=ciphertext mutation BEFORE the smoke runs.
 * Flips a byte in the patient row's ciphertext server-side; obs 1 should
 * then fail with "ciphertext mismatch [regression class: wire layer]".
 *
 * Modes 'passphrase' and 'plaintext' don't need server-side mutation —
 * they're handled in the smoke driver (passphrase) or the meta-test
 * (plaintext). This function is a no-op for those modes.
 */
export async function applyForcedFailMutation(ctx, seeded, mode) {
  if (mode !== 'ciphertext') return seeded;
  const targetType = 'patient';
  const fixture = BLOB_SEEDS[targetType];
  const orig = Buffer.from(seeded[targetType].ciphertext, 'base64');
  // Flip the high bit of byte 0. AES-GCM auth-tag mismatch will throw
  // on decrypt, but obs 1 catches it first by exact-match.
  orig[0] ^= 0xff;
  const corrupted = orig.toString('base64');
  const { error } = await ctx.supabase
    .from('ward_helper_backup')
    .update({ ciphertext: corrupted })
    .eq('user_id', ctx.syntheticUserId)
    .eq('blob_type', targetType)
    .eq('blob_id', fixture.blobId);
  if (error) throw new Error(`applyForcedFailMutation 'ciphertext' failed: ${error.message}`);
  // Don't update seeded[targetType].ciphertext — the smoke compares the
  // network response against `seeded`, so we WANT the comparison to fail.
  return seeded;
}
```

- [ ] **Step 2: Wire `applyForcedFailMutation` into the smoke driver**

In `scripts/smoke-blob-runtime.mjs`, modify the import line and the seed-call site:

```js
import { initContext, seedAll, cleanupAll, applyForcedFailMutation } from './lib/seed-blobs.mjs';

// ... after seeded = await seedAll(...):
seeded = await applyForcedFailMutation(ctx, seeded, process.env.SMOKE_FORCE_FAIL);
```

- [ ] **Step 3: Manually verify each forced-fail mode**

```bash
SMOKE_FORCE_FAIL=ciphertext npm run smoke:blob-runtime
# Expected: patient obs-1 fails with "ciphertext mismatch [regression class: wire layer]"
SMOKE_FORCE_FAIL=passphrase npm run smoke:blob-runtime
# Expected: all 4 obs-3 fail with "...[regression class: production decrypt path OR persistence step]"
SMOKE_FORCE_FAIL=plaintext npm run smoke:blob-runtime
# Expected (currently): same as passphrase mode (plaintext mutation is meta-test territory).
# Task 5 wires plaintext mode for distinguishability.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/seed-blobs.mjs scripts/smoke-blob-runtime.mjs
git commit -m "feat(smoke): forced-fail mode 'ciphertext' (post-seedAll byte flip)

Mode 'ciphertext' mutates the patient row's ciphertext server-side
after seedAll commits it; obs 1 catches the mismatch via exact-match
against the seeded reference. Mode 'passphrase' is already wired in
Task 3 (drives wrong passphrase through the login form). Mode
'plaintext' is meta-test territory — Task 5 wires it for distinct
regression-class messaging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Meta-test — `dry-fail-all` runs all 3 modes, checks distinct regression classes

**Files:**
- Create: `scripts/smoke-blob-runtime-dry-fail-all.mjs`
- Modify: `scripts/smoke-blob-runtime.mjs` (mode 'plaintext' fixture mutation in-process)

The meta-test is what guards against "assertions fire-but-don't-actually-assert" rot. For it to actually distinguish modes 2 and 3 (which both fail obs 3), mode 'plaintext' needs a different regression-class string than mode 'passphrase'. Task 3 already has the conditional in obs 3's failure message; this task wires the actual fixture mutation for mode 'plaintext'.

- [ ] **Step 1: Add mode 'plaintext' fixture mutation in the smoke driver**

In `scripts/smoke-blob-runtime.mjs`, BEFORE the `for (const blobType of USER_DATA_BLOB_TYPES)` loop, add:

```js
// SMOKE_FORCE_FAIL=plaintext: mutate fixture plaintext in-process so
// obs 3's deep-equal against fixture.plaintext fails (decrypt produces
// the originally-seeded plaintext, but the fixture we're comparing
// against has changed). Distinguishes from mode 'passphrase' which
// produces an actually-different decrypt path failure.
if (process.env.SMOKE_FORCE_FAIL === 'plaintext') {
  // Mutate the patient fixture in-memory. The smoke compares against
  // BLOB_SEEDS[type].plaintext, which is now mutated; obs 3 fails as
  // 'fixture drift / harness self-test'.
  BLOB_SEEDS.patient.plaintext = { ...BLOB_SEEDS.patient.plaintext, name: 'MUTATED-FOR-DRY-FAIL' };
}
```

- [ ] **Step 2: Create the meta-test script**

```js
#!/usr/bin/env node
// @ts-check
/**
 * smoke-blob-runtime-dry-fail-all.mjs — meta-test.
 *
 * Runs the smoke under each of the 3 SMOKE_FORCE_FAIL modes and asserts
 * each one fails with the expected regression-class string. Exits 0
 * only if 3/3 fail correctly. Protects against the silent-rot class:
 * assertions that fire-but-don't-actually-assert, mocks that swallow
 * errors, or mode 2/3 collapsing into the same failure message.
 */

import { spawnSync } from 'node:child_process';

const MODES = [
  { mode: 'ciphertext', expectedSubstring: 'regression class: wire layer' },
  { mode: 'passphrase', expectedSubstring: 'regression class: production decrypt path OR persistence step' },
  { mode: 'plaintext', expectedSubstring: 'regression class: fixture drift / harness self-test' },
];

let allCorrect = true;

for (const { mode, expectedSubstring } of MODES) {
  console.log(`\n=== SMOKE_FORCE_FAIL=${mode} ===`);
  const result = spawnSync('node', ['scripts/smoke-blob-runtime.mjs'], {
    env: { ...process.env, SMOKE_FORCE_FAIL: mode },
    encoding: 'utf-8',
  });

  const output = result.stdout + '\n' + result.stderr;

  if (result.status === 0) {
    console.error(`FAIL: mode '${mode}' was expected to fail but the smoke passed (exit 0)`);
    allCorrect = false;
    continue;
  }
  if (!output.includes(expectedSubstring)) {
    console.error(`FAIL: mode '${mode}' failed but message didn't include expected substring: "${expectedSubstring}"`);
    console.error('--- last 30 lines of output ---');
    console.error(output.split('\n').slice(-30).join('\n'));
    allCorrect = false;
    continue;
  }
  console.log(`OK: mode '${mode}' failed with expected regression-class message.`);
}

if (!allCorrect) {
  console.error('\nMeta-test FAILED: not all 3 modes failed correctly. Smoke assertions may have rotted.');
  process.exit(1);
}
console.log('\nMeta-test PASSED: 3/3 forced-fail modes failed with distinct regression-class messages.');
process.exit(0);
```

- [ ] **Step 3: Run the meta-test, expect pass**

Run: `cd ~/repos/ward-helper && npm run smoke:blob-runtime:dry-fail-all`
Expected: `Meta-test PASSED: 3/3 forced-fail modes failed with distinct regression-class messages.` exit 0. Takes ~3× the smoke runtime.

- [ ] **Step 4: Sanity-check the meta-test catches a broken smoke**

Temporarily comment out the obs-1 ciphertext exact-match in `scripts/smoke-blob-runtime.mjs` (so mode 'ciphertext' would silently pass). Re-run:

```bash
npm run smoke:blob-runtime:dry-fail-all
```

Expected: meta-test reports `FAIL: mode 'ciphertext' was expected to fail but the smoke passed (exit 0)` and exits 1.

Restore the assertion. Re-run; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-blob-runtime-dry-fail-all.mjs scripts/smoke-blob-runtime.mjs
git commit -m "feat(smoke): dry-fail-all meta-test + plaintext-mode in-process mutation

Mode 'plaintext' now mutates BLOB_SEEDS.patient.plaintext in-process
so obs 3 fails with 'fixture drift / harness self-test', distinct
from mode 'passphrase' which fails with 'production decrypt path OR
persistence step'. Modes 2 and 3 now have distinct regression-class
messages — meta-test asserts all 3 distinct strings appear.

Without this distinction, mode 2 and mode 3 produced the same failure
message, so a developer triaging a real production-decrypt regression
couldn't tell it apart from a fixture-drift bug. The regression-class
annotation is what makes the 3 modes individually actionable.

Meta-test catches the silent-rot class (assertions fire-but-don't-
actually-assert): runs the smoke under all 3 modes, exits 0 only if
3/3 fail with the correct distinct messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checks

Before declaring the implementation done:

1. **Spec coverage** — every section of the spec maps to a task:
   - §A architecture → Task 3 (smoke driver, bare-script per Edits §4)
   - §B fixtures + seeding → Task 1 (fixtures) + Task 2 (seeding helper)
   - §C observations → Task 3 (smoke driver body)
   - §D burner + ward_helper_backup lifecycle → Pre-flight (manual app_users SQL paste) + Task 2 (ward_helper_backup seedAll/cleanupAll)
   - §E forced-fail + meta-test → Tasks 4 + 5
   - §F deliberately not in scope → enforced by what's NOT in the plan (no canary assertions, no push-leg coverage, no src/crypto refactor, no app_users programmatic provisioning)

2. **Spec corrections preserved** — handled in PR #140 (independent), referenced from this plan but not gated on its merge.

3. **Env vars in Pre-flight** match what `initContext` / smoke driver actually read.

4. **No placeholders** — every code block has actual code; every command has actual flags; every commit message names the actual change.

5. **Type consistency** — `BlobSeed` defined in Task 1 is used consistently in Tasks 2-5. `USER_DATA_BLOB_TYPES` order is the iteration order. `CANARY_PRECONDITION` is shape-distinct from `BLOB_SEEDS` entries (different export, different role).

6. **Architecture parity with Geri** — smoke is bare Node + raw playwright + manual burner pre-seed. No `@playwright/test`, no `playwright.config.ts`, no bcrypt npm dep, no service-role write to `app_users`. Per `feedback_view_source_before_cite.md` (saved today after this plan was rewritten): the citation "shape mirrors Geri" is now grounded in actual `~/repos/Geriatrics/scripts/smoke-api-key-restore.mjs`, not memory-reconstructed.

---

## Open items deferred to the implementing engineer

1. **Patient / note / day-snapshot plaintext shapes** — Task 1 ships minimal-valid shapes per `src/storage/indexed.ts:8-25,27-52` and `src/storage/rounds.ts:7-12`. If `src/notes/save.ts:398-443` apply branches reject any field, grow the fixture to satisfy the apply path.
2. **Service-role key access** — Pre-flight requires it. If the test env doesn't have one, the entire plan is blocked.
3. **One-time burner pre-seed** — manual SQL paste once per Supabase project (Pre-flight section). Subsequent runs reuse the burner row.
4. **UI selector stability** — Task 3 step 3 best-guesses login + restore selectors. The implementing engineer adjusts to match the live UI on first run; selector strings in the plan can't be authoritative.
5. **Live URL vs preview** — defaults to `https://eiasash.github.io/ward-helper/` per Geri's smoke pattern. Override with `SMOKE_URL` to point at a `vite preview` if testing pre-deploy. Note: testing against the live URL means the smoke catches GitHub Pages deploy issues too.
6. **Lockout note** — 5 failed login attempts → 15 min burner lockout per existing `app_users` behavior. If env-var typos lock the burner, re-run the Pre-flight UPSERT to reset.
