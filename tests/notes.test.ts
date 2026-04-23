import { describe, it, expect } from 'vitest';
import { buildSoapPromptPrefix, buildPromptPrefix } from '@/notes/orchestrate';
import type { ContinuityContext } from '@/notes/continuity';
import type { Note } from '@/storage/indexed';

function mkNote(overrides: Partial<Note>): Note {
  return {
    id: 'n',
    patientId: 'p',
    type: 'admission',
    bodyHebrew: '',
    structuredData: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildSoapPromptPrefix', () => {
  it('null continuity returns first-SOAP instructions', () => {
    const out = buildSoapPromptPrefix(null);
    expect(out).toContain('First SOAP for this patient');
    expect(out).not.toContain('ADMISSION');
    expect(out).not.toContain('MOST RECENT SOAP');
  });

  it('case 1 (fresh): first-SOAP instructions, no admission block', () => {
    const ctx: ContinuityContext = {
      patient: null,
      admission: null,
      priorSoaps: [],
      mostRecentSoap: null,
      episodeStart: null,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('First SOAP for this patient');
    expect(out).not.toContain('ADMISSION');
    expect(out).not.toContain('MOST RECENT SOAP');
  });

  it('case 2 (first post-admission): includes admission block + anchor instruction', () => {
    const adm = mkNote({
      type: 'admission',
      bodyHebrew: 'קבלה: 82yo male admitted for pneumonia',
      createdAt: Date.parse('2026-04-20'),
    });
    const ctx: ContinuityContext = {
      patient: { id: 'p', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 0, updatedAt: 0 },
      admission: adm,
      priorSoaps: [],
      mostRecentSoap: null,
      episodeStart: adm.createdAt,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('admission note');
    expect(out).toContain('82yo male admitted for pneumonia');
    expect(out).not.toContain('MOST RECENT SOAP');
  });

  it('case note includes 6-section template + Chameleon rules', () => {
    const out = buildPromptPrefix('case', null);
    expect(out).toContain('Chameleon paste rules');
    expect(out).toContain('1. Who');
    expect(out).toContain('2. Background');
    expect(out).toContain('3. Why they came');
    expect(out).toContain('4. What we found');
    expect(out).toContain('5. What we did');
    expect(out).toContain('6. Current status');
    expect(out).toContain('Open questions for the room');
    // The szmc-interesting-cases skill explicitly allows English q8h here.
    expect(out).toContain('English case-conference');
  });

  it('admission note emits 15-step order', () => {
    const out = buildPromptPrefix('admission', null);
    expect(out).toContain('הצגת החולה');
    expect(out).toContain('דיון ותוכנית');
    expect(out).toContain('חתימה');
  });

  it('discharge note forbids glossary / PT prose / תרופות באשפוז', () => {
    const out = buildPromptPrefix('discharge', null);
    expect(out).toContain('Do NOT include a glossary');
    expect(out).toContain('Do NOT include תרופות באשפוז');
    expect(out).toContain('PT/OT/dietician prose');
  });

  it('consult note forbids jargon (CFS/Beers/STOPP/BPSD/etc.) and proactive GOC', () => {
    const out = buildPromptPrefix('consult', null);
    expect(out).toContain('CFS');
    expect(out).toContain('Beers');
    expect(out).toContain('STOPP/START');
    expect(out).toContain('BPSD');
    expect(out).toContain('deprescribing');
    expect(out).toContain('Do NOT raise goals of care proactively');
  });

  it('case 3 (follow-up): includes both admission + most-recent SOAP', () => {
    const adm = mkNote({ type: 'admission', bodyHebrew: 'קבלה body', createdAt: 1 });
    const prior = mkNote({ type: 'soap', bodyHebrew: 'yesterday SOAP body', createdAt: 2 });
    const ctx: ContinuityContext = {
      patient: { id: 'p', name: 'x', teudatZehut: '1', dob: '', room: null, tags: [], createdAt: 0, updatedAt: 0 },
      admission: adm,
      priorSoaps: [prior],
      mostRecentSoap: prior,
      episodeStart: adm.createdAt,
    };
    const out = buildSoapPromptPrefix(ctx);
    expect(out).toContain('ADMISSION');
    expect(out).toContain('MOST RECENT SOAP');
    expect(out).toContain('yesterday SOAP body');
    expect(out).toContain('trajectory vs today');
  });
});
