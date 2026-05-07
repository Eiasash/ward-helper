import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted ABOVE imports, so any spies they reference
// must also be hoisted. vi.hoisted is the contract for that — the spy
// returned here is the same instance the factory closes over and the test
// body mutates via .mockResolvedValue / .mockReset.
const { callAnthropicSpy } = vi.hoisted(() => ({
  callAnthropicSpy: vi.fn(),
}));

// consult.ts now imports callClaude from @/ai/dispatch (the v1.39.0
// single-chokepoint refactor). The legacy @/agent/client::callAnthropic
// re-export is preserved, but mocking @/agent/client no longer
// intercepts because consult.ts goes straight to dispatch.
vi.mock('@/ai/dispatch', () => ({
  callClaude: callAnthropicSpy,
}));

// Mock skill loader so emit doesn't try to fetch from disk.
vi.mock('@/skills/loader', () => ({
  loadSkills: vi.fn(async () => 'STUB SKILL CONTENT'),
}));

// Stub debug recorders + cost meter so they don't pollute test output.
vi.mock('@/agent/costs', () => ({ addTurn: vi.fn() }));
vi.mock('@/agent/debugLog', () => ({
  recordEmit: vi.fn(),
  recordError: vi.fn(),
}));

import {
  runConsultTurn,
  runConsultEmit,
  CONSULT_NOTE_READY_TOKEN,
  type ConsultMsg,
} from '@/notes/consult';

function mkUsage(): { input_tokens: number; output_tokens: number } {
  return { input_tokens: 100, output_tokens: 50 };
}

beforeEach(() => {
  callAnthropicSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runConsultTurn — chat replies', () => {
  it('returns the assistant reply text when the model speaks normally', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: 'מה הCFS שלו לפני האשפוז?' }],
      usage: mkUsage(),
    });
    const history: ConsultMsg[] = [
      { role: 'user', content: 'בן 84, נפילה', ts: Date.now() },
    ];
    const res = await runConsultTurn(history);
    expect(res.emitReady).toBe(false);
    expect(res.reply).toBe('מה הCFS שלו לפני האשפוז?');
    expect(res.outTokens).toBe(50);
  });

  it('detects the <NOTE_READY> sentinel even with surrounding whitespace', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: '\n  <NOTE_READY>\n' }],
      usage: mkUsage(),
    });
    const history: ConsultMsg[] = [
      { role: 'user', content: 'תכין קבלה', ts: Date.now() },
    ];
    const res = await runConsultTurn(history);
    expect(res.emitReady).toBe(true);
    expect(res.reply).toBe('');
  });

  it('detects sentinel embedded in extra prose (defensive — model violates contract)', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: 'OK <NOTE_READY> drafting now.' }],
      usage: mkUsage(),
    });
    const res = await runConsultTurn([
      { role: 'user', content: 'תכין', ts: Date.now() },
    ]);
    expect(res.emitReady).toBe(true);
  });

  it('throws on empty history', async () => {
    await expect(runConsultTurn([])).rejects.toThrow(/empty history/);
  });

  it('throws when last message is not from user', async () => {
    const history: ConsultMsg[] = [
      { role: 'user', content: 'hi', ts: 1 },
      { role: 'assistant', content: 'hello', ts: 2 },
    ];
    await expect(runConsultTurn(history)).rejects.toThrow(/last message/);
  });
});

describe('runConsultEmit — note emission from chat history', () => {
  it('parses the noteHebrew envelope and returns sanitized text', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            noteHebrew: 'מטופל בן 84 התקבל עקב נפילה.\nהמלצות: …',
          }),
        },
      ],
      usage: mkUsage(),
    });
    const history: ConsultMsg[] = [
      { role: 'user', content: 'בן 84, נפילה, CFS 5', ts: 1 },
      { role: 'assistant', content: 'איך הסטטוס הקוגניטיבי?', ts: 2 },
      { role: 'user', content: 'תקין. תכין קבלה', ts: 3 },
    ];
    const out = await runConsultEmit('admission', history);
    expect(out).toContain('מטופל בן 84');
    expect(out).toContain('המלצות:');
  });

  it('strips code fences if the model wraps the JSON', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '```json\n{"noteHebrew":"קבלה: בן 84"}\n```',
        },
      ],
      usage: mkUsage(),
    });
    const history: ConsultMsg[] = [
      { role: 'user', content: 'תכין קבלה', ts: 1 },
    ];
    const out = await runConsultEmit('admission', history);
    expect(out).toContain('בן 84');
  });

  it('extracts the first JSON object even with prose preamble', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Here is the note:\n{"noteHebrew":"שחרור: …"}',
        },
      ],
      usage: mkUsage(),
    });
    const out = await runConsultEmit('discharge', [
      { role: 'user', content: 'תכין שחרור', ts: 1 },
    ]);
    expect(out).toContain('שחרור');
  });

  it('throws when noteHebrew is missing from the response envelope', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: '{"other": "field"}' }],
      usage: mkUsage(),
    });
    await expect(
      runConsultEmit('admission', [
        { role: 'user', content: 'תכין', ts: 1 },
      ]),
    ).rejects.toThrow(/missing noteHebrew/);
  });

  it('throws on completely malformed (non-JSON) responses', async () => {
    callAnthropicSpy.mockResolvedValue({
      content: [{ type: 'text', text: 'sorry, I cannot help' }],
      usage: mkUsage(),
    });
    await expect(
      runConsultEmit('admission', [
        { role: 'user', content: 'x', ts: 1 },
      ]),
    ).rejects.toThrow(/was not JSON/);
  });

  it('throws on empty history', async () => {
    await expect(runConsultEmit('admission', [])).rejects.toThrow(
      /empty history/,
    );
  });
});

describe('exports', () => {
  it('exports the sentinel token literal so the UI can match defensively', () => {
    expect(CONSULT_NOTE_READY_TOKEN).toBe('<NOTE_READY>');
  });
});
