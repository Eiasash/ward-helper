import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Shared eiasash.github.io origin: the worker must only delete its own 'ward-' caches.
describe('service worker cache cleanup scope', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  it('deletes only ward- caches other than the current VERSION', () => {
    expect(sw).toMatch(/keys\.filter\(\(k\) => k\.startsWith\('ward-'\) && k !== VERSION\)/);
    expect(sw).not.toMatch(/keys\.filter\(\(k\) => k !== VERSION\)/);
  });
});
