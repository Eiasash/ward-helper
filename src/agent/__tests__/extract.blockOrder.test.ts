/**
 * runExtractTurn (v1.21.0) — confirms the request body's content array is
 * shaped as: [extract-prompt-text, ...blocks-in-order] with text-block
 * source labels mapped to the documented Hebrew section headers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runExtractTurn } from '@/agent/loop';
import type { CaptureBlock } from '@/camera/session';

function mockOk(text: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

function img(dataUrl: string): CaptureBlock {
  return {
    kind: 'image',
    id: 'i-' + Math.random(),
    dataUrl,
    blobUrl: 'blob:fake',
    sourceLabel: 'camera',
    addedAt: 0,
  };
}
function txt(content: string, sourceLabel: 'paste' | 'typed'): CaptureBlock {
  return {
    kind: 'text',
    id: 't-' + Math.random(),
    content,
    sourceLabel,
    addedAt: 0,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface SentBody {
  messages: Array<{
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { data: string; media_type: string } }
    >;
  }>;
}

describe('runExtractTurn — block content array shape & order', () => {
  it('content[0] is the extract prompt; subsequent items mirror blocks order', async () => {
    const fetchFn = mockOk(JSON.stringify({ fields: {}, confidence: {} }));
    vi.stubGlobal('fetch', fetchFn);

    const blocks: CaptureBlock[] = [
      img('data:image/jpeg;base64,/9j/AAA'),
      txt('caption for first image', 'typed'),
      img('data:image/jpeg;base64,/9j/BBB'),
      txt('extra paste payload', 'paste'),
    ];
    await runExtractTurn(blocks, 'skill');

    const body = JSON.parse(
      (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body,
    ) as SentBody;
    const content = body.messages[0]!.content;

    expect(content).toHaveLength(5);
    expect(content[0]!.type).toBe('text');
    // Prompt prefix — distinctive sentence from EXTRACT_JSON_INSTRUCTIONS.
    expect((content[0] as { text: string }).text).toMatch(/Return EXACTLY ONE valid JSON object/);

    expect(content[1]!.type).toBe('image');
    expect((content[1] as { source: { data: string } }).source.data).toBe('/9j/AAA');

    expect(content[2]!.type).toBe('text');
    expect((content[2] as { text: string }).text).toMatch(/^## הערות נוספות\n/);
    expect((content[2] as { text: string }).text).toContain('caption for first image');

    expect(content[3]!.type).toBe('image');
    expect((content[3] as { source: { data: string } }).source.data).toBe('/9j/BBB');

    expect(content[4]!.type).toBe('text');
    expect((content[4] as { text: string }).text).toMatch(/^## נתונים מודבקים\n/);
    expect((content[4] as { text: string }).text).toContain('extra paste payload');
  });

  it('paste-source labels render as "## נתונים מודבקים", typed as "## הערות נוספות"', async () => {
    const fetchFn = mockOk(JSON.stringify({ fields: {}, confidence: {} }));
    vi.stubGlobal('fetch', fetchFn);

    await runExtractTurn(
      [txt('a', 'paste'), txt('b', 'typed')],
      'skill',
    );
    const body = JSON.parse(
      (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]![1].body,
    ) as SentBody;
    const content = body.messages[0]!.content;
    expect((content[1] as { text: string }).text.startsWith('## נתונים מודבקים\n')).toBe(true);
    expect((content[2] as { text: string }).text.startsWith('## הערות נוספות\n')).toBe(true);
  });

  it('throws "אין קלט לעיבוד" when blocks list is empty', async () => {
    const fetchFn = mockOk('{}');
    vi.stubGlobal('fetch', fetchFn);
    await expect(runExtractTurn([], 'skill')).rejects.toThrow('אין קלט לעיבוד');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
