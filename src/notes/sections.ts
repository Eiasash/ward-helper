/**
 * Split a generated Hebrew note body into copy-by-section chunks.
 *
 * Two header styles are recognized:
 *   1. `# label` — markdown-style, used by the model for problem-list items
 *      inside the discussion section ("# חשד לפרכוס", "# פגיעה כלייתית")
 *   2. `<hebrew label>:` on its own line — used for the major structural
 *      sections of admission/discharge notes ("הצגת החולה:", "אבחנות פעילות:",
 *      "רקע רפואי:", "תרופות בבית:", "דיון ותוכנית:", "חתימה:" etc.)
 *
 * Both styles split the note into a flat list of sections — so the user can
 * copy any individual section (or sub-section / problem) into Chameleon
 * without scrolling to find the boundaries.
 *
 * Anything before the first header is the "intro" — labeled "פתיחה" so it
 * gets its own copy button.
 *
 * Pure / deterministic. Empty input → empty array. No-header input → a
 * single "פתיחה" section containing the whole text.
 */

export interface NoteSection {
  /** Hebrew label shown on the copy button. */
  name: string;
  /**
   * Section content INCLUDING its own header line. Pasting this into
   * Chameleon should reproduce the section verbatim, header and all.
   */
  body: string;
}

const HEADER_HASH_RE = /^#\s+(.+?)\s*$/;
// Hebrew-label-colon header: line is ENTIRELY a Hebrew label + ":" + only
// trailing whitespace. Allows spaces, hyphens, and slashes inside the label
// (e.g. "פרוט מחלות:", "דיון ותוכנית:"). Length capped at 60 to avoid
// matching long content lines that incidentally end with ":".
// ֐-׿ is the Hebrew unicode block.
const HEADER_HEBREW_LABEL_RE = /^([֐-׿][֐-׿\s\-/]{0,60}):\s*$/;
const INTRO_LABEL = 'פתיחה';

function detectHeader(line: string): string | null {
  const hashMatch = HEADER_HASH_RE.exec(line);
  if (hashMatch) return hashMatch[1]!.trim();
  const hebMatch = HEADER_HEBREW_LABEL_RE.exec(line);
  if (hebMatch) return hebMatch[1]!.trim();
  return null;
}

export function splitIntoSections(body: string): NoteSection[] {
  if (!body.trim()) return [];

  const lines = body.split('\n');
  const sections: NoteSection[] = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerName = detectHeader(line);
    if (headerName) {
      if (current) {
        const trimmed = current.lines.join('\n').replace(/\n+$/, '');
        if (trimmed.trim().length > 0 || sections.length === 0) {
          sections.push({ name: current.name, body: trimmed });
        }
      }
      current = { name: headerName, lines: [line] };
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
