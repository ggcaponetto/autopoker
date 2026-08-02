import type { DecisionRequest, DecisionResult, DecisionSource } from '@autopoker/llm';
import {
  ProfileSchema,
  type LlmDecision,
  type LlmDecisionRecord,
  type Profile,
  type ProfileInput,
} from '@autopoker/shared';
import { describe, expect, it } from 'vitest';
import { LlmDecider } from './llm-decider';
import { FakeCapturer, solidFrame } from './testing';
import type { DeciderInput, MonitorDescriptor } from './types';

const MONITOR = 'M@0,0';

const monitor: MonitorDescriptor = {
  key: MONITOR,
  name: 'M',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
  isPrimary: true,
  captureWidth: 1920,
  captureHeight: 1080,
};

/** Doubles capture pixels so tests can prove the mapper was actually applied. */
const doublingMapper = {
  toScreen: (monitorKey: string, point: { x: number; y: number }) => {
    if (monitorKey !== MONITOR) throw new Error(`unknown monitor: ${monitorKey}`);
    return { x: point.x * 2, y: point.y * 2 };
  },
};

function profileOf(overrides: Partial<ProfileInput['settings']> = {}): Profile {
  return ProfileSchema.parse({
    id: 'p1',
    name: 'LLM',
    regions: [
      {
        id: 'r-fold',
        name: 'Fold button',
        description: 'bottom left',
        purpose: 'landmark',
        monitorKey: MONITOR,
        rect: { x: 100, y: 200, width: 40, height: 20 },
        condition: { type: 'regionAverageColor', color: { r: 0, g: 0, b: 0 }, tolerance: 255 },
        actions: [],
      },
    ],
    settings: { mode: 'llm', ...overrides },
  } satisfies ProfileInput);
}

class ScriptedSource implements DecisionSource {
  readonly requests: DecisionRequest[] = [];
  constructor(private readonly decision: LlmDecision | Error) {}
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    this.requests.push(request);
    if (this.decision instanceof Error) throw this.decision;
    return { decision: this.decision, latencyMs: 42, model: 'test-model' };
  }
}

function buildDecider(decision: LlmDecision | Error, profile: Profile, dryRun = false) {
  const source = new ScriptedSource(decision);
  const records: LlmDecisionRecord[] = [];
  const logs: string[] = [];
  const decider = new LlmDecider({
    source,
    capturer: new FakeCapturer({ [MONITOR]: [solidFrame(4, 4, { r: 0, g: 0, b: 0 })] }, [monitor]),
    mapper: doublingMapper,
    getProfile: () => profile,
    loadContext: async () => null,
    isDryRun: () => dryRun,
    onDecision: (record) => records.push(record),
    onLog: (_level, message) => logs.push(message),
    now: () => 1_000,
  });
  return { decider, source, records, logs };
}

const input: DeciderInput = { tick: 0, now: 1_000, evaluations: [], frames: new Map() };

function decisionOf(actions: LlmDecision['actions'], confidence = 0.9): LlmDecision {
  return { observation: 'saw the table', reasoning: 'strategy says so', confidence, actions };
}

describe('LlmDecider translation', () => {
  it('resolves a region name to mapped screen coordinates', async () => {
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'Fold button' }]),
      profileOf(),
    );
    const requests = await decider.decide(input);
    expect(requests).toHaveLength(1);
    // Region center is (120, 210) in capture pixels; the mapper doubles it.
    expect(requests[0]!.steps).toEqual([
      { type: 'click', button: 'left', double: false, target: { x: 240, y: 420 } },
    ]);
    expect(records[0]!.executed).toBe(true);
  });

  it('matches region names case- and whitespace-insensitively', async () => {
    const { decider } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: '  fold BUTTON ' }]),
      profileOf(),
    );
    expect(await decider.decide(input)).toHaveLength(1);
  });

  it('rejects the whole decision when one region name is unknown', async () => {
    const { decider, records } = buildDecider(
      decisionOf([
        { type: 'clickRegion', regionName: 'Fold button' },
        { type: 'typeText', text: '100' },
        { type: 'clickRegion', regionName: 'All in' },
      ]),
      profileOf(),
    );
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.executed).toBe(false);
    expect(records[0]!.skippedReason).toContain('unknown region "All in"');
    expect(records[0]!.steps).toEqual([]);
  });

  it('maps raw coordinates through the mapper', async () => {
    const { decider } = buildDecider(
      decisionOf([{ type: 'clickPoint', monitorKey: MONITOR, x: 50, y: 60, button: 'right' }]),
      profileOf(),
    );
    const requests = await decider.decide(input);
    expect(requests[0]!.steps).toEqual([
      { type: 'click', button: 'right', double: false, target: { x: 100, y: 120 } },
    ]);
  });

  it('rejects coordinates on an unknown monitor', async () => {
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickPoint', monitorKey: 'ghost', x: 1, y: 1 }]),
      profileOf(),
    );
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.skippedReason).toContain('unknown monitor');
  });

  it('translates typing, key taps and delays', async () => {
    const { decider } = buildDecider(
      decisionOf([
        { type: 'typeText', text: '100' },
        { type: 'keyTap', key: 'enter', modifiers: ['control'] },
        { type: 'delay', ms: 250 },
      ]),
      profileOf(),
    );
    const requests = await decider.decide(input);
    expect(requests[0]!.steps).toEqual([
      { type: 'typeText', text: '100' },
      { type: 'keyTap', key: 'enter', modifiers: ['control'] },
      { type: 'delay', ms: 250 },
    ]);
  });

  it('clamps an out-of-range delay instead of rejecting', async () => {
    const { decider } = buildDecider(decisionOf([{ type: 'delay', ms: 999_999 }]), profileOf());
    const requests = await decider.decide(input);
    expect(requests[0]!.steps).toEqual([{ type: 'delay', ms: 60_000 }]);
  });

  it('produces no steps for a wait decision', async () => {
    const { decider, records } = buildDecider(decisionOf([{ type: 'wait' }]), profileOf());
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.skippedReason).toBe('the model chose to wait');
  });
});

