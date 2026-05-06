# ward-helper — "one passphrase, ever" + safety-net backups

**Date:** 2026-05-06
**Target version:** 1.34.0
**Driving complaint (verbatim):** "Make API and supabase embedded in account everytime I login I have to put in supabase password and backup password and API and nothing comes back from cloud data lost"

## 1. Problem

ward-helper v1.33.1 forces the user to re-enter three credentials on every login: login password, backup passphrase (15-min in-memory expiry), and Anthropic API key (already in IndexedDB but not always picked up). Worse, the cloud restore on the user's account silently fails: 4 cloud rows, 0 restored, all skipped with the generic message "סיסמה שגויה / פורמט לא תואם". The error path is `restoreFromCloud` in `src/notes/save.ts:243` catching AES-GCM auth-tag failures one row at a time, with no early-exit verifier and no actionable UI.

The user has chosen to abandon the 4 stranded blobs (option **D + some A** in the brainstorm). Recovery of those 4 is **not** in scope. What is in scope:

- Eliminate the three-prompt friction on login (cache-on-device pattern).
- Replace the silent "wrong passphrase" failure with a deterministic verifier that fails fast and tells the user what's wrong.
- Add manual cloud-push and manual local-export buttons so the user has explicit safety-net controls.

## 2. Approach (rung 2 + canary + manual buttons)

The user chose **rung 2** of the security ladder presented during brainstorming: cache the backup passphrase on-device, encrypted with the user's login password. Trade-off accepted: server breach **plus** cracked bcrypt hash of the login password makes ciphertext readable. Mitigated by bcrypt cost 10 + AES-GCM 256 + PBKDF2 600k.

The "some A" addition: a canary cloud blob with known plaintext, encrypted with the same passphrase. Decryption of the canary is the deterministic test for "is this passphrase correct".

## 3. Architecture overview

```
LOGIN
  │  username + login_password ──► auth_login_user RPC (existing, unchanged)
  ▼
CHECK IndexedDB.settings.cachedUnlockBlob
  │
  ├── NOT PRESENT ──► prompt for backup passphrase (existing UI)
  │                       │
  │                       ▼
  │                   verify against canary
  │                       │
  │                       ▼
  │                   cache the unlock blob
  │
  └── PRESENT ──► auto-decrypt with login_password
                  │
                  ▼
              passphrase live in memory
                  │
                  ▼
              everything works:
                - API key auto-restores from cloud (PR #56 path)
                - cloud restore decrypts cleanly
                - manual backup buttons enabled
```

Three logical pieces change: a new on-device cache, a canary blob in the cloud, and two new buttons in Settings. AES-GCM-at-rest property unchanged on Supabase.

## 4. Components

| File | Change |
|---|---|
| `src/storage/indexed.ts` | Add `cachedUnlockBlob: { ciphertext, iv, salt } \| null` to settings schema + setter |
| `src/crypto/unlock.ts` (new) | `cacheUnlockBlob(passphrase, loginPassword)` and `tryAutoUnlock(loginPassword)` |
| `src/storage/cloud.ts` | Add `pushCanary` / `verifyCanary` helpers; reuse existing `pushBlob` plumbing |
| `src/notes/save.ts` (`restoreFromCloud`) | Verify canary first; if it fails, return early with `wrongPassphrase: true`. Existing per-blob skip logic kept as fallback. |
| `src/auth/auth.ts` | On password-change RPC success, re-encrypt `cachedUnlockBlob` with the new login password |
| `src/notes/exportLocal.ts` (new) | `exportLocalBackup(opts)` — serializes IndexedDB to JSON, optionally encrypts with login password, triggers download |
| `src/notes/importLocal.ts` (new) | `importLocalBackup(file, opts)` — reverse of export; idempotent IndexedDB upsert |
| `src/notes/manualPush.ts` (new) | `pushAllToCloud()` — re-pushes every local patient + note + api-key with current passphrase |
| `src/ui/screens/Settings.tsx` | Add buttons "גיבוי לענן עכשיו" / "ייצא גיבוי מקומי" / "ייבא גיבוי מקומי"; new "wrong passphrase" copy with retry/reset actions |
| `supabase/migrations/0005_canary_blob_type.sql` | Extend `blob_type` CHECK to allow `'canary'` |

## 5. Data types

