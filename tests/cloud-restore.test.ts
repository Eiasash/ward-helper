import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock before imports so cloud.ts gets the mocked Supabase client.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
      signInAnonymously: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      // Resolve to the mocked rows when the final .order() chain is awaited
      then: (resolve: (v: unknown) => void) => resolve({ data: MOCK_ROWS, error: null }),
    })),
  })),
}));

let MOCK_ROWS: unknown[] = [];

import { base64ToBytes, pullAllBlobs } from '@/storage/cloud';

describe('base64ToBytes', () => {
  it('decodes standard base64', () => {
    const bytes = base64ToBytes('aGVsbG8=');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('decodes supabase-style hex bytea (\\x prefix)', () => {
    // \x68656c6c6f === "hello"
    const bytes = base64ToBytes('\\x68656c6c6f');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles empty input safely', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('pullAllBlobs', () => {
  beforeEach(() => {
    MOCK_ROWS = [
      { blob_type: 'patient', blob_id: 'p1', ciphertext: 'AAA=', iv: 'AAA=', salt: 'AAA=', updated_at: '2026-01-01' },
      { blob_type: 'note', blob_id: 'n1', ciphertext: 'BBB=', iv: 'BBB=', salt: 'BBB=', updated_at: '2026-01-02' },
    ];
  });

  it('returns all rows as CloudBlobRow[]', async () => {
    const rows = await pullAllBlobs();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty('blob_type');
    expect(rows[0]).toHaveProperty('ciphertext');
  });

  it('returns empty array when no rows exist', async () => {
    MOCK_ROWS = [];
    expect(await pullAllBlobs()).toEqual([]);
  });
});
