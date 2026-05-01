# ward-helper

SZMC ward rounds copilot. Hebrew-RTL mobile-first PWA — photograph an AZMA screen, review the parsed fields, generate a SZMC-format Hebrew note, paste into Chameleon.

**Live:** https://eiasash.github.io/ward-helper/

**Sibling project:** [Toranot](https://github.com/Eiasash/Toranot) — on-call ward management PWA at SZMC.

## What it does

Four note types, one pipeline:

1. **Capture** — camera (primary) or paste (fallback) on Capture screen. Pick note type: קבלה / שחרור / ייעוץ / מקרה מעניין.
2. **Review** — Claude extracts structured data from the shots. Each field shows confidence (red/amber/green) and source-region hint. Low-confidence or missing critical fields (name, ת.ז., age) require manual confirmation before you can proceed.
3. **Edit** — Claude emits the Hebrew note in SZMC format. Bidi marks (RLM/LRM) are added at the clipboard boundary so drug names and acronyms render correctly when pasted into Chameleon.
4. **Save** — the note + patient go to IndexedDB on your device. If your backup passphrase is active, the records are AES-GCM encrypted client-side and pushed to Supabase as ciphertext.
5. **History** — patient search by name / ת.ז. / room. All data stays on your device.

## Install as PWA

1. Open https://eiasash.github.io/ward-helper/ on your phone.
2. iOS Safari: Share → Add to Home Screen. Android Chrome: install banner.
3. First launch: open Settings, paste your Anthropic API key (stored XOR-encrypted on device), set a backup passphrase if you want cloud sync.

## Privacy posture

- **Screenshots never leave memory.** Released (`URL.revokeObjectURL`) after the API call.
- **Patient history is device-local.** IndexedDB only. Supabase sees AES-GCM-256 ciphertext with user-held passphrase key (PBKDF2 600k).
- **No analytics, no 3rd-party scripts.** CI grep enforces.
- **CSP pinned** to self + `api.anthropic.com` + `*.supabase.co`.
- **Main chunk ≤ 150 kB gzipped** (CI enforces).

## Dev

```bash
npm install
npm run dev       # vite on 5173, base /ward-helper/
npm test          # vitest
npm run check     # tsc --noEmit
npm run build     # prebuild (skill sync) + tsc + vite
```

Run `node scripts/sync-skills.mjs` to pull the four SZMC skills from `~/.claude/skills/<name>/` into `public/skills/`. In CI the script is a no-op when the source dir is absent, so committed skills ship as-is.

## Spec & plan

- [Design spec](docs/superpowers/specs/2026-04-22-ward-helper-design.md)
- [Implementation plan](docs/superpowers/plans/2026-04-22-ward-helper-v1.md)

## License

Personal tool. No license granted.
