/**
 * Claude access with automatic fallback.
 *
 * Path A (preferred, when user has configured their own API key):
 *   direct POST to api.anthropic.com/v1/messages. No 10s Netlify Function
 *   ceiling — Anthropic's own timeouts apply (5 minutes streaming, ~60s
 *   non-streaming). Long admission/discharge emits actually complete.
 *
 * Path B (fallback, when no user key is set):
 *   POST to the Toranot proxy (toranot.netlify.app/api/claude). This is the
 *   text-only path shared with the three board-exam PWAs. It has a ~10s
 *   upstream timeout which is NOT enough for long emit calls — users will
 *   see 504s. The Settings screen prompts for a key for exactly this reason.
 *
 * Why the architecture looks like this:
 *   A previous refactor removed the @anthropic-ai/sdk and routed everything
 *   through the proxy. That's fine for chat completions in the study apps
 *   where prompts are short and outputs are a few hundred tokens — but ward-
 *   helper emits admission notes with 25 KB of skill content + 4096 output
 *   tokens, which regularly hits 20-40s of compute. The proxy's Netlify-
 *   Function ceiling truncates the response with HTTP 504.
 *
 *   Going direct with a user's own key is the honest fix. It also restores
 *   the original BYO-key design the CSP was built around.
 */

// Constants and types used by the AI dispatcher. The actual call logic lives
// in src/ai/dispatch.ts (the single chokepoint). This module retains the type
// surface + a back-compat `callAnthropic` re-export so older callers and the
// existing test suite keep compiling without churn.

export const PROXY_URL = 'https://toranot.netlify.app/api/claude';
export const PROXY_SECRET = 'shlav-a-mega-1f97f311d307-2026';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Model string for direct calls. Opus 4.7 matches what the proxy selects.
export const MODEL_DIRECT = 'claude-opus-4-7';
// Informational label for proxy path (server chooses the actual model).
export const MODEL_PROXY = 'proxy:claude-opus-4-7';

/** Retry policy. Callers opt in — default is 0 (single call). */
export interface CallOptions {
  /** Max additional attempts on transient failure (504/timeout/network). Default 0. */
  retryOnTransient?: number;
  /**
   * External AbortSignal — when fired, the in-flight fetch is canceled
   * and any pending retry-backoff is short-circuited. Used by the batch
   * SOAP runner so a "בטל" tap on patient 3 of 5 cancels the in-flight
   * extract immediately rather than waiting up to 90s for it to finish.
   * Distinct from the per-call internal AbortController used for the
   * timeout — both signals are linked: either one firing aborts the
   * underlying fetch.
   */
  signal?: AbortSignal;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        data: string;
      };
    }
  | {
      // PDF documents: Sonnet 4.6 reads them natively. Same base64 envelope
      // as images, distinct content-block type.
      type: 'document';
      source: {
        type: 'base64';
        media_type: 'application/pdf';
        data: string;
      };
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Adaptive thinking effort dial. Opus 4.7 only — used as soft guidance for how much reasoning the model allocates. */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicRequest {
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  /** Set to {type:'adaptive'} to enable Opus 4.7 adaptive thinking. Off when omitted. */
  thinking?: { type: 'adaptive' | 'disabled' };
  /** Soft hint for adaptive thinking depth; ignored when thinking is off/absent. */
  output_config?: { effort: ThinkingEffort };
}

export interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type RequestPath = 'direct' | 'proxy';

import { activeAiPath, callClaude } from '@/ai/dispatch';

/** For Settings UI: which path is active right now? */
export async function activePath(): Promise<RequestPath> {
  return activeAiPath();
}

// `callAnthropic` / `callProxy` are kept as thin re-exports of the single
// chokepoint in src/ai/dispatch.ts so older imports (tests, legacy callers)
// keep working unchanged.
export { callClaude as callAnthropic, callClaude as callProxy };
export const MODEL = MODEL_PROXY;
// Suppress unused-import lint: callClaude is referenced via the re-export above.
void callClaude;
