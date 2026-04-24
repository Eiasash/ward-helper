import { describe, it, expect } from 'vitest';
import { stripMarkdownFence } from '@/agent/loop';

describe('stripMarkdownFence', () => {
  it('returns plain JSON unchanged', () => {
    const s = '{"noteHebrew":"קבלה"}';
    expect(stripMarkdownFence(s)).toBe(s);
  });

  it('strips ```json fences', () => {
    const wrapped = '```json\n{"noteHebrew":"x"}\n```';
    expect(stripMarkdownFence(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('strips bare ``` fences (no language tag)', () => {
    const wrapped = '```\n{"noteHebrew":"x"}\n```';
    expect(stripMarkdownFence(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('strips fences with surrounding whitespace padding', () => {
    const wrapped = '   ```json\n{"noteHebrew":"x"}\n```   ';
    expect(stripMarkdownFence(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('strips uppercase ```JSON variant', () => {
    const wrapped = '```JSON\n{"noteHebrew":"x"}\n```';
    expect(stripMarkdownFence(wrapped)).toBe('{"noteHebrew":"x"}');
  });

  it('is idempotent — calling twice equals calling once', () => {
    const wrapped = '```json\n{"noteHebrew":"קבלה"}\n```';
    const once = stripMarkdownFence(wrapped);
    const twice = stripMarkdownFence(once);
    expect(twice).toBe(once);
  });

  it('handles empty string', () => {
    expect(stripMarkdownFence('')).toBe('');
  });

  it('preserves Hebrew content inside fences', () => {
    const wrapped = '```json\n{"noteHebrew":"קבלה: דוד כהן בן 82"}\n```';
    expect(stripMarkdownFence(wrapped)).toBe(
      '{"noteHebrew":"קבלה: דוד כהן בן 82"}',
    );
  });

  it('handles CRLF newlines around the fences', () => {
    const wrapped = '```json\r\n{"noteHebrew":"x"}\r\n```';
    expect(stripMarkdownFence(wrapped)).toBe('{"noteHebrew":"x"}');
  });
});
