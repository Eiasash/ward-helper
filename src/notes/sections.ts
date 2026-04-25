/**
 * Split a generated Hebrew note body into copy-by-section chunks.
 *
 * The model emits headers as lines starting with `# ` (single hash, space).
 * Each chunk between consecutive headers is one section. Anything before the
 * first header is the "intro" — labeled "פתיחה" so it gets its own copy
 * button rather than being lumped into the first real section.
 *
 * Pure / deterministic. Empty input → empty array. No-header input → a
 * single "פתיחה" section containing the whole text.
 */

export interface NoteSection {
  /** Hebrew label shown on the copy button. */
  name: string;
  /**
   * Section content INCLUDING its own `# header` line. Pasting this into
   * Chameleon should reproduce the section verbatim, header and all.
   */
  body: string;
}

const HEADER_RE = /^#\s+(.+?)\s*$/;
const INTRO_LABEL = 'פתיחה';

export function splitIntoSections(body: string): NoteSection[] {
  if (!body.trim()) return [];

  const lines = body.split('\n');
  const sections: NoteSection[] = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      if (current) {
        const trimmed = current.lines.join('\n').replace(/\n+$/, '');
        if (trimmed.trim().length > 0 || sections.length === 0) {
          sections.push({ name: current.name, body: trimmed });
        }
      }
      current = { name: m[1]!.trim(), lines: [line] };
    } else {
      if (!current) current = { name: INTRO_LABEL, lines: [] };
      current.lines.push(line);
    }
  }
  if (current) {
    const trimmed = current.lines.join('\n').replace(/\n+$/, '');
    // Drop a trailing empty intro if there was one (e.g. body that starts
    // with a header has no intro content).
    if (current.name !== INTRO_LABEL || trimmed.trim().length > 0) {
      sections.push({ name: current.name, body: trimmed });
    }
  }
  return sections;
}
