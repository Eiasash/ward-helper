/**
 * Types shared across the agent flow.
 *
 * The tool definitions (parseAzmaTool / emitNoteTool) that lived here
 * pre-v1.5.0 were removed when we migrated to the Toranot proxy, which
 * strips `tools` / `tool_choice` fields. Structured output now goes
 * through JSON-mode prompting in src/agent/loop.ts — the prompts embed
 * the required shape as instructions, and loop.ts parses strict JSON
 * from `content[].text`.
 *
 * Keep the types — they're the contract between extract and emit turns.
 */

export type Confidence = 'low' | 'med' | 'high';

export interface Med {
  name: string;
  dose?: string;
  freq?: string;
}

export interface Lab {
  name: string;
  value: string;
  unit?: string;
  flag?: string;
}

export interface ParseFields {
  name?: string;
  teudatZehut?: string;
  age?: number;
  sex?: 'M' | 'F' | 'unknown';
  room?: string;
  chiefComplaint?: string;
  pmh?: string[];
  meds?: Med[];
  allergies?: string[];
  labs?: Lab[];
  vitals?: Record<string, string | number>;
}

export interface ParseResult {
  fields: ParseFields;
  confidence: Record<string, Confidence>;
  sourceRegions: Record<string, string>;
}