```ts
interface CachedUnlockBlob {
  v: 1;
  ciphertext: Uint8Array;  // AES-GCM(passphrase) under PBKDF2(loginPassword, salt)
  iv: Uint8Array;
  salt: Uint8Array;
}

interface CanaryBlob {
  v: 1;
  marker: 'ward-helper-canary';
  createdAt: number;
}

interface LocalBackupFile {
  v: 1;
  exportedAt: number;
  encrypted: boolean;
  // when encrypted=true, the rest are absent and instead `payload`,
  // `iv`, `salt` are present (AES-GCM under PBKDF2(loginPassword, salt))
  patients?: Patient[];
  notes?: Note[];
  settings?: { apiKeyXor: number[]; deviceSecret: number[] };
  payload?: string;  // base64 ciphertext
  iv?: string;       // base64
  salt?: string;     // base64
}
```

Single canary per user, pinned `blob_id = '__canary__'`. Pushed on first set-passphrase. Pulled and decrypted on every subsequent unlock or restore attempt **before** any other work.

## 6. Error handling

| Canary check | UI message | Action button(s) |
|---|---|---|
| no canary on cloud | "הענן ריק עבור החשבון הזה — אין גיבוי לשחזר." | (none) |
| canary decrypts | proceed to full restore as today | — |
| canary fails | "הסיסמה שגויה (לא הסיסמה ששמרה את הגיבויים בענן)." | "נסה סיסמה אחרת" / "התחל מחדש (יחליף את הגיבוי בענן)" |

The "התחל מחדש" path explicitly re-pushes everything local with the current passphrase, replacing the stranded rows. Stranded rows on a different passphrase become orphan ciphertext on the server — inert, unreadable, but they take up a few KB and stay until manual cleanup.

## 7. Manual buttons

### 7.1 "גיבוי לענן עכשיו" (manual cloud backup)

Iterates every IndexedDB patient + note, runs `encryptForCloud` with current passphrase, calls `pushBlob`. Includes the api-key blob via the existing `pushApiKeyToCloud`. Returns `{ pushedPatients, pushedNotes, pushedApiKey, failed }` and the UI surfaces the count. Idempotent: a second click within seconds re-pushes with a fresh IV per blob, but blob_id is preserved so the row is upserted, not duplicated.

### 7.2 "ייצא גיבוי מקומי" (manual local backup) — option (d)

Generates a JSON file. Dialog presents a checkbox **"הצפן עם סיסמת הכניסה (מומלץ)"** (encrypt with login password — recommended), checked by default.

- Checked → encrypted file. Contents are the JSON above with `encrypted: true` and `payload`/`iv`/`salt` populated. Importing requires being logged into the same account on any device.
- Unchecked → plaintext file. Contents are `encrypted: false` with `patients`/`notes`/`settings` populated. Anyone with the file can read all PHI. Use case: nuclear-option recovery on a clean machine, or transfer to a different account.

Triggered via `<a download>` with `URL.createObjectURL(blob)` — same approach used elsewhere in the bundle.

### 7.3 "ייבא גיבוי מקומי" (manual local import)

Counterpart to 7.2. Accepts the same file shape. If `encrypted: true`, decrypts with current login password (errors if logged out or with the wrong session). If `encrypted: false`, applies directly. Each patient + note goes through the same `putPatient` / `putNote` IndexedDB upsert path as the cloud restore, so IDs collide cleanly.

## 8. Migration plan

| Concern | Plan |
|---|---|
| Existing user on v1.33.1 (the user reporting this issue) | After upgrade to v1.34.0: on next login, no `cachedUnlockBlob` exists, so the **passphrase prompt appears one more time**. After that prompt, the app caches the unlock blob *and* pushes the canary if missing. Every subsequent login is silent. |
| The 4 stranded rows on cloud right now | Untouched until the user decides. The new error UI offers "נסה סיסמה אחרת" or "התחל מחדש (יחליף בענן)". The second action pushes a fresh canary with the new passphrase and re-pushes every local patient/note via `pushAllToCloud`. The 4 ghost rows get overwritten where IDs collide; the rest become orphans on a different passphrase. |
| Schema migration `0005_canary_blob_type.sql` | Single `ALTER … CHECK` to add `'canary'` to allowed `blob_type` values, alongside the `'api-key'` from migration 0004. Same idempotent pattern. |
| Other devices already logged in (if any) | Same as the upgrade flow above — they'll prompt once for the passphrase, then silent. |
| Login password change | The auth flow at `src/auth/auth.ts` gets a hook: after the server bcrypt update succeeds, locally re-encrypt `cachedUnlockBlob` with the new login password. Other devices re-cache on their next login. |
| Forgotten login password (Tier 1 admin reset) | Existing runbook in CLAUDE.md unchanged. After admin reset, user logs in with the new password — but `cachedUnlockBlob` won't decrypt, so the passphrase prompt appears again (one-time). After that, normal flow resumes. |

