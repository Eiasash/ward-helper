# PR-B2 design pins (locked 2026-05-14)

Companion to `docs/audit/2026-05-14-pr-b2-kickoff-brief.md` (original)
and `docs/audit/2026-05-14-pr-b2-2-kickoff-brief.md` (B2.2 follow-on).
Pins design decisions that are easy to lose between sessions or to
drift on under pressure. Open this before writing any B2 code.

**Status as of 2026-05-14**: B2.1 shipped (PR #167, squash `4dc737d`,
live `ward-v1.45.0`, verify-deploy PASS). B2.2 pending — see B2.2
kickoff brief for scope + the 9 throw-branch enumeration.

## Seam: Option 1a — locked

**Decryption seam location:**
- `listPatients()` and `listAllNotes()` — collection reads decrypt all rows.
- Shared `decryptRowIfEncrypted(row, kind)` helper — every point-read site crosses it: `getPatient(id)`, `getNote(id)`, and `listNotes(patientId)`.

**Rejected alternatives:**
- Plain Option 1 (collection-only seam): leaves three point-reads seeing ciphertext (`getPatient` / `getNote` / `listNotes`). Same class of bug as the `listNotesByTeudatZehut` direct-`getAll` bypass the PR #166 review caught — 1a's shared helper closes ALL of them, not just the one the brief named.
- Option 2 (low-level wrapper around `db.getAll`/`db.get`): flattens the patient-vs-note decrypt-timing asymmetry. Patient rows must decrypt-before-filter (filter key `teudatZehut` is encrypted PHI). Notes filter by `patientId` (plaintext UUID) and stay indexed — uniform eager-decrypt at the wrapper layer wastes CPU on every `getAll('notes')` when the caller only wants IDs. 1a respects the asymmetry.

## Refactor surface for B2.1

`listNotesByTeudatZehut` (src/storage/indexed.ts:503) currently does
`db.getAll('patients')` direct — must route through `listPatients()` so
the seam catches it. Small commit, well-scoped.

## Shape-sniff: pin

The `decryptRowIfEncrypted(row, kind)` helper sniffs by **positive
structural check on the encrypted shape**, not heuristic.

Encrypted Patient row: `{ id: string, enc: Sealed }` (or whatever the
`Sealed`-carrying envelope shape `phi.ts::sealRow` produces — verify
against `src/crypto/aes.ts::Sealed` definition before implementing).

Sniff rule (in pseudocode):

    isEncrypted(row) =
      typeof row.enc === 'object' &&
      row.enc !== null &&
      <positive structural assertion that enc matches Sealed>

**Failure-mode rule:** a row that matches neither cleanly (legacy
plaintext AND missing the `enc` envelope) goes down the **plaintext
passthrough path**. It does NOT get fed to `unsealRow` and silently
return null. Pin a test for this case in B2.1: a malformed half-migrated
row should surface as a normal downstream error (e.g. missing required
field), not vanish.

This matters because `unsealRow` returns null on any decrypt failure
(by design — "decrypt failure must not crash" per phi.ts:130). If a
malformed plaintext row gets routed through `unsealRow`, the row
silently disappears with no surfaced error — a silent-corruption bug.
The shape-sniff must be unambiguous to prevent that.

## B2.1 vs B2.2 split

**B2.1 — read seam, encryption no-op:**
- Add `decryptRowIfEncrypted(row, kind)` helper.
- Wrap `listPatients()` + `listAllNotes()` output.
- Wrap `getPatient(id)` + `getNote(id)` + `listNotes(patientId)` output.
- Refactor `listNotesByTeudatZehut` to call `listPatients()` (no more direct `db.getAll('patients')`).
- **Flag-off equivalence:** every existing test must pass unchanged. `phi_encrypt_v7` flag absent → helper is identity-on-plaintext-shape. No encryption code lands.
- Pin test: malformed half-migrated row → plaintext passthrough path, NOT silent null.
- Bakeable in isolation; B2.2 composes on top of a proven read seam.

**B2.2 — write encryption + backfill + sentinel + cold-start gate + decrypt-failure UX:**
- See kickoff brief table for full line-count budget (~800-1000 lines).
- Does NOT land until B2.1 is baked in production.

