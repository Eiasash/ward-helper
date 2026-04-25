import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  putNote,
  getNote,
  markNoteSent,
  resetDbForTests,
} from '@/storage/indexed';

describe('markNoteSent', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('writes sentToEmrAt and updatedAt, reads them back', async () => {
    await putNote({
      id: 'n1',
      patientId: 'p1',
      type: 'soap',
      bodyHebrew: 'body',
      structuredData: {},
      createdAt: 100,
      updatedAt: 100,
    });
    await markNoteSent('n1', 12345);
    const back = await getNote('n1');
    expect(back?.sentToEmrAt).toBe(12345);
    expect(back?.updatedAt).toBe(12345);
    expect(back?.createdAt).toBe(100);
  });

  it('uses Date.now() as default when no ts provided', async () => {
    await putNote({
      id: 'n2',
      patientId: 'p1',
      type: 'admission',
      bodyHebrew: 'body',
      structuredData: {},
      createdAt: 1,
      updatedAt: 1,
    });
    const before = Date.now();
    await markNoteSent('n2');
    const back = await getNote('n2');
    expect(typeof back?.sentToEmrAt).toBe('number');
    expect(back!.sentToEmrAt!).toBeGreaterThanOrEqual(before);
  });

  it('is a silent no-op for missing notes', async () => {
    await expect(markNoteSent('does-not-exist', 999)).resolves.toBeUndefined();
  });
});
