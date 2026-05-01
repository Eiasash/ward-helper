# ward-helper — audit-fix-deploy improvement log

Auto-appended by the audit-fix-deploy pipeline. Most recent run on top.

---

## 2026-05-01 — deep audit + test expansion (v1.32.0)

### Audit findings

| Gate | Result | Detail |
|---|---|---|
| Entry chunk ≤ 180 kB gz (CI authoritative) | PASS | 154,584 bytes — 83.87% of ceiling |
| Total JS ≤ 400 kB gz | PASS | 164,511 bytes — 40.16% of ceiling |
| CSP present in index.html | PASS | meta tag present |
| No analytics | PASS | grep clean |
| No `console.log` of teudatZehut/bodyHebrew | PASS | grep clean |
| No `localStorage.setItem` of bodyHebrew | PASS | grep clean |
| PBKDF2 = 600,000 | PASS | `src/crypto/pbkdf2.ts` |
| Toranot proxy in client | PASS | `src/agent/client.ts` PROXY_URL |
| No `@anthropic-ai/sdk` runtime dep | PASS | not in package.json |
| `compressImage` in capture flow | PASS | `src/ui/screens/Capture.tsx` |
| Supabase pinned to `krmlzwwelqvlfslwltol` | PASS | `src/storage/cloud.ts` + `src/auth/auth.ts` |
| No legacy JWT anon keys | PASS | grep clean across `src/`, `public/` |
| 4 skills synced into `public/skills/` | PASS | azma-ui, szmc-clinical-notes, szmc-interesting-cases, hebrew-medical-glossary |
| RLS scoped by `auth.uid()` | PASS | `supabase/migrations/0002_ward_helper_backup_rls_harden.sql` (no DELETE policy intentionally) |

**Severity counts**: 0 critical, 0 high, 0 medium, 0 low. Clean run.

### Surfaced tradeoff (per user-mandated working rule #1)

The `audit-fix-deploy` task scaffold cited a stale **150 kB entry-chunk ceiling**. The repo authoritative ceiling is **180 kB** — codified in `.github/workflows/ci.yml` (`184320` byte literal) and `CLAUDE.md`. The bundle (154,584 bytes gzipped) **passes** the actual CI gate but would fail the stale 150 kB literal. No artificial chunking was added — that would speculatively change runtime cache behavior to satisfy a scaffold check the repo retired. If the central `~/.claude/skills/audit-fix-deploy/SKILL.md` still says 150 kB, that's drift in the central skill, not the repo.

### Test expansion

New file: `tests/cloud-payload-ciphertext-only.test.ts` — 7 cases targeting the highest-value PHI safety contract that was not directly asserted before:

1. `pushBlob` upserts contain only allowlisted columns (ciphertext / iv / salt / meta / username), never plaintext PHI like name / teudatZehut / bodyHebrew / pmh / meds.
2. PHI sentinel strings never appear in the wire payload.
3. AES-GCM IV bytes are 12 bytes per row.
4. Encrypted ciphertext bytes do NOT contain plaintext UTF-8 (catches a no-op encrypt).
5. Two encrypts of the same payload produce different IVs and different ciphertexts.
6. `username` column is **omitted entirely** for guest pushes (never stored as `null` or `""`).
7. `username` column is trimmed before storage (no whitespace lands in DB).
8. `onConflict` upsert key is the composite `(user_id, blob_type, blob_id)`.

**Test count delta**: 633 → 640 passing (+7); 58 → 59 files (+1); 1 skipped unchanged (live eval needs `ANTHROPIC_API_KEY`).

### Skill drift

Source `~/.claude/skills/<name>/SKILL.md` ↔ public `public/skills/<name>/SKILL.md` — md5 equal for all four bundled skills. No drift.

### Skill creation tradeoff

Task spec asked for a new `~/.claude/skills/ward-helper-dev/SKILL.md`. Sandbox blocked write under both `~/.claude/skills/` and the repo's `.claude/skills/` (untracked). Equivalent ward-helper-dev reference content is consolidated in this repo's `CLAUDE.md` and `IMPROVEMENTS.md` so it lives in the codebase and is discoverable to any future Claude session via the existing CLAUDE.md auto-load path.

### Bundle budget telemetry

- Entry: 154,584 bytes (83.87% of 180 kB)
- Total: 164,511 bytes (40.16% of 400 kB)
- Headroom: 29,736 bytes (entry) / 245,089 bytes (total)
- Watch list: `react-router-dom` + `@supabase/supabase-js` are the heaviest single deps. If entry approaches 90% of ceiling, split them into a vendor chunk via `rollupOptions.output.manualChunks`.

### Supabase backup success rate

No telemetry currently shipped — `saveBoth` returns a `cloudSkippedReason` to the UI but it isn't aggregated. **Future**: if cloud failure rate ever needs to be tracked, the existing `cloudSkippedReason` field is the natural place to wire a counter into IndexedDB `settings` (PHI-free; counter only).

### Notes / followups

- Vite warning: `useGlanceable.ts` is dynamically imported by `indexed.ts` but statically imported by 5+ other modules — the dynamic import is therefore a no-op. Either drop the dynamic import or refactor those static importers if a chunking benefit is actually wanted. Not a blocker.
- `tests/extraction/eval.test.ts` remains the only skipped test, gated on `ANTHROPIC_API_KEY` env var. By design — runs against the live proxy in nightly CI when the secret is present.
