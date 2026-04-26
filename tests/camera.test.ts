import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addImageBlock,
  listShots,
  removeBlock,
  clearBlocks,
} from '@/camera/session';

// happy-dom doesn't implement URL.createObjectURL/revokeObjectURL.
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

describe('camera session — multi-shot support (blocks API)', () => {
  it('accepts multiple sequential shots (gallery multi-select path)', () => {
    addImageBlock(TINY_PNG, 'gallery');
    addImageBlock(TINY_PNG, 'gallery');
    addImageBlock(TINY_PNG, 'gallery');
    expect(listShots()).toHaveLength(3);
  });

  it('removeBlock removes exactly one shot by id, keeping the rest', () => {
    const a = addImageBlock(TINY_PNG, 'camera')!;
    const b = addImageBlock(TINY_PNG, 'camera')!;
    const c = addImageBlock(TINY_PNG, 'camera')!;
    removeBlock(b.id);
    const ids = listShots().map((s) => s.id);
    expect(ids).toEqual([a.id, c.id]);
  });

  it('removeBlock is a no-op for an unknown id', () => {
    addImageBlock(TINY_PNG, 'camera');
    removeBlock('not-a-real-id');
    expect(listShots()).toHaveLength(1);
  });

  it('clearBlocks empties the session', () => {
    addImageBlock(TINY_PNG, 'gallery');
    addImageBlock(TINY_PNG, 'gallery');
    clearBlocks();
    expect(listShots()).toHaveLength(0);
  });
});
