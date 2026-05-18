/**
 * SOAP → AZMA 4-field segmenter.
 *
 * AZMA's SOAP entry has four separate, pre-labeled fields (S / O / A / P);
 * you paste each section into its own field. ward-helper emits ONE note
 * body with Hebrew section headers. Two defects make the generic
 * `splitIntoSections` per-section copy unusable for AZMA SOAP:
 *
 *   1. Header duplication — a copied section still carries its header line,
 *      so "דיווח המטופל:" stacks on top of AZMA's own S field label.
 *   2. Mis-segmentation — A fragments into capsule ("מסקנה והערכה") +
 *      "בעיות", and "תוכנית טיפול (יעדי טיפול)" is swallowed into the P
 *      section because its parentheses fail the Hebrew-label header regex.
 *
 * This function produces four header-less strings, each ready to paste
 * straight into its matching AZMA field:
 *
 *   S = "דיווח המטופל" body
 *   O = "בדיקה גופנית וממצאי עזר" body
 *   A = capsule ("מסקנה והערכה") + "בעיות:" + *domain bullets
 *       + the "תוכנית טיפול (יעדי טיפול)" goal block — together
 *   P = "לביצוע" body, WITHOUT the goal block (which belongs with A's goal,
 *       not P — per the SOAP/AZMA spec)
 *
 * The outer S/O/A/P labels are stripped (they collide with AZMA's pre-set
 * field labels). The inner "בעיות:" and "תוכנית טיפול (יעדי טיפול):" lines
 * are KEPT — they are sub-structure of the A field, not field labels, and
 * carry no AZMA collision.
 *
 * Header matching is restricted to the six known SOAP labels (not "any
 * Hebrew label:") so content lines that incidentally end in ":" can't
 * mis-trigger a field boundary. An optional leading "S "/"O "/"A "/"P "
 * Latin prefix is tolerated: the SOAP template suggests it but the model
 * emits Hebrew-only headers in practice — accepting both is robust to that
 * drift (the exact ambiguity behind the closed PR #201).
 *
 * Returns null when the body lacks the SOAP anchors (S, O, an A component,
 * and P) — the caller falls back to the generic per-section copy UI rather
 * than hand AZMA empty field pastes. Pure / deterministic.
 */

export interface SoapFields {
  /** דיווח המטופל — pastes into AZMA's S field. */
  s: string;
  /** בדיקה גופנית וממצאי עזר — pastes into AZMA's O field. */
  o: string;
  /** מסקנה והערכה + בעיות + *bullets + תוכנית טיפול goal — AZMA's A field. */
  a: string;
  /** לביצוע, goal block excluded — pastes into AZMA's P field. */
  p: string;
}

type Bucket = 's' | 'o' | 'a' | 'p';

/** Optional Latin S/O/A/P prefix some outputs carry; stripped before match. */
const SOAP_LATIN_PREFIX_RE = /^[SOAP]\s+/;

/**
 * Classify a line as a SOAP field header, or null if it is content.
 * `keepHeader` = include this header line in the field body (true only for
 * the A sub-structure labels "בעיות" / "תוכנית טיפול", which are not AZMA
 * field labels and give the assessment its shape).
 */
function classifyHeader(
  line: string,
): { bucket: Bucket; keepHeader: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed.endsWith(':')) return null;
  // Strip an optional leading "S "/"O "/"A "/"P " then the trailing colon.
  const label = trimmed
    .replace(SOAP_LATIN_PREFIX_RE, '')
    .replace(/:\s*$/, '')
    .trim();

  switch (label) {
    case 'דיווח המטופל':
      return { bucket: 's', keepHeader: false };
    case 'בדיקה גופנית וממצאי עזר':
      return { bucket: 'o', keepHeader: false };
    case 'מסקנה והערכה':
      return { bucket: 'a', keepHeader: false };
    case 'בעיות':
      return { bucket: 'a', keepHeader: true };
    case 'לביצוע':
      return { bucket: 'p', keepHeader: false };
    default:
      // Goal header. The template wording is "תוכנית טיפול (יעדי טיפול)";
      // match by the stable "תוכנית טיפול" prefix to tolerate spelling /
      // spacing variants ("תכנית טיפול", extra spaces inside the parens).
      if (label.startsWith('תוכנית טיפול') || label.startsWith('תכנית טיפול')) {
        return { bucket: 'a', keepHeader: true };
      }
      return null;
  }
}

function normalize(lines: string[]): string {
  // A stripped header leaves its trailing blank line behind; collapse 3+
  // newlines to a paragraph break and trim the field edges.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitSoapFields(body: string): SoapFields | null {
  if (!body.trim()) return null;

  const buckets: Record<Bucket, string[]> = { s: [], o: [], a: [], p: [] };
  const seen = { s: false, o: false, aCapsule: false, aProblems: false, p: false };
  let current: Bucket | null = null;

  for (const line of body.split('\n')) {
    const header = classifyHeader(line);
    if (header) {
      current = header.bucket;
      if (header.bucket === 's') seen.s = true;
      else if (header.bucket === 'o') seen.o = true;
      else if (header.bucket === 'p') seen.p = true;
      else {
        // 'a' — distinguish capsule vs the kept sub-labels for the gate.
        if (header.keepHeader) seen.aProblems = true;
        else seen.aCapsule = true;
      }
      if (header.keepHeader) buckets[header.bucket].push(line);
      continue;
    }
    // Content before any recognized SOAP header (stray preamble) is dropped:
    // there is no AZMA field for it, and keeping it would mis-fill S.
    if (current) buckets[current].push(line);
  }

  // Require the structural anchors. A non-conforming body → null so the
  // caller keeps the generic section UI instead of emitting empty fields.
  if (!seen.s || !seen.o || !seen.p || !(seen.aCapsule || seen.aProblems)) {
    return null;
  }

  return {
    s: normalize(buckets.s),
    o: normalize(buckets.o),
    a: normalize(buckets.a),
    p: normalize(buckets.p),
  };
}
