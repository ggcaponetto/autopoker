import { describe, expect, it } from 'vitest';
import { createDefaultSettings, ProfileSchema, RegionSchema, type RegionInput } from './config';
import {
  createDefaultLlmSettings,
  LlmDecisionSchema,
  LlmSettingsSchema,
  StrategySchema,
} from './llm';

describe('LlmSettingsSchema', () => {
  it('defaults to a local Ollama model with conservative caps', () => {
    const settings = createDefaultLlmSettings();
    expect(settings.provider).toBe('ollama');
    expect(settings.minConfidence).toBe(0.5);
    expect(settings.maxActionsPerDecision).toBe(4);
    expect(settings.minIntervalMs).toBe(5_000);
  });

  it('leaves temperature unset so Claude 5 models are not sent a rejected parameter', () => {
    expect(createDefaultLlmSettings().temperature).toBeUndefined();
    expect(LlmSettingsSchema.parse({ temperature: 0.2 }).temperature).toBe(0.2);
  });

  it('rejects unknown providers', () => {
    expect(() => LlmSettingsSchema.parse({ provider: 'skynet' })).toThrow();
  });
});

describe('EngineSettingsSchema LLM fields', () => {
  it('defaults to manual mode with no strategy', () => {
    const settings = createDefaultSettings();
    expect(settings.mode).toBe('manual');
    expect(settings.strategyId).toBeNull();
    expect(settings.llmTrigger).toBe('onRegionTrigger');
    expect(settings.llm.provider).toBe('ollama');
  });

  it('round-trips an llm-mode profile through JSON', () => {
    const profile = ProfileSchema.parse({
      id: 'p1',
      name: 'LLM profile',
      regions: [],
      settings: {
        mode: 'llm',
        strategyId: 's1',
        llm: { provider: 'anthropic', model: 'claude-opus-5' },
      },
    });
    expect(ProfileSchema.parse(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });
});

describe('RegionSchema purposes', () => {
  const base: RegionInput = {
    id: 'r1',
    name: 'Fold button',
    monitorKey: 'M@0,0',
    rect: { x: 0, y: 0, width: 10, height: 10 },
    condition: { type: 'regionAverageColor', color: { r: 1, g: 2, b: 3 } },
    actions: [{ type: 'click' }],
  };

  it('defaults to an automate region that requires actions', () => {
    expect(RegionSchema.parse(base).purpose).toBe('automate');
    expect(() => RegionSchema.parse({ ...base, actions: [] })).toThrow();
  });

  it('allows landmark regions with no actions', () => {
    const landmark = RegionSchema.parse({
      ...base,
      purpose: 'landmark',
      actions: [],
      description: 'the fold button, bottom left of the table',
    });
    expect(landmark.actions).toEqual([]);
    expect(landmark.description).toContain('bottom left');
  });
});

describe('StrategySchema', () => {
  it('applies defaults for a bare strategy', () => {
    const strategy = StrategySchema.parse({ id: 's1', name: 'Tight aggressive' });
    expect(strategy.markdown).toBe('');
    expect(strategy.attachments).toEqual([]);
  });

  it('round-trips attachments', () => {
    const strategy = StrategySchema.parse({
      id: 's1',
      name: 'With chart',
      markdown: '# Preflop\n\nOpen 15% from UTG.',
      attachments: [
        {
          id: 'a1',
          filename: 'ranges.pdf',
          mediaType: 'application/pdf',
          kind: 'pdf',
          sizeBytes: 2048,
        },
      ],
    });
    expect(StrategySchema.parse(JSON.parse(JSON.stringify(strategy)))).toEqual(strategy);
  });
});

describe('LlmDecisionSchema', () => {
  it('accepts the flat action shape models produce', () => {
    const decision = LlmDecisionSchema.parse({
      observation: 'It is my turn; the pot is 120.',
      reasoning: 'Strategy says fold weak offsuit hands out of position.',
      confidence: 0.82,
      actions: [
        { type: 'clickRegion', regionName: 'Fold button' },
        { type: 'delay', ms: 500 },
      ],
    });
    expect(decision.actions).toHaveLength(2);
    expect(decision.actions[0]!.regionName).toBe('Fold button');
  });

  it('accepts a wait action with no other fields', () => {
    const decision = LlmDecisionSchema.parse({
      observation: 'Not my turn.',
      reasoning: 'Nothing to do.',
      confidence: 0.95,
      actions: [{ type: 'wait' }],
    });
    expect(decision.actions[0]).toEqual({ type: 'wait' });
  });

  it('rejects confidence outside 0..1 and unknown action types', () => {
    const base = { observation: 'x', reasoning: 'y', actions: [] };
    expect(() => LlmDecisionSchema.parse({ ...base, confidence: 1.5 })).toThrow();
    expect(() =>
      LlmDecisionSchema.parse({ ...base, confidence: 0.5, actions: [{ type: 'launchMissile' }] }),
    ).toThrow();
  });
});
