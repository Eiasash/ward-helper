import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addShot,
  listShots,
  removeShot,
  clearShots,
} from '@/camera/session';

// happy-dom doesn't implement URL.createObjectURL/revokeObjectURL.
beforeEach(() => {
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake-${++n}`,
    revokeObjectURL: () => {},
  });
  clearShots();
});

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('camera session — multi-shot support', () => {
  it('accepts multiple sequential shots (gallery multi-select path)', () => {
    addShot(TINY_PNG);
    addShot(TINY_PNG);
    addShot(TINY_PNG);
    expect(listShots()).toHaveLength(3);
  });

  it('removeShot removes exactly one shot by id, keeping the rest', () => {
    const a = addShot(TINY_PNG);
    const b = addShot(TINY_PNG);
    const c = addShot(TINY_PNG);
    removeShot(b.id);
    const ids = listShots().map((s) => s.id);
    expect(ids).toEqual([a.id, c.id]);
  });

  it('removeShot is a no-op for an unknown id', () => {
    addShot(TINY_PNG);
    removeShot('not-a-real-id');
    expect(listShots()).toHaveLength(1);
  });

  it('clearShots empties the session', () => {
    addShot(TINY_PNG);
    addShot(TINY_PNG);
    clearShots();
    expect(listShots()).toHaveLength(0);
  });
});
