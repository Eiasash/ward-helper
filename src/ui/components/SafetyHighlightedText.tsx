/**
 * Inline drug-safety underliner for the Review screen.
 *
 * Reads the v1.20.0 SafetyFlags structure (Beers / STOPP / START hits, each
 * carrying a `drug` string and a `severity` level), scans the supplied body
 * text for those drug names, and renders them as <mark>-style spans:
 *
 *   - severity 'critical' / 'high' → red underline
 *   - severity 'moderate' / 'low'  → amber underline
 *
 * Tapping a highlighted span surfaces a tooltip with the rule
 * recommendation. Implementation uses `<details>` for native click-to-open
 * accessibility on mobile (no JS state needed); the body of `<details>`
 * carries the recommendation text.
 *
 * Rendering invariant: the original text outside drug name spans is passed
 * through unchanged. Match locations are computed by `findHighlightRanges`,
 * a pure function unit-tested in isolation.
 */
import type { Hit, SafetyFlags, Severity } from '@/safety/types';

export interface HighlightRange {
  start: number;
  end: number;
  hit: Hit;
}

const SEVERITY_TO_TONE: Record<Severity, 'red' | 'amber'> = {
  critical: 'red',
  high: 'red',
  moderate: 'amber',
  low: 'amber',
};

/**
 * Pure: find every drug-name match in `text` from the supplied flags.
 *
 * Match rules:
 *   - Drug names are matched case-insensitively, on word boundaries, against
 *     the `hit.drug` string (with regex specials escaped).
 *   - Overlapping matches are coalesced — the highest-severity hit wins
 *     (red beats amber). When two hits share a severity tier, the earlier
 *     one in the flags arrays is used.
 *   - All non-overlapping matches are kept and returned in left-to-right
 *     order.
 *
 * Exported so tests can lock the range computation independently of
 * rendering.
 */
export function findHighlightRanges(
  text: string,
  flags: SafetyFlags | null | undefined,
): HighlightRange[] {
  if (!flags || !text) return [];
  // Combine the three rule families into one ordered hit list (severity
  // distinguishes them at render time; ordering only matters for tie-break).
  const allHits: Hit[] = [...flags.beers, ...flags.stopp, ...flags.start];
  if (allHits.length === 0) return [];

  const ranges: HighlightRange[] = [];
  for (const hit of allHits) {
    const drug = hit.drug?.trim();
    if (!drug) continue;
    // Word-boundary regex around the drug name, case-insensitive. JS `\b`
    // is ASCII-only; for Hebrew drug names we use a Unicode-aware lookaround
    // that treats Hebrew letters as part of a "word." The (?:^|...) prefix
    // and (?:$|...) suffix avoid matching mid-token (e.g. "spirin" inside
    // "myaspirin" should NOT fire when the rule drug is "aspirin").
    const re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(${escapeRegex(drug)})(?=$|[^\\p{L}\\p{N}])`,
      'giu',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // The capture group (group 1) is the actual drug name; the leading
      // non-word char (if any) is part of m[0] but should not be included
      // in the highlight range.
      const matchedDrug = m[1] ?? '';
      const drugStart = m.index + (m[0].length - matchedDrug.length);
      ranges.push({ start: drugStart, end: drugStart + matchedDrug.length, hit });
      // Reset lastIndex so a single-char prefix (like a space) doesn't
      // skip an immediately adjacent next match.
      re.lastIndex = drugStart + matchedDrug.length;
      // Guard against zero-length matches looping forever.
      if (matchedDrug.length === 0) re.lastIndex++;
    }
  }
  if (ranges.length === 0) return [];

  // Sort by start; on ties, longest range first so the longer match wins
  // (e.g. "Apixaban" vs "ban") at the same start.
  ranges.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  // Coalesce overlaps. Highest-severity tone wins; if same tone, keep first.
  const coalesced: HighlightRange[] = [];
  for (const r of ranges) {
    const last = coalesced[coalesced.length - 1];
    if (last && r.start < last.end) {
      // overlap — pick the one with worse severity (red beats amber)
      const lastTone = SEVERITY_TO_TONE[last.hit.severity];
      const rTone = SEVERITY_TO_TONE[r.hit.severity];
      if (rTone === 'red' && lastTone === 'amber') {
        last.hit = r.hit;
      }
      // either way, drop the new range (already covered)
      continue;
    }
    coalesced.push({ ...r });
  }
  return coalesced;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render the body text with inline drug highlights. Plain text outside
 * matched drug names is passed through verbatim. Each match is wrapped in
 * a `<details>` so a tap (or hover with `summary` open) reveals the rule
 * recommendation.
 */
export function SafetyHighlightedText({
  text,
  flags,
}: {
  text: string;
  flags: SafetyFlags | null | undefined;
}) {
  const ranges = findHighlightRanges(text, flags);
  if (ranges.length === 0) {
    return <span dir="auto">{text}</span>;
  }
  const parts: Array<string | { range: HighlightRange; key: number }> = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (cursor < r.start) parts.push(text.slice(cursor, r.start));
    parts.push({ range: r, key: i });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <span dir="auto" className="safety-highlight-text">
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={`s${i}`}>{p}</span>;
        const tone = SEVERITY_TO_TONE[p.range.hit.severity];
        const matched = text.slice(p.range.start, p.range.end);
        return (
          <details
            key={`h${p.key}`}
            className={`safety-highlight ${tone}`}
            data-severity={p.range.hit.severity}
            data-rule={p.range.hit.code}
          >
            <summary
              dir="ltr"
              title={p.range.hit.recommendation}
              aria-label={`${matched} — ${p.range.hit.recommendation}`}
            >
              {matched}
            </summary>
            <span dir="auto" className="safety-highlight-tooltip">
              {p.range.hit.code} · {p.range.hit.recommendation}
            </span>
          </details>
        );
      })}
    </span>
  );
}
