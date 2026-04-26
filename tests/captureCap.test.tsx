/**
 * Image-cap tests for Capture.tsx.
 *
 * Covers scope 2 of v1.18.0:
 *   - hard cap at IMAGE_HARD_CAP (10) — extra files are dropped with a
 *     Hebrew warning stating how many
 *   - 3-tier pill (info / warn / err) reflects current count against the
 *     soft and hard caps
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

// Keep the compressImage step from exploding on fake File objects — it tries
// to decode the blob, which happy-dom can't do. Passthrough is fine for this
// test because we only care about the cap + pill selection, not the shot
// pixels.
vi.mock('@/camera/compress', () => ({
  compressImage: vi.fn(async (d: string) => d),
}));
vi.mock('@/crypto/keystore', () => ({
  hasApiKey: vi.fn(async () => true),
}));

import {
  Capture,
  IMAGE_SOFT_CAP,
  IMAGE_HARD_CAP,
} from '@/ui/screens/Capture';
import { addImageBlock, clearBlocks } from '@/camera/session';

beforeEach(() => {
  sessionStorage.clear();
  clearBlocks();
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

describe('Capture — image caps (constants)', () => {
  it('exposes the soft/hard caps as 6 and 10', () => {
    expect(IMAGE_SOFT_CAP).toBe(6);
    expect(IMAGE_HARD_CAP).toBe(10);
  });
});

async function flush() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

// 1×1 transparent PNG — atob(b64) in addImageBlock needs valid base64.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function seedShots(n: number): void {
  for (let i = 0; i < n; i++) {
    addImageBlock(TINY_PNG, 'gallery');
  }
}

function renderCapture() {
  return render(
    <MemoryRouter>
      <Capture />
    </MemoryRouter>,
  );
}

describe('Capture — pill class reflects count', () => {
  it('shows pill-info when shot count is at/below the soft cap', async () => {
    seedShots(5);
    const { container } = renderCapture();
    await flush();
    const pill = container.querySelector('.pill');
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain('pill-info');
    expect(pill!.textContent).toMatch(/^5 תמונות$/);
  });

  it('shows pill-warn when above soft cap but under hard cap', async () => {
    seedShots(8);
    const { container } = renderCapture();
    await flush();
    const pill = container.querySelector('.pill');
    expect(pill!.className).toContain('pill-warn');
    expect(pill!.textContent).toMatch(/8 תמונות/);
  });

  it('shows pill-err at the hard cap', async () => {
    seedShots(10);
    const { container } = renderCapture();
    await flush();
    const pill = container.querySelector('.pill');
    expect(pill!.className).toContain('pill-err');
    expect(pill!.textContent).toMatch(/10\/10/);
    expect(pill!.textContent).toMatch(/תקרה/);
  });
});

describe('Capture — hard cap enforcement on file pick', () => {
  it('caps at 10 and surfaces "N לא נוספו" Hebrew warning', async () => {
    const { container } = renderCapture();
    await flush();

    const galleryInput = container.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    expect(galleryInput).not.toBeNull();

    // Build 12 minimal File objects. FileReader in happy-dom fires onload with
    // a data URL shape, which the mocked compressImage will return unchanged.
    const files = Array.from({ length: 12 }, (_, i) =>
      new File([`x${i}`], `s${i}.jpg`, { type: 'image/jpeg' }),
    );
    await act(async () => {
      fireEvent.change(galleryInput, { target: { files } });
    });
    await flush();

    // Expect a warning pill about the dropped count.
    const warn = Array.from(container.querySelectorAll('.pill-warn')).find(
      (n) => /לא נוספו/.test(n.textContent ?? ''),
    );
    expect(warn).toBeDefined();
    expect(warn!.textContent).toMatch(/2 לא נוספו/);

    // And the total shot count is capped at the hard cap.
    const pill = container.querySelector('.pill-err');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toMatch(/10\/10/);
  });

  it('blocks further picks once the cap is reached: file inputs are replaced with disabled buttons', async () => {
    seedShots(IMAGE_HARD_CAP);
    const { container } = renderCapture();
    await flush();

    // v1.21.0: at cap, the label/input pair is replaced with a disabled
    // button rather than relying on input[disabled] (which can still
    // open the picker on some Chromium builds).
    const galleryInput = container.querySelector('input[type="file"][multiple]');
    expect(galleryInput).toBeNull();
    const cameraInput = container.querySelector('input[type="file"][capture]');
    expect(cameraInput).toBeNull();
    const galleryBtn = screen.getByLabelText('גלריה — תקרה') as HTMLButtonElement;
    expect(galleryBtn.disabled).toBe(true);
  });
});

describe('Capture — empty state when no blocks', () => {
  it('shows the "אין קלט" empty card', async () => {
    renderCapture();
    await flush();
    expect(screen.getByText(/אין קלט/)).toBeInTheDocument();
  });
});
