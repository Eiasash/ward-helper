import { describe, it, expect } from 'vitest';
describe('smoke', () => {
    it('arithmetic works', () => {
        expect(2 + 2).toBe(4);
    });
    it('fake-indexeddb is loaded', () => {
        expect(indexedDB).toBeDefined();
    });
});
