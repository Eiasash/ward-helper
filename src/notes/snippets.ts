import { getSettings, setSettings } from '@/storage/indexed';

/**
 * Snippet expansion: short trigger like `/nc` followed by a space expands to
 * a phrase. Doctors type the same five-six idioms ("ללא תלונות חדשות",
 * "המשך טיפול קיים", ...) into every SOAP and admission — the expansion
 * saves seconds per note and keeps the prose consistent.
 *
 * Persistence lives in the existing IDB `settings` singleton's `prefs` map
 * under key `snippets` so we don't bump DB_VERSION for what is fundamentally
 * a key/value preference. If `prefs.snippets` is missing, the default seed
 * (DEFAULT_SNIPPETS) is the user's effective map until they save anything.
 */

export type SnippetMap = Record<string, string>;

export const DEFAULT_SNIPPETS: SnippetMap = {
  '/nc': 'ללא תלונות חדשות',
  '/mt': 'המשך טיפול קיים',
  '/no': 'ללא ממצאים חריגים',
  '/mn': 'מטופלת בנוזלים',
  '/sf': 'יציבה הימודינמית, ללא חום',
};

const PREFS_KEY = 'snippets';
const TRIGGER_RE = /^\/[a-z]{1,4}$/;

export async function loadSnippets(): Promise<SnippetMap> {
  const s = await getSettings();
  const stored = (s?.prefs?.[PREFS_KEY] ?? null) as SnippetMap | null;
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_SNIPPETS };
  return stored;
}

export async function saveSnippets(map: SnippetMap): Promise<void> {
  const existing = await getSettings();
  // First-run: settings record doesn't exist yet (no API key saved). Create
  // a minimal one so the snippets persist before the user touches anything
  // crypto-related.
  const base = existing ?? {
    apiKeyXor: new Uint8Array(0),
    deviceSecret: new Uint8Array(0),
    lastPassphraseAuthAt: null,
    prefs: {},
  };
  await setSettings({
    ...base,
    prefs: { ...base.prefs, [PREFS_KEY]: map },
  });
}

/**
 * Pure expansion function — takes (text, cursorIndex, snippetMap) and returns
 * the new (text, cursorIndex) after applying any matching snippet. Extracted
 * from the textarea handler so the cursor-math is testable without React.
 *
 * Trigger contract: caller invokes this AFTER a space was just typed. The
 * function looks at the token immediately before the cursor's preceding
 * space, matches against /^\/[a-z]{1,4}$/, and if present in the map,
 * substitutes the expansion. The trailing space is preserved.
 *
 * If no match: returns the inputs unchanged (object equality NOT guaranteed —
 * callers should rely on string/number comparison).
 */
export function expandSnippetAt(
  text: string,
  cursorIndex: number,
  map: SnippetMap,
): { text: string; cursorIndex: number } {
  // Cursor is positioned RIGHT AFTER the space the user just typed.
  // Layout: ...prefix + token + " " + suffix
  //                            ^ cursor
  if (cursorIndex < 1 || text.charAt(cursorIndex - 1) !== ' ') {
    return { text, cursorIndex };
  }
  // Walk backwards from the space to find the start of the token.
  // Token boundary: start-of-string, whitespace, or newline.
  let tokenEnd = cursorIndex - 1; // index of the space
  let tokenStart = tokenEnd;
  while (tokenStart > 0) {
    const ch = text.charAt(tokenStart - 1);
    if (ch === ' ' || ch === '\n' || ch === '\t') break;
    tokenStart--;
  }
  const token = text.slice(tokenStart, tokenEnd);
  if (!TRIGGER_RE.test(token)) return { text, cursorIndex };
  const expansion = map[token];
  if (typeof expansion !== 'string') return { text, cursorIndex };

  const before = text.slice(0, tokenStart);
  const after = text.slice(tokenEnd); // includes the trailing space
  const newText = before + expansion + after;
  // Cursor lands right after the expansion + the preserved space.
  const newCursor = tokenStart + expansion.length + 1;
  return { text: newText, cursorIndex: newCursor };
}
