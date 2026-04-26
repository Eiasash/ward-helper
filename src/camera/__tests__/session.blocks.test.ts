/**
 * blocks[] session — round-trip + cap + reorder semantics. Covers v1.21.0
 * scope: a single ordered list of image and text blocks replacing the old
 * shots[] + pastedText globals.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addImageBlock,
  addTextBlock,
  updateTextBlock,
  removeBlock,
  reorderBlocks,
  listBlocks,
  clearBlocks,
  listShots,
  getPastedText,
  IMAGE_HARD_CAP,
  TEXT_HARD_CAP,
} from '@/camera/session';

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake-${++n}`,
    revokeObjectURL: () => {},
  });
  clearBlocks();
});

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('session blocks — add / remove / update', () => {
  it('addImageBlock preserves order across mixed adds', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addTextBlock('hello', 'typed')!;
    const c = addImageBlock(TINY_PNG, 'gallery')!;
    expect(listBlocks().map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(listBlocks().map((x) => x.kind)).toEqual(['image', 'text', 'image']);
  });

  it('updateTextBlock mutates content in place; image blocks are immune', () => {
    const t = addTextBlock('first', 'typed')!;
    const i = addImageBlock(TINY_PNG, 'camera')!;
    updateTextBlock(t.id, 'second');
    updateTextBlock(i.id, 'should be ignored — wrong kind');
    const out = listBlocks();
    expect((out[0] as { content: string }).content).toBe('second');
    expect(out[1]!.kind).toBe('image');
  });

  it('removeBlock removes a single block by id, preserves order', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addTextBlock('mid', 'paste')!;
    const c = addImageBlock(TINY_PNG, 'gallery')!;
    removeBlock(b.id);
    expect(listBlocks().map((x) => x.id)).toEqual([a.id, c.id]);
  });
});

describe('session blocks — reorderBlocks', () => {
  it('moves a block from fromIndex to toIndex', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addTextBlock('B', 'typed')!;
    const c = addImageBlock(TINY_PNG, 'gallery')!;
    reorderBlocks(2, 0);
    expect(listBlocks().map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it('out-of-bounds reorder is a no-op (defensive)', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addTextBlock('B', 'typed')!;
    reorderBlocks(-1, 0);
    reorderBlocks(0, 5);
    reorderBlocks(99, 1);
    expect(listBlocks().map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('reorder with same index is a no-op', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addTextBlock('B', 'typed')!;
    reorderBlocks(1, 1);
    expect(listBlocks().map((x) => x.id)).toEqual([a.id, b.id]);
  });
});

describe('session blocks — cap enforcement', () => {
  it('rejects the 11th image (returns null)', () => {
    for (let i = 0; i < IMAGE_HARD_CAP; i++) addImageBlock(TINY_PNG, 'gallery');
    const overflow = addImageBlock(TINY_PNG, 'gallery');
    expect(overflow).toBeNull();
    expect(listBlocks().filter((b) => b.kind === 'image')).toHaveLength(IMAGE_HARD_CAP);
  });

  it('rejects the 9th text block (returns null)', () => {
    for (let i = 0; i < TEXT_HARD_CAP; i++) addTextBlock(`t${i}`, 'paste');
    const overflow = addTextBlock('overflow', 'typed');
    expect(overflow).toBeNull();
    expect(listBlocks().filter((b) => b.kind === 'text')).toHaveLength(TEXT_HARD_CAP);
  });

  it('image cap and text cap are independent', () => {
    for (let i = 0; i < IMAGE_HARD_CAP; i++) addImageBlock(TINY_PNG, 'gallery');
    const t = addTextBlock('still ok', 'typed');
    expect(t).not.toBeNull();
  });
});

describe('session blocks — backcompat helpers', () => {
  it('listShots() returns image-kind blocks only, in order, in legacy shape', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    addTextBlock('mid', 'paste');
    const c = addImageBlock(TINY_PNG, 'gallery')!;
    const shots = listShots();
    expect(shots).toHaveLength(2);
    expect(shots.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(shots[0]).toMatchObject({ id: a.id, dataUrl: TINY_PNG });
    expect(shots[0]).toHaveProperty('blobUrl');
    expect(shots[0]).toHaveProperty('capturedAt');
  });

  it('getPastedText() returns the first text block content (or null)', () => {
    expect(getPastedText()).toBeNull();
    addImageBlock(TINY_PNG, 'camera');
    expect(getPastedText()).toBeNull();
    addTextBlock('first paste payload', 'paste');
    addTextBlock('second', 'typed');
    expect(getPastedText()).toBe('first paste payload');
  });
});

describe('session blocks — clearBlocks', () => {
  it('empties the session and revokes blob URLs', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:x',
      revokeObjectURL: revoke,
    });
    addImageBlock(TINY_PNG, 'camera');
    addImageBlock(TINY_PNG, 'gallery');
    addTextBlock('t', 'typed');
    clearBlocks();
    expect(listBlocks()).toHaveLength(0);
    // 2 images → 2 revocations.
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