describe('LlmDecider safety limits', () => {
  it('does not execute below the confidence threshold but still reports the decision', async () => {
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'Fold button' }], 0.2),
      profileOf({ llm: { minConfidence: 0.5 } }),
    );
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.executed).toBe(false);
    expect(records[0]!.skippedReason).toContain('below the 0.5 threshold');
    expect(records[0]!.decision.observation).toBe('saw the table');
  });

  it('rejects decisions with more actions than the cap', async () => {
    const { decider, records } = buildDecider(
      decisionOf([
        { type: 'delay', ms: 1 },
        { type: 'delay', ms: 2 },
        { type: 'delay', ms: 3 },
      ]),
      profileOf({ llm: { maxActionsPerDecision: 2 } }),
    );
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.skippedReason).toContain('above the cap of 2');
  });

  it('reports a dry-run decision as not executed and keeps it out of history', async () => {
    const profile = profileOf();
    const { decider, records, source } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'Fold button' }]),
      profile,
      true,
    );
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.executed).toBe(false);
    expect(records[0]!.skippedReason).toContain('dry-run');
    // The steps are still reported so the UI can show what would have happened.
    expect(records[0]!.steps).toHaveLength(1);
    await decider.decide(input);
    expect(source.requests[1]!.history).toHaveLength(0);
  });

  it('reports a failed model call without throwing', async () => {
    const { decider, records, logs } = buildDecider(new Error('ollama is down'), profileOf());
    expect(await decider.decide(input)).toEqual([]);
    expect(records[0]!.executed).toBe(false);
    expect(records[0]!.skippedReason).toBe('model call failed');
    expect(logs.some((line) => line.includes('ollama is down'))).toBe(true);
  });
});

describe('LlmDecider request assembly', () => {
  it('sends landmarks, screenshots and triggered region names', async () => {
    const profile = profileOf();
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), profile);
    await decider.decide({
      ...input,
      evaluations: [{ region: profile.regions[0]!, matched: true, triggered: true }],
    });
    const request = source.requests[0]!;
    expect(request.landmarks).toEqual([
      {
        name: 'Fold button',
        description: 'bottom left',
        monitorKey: MONITOR,
        rect: { x: 100, y: 200, width: 40, height: 20 },
      },
    ]);
    expect(request.screenshots[0]).toMatchObject({
      monitorKey: MONITOR,
      mediaType: 'image/jpeg',
      captureWidth: 1920,
    });
    expect(request.triggeredRegionNames).toEqual(['Fold button']);
  });

  it('accumulates history only for executed decisions and bounds it', async () => {
    const profile = profileOf({ llm: { historySize: 2 } });
    const { decider, source } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'Fold button' }]),
      profile,
    );
    await decider.decide(input);
    await decider.decide(input);
    await decider.decide(input);
    expect(source.requests[0]!.history).toHaveLength(0);
    expect(source.requests[1]!.history).toHaveLength(1);
    expect(source.requests[2]!.history).toHaveLength(2);
    expect(source.requests[2]!.history[0]!.actionSummary).toBe('clickRegion(Fold button)');
  });

  it('does not remember decisions that were never executed', async () => {
    const profile = profileOf();
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), profile);
    await decider.decide(input);
    await decider.decide(input);
    expect(source.requests[1]!.history).toHaveLength(0);
  });
});