## Cursor staged-pattern (rounds.ts:111) — pin

Fresh-eye check 2026-05-14 round 2 answered Q2 concretely: the existing
cursor at `runV1_40_0_BackfillIfNeeded` only awaits IDB-internal ops
(`cursor.update` / `cursor.continue`). It does NOT tolerate non-IDB awaits
(`crypto.subtle.decrypt` would poison the tx — `idb` README:
*"Do not await other things between the start and end of your transaction,
otherwise the transaction will close."*).

**B2.1 cursor pattern at rounds.ts:111 — staged:**

    // Phase 1 — read-only tx, collect rows synchronously
    const collected = [];
    const readTx = db.transaction('patients', 'readonly');
    let cursor = await readTx.objectStore('patients').openCursor();
    while (cursor) {
      collected.push(cursor.value);
      cursor = await cursor.continue();
    }
    await readTx.done;

    // Phase 2 — decrypt async, OUTSIDE any tx
    const decrypted = await Promise.all(
      collected.map((row) => decryptRowIfEncrypted(row, 'patient')),
    );

    // Phase 3 — readwrite tx, sync writes only
    const writeTx = db.transaction('patients', 'readwrite');
    const store = writeTx.objectStore('patients');
    for (const row of decrypted) {
      const next = applyBackfillMutation(row);
      // Re-seal if flag on (handled by wrapForWrite helper)
      await store.put(next);
    }
    await writeTx.done;

Document this pattern explicitly in the B2.1 commit message — it's the
single trickiest site in the PR and the B2.1 fresh-eye should look
straight at it.

## Scope: 20 sites total

After fresh-eye round 1 (PHI scope FAIL → roster in scope) and round 2
(inventory completeness PASS), the full B2.1 wrapping surface is:

- **`src/storage/indexed.ts`** — 11 sites: listPatients, listAllNotes,
  getPatient, getNote, listNotes, listNotesByTeudatZehut (refactor to
  call listPatients), getPatientByTz / listPatientsByTzMap /
  upsertPatientByTz (already route through listPatients, no further
  change), markNoteSent (inline get), getDbStats (ciphertext-length
  estimate, not decrypt).
- **`src/storage/rounds.ts`** — 7 sites: archiveDay, runV1_40_0_BackfillIfNeeded
  (STAGED), dischargePatient, unDischargePatient, addTomorrowNote,
  dismissTomorrowNote, promoteToHandover.
- **`src/storage/roster.ts`** — 2 sites: getRoster, ageOutRoster.

daySnapshots stores are NOT wrapped — fresh-eye Q3 confirmed no read
path assumes encryption, and `daySnapshotsCloud.ts` already encrypts on
cloud push. Local-rest plaintext is the documented carve-out.

## phi.ts header — required revision in B2.1

Current `src/crypto/phi.ts:10-12` says PHI lives only in patients+notes.
Fresh-eye Q2 falsified this — roster carries direct PHI (`tz`, `name`,
`room`, `dxShort`). B2.1 must update the header to:

  Scope: patients + notes + roster rows (full PHI envelope).
         daySnapshots intentionally NOT wrapped — local-rest plaintext is
         the documented carve-out: cloud-side already encrypted via
         daySnapshotsCloud.ts (encryptForCloud on push, decryptFromCloud
         on pull), and the local-rest threat model assumes OS full-disk
         encryption per CLAUDE.md.
         settings is metadata only (apiKeyXor / deviceSecret / phiSalt /
         prefs) — no plaintext PHI fields.

## Pre-commit gate

Before opening `claude/term-phi-encrypt-b2-1-read-seam`:
1. Fresh-eye check answers the three falsifiable questions (caller-inventory completeness, PHI-scope claim, encrypted-row shape consistency). See companion fresh-eye-check report when it lands.
2. Revised-plan check answers three follow-up questions (inventory after revisions, cursor await tolerance, daySnapshots read-path validity).
3. If any of those comes back FAIL → fix the design first, do NOT write code on a broken foundation.
4. If clean → B2.1 is a write session.

**Status as of 2026-05-14:** Both rounds clean (round 1: PARTIAL/FAIL/FAIL produced 3 adjustments; round 2: PASS/staged-pattern-confirmed/PASS). B2.1 unblocked.
