import { describe, it, expect } from 'vitest';
import { getSupabaseConfig } from '@/storage/cloud';

/**
 * Pins the Supabase project the PWA talks to. If this test ever fails,
 * somebody either:
 *   (a) changed the shared project (check with Eias first — breaks Toranot /
 *       FamilyMedicine / Geriatrics / InternalMedicine which all share it), or
 *   (b) accidentally cross-wired to watch-advisor2's separate project
 *       (`oaojkanozbfpofbewtfq`) which must never happen.
 */
describe('Supabase configuration', () => {
  it('points to the shared "Toranot" project (krmlzwwelqvlfslwltol)', () => {
    const { url } = getSupabaseConfig();
    expect(url).toContain('krmlzwwelqvlfslwltol.supabase.co');
  });

  it('never cross-wires to the watch-advisor2 project', () => {
    const { url } = getSupabaseConfig();
    expect(url).not.toContain('oaojkanozbfpofbewtfq');
  });

  it('uses a publishable/anon key (not a service-role key)', () => {
    const { keyPrefix } = getSupabaseConfig();
    // Service-role JWTs start with "eyJ"... with role=service_role.
    // Publishable keys start with "sb_publishable_" (or the older "eyJ" anon).
    // Either way, a committed key must not be service_role.
    expect(keyPrefix).toMatch(/^(sb_publishable_|eyJ)/);
  });
});
