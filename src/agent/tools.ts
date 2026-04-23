import type Anthropic from '@anthropic-ai/sdk';

export const parseAzmaTool: Anthropic.Tool = {
  name: 'parse_azma_screen',
  description:
    'Extract structured patient data from one or more AZMA EMR screenshots. ' +
    'Preserve original language per field (drug names in English, Hebrew clinical text in Hebrew). ' +
    'For every field, report confidence (low/med/high) and source_region (e.g. "meds tab", "ADT banner").',
  input_schema: {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          teudatZehut: { type: 'string' },
          age: { type: 'number' },
          sex: { type: 'string', enum: ['M', 'F', 'unknown'] },
          room: { type: 'string' },
          chiefComplaint: { type: 'string' },
          pmh: { type: 'array', items: { type: 'string' } },
          meds: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dose: { type: 'string' },
                freq: { type: 'string' },
              },
              required: ['name'],
            },
          },
          allergies: { type: 'array', items: { type: 'string' } },
          labs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                unit: { type: 'string' },
                flag: { type: 'string' },
              },
              required: ['name', 'value'],
            },
          },
          vitals: { type: 'object' },
        },
      },
      confidence: {
        type: 'object',
        description:
          'Per-field confidence, keyed by field path. e.g. { "name": "high", "meds[2].dose": "low" }',
        additionalProperties: { type: 'string', enum: ['low', 'med', 'high'] },
      },
      sourceRegions: {
        type: 'object',
        description: 'Per-field region hint, keyed by field path.',
        additionalProperties: { type: 'string' },
      },
    },
  },
};

export const emitNoteTool: Anthropic.Tool = {
  name: 'emit_note',
  description:
    'Produce a single SZMC-format Hebrew note. Use proper bidi for mixed Hebrew/English: ' +
    'keep drug names + acronyms in English, wrap LTR runs with RLM/LRM where needed, never transliterate. ' +
    'Output plain text ready to paste into Chameleon.',
  input_schema: {
    type: 'object',
    required: ['noteHebrew'],
    properties: {
      noteHebrew: { type: 'string' },
    },
  },
};

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
