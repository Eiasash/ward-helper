import Anthropic from '@anthropic-ai/sdk';
import { loadApiKey } from '@/crypto/keystore';

// Current flagship. Update this string when a newer model ships —
// verify at https://docs.claude.com/en/docs/about-claude/models.
export const MODEL = 'claude-opus-4-7';

let cached: Anthropic | null = null;

export async function getClient(): Promise<Anthropic> {
  if (cached) return cached;
  const apiKey = await loadApiKey();
  if (!apiKey) throw new Error('API key not set. Open Settings to configure.');
  cached = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // Default SDK timeout is very long. Cap it so UI can surface hangs
    // rather than spinning forever.
    timeout: 45_000,
    maxRetries: 1,
  });
  return cached;
}

export function resetClient(): void {
  cached = null;
}
