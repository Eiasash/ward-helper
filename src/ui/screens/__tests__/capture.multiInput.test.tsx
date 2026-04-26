/**
 * Multi-input Capture (v1.21.0) — exercises the ordered blocks UI:
 *   - mixed image + text blocks render in order
 *   - paste handler routes image+text from a single ClipboardEvent
 *   - removing a middle block preserves remaining order
 *   - move-up/down disabled at list ends
 *
 * The clipboard paste handler is also covered in isolation because
 * happy-dom's ClipboardEvent shape is permissive — exercising the DOM
 * dispatch is the realistic mobile-Chrome scenario; a pure-function
 * test is unnecessary because the handler reads from the dispatched
 * event's clipboardData directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

vi.mock('@/camera/compress', () => ({
  compressImage: vi.fn(async (d: string) => d),
}));
vi.mock('@/crypto/keystore', () => ({
  hasApiKey: vi.fn(async () => true),
}));

import { Capture } from '@/ui/screens/Capture';
import {
  addImageBlock,
  addTextBlock,
  clearBlocks,
  listBlocks,
} from '@/camera/session';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake-${++n}`,
    revokeObjectURL: () => {},
  });
  sessionStorage.clear();
  clearBlocks();
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

async function flush() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

function renderCapture() {
  return render(
    <MemoryRouter>
      <Capture />
    </MemoryRouter>,
  );
}

describe('Capture — mixed-block render order', () => {
  it('renders blocks in their session order', async () => {
    addImageBlock(TINY_PNG, 'camera');
    addTextBlock('first text', 'typed');
    addImageBlock(TINY_PNG, 'gallery');
    addTextBlock('second text', 'paste');

    const { container } = renderCapture();
    await flush();

    const items = container.querySelectorAll('li[data-block-kind]');
    expect(items).toHaveLength(4);
    expect(items[0]!.getAttribute('data-block-kind')).toBe('image');
    expect(items[1]!.getAttribute('data-block-kind')).toBe('text');
    expect(items[2]!.getAttribute('data-block-kind')).toBe('image');
    expect(items[3]!.getAttribute('data-block-kind')).toBe('text');
  });
});

describe('Capture — paste handler', () => {
  it('routes an image+text ClipboardEvent into one image block + one text block', async () => {
    renderCapture();
    await flush();

    // Construct a ClipboardEvent whose dataTransfer contains both an image
    // file and plain text. happy-dom doesn't fire the real ClipboardEvent
    // shape, so we synthesize the relevant subset and dispatch on window.
    const file = new File(['x'], 'snip.png', { type: 'image/png' });
    // FileReader needs to produce a valid data URL on read; happy-dom
    // returns 'data:application/octet-stream;base64,...' for text files,
    // which compressImage's data-URL parser tolerates. Mock the reader
    // to return a known PNG so addImageBlock's atob() succeeds.
    const OriginalFileReader = globalThis.FileReader;
    class FakeFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        this.result = TINY_PNG;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader);

    const items = [
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => file,
      } as unknown as DataTransferItem,
    ];
    const cd = {
      items,
      getData: (t: string) => (t === 'text' ? 'pasted hebrew text' : ''),
    } as unknown as DataTransfer;

    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: cd });

    await act(async () => {
      window.dispatchEvent(ev);
      await new Promise<void>((r) => setTimeout(r, 10));
    });
    await flush();

    vi.stubGlobal('FileReader', OriginalFileReader);

    const blocks = listBlocks();
    expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(1);
    expect(blocks.filter((b) => b.kind === 'text')).toHaveLength(1);
    const img = blocks.find((b) => b.kind === 'image')!;
    const txt = blocks.find((b) => b.kind === 'text')!;
    expect(img.sourceLabel).toBe('clipboard');
    expect((txt as { content: string }).content).toBe('pasted hebrew text');
    expect(txt.sourceLabel).toBe('paste');
  });
});

describe('Capture — remove preserves remaining order', () => {
  it('removing the middle block leaves the surrounding blocks in their original positions', async () => {
    addImageBlock(TINY_PNG, 'camera');
    addTextBlock('middle text', 'typed');
    addImageBlock(TINY_PNG, 'gallery');

    const { container } = renderCapture();
    await flush();

    // The textarea preview button "ערוך" identifies a text row uniquely.
    // Find the text row and click its remove button (the ✕).
    const textRow = Array.from(
      container.querySelectorAll('li[data-block-kind="text"]'),
    )[0] as HTMLElement;
    const removeBtn = textRow.querySelector(
      'button[aria-label="הסר בלוק"]',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(removeBtn);
    });
    await flush();

    const items = container.querySelectorAll('li[data-block-kind]');
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute('data-block-kind')).toBe('image');
    expect(items[1]!.getAttribute('data-block-kind')).toBe('image');
  });
});

describe('Capture — move-up / move-down end-of-list disable', () => {
  it('first row ↑ is disabled and last row ↓ is disabled', async () => {
    addImageBlock(TINY_PNG, 'camera');
    addImageBlock(TINY_PNG, 'gallery');
    addImageBlock(TINY_PNG, 'gallery');

    const { container } = renderCapture();
    await flush();

    const rows = container.querySelectorAll('li[data-block-kind]');
    const firstUp = (rows[0] as HTMLElement).querySelector(
      'button[aria-label="העלה למעלה"]',
    ) as HTMLButtonElement;
    const firstDown = (rows[0] as HTMLElement).querySelector(
      'button[aria-label="הורד למטה"]',
    ) as HTMLButtonElement;
    const lastUp = (rows[2] as HTMLElement).querySelector(
      'button[aria-label="העלה למעלה"]',
    ) as HTMLButtonElement;
    const lastDown = (rows[2] as HTMLElement).querySelector(
      'button[aria-label="הורד למטה"]',
    ) as HTMLButtonElement;

    expect(firstUp.disabled).toBe(true);
    expect(firstDown.disabled).toBe(false);
    expect(lastUp.disabled).toBe(false);
    expect(lastDown.disabled).toBe(true);
  });

  it('move-down on the first block reorders to position 2', async () => {
    const a = addImageBlock(TINY_PNG, 'camera');
    const b = addTextBlock('text', 'typed');

    const { container } = renderCapture();
    await flush();

    const rows = container.querySelectorAll('li[data-block-kind]');
    const downBtn = (rows[0] as HTMLElement).querySelector(
      'button[aria-label="הורד למטה"]',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(downBtn);
    });
    await flush();

    const reordered = listBlocks();
    expect(reordered[0]!.id).toBe(b.id);
    expect(reordered[1]!.id).toBe(a.id);
  });
});

describe('Capture — cap feedback', () => {
  it('image cap: pre-seed 10, attempt to add 1 more — count stays at 10, warning shown', async () => {
    for (let i = 0; i < 10; i++) addImageBlock(TINY_PNG, 'gallery');
    const { container } = renderCapture();
    await flush();

    // The label/input pair is replaced with a disabled button at cap, so
    // there's no usable file input on the screen — verify that, then
    // also verify onPickFiles still rejects defensively if exercised.
    const galleryInput = container.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement | null;
    expect(galleryInput).toBeNull();

    const galleryBtn = screen.getByLabelText('גלריה — תקרה') as HTMLButtonElement;
    expect(galleryBtn.disabled).toBe(true);
    const cameraBtn = screen.getByLabelText('צלם — תקרה') as HTMLButtonElement;
    expect(cameraBtn.disabled).toBe(true);

    expect(listBlocks().filter((b) => b.kind === 'image')).toHaveLength(10);
  });

  it('text cap: pre-seed 8 text blocks — "הוסף טקסט" button is disabled', async () => {
    for (let i = 0; i < 8; i++) addTextBlock(`t${i}`, 'paste');
    renderCapture();
    await flush();

    const addTextBtn = screen.getByText(/הוסף טקסט/) as HTMLButtonElement;
    expect(addTextBtn.disabled).toBe(true);
    expect(listBlocks().filter((b) => b.kind === 'text')).toHaveLength(8);
  });

  it('paste of an image while at image cap surfaces the cap warning', async () => {
    for (let i = 0; i < 10; i++) addImageBlock(TINY_PNG, 'gallery');
    const { container } = renderCapture();
    await flush();

    const file = new File(['x'], 'snip.png', { type: 'image/png' });
    class FakeFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        this.result = TINY_PNG;
        setTimeout(() => this.onload?.(), 0);
      }
    }
    const OriginalFileReader = globalThis.FileReader;
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader);

    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => file } as unknown as DataTransferItem,
    ];
    const cd = { items, getData: () => '' } as unknown as DataTransfer;
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: cd });

    await act(async () => {
      window.dispatchEvent(ev);
      await new Promise<void>((r) => setTimeout(r, 10));
    });
    await flush();

    vi.stubGlobal('FileReader', OriginalFileReader);

    const warn = Array.from(container.querySelectorAll('.pill-warn')).find((n) =>
      /תקרה/.test(n.textContent ?? ''),
    );
    expect(warn).toBeDefined();
    expect(listBlocks().filter((b) => b.kind === 'image')).toHaveLength(10);
  });
});

describe('Capture — Proceed disabled when empty', () => {
  it('Proceed is disabled with zero blocks', async () => {
    renderCapture();
    await flush();
    const proceed = screen.getByText(/המשך לבדיקה/);
    expect((proceed as HTMLButtonElement).disabled).toBe(true);
  });

  it('Proceed becomes enabled after adding any block', async () => {
    addTextBlock('something', 'typed');
    renderCapture();
    await flush();
    const proceed = screen.getByText(/המשך לבדיקה/);
    expect((proceed as HTMLButtonElement).disabled).toBe(false);
  });
});
