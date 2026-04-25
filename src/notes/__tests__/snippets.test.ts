import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  DEFAULT_SNIPPETS,
  loadSnippets,
  saveSnippets,
  expandSnippetAt,
} from '@/notes/snippets';
import { resetDbForTests } from '@/storage/indexed';

describe('snippets — persistence', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('returns the default seed when nothing has been saved', async () => {
    const m = await loadSnippets();
    expect(m).toEqual(DEFAULT_SNIPPETS);
  });

  it('persists a saved map and round-trips it back', async () => {
    const map = { '/x': 'expansion x', '/y': 'expansion y' };
    await saveSnippets(map);
    const back = await loadSnippets();
    expect(back).toEqual(map);
  });

  it('overwrites an existing saved map (not merge)', async () => {
    await saveSnippets({ '/a': 'first' });
    await saveSnippets({ '/b': 'second' });
    const back = await loadSnippets();
    expect(back).toEqual({ '/b': 'second' });
  });
});

describe('snippets — expandSnippetAt (pure)', () => {
  it('expands a known trigger after a trailing space', () => {
    const text = '/nc ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe('ללא תלונות חדשות ');
    expect(out.cursorIndex).toBe('ללא תלונות חדשות '.length);
  });

  it('preserves text before and after the trigger', () => {
    const text = 'הערה: /mt ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe('הערה: המשך טיפול קיים ');
    expect(out.cursorIndex).toBe('הערה: המשך טיפול קיים '.length);
  });

  it('expands mid-string (cursor not at end)', () => {
    const text = 'pre /no  post';
    // cursor right after the space following /no
    const cursor = 'pre /no '.length;
    const out = expandSnippetAt(text, cursor, DEFAULT_SNIPPETS);
    expect(out.text).toBe('pre ללא ממצאים חריגים  post');
    expect(out.cursorIndex).toBe('pre ללא ממצאים חריגים '.length);
  });

  it('returns input unchanged when no trailing space at cursor', () => {
    const text = '/nc';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe(text);
    expect(out.cursorIndex).toBe(text.length);
  });

  it('returns input unchanged when token is not in map', () => {
    const text = '/zz ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe(text);
    expect(out.cursorIndex).toBe(text.length);
  });

  it('returns input unchanged when token does not match trigger pattern', () => {
    const text = 'plain ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe(text);
    expect(out.cursorIndex).toBe(text.length);
  });

  it('does not expand when token has more than 4 letters', () => {
    const text = '/abcde ';
    const out = expandSnippetAt(text, text.length, { '/abcde': 'no' });
    // Token /abcde is 5 letters after the slash; trigger regex caps at 4.
    expect(out.text).toBe(text);
    expect(out.cursorIndex).toBe(text.length);
  });

  it('handles a token at the very start of the string', () => {
    const text = '/sf ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe('יציבה הימודינמית, ללא חום ');
    expect(out.cursorIndex).toBe('יציבה הימודינמית, ללא חום '.length);
  });

  it('treats newline as a token boundary', () => {
    const text = 'line1\n/mn ';
    const out = expandSnippetAt(text, text.length, DEFAULT_SNIPPETS);
    expect(out.text).toBe('line1\nמטופלת בנוזלים ');
    expect(out.cursorIndex).toBe('line1\nמטופלת בנוזלים '.length);
  });

  it('returns input unchanged when cursor is at index 0', () => {
    const out = expandSnippetAt('', 0, DEFAULT_SNIPPETS);
    expect(out.text).toBe('');
    expect(out.cursorIndex).toBe(0);
  });
});
