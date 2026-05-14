# PR-B2.2 kickoff brief — write side + 9-site throw-branch replacement

**Created:** 2026-05-14 (end of session that shipped B2.1 / PR #167)
**State of the world:** PR-B2.1 merged at `4dc737d`. Live `ward-v1.45.0`
verified. Read seam in place at every patients/notes/roster IDB site;
flag-off, no encrypted rows in storage yet. B2.2 is the write side.

Companion docs (all live in `docs/audit/` — tracked, fresh-clone reachable):
- `docs/audit/2026-05-14-pr-b2-kickoff-brief.md` — original pre-split B2 brief
- `docs/audit/2026-05-14-pr-b2-design-pins.md` — locked design pins (Option 1a,
  shape-sniff rule, cursor staged-pattern pseudocode)

---

## Open-the-session prompt (paste verbatim into the next terminal Claude)

> Resuming ward-helper PR-B2.2 — PHI-at-rest write side. main is at the
> B2.1 squash commit `4dc737d`; live `ward-v1.45.0` verified; read seam
> in place at every patients/notes/roster site (1197 tests passing,
> verify-deploy PASS). B2.2 is the write side + backfill + cold-start
> gate + replacing the 9 tx-bound throw branches with staged-write
> patterns enumerated below.
>
> Read these first:
> 1. `docs/audit/2026-05-14-pr-b2-2-kickoff-brief.md` (this file)
> 2. `docs/audit/2026-05-14-pr-b2-design-pins.md` (shape-sniff rule + cursor staged-pattern + scope)
> 3. `src/crypto/phiRow.ts` (the wrapper types + read seam shipped in B2.1)
> 4. `src/crypto/phi.ts` (key lifecycle + per-store header)
> 5. `src/storage/indexed.ts` + `rounds.ts` + `roster.ts` (the 20
>    wired read sites, including the 9 throw branches that B2.2 must
>    replace)
> 6. `CLAUDE.md` working rules
>
> Pre-write three-gate fresh-eye cadence is REQUIRED before opening the
> B2.2 PR (per memory `feedback_audit_logs_cross_claude_visibility.md`
> or its consolidated successor). The B2.2 brief's "Pre-write gates"
> section pre-names the Gate 1 questions; run those before designing
> any commits.
>
> Branch: `claude/term-phi-encrypt-b2-2-write-side`. Branch protection:
> PR-based, never push to main. CI gate: `bash scripts/verify-deploy.sh`
> after merge.

---

## Scope of B2.2

| Item | Approx lines |
|---|---|
| Write-side wrap helpers: `wrapPatientForWrite`, `wrapNoteForWrite`, `wrapRosterForWrite` (alongside `sealRow`) | ~80 |
| **Replace 9 throw branches with staged-write patterns** (enumerated below) | ~250-350 |
| `Settings.phiEncryptedV7` sentinel field + persistence in `patchSettings`-style call | ~30 |
| Backfill runner (one-shot, post-login, sentinel-gated): scan all patients/notes/roster, seal each, write back, set sentinel + flip `localStorage.phi_encrypt_v7=1` | ~120 |
| `main.tsx` ordering: backfill runs AFTER `runV1_40_0_BackfillIfNeeded` AND AFTER successful key derivation (per `feedback_react_setauthsession_unmount_race`) | ~30 |
| Cold-start `Unlock.tsx` screen + `App.tsx` gate (render unlock when `hasPhiKey()` false AND flag on) | ~150 |
| Auth flow integration — derive key on login, clear on logout (already partly in `phi.ts::setPhiKey`/`clearPhiKey` API) | ~30 |
| Decrypt-failure UX: visible "1 record couldn't be loaded — retry sync" affordance | ~40 |
| Tests: write-side roundtrip, backfill idempotency, mixed-state post-backfill reads, cold-start gate, flag-off equivalent to today | ~300-400 |

Total: ~1000-1300 lines. Bigger than B2.1 (~900 lines actual).

---

## The 9 throw-branch replacements — DO NOT understate this as "a few sites"

B2.1 wired every tx-bound read site with `isEncryptedRow` + a throw
branch. Under B2.1's expected world the throws are unreachable; once
B2.2 flips the flag and rows are sealed, EVERY throw becomes reachable
and must be replaced with the appropriate staged-write pattern.

The 9 sites by pattern shape:

### Pattern A — single-store point read+write (5 + 1 sites)

Sites that do `tx.objectStore(X).get(id)` → mutate → `put` in one tx.
Staged shape:

    // Phase 1 — readonly tx
    const readTx = db.transaction('patients', 'readonly');
    const raw = await readTx.objectStore('patients').get(id);
    await readTx.done;
    if (!raw) throw new Error(`Patient ${id} not found`);

    // Phase 2 — decrypt out-of-tx
    const p = isEncryptedRow(raw)
      ? await decryptRowIfEncrypted<Patient>(raw, 'patient')
      : raw;
    if (!p) throw new Error(`Patient ${id} decrypt failed`);

    // Phase 3 — mutate + reseal + write
    const next = { ...p, /* mutation */ };
    const writeTx = db.transaction('patients', 'readwrite');
    await writeTx.objectStore('patients').put(
      isPhiEncryptV7Enabled() ? await wrapPatientForWrite(next) : next,
    );
    await writeTx.done;

Applies to:
1. `src/storage/indexed.ts::markNoteSent` (notes store)
2. `src/storage/rounds.ts::dischargePatient` (patients store)
3. `src/storage/rounds.ts::unDischargePatient` (patients store)
4. `src/storage/rounds.ts::addTomorrowNote` (patients store)
5. `src/storage/rounds.ts::dismissTomorrowNote` (patients store)
6. `src/storage/rounds.ts::promoteToHandover` (patients store)

**Atomicity note:** the original single-tx pattern guarded against
"two concurrent calls both reading the same `p` and overwriting each
other's append." The staged pattern reintroduces this race. ward-helper
is single-tab single-user per CLAUDE.md, so concurrent double-tap is
UX-mitigated — but flag this in the commit message so the next reader
knows the atomicity downgrade is deliberate, not an oversight.

### Pattern B — read-then-delete in tx (1 site)

7. `src/storage/roster.ts::ageOutRoster`

Sibling to Pattern A but the write is a delete. Staged shape:

    // Phase 1 — readonly tx, collect rows
    const readTx = db.transaction('roster', 'readonly');
    const rawRows = await readTx.objectStore('roster').getAll();
    await readTx.done;

    // Phase 2 — decrypt out-of-tx
    const rows = await decryptRowsIfEncrypted<RosterPatient>(rawRows, 'roster');

    // Phase 3 — readwrite tx, delete expired
    const writeTx = db.transaction('roster', 'readwrite');
    let dropped = 0;
    for (const r of rows) {
      if (r.importedAt < cutoff) {
        await writeTx.objectStore('roster').delete(r.id);
        dropped++;
      }
    }
    await writeTx.done;
    return dropped;

### Pattern C — multi-store tx (1 site — the trickiest of the 9)

8. `src/storage/rounds.ts::archiveDay`

Multi-store tx over `['daySnapshots', 'patients']`, readwrite. Reads
patients, snapshots them into daySnapshots, then clears `planToday`
on every patient. The staged version has to:

    // Phase 1 — readonly tx
    const readTx = db.transaction('patients', 'readonly');
    const rawPatients = await readTx.objectStore('patients').getAll();
    await readTx.done;

    // Phase 2 — decrypt out-of-tx
    const patients = await decryptRowsIfEncrypted<Patient>(rawPatients, 'patient');

    // Phase 3 — readwrite MULTI-STORE tx
    const writeTx = db.transaction(['daySnapshots', 'patients'], 'readwrite');
    // ... structuredClone(patients) into snapshot (plaintext per carve-out)
    // ... put snapshot, enforce SNAPSHOT_HISTORY_CAP
    // ... for each patient with planToday !== '': mutate + reseal-if-flagged + put
    await writeTx.done;

The carve-out invariant: `daySnapshots.patients` stays plaintext at rest
(per the 2C decision). The Phase-3 write of the snapshot uses the
DECRYPTED patients array directly via `structuredClone` — that's
correct because daySnapshots is exempt from sealing.

### Pattern D — cursor read-modify-write (1 site)

9. `src/storage/rounds.ts::runV1_40_0_BackfillIfNeeded`

Already staged in B2.1 — Phase 2 currently throws if any row is
encrypted. B2.2 replaces the throw branch:

    // EXISTING B2.1 (Phase 2 abort):
    if (collected.some((r) => isEncryptedRow(r))) throw new Error(...);
    const plaintextRows = collected as Patient[];

    // B2.2 replacement:
    const decryptedRows = await Promise.all(
      collected.map((r) =>
        isEncryptedRow(r)
          ? decryptRowIfEncrypted<Patient>(r, 'patient')
          : r,
      ),
    );
    if (decryptedRows.some((r) => r === null)) {
      throw new Error('runV1_40_0_BackfillIfNeeded: decrypt failed on some rows');
    }
    const rows = decryptedRows as Patient[];

Then Phase 3 wraps each write through `wrapPatientForWrite` (gated on
flag). The structural staging from B2.1 stays; only the abort →
decrypt-and-continue swap is new.

---

## Why this enumeration matters

The B2.2 work is "build the wrap helpers + backfill + cold-start gate
+ replace 9 throw branches." If the brief read "replace the throw
branches" as a one-liner, the next session would discover mid-PR that
each of the 9 has a slightly different staged shape — Pattern A's
atomicity downgrade, Pattern B's collect-then-delete, Pattern C's
multi-store reopening, Pattern D's continue-from-existing-stage —
and the PR would balloon mid-flight. Same failure mode as B1's
"4 callers" understating the real `rounds.ts` scope.

---

## Pre-write gates for B2.2

Run the three-gate fresh-eye cadence again (it earned its keep on B2.1):

1. **Design plan gate** — three falsifiable questions BEFORE writing:
   - Is the 9-site enumeration above complete, or did B2.1's wiring
     introduce a new throw branch I haven't named?
   - Is the backfill runner's ordering vs login/key-derivation/v1_40_0
     correct, or does the auth flow have a race?
   - Is `wrapPatientForWrite`'s atomicity assumption (single-tab) still
     defensible for the multi-store `archiveDay` case?
2. **Revised plan gate** — after the first gate's findings adjust the
   plan.
3. **Implementation gate** — re-grep after writing to confirm every
   throw branch was replaced (the failure mode here is "missed one of
   the 9" — same class as B1 missing rounds.ts).

---

## Branch + PR conventions

- Branch: `claude/term-phi-encrypt-b2-2-write-side` (or similar
  per-session lane).
- PR title: `feat(crypto): PR-B2.2 — PHI-at-rest write side + backfill`
- PR body: list the 9 throw-branch replacements with which pattern
  shape each got. Flag `archiveDay` and the cursor as the two
  highest-risk sites.
- After merge: `bash scripts/verify-deploy.sh` — the live witness gate.

## What does NOT belong in B2.2

- Cloud-side encrypted-blob runtime — separate workstream
  (`project_ward_helper_encrypted_blob_runtime` per memory).
- daySnapshots encryption — the carve-out is durable per the 2C
  decision and the `phi.ts:11-49` header trip-wire. Do not
  "fix" it without revisiting the threat model.
- Roster `ageOutRoster` plaintext-importedAt optimization — discussed
  briefly in B2.1 thinking but ruled out (decryption cost on 50 rows
  is ~50ms at boot, tolerable).
