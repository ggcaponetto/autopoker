import { createDefaultLlmSettings, type LlmSettings } from '@autopoker/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { MockDecisionSource } from './mock';
import { AiSdkDecisionSource, LlmDecisionError } from './source';
import type { DecisionRequest } from './types';

const validDecision = {
  observation: 'The fold button is lit; it is my turn.',
  reasoning: 'Strategy folds 72o from early position.',
  confidence: 0.9,
  actions: [{ type: 'clickRegion', regionName: 'Fold button' }],
};

function request(settings: Partial<LlmSettings> = {}): DecisionRequest {
  return {
    settings: { ...createDefaultLlmSettings(), ...settings },
    context: null,
    screenshots: [
      {
        label: 'M@0,0',
        monitorKey: 'M@0,0',
        originX: 0,
        originY: 0,
        mediaType: 'image/jpeg',
        data: new Uint8Array([1]),
        captureWidth: 100,
        captureHeight: 100,
      },
    ],
    landmarks: [
      {
        name: 'Fold button',
        description: '',
        monitorKey: 'M@0,0',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    history: [],
    triggeredRegionNames: [],
    at: 0,
  };
}

/** A model that returns whatever text it is given, with the V4 usage/finishReason shapes. */
function modelReturning(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: undefined },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe('AiSdkDecisionSource', () => {
  it('returns a schema-validated decision and timing', async () => {
    let ticks = 0;
    const source = new AiSdkDecisionSource({
      modelFactory: () => modelReturning(JSON.stringify(validDecision)),
      now: () => (ticks += 250),
    });
    const result = await source.decide(request());
    expect(result.decision.confidence).toBe(0.9);
    expect(result.decision.actions[0]!.regionName).toBe('Fold button');
    expect(result.latencyMs).toBe(250);
    expect(result.model).toBe('llama3.2-vision');
  });

  it('reports cache statistics from usage', async () => {
    const source = new AiSdkDecisionSource({
      modelFactory: () => modelReturning(JSON.stringify(validDecision)),
    });
    const result = await source.decide(request());
    expect(result.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 40,
      cacheReadTokens: 1000,
    });
  });

  it('classifies unparseable model output as invalid-output', async () => {
    const source = new AiSdkDecisionSource({
      modelFactory: () => modelReturning('I think you should probably fold, mate.'),
    });
    await expect(source.decide(request())).rejects.toSatisfy(
      (error: unknown) => error instanceof LlmDecisionError && error.kind === 'invalid-output',
    );
  });

  it('classifies output that parses but violates the schema as invalid-output', async () => {
    const source = new AiSdkDecisionSource({
      modelFactory: () => modelReturning(JSON.stringify({ ...validDecision, confidence: 'high' })),
    });
    await expect(source.decide(request())).rejects.toSatisfy(
      (error: unknown) => error instanceof LlmDecisionError && error.kind === 'invalid-output',
    );
  });

  it('names the likely cause when the model returns an empty decision husk', async () => {
    const source = new AiSdkDecisionSource({
      modelFactory: () =>
        modelReturning(
          JSON.stringify({ observation: '', reasoning: '', confidence: 0, actions: [] }),
        ),
    });
    await expect(source.decide(request())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LlmDecisionError &&
        error.kind === 'invalid-output' &&
        error.message.includes('empty decision') &&
        error.message.includes('thinking'),
    );
  });

  it('accepts percent-style confidence and normalizes it to 0..1', async () => {
    const source = new AiSdkDecisionSource({
      modelFactory: () => modelReturning(JSON.stringify({ ...validDecision, confidence: 100 })),
    });
    const result = await source.decide(request());
    expect(result.decision.confidence).toBe(1);
  });

  it('never sends temperature unless it is configured', async () => {
    const seen: { temperature?: number }[] = [];
    const capture = new MockLanguageModelV4({
      doGenerate: async (options) => {
        seen.push({ temperature: (options as { temperature?: number }).temperature });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(validDecision) }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const source = new AiSdkDecisionSource({ modelFactory: () => capture });
    await source.decide(request());
    await source.decide(request({ temperature: 0.3 }));
    expect(seen[0]!.temperature).toBeUndefined();
    expect(seen[1]!.temperature).toBe(0.3);
  });
});

describe('MockDecisionSource', () => {
  it('clicks the first landmark by default', async () => {
    const result = await new MockDecisionSource().decide(request());
    expect(result.decision.actions).toEqual([{ type: 'clickRegion', regionName: 'Fold button' }]);
    expect(result.model).toBe('mock');
  });

  it('waits when there are no landmarks', async () => {
    const result = await new MockDecisionSource().decide({ ...request(), landmarks: [] });
    expect(result.decision.actions).toEqual([{ type: 'wait' }]);
  });

  it('follows a script and counts calls', async () => {
    const source = new MockDecisionSource((_request, call) => ({
      observation: `call ${call}`,
      reasoning: 'scripted',
      confidence: 1,
      actions: [{ type: 'delay', ms: call }],
    }));
    expect((await source.decide(request())).decision.observation).toBe('call 0');
    expect((await source.decide(request())).decision.observation).toBe('call 1');
  });
});
