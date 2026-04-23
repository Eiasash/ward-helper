import Anthropic from '@anthropic-ai/sdk';
import { loadApiKey } from '@/crypto/keystore';

export const MODEL = 'claude-opus-4-7';

let cached: Anthropic | null = null;

export async function getClient(): Promise<Anthropic> {
  if (cached) return cached;
  const apiKey = await loadApiKey();
  if (!apiKey) throw new Error('API key not set. Open Settings to configure.');
  cached = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return cached;
}

export function resetClient(): void {
  cached = null;
}