## 9. Testing strategy

| New test file | Coverage |
|---|---|
| `tests/cachedUnlock.test.ts` | round-trip: `cacheUnlockBlob` → `tryAutoUnlock` returns identical passphrase; wrong login password → returns `null` not throws; corrupt blob → returns `null` |
| `tests/canary.test.ts` | `pushCanary` → `verifyCanary` returns `true`; `verifyCanary` with wrong passphrase returns `false` (not throws); no canary on cloud returns `'absent'` |
| `tests/restoreFromCloud.canary.test.ts` | extends existing restore tests: wrong passphrase → returns early with `{ wrongPassphrase: true, scanned: 0 }` instead of iterating; right passphrase → unchanged |
| `tests/passwordChange.reencrypt.test.ts` | login password change re-encrypts `cachedUnlockBlob`; old login password no longer unlocks; new one does |
| `tests/exportLocalBackup.test.ts` | JSON shape v=1; encrypted form round-trips; importLocalBackup rejects ciphertext under the wrong key cleanly |
| `tests/manualPush.test.ts` | `pushAllToCloud` re-pushes every local row, idempotent on second call |

Plus extending `tests/apiKeyCloudSync.test.ts` to confirm the api-key auto-restores via the cached-unlock path with no passphrase prompt in the flow.

## 10. Threat model delta

| Property | Today (v1.33.1) | After v1.34.0 |
|---|---|---|
| Server (Supabase) breach reveals plaintext PHI? | No — passphrase never sent | No — passphrase never sent |
| Server breach + cracked bcrypt hash reveals PHI? | No — passphrase still independent | **Yes** — bcrypt-cost-10 password feeds PBKDF2 to derive AES key |
| Device theft + login session active reveals PHI? | Yes (15 min window) | Yes (always, since cache is unlocked the moment user logs in) |
| Forgotten passphrase → permanent data loss? | Yes | Yes for stranded blobs; future blobs use the cached unlock and survive logouts |
| Local file leaked from disk reveals PHI? | N/A (no local export today) | Yes if user chose plaintext export; no if encrypted (default) |

The tradeoff is acknowledged: the user has chosen convenience over the bcrypt-cracking-attack-vector. Bcrypt cost 10 with a unique-per-user salt is the standard floor for this attack class and the user is a single physician (not a target population). If this app ever scales to a population where bcrypt-cracking becomes economical, this design needs revisiting.

## 11. Out of scope (explicit YAGNI)

- Self-service password reset email flow (Tier 2; designed separately, deferred).
- Multi-device passphrase sync independent of login (login-password-derived cache covers it).
- Automatic local-file backup schedule (manual button only — user explicitly asked for manual).
- Recovery of the 4 stranded blobs (user accepted loss).
- Server-side API-key storage (PR #56 already syncs via cloud blob, gated on cached unlock).
- Hardware-backed key storage (WebAuthn/passkey) — meaningful upgrade, but a separate project.

## 12. Release checklist

Per ward-helper invariants in CLAUDE.md:

- bump `package.json` → 1.34.0
- bump `public/sw.js` `VERSION` line to match (Vite plugin rewrites at build, but the source line must be present)
- run `npm run check && npm test && npm run build` — all green
- PR with all 13 CI gates green (no direct push to main)
- after merge: `bash scripts/verify-deploy.sh` confirms `ward-v1.34.0` is live on Pages
- entry-chunk gzipped budget unchanged (new code ≈ 1-2 KB gz)

## 13. Spec self-review (filled in after first draft)

- Placeholder scan: none.
- Internal consistency: §6 error table matches §10 threat-model row "forgotten passphrase". §7.3 import shape matches §5 type definition. §8 migration covers all four user paths surfaced during brainstorming (existing user, stranded rows, multi-device, password change).
- Scope: focused enough for a single implementation plan. ~7 new files, ~3 edits to existing files. ~6 new test files. Estimate 1-2 days of focused work.
- Ambiguity: section 7.2 explicitly resolves the encryption-default question. Section 7.1 specifies `pushApiKeyToCloud` is invoked even though the manual button could in principle skip it — kept in for the parity with `saveBoth`.
