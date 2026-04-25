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
  /** Date of birth as the source rendered it (no normalization). */
  dob?: string;
  chiefComplaint?: string;
  pmh?: string[];
  meds?: Med[];
  allergies?: string[];
  labs?: Lab[];
  vitals?: Record<string, string | number>;
}

export interface ParseResult {
  fields: ParseFields;
  /**
   * Sparse map keyed by field name. Populated only for the three critical
   * identifiers (name / teudatZehut / age) — the fields whose misread causes
   * wrong-patient or wrong-age errors. Everything else the doc verifies
   * visually against the source screenshot, so spending extract-response
   * tokens on those confidence labels is not worth the latency cost.
   */
  confidence: Record<string, Confidence>;
}
