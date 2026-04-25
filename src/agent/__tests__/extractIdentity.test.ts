import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runExtractTurn } from '@/agent/loop';

/**
 * Identity-field regression: given a well-formed model response for each of
 * three input archetypes (AZMA grid, phone-consult freeform, SOAP narrative),
 * runExtractTurn must preserve teudatZehut / age / room verbatim. This pins
 * the v1.20.2 prompt change that hardened identity extraction across input
 * formats — a regression here would mean the parser dropped fields the
 * prompt instructs the model to populate.
 */
function mockProxyResponse(text: string, usage = { input_tokens: 10, output_tokens: 5 }) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      usage,
    }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runExtractTurn — identity fields across input archetypes', () => {
  it('AZMA grid fixture — preserves teudatZehut / age / room', async () => {
    // Source text the model saw (in image): "שם מטופל: דוד כהן | ת.ז.: 123456789 | גיל: 82 | חדר: 12A"
    const payload = JSON.stringify({
      fields: {
        name: 'דוד כהן',
        teudatZehut: '123456789',
        age: 82,
        sex: 'M',
        room: '12A',
      },
      confidence: { name: 'high', teudatZehut: 'high', age: 'high' },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(
      ['data:image/jpeg;base64,/9j/'],
      'azma-ui',
    );
    expect(result.fields.teudatZehut).toBe('123456789');
    expect(result.fields.age).toBe(82);
    expect(result.fields.room).toBe('12A');
  });

  it('phone-consult freeform fixture — preserves teudatZehut / age / room', async () => {
    // Source: "מטופלת בת 79, ת.ז. 305412678, מאושפזת חדר 7B במחלקה הפנימית..."
    const payload = JSON.stringify({
      fields: {
        name: 'שרה לוי',
        teudatZehut: '305412678',
        age: 79,
        sex: 'F',
        room: '7B',
      },
      confidence: { name: 'med', teudatZehut: 'high', age: 'high' },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(
      ['data:image/jpeg;base64,/9j/'],
      'azma-ui',
    );
    expect(result.fields.teudatZehut).toBe('305412678');
    expect(result.fields.age).toBe(79);
    expect(result.fields.room).toBe('7B');
  });

  it('SOAP narrative fixture — preserves teudatZehut / age / room', async () => {
    // Source: "S: בן 88 (ת.ז. 029384756), חדר 14, מתלונן על קוצר נשימה מאתמול..."
    const payload = JSON.stringify({
      fields: {
        name: 'יעקב גרין',
        teudatZehut: '029384756',
        age: 88,
        sex: 'M',
        room: '14',
        chiefComplaint: 'קוצר נשימה',
      },
      confidence: { name: 'high', teudatZehut: 'high', age: 'high' },
    });
    vi.stubGlobal('fetch', mockProxyResponse(payload));
    const result = await runExtractTurn(
      ['data:image/jpeg;base64,/9j/'],
      'azma-ui',
    );
    expect(result.fields.teudatZehut).toBe('029384756');
    expect(result.fields.age).toBe(88);
    expect(result.fields.room).toBe('14');
  });
});
