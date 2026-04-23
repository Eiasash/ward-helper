#!/usr/bin/env node
/**
 * Copies the four SZMC skills from their source dir into public/skills/<name>/.
 * Unlike a "SKILL.md only" copy, this replicates the entire skill folder so
 * pointer-style skills (azma-ui has SKILL.md → AZMA_REFERENCE.md) work at runtime.
 *
 * SKILL_SOURCE env var overrides the default source (~/.claude/skills/).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILLS = [
  'azma-ui',
  'szmc-clinical-notes',
  'szmc-interesting-cases',
  'hebrew-medical-glossary',
];

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

for (const name of SKILLS) {
  const src = join(SOURCE, name);
  const dst = join(DEST, name);
  if (existsSync(src)) {
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    console.log(`synced ${name}`);
  } else if (!existsSync(dst)) {
    mkdirSync(dst, { recursive: true });
    writeFileSync(
      join(dst, 'SKILL.md'),
      `# ${name}\n\n(placeholder — source not found at ${src})\n`,
    );
    console.warn(`WARN: ${name} source missing; wrote placeholder to ${dst}/SKILL.md`);
  } else {
    console.log(`${name}: source missing, keeping existing committed copy`);
  }
}
