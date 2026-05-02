#!/usr/bin/env node
/**
 * Copies the SZMC skills from their source dir (default `~/.claude/skills/`)
 * into ward-helper's `public/skills/<name>/`.
 *
 * Unlike a blanket cpSync, each skill declares which files are runtime-relevant
 * (in SKILL_FILES below). Decorative / verification-only files in the source
 * folder (e.g. azma-ui's `slide_art/` directory of decorative slide
 * backgrounds, or its 198 KB SCORM `manifest.json` which only matters for
 * verifying quiz answer keys) are excluded from the bundle.
 *
 * Per-skill text patches (mostly to remove instructions for tools that exist
 * on claude.ai but NOT in ward-helper's runtime, like `project_knowledge_search`)
 * are applied after copy so the synced public/skills/ copy is what the model
 * actually sees, without diverging from the source-of-truth in
 * `~/.claude/skills/`.
 *
 * SKILL_SOURCE env var overrides the default source dir.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Per-skill: list of source-relative file paths to copy. If empty/undefined
 * the whole skill directory is copied (legacy behavior). Keep this in sync
 * with `src/skills/loader.ts` SKILL_FILES.
 */
const SKILL_FILES = {
  'azma-ui': ['SKILL.md', 'AZMA_REFERENCE.md', 'azma_reference.json'],
  'szmc-clinical-notes': ['SKILL.md'],
  'szmc-interesting-cases': ['SKILL.md'],
  'hebrew-medical-glossary': ['SKILL.md'],
  'geriatrics-knowledge': ['SKILL.md'],
};

/**
 * Per-skill text patches applied AFTER copy. Each entry: a function that takes
 * the file's text content and returns the patched text. Used to surgically
 * adjust skill content for ward-helper's runtime (which is different from
 * claude.ai's runtime — no project_knowledge_search, etc.).
 *
 * Keep these MINIMAL. If a patch becomes structural, prefer fixing the source
 * file in `~/.claude/skills/` instead, so the patch reduces to a no-op.
 */
const SKILL_PATCHES = {
  'geriatrics-knowledge': {
    'SKILL.md': (text) => {
      // The skill description AND body tell the model to call
      // `project_knowledge_search`. That tool exists on claude.ai when
      // project knowledge is attached, but NOT in ward-helper's runtime
      // — calls would fail / confuse the model. Rewrite every reference
      // to use the inline tables instead.
      let s = text;
      s = s.replace(
        /ALWAYS use project_knowledge_search FIRST[^.]*\./gi,
        'Use the inline tables in this file directly (project_knowledge_search is not available in this runtime).',
      );
      s = s.replace(
        /Never answer clinical questions from memory alone — always search first\./gi,
        'Never answer clinical questions from memory alone — always cite from the inline tables in this file.',
      );
      // Body usage instruction: "Run `project_knowledge_search` with focused
      // queries. 2-3 per complex question." → no-op in this runtime.
      s = s.replace(
        /Run `project_knowledge_search`[^.]*\.\s*\d+[–\-]\d+\s*per\s*complex\s*question\.?/gi,
        'Read the inline tables in this file directly. The runtime does not provide search.',
      );
      // Catch any remaining bare mentions of project_knowledge_search.
      s = s.replace(
        /`?project_knowledge_search`?/gi,
        'inline-table lookup',
      );
      return s;
    },
  },
};

const SOURCE = process.env.SKILL_SOURCE
  ?? resolve(process.env.USERPROFILE ?? process.env.HOME ?? '', '.claude', 'skills');
const DEST = resolve('public', 'skills');

mkdirSync(DEST, { recursive: true });

// If the source tree doesn't exist (e.g. CI runner), skip entirely so we don't
// overwrite any checked-in skills. The dev machine is the authority for skill
// content; CI just ships whatever is committed.
if (!existsSync(SOURCE)) {
  console.log(`sync-skills: source ${SOURCE} not found; skipping (using committed public/skills/)`);
  process.exit(0);
}

const SKILLS = Object.keys(SKILL_FILES);

for (const name of SKILLS) {
  const src = join(SOURCE, name);
  const dst = join(DEST, name);
  const files = SKILL_FILES[name];

  if (!existsSync(src)) {
    if (!existsSync(dst)) {
      mkdirSync(dst, { recursive: true });
      writeFileSync(
        join(dst, 'SKILL.md'),
        `# ${name}\n\n(placeholder — source not found at ${src})\n`,
      );
      console.warn(`WARN: ${name} source missing; wrote placeholder to ${dst}/SKILL.md`);
    } else {
      console.log(`${name}: source missing, keeping existing committed copy`);
    }
    continue;
  }

  // Selective copy: only the whitelisted files. Skips decorative / verification-
  // only files in the source dir (e.g. slide_art/, manifest.json, README.md).
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  let missing = 0;
  for (const f of files) {
    const fSrc = join(src, f);
    const fDst = join(dst, f);
    if (existsSync(fSrc)) {
      cpSync(fSrc, fDst);
      copied++;
    } else {
      missing++;
      console.warn(`WARN: ${name}/${f} not in source — skipping`);
    }
  }

  // Apply per-file text patches if any.
  const patches = SKILL_PATCHES[name];
  if (patches) {
    for (const [filename, patchFn] of Object.entries(patches)) {
      const fp = join(dst, filename);
      if (existsSync(fp)) {
        const before = readFileSync(fp, 'utf8');
        const after = patchFn(before);
        if (after !== before) {
          writeFileSync(fp, after);
          console.log(`patched ${name}/${filename}`);
        }
      }
    }
  }

  console.log(`synced ${name} (${copied}/${files.length} files${missing ? `, ${missing} missing` : ''})`);
}
