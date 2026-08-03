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

function buildDecider(
  decision: LlmDecision | Error,
  profile: Profile,
  dryRun = false,
  monitors: MonitorDescriptor[] = [monitor],
) {
  const source = new ScriptedSource(decision);
  const records: LlmDecisionRecord[] = [];
  const logs: string[] = [];
  const decider = new LlmDecider({
    source,
    capturer: new FakeCapturer({ [MONITOR]: [solidFrame(4, 4, { r: 0, g: 0, b: 0 })] }, monitors),
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

  it('reports a dry-run decision as not executed and remembers it as such', async () => {
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
    // History keeps the entry, honestly flagged: it never ran on the machine.
    expect(source.requests[1]!.history).toEqual([
      expect.objectContaining({
        executed: false,
        actionSummary: expect.stringContaining('dry-run'),
      }),
    ]);
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

  it('accumulates bounded history with executed flags', async () => {
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
    expect(source.requests[2]!.history[0]!).toMatchObject({
      actionSummary: 'clickRegion(Fold button)',
      executed: true,
    });
  });

  it('remembers waits as what happened, not as failures', async () => {
    const profile = profileOf();
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), profile);
    await decider.decide(input);
    await decider.decide(input);
    expect(source.requests[1]!.history).toEqual([
      expect.objectContaining({ actionSummary: 'wait', executed: true }),
    ]);
  });
});

describe('LlmDecider debug artifacts', () => {
  it('attaches the sent screenshots to the record, even when the model call fails', async () => {
    const failed = buildDecider(new Error('ollama is down'), profileOf());
    await failed.decider.decide(input);
    expect(failed.records[0]!.screenshots).toMatchObject([
      { monitorKey: MONITOR, captureWidth: 1920, captureHeight: 1080 },
    ]);

    const ok = buildDecider(decisionOf([{ type: 'wait' }]), profileOf());
    await ok.decider.decide(input);
    expect(ok.records[0]!.screenshots.map((shot) => shot.monitorKey)).toEqual([MONITOR]);
  });

  it('marks where a clickRegion decision would land, in capture pixels', async () => {
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'fold BUTTON' }]),
      profileOf(),
    );
    await decider.decide(input);
    // Centre of the Fold button rect (x=100 y=200 w=40 h=20), unmapped.
    expect(records[0]!.markers).toEqual([
      { screenshotLabel: MONITOR, x: 120, y: 210, label: '1. click "Fold button"' },
    ]);
  });

  it('marks clickPoint coordinates and numbers markers in action order', async () => {
    const { decider, records } = buildDecider(
      decisionOf([
        { type: 'clickRegion', regionName: 'Fold button' },
        { type: 'clickPoint', monitorKey: MONITOR, x: 50.4, y: 60.6 },
      ]),
      profileOf(),
    );
    await decider.decide(input);
    expect(records[0]!.markers.map((marker) => marker.label)).toEqual([
      '1. click "Fold button"',
      '2. click (50, 61)',
    ]);
    expect(records[0]!.markers[1]).toMatchObject({ screenshotLabel: MONITOR, x: 50, y: 61 });
  });

  it('still marks a below-confidence decision, and skips unresolvable actions', async () => {
    const { decider, records } = buildDecider(
      decisionOf(
        [
          { type: 'clickRegion', regionName: 'Ghost button' },
          { type: 'clickPoint', x: 10, y: 20 },
        ],
        0.1,
      ),
      profileOf({ llm: { minConfidence: 0.9 } }),
    );
    await decider.decide(input);
    expect(records[0]!.executed).toBe(false);
    // The unknown region produces no marker; the point falls back to the region monitor.
    expect(records[0]!.markers).toEqual([
      { screenshotLabel: MONITOR, x: 10, y: 20, label: '2. click (10, 20)' },
    ]);
  });
});

describe('LlmDecider screenshot selection', () => {
  const second: MonitorDescriptor = { ...monitor, key: 'M@1920,0', name: 'M2', x: 1920 };

  function bareProfile(overrides: Partial<ProfileInput['settings']> = {}): Profile {
    return ProfileSchema.parse({
      id: 'p-bare',
      name: 'no regions',
      regions: [],
      settings: { mode: 'llm', ...overrides },
    } satisfies ProfileInput);
  }

  it('sends every monitor by default, even when the profile has no regions', async () => {
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), bareProfile(), false, [
      monitor,
      second,
    ]);
    await decider.decide(input);
    expect(source.requests[0]!.screenshots.map((shot) => shot.monitorKey)).toEqual([
      MONITOR,
      'M@1920,0',
    ]);
  });

  it('sends only the screens picked in settings', async () => {
    const profile = bareProfile({ llm: { monitorKeys: ['M@1920,0'] } });
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), profile, false, [
      monitor,
      second,
    ]);
    await decider.decide(input);
    expect(source.requests[0]!.screenshots.map((shot) => shot.monitorKey)).toEqual(['M@1920,0']);
  });

  it('sends nothing but warns when no screens are selected', async () => {
    const profile = bareProfile({ llm: { monitorKeys: [] } });
    const { decider, source, logs } = buildDecider(decisionOf([{ type: 'wait' }]), profile);
    await decider.decide(input);
    expect(source.requests[0]!.screenshots).toEqual([]);
    expect(logs.some((line) => line.includes('no screenshots will be sent'))).toBe(true);
  });

  it('skips and warns about selected screens that are not connected', async () => {
    const profile = bareProfile({ llm: { monitorKeys: ['ghost', MONITOR] } });
    const { decider, source, logs } = buildDecider(decisionOf([{ type: 'wait' }]), profile);
    await decider.decide(input);
    expect(source.requests[0]!.screenshots.map((shot) => shot.monitorKey)).toEqual([MONITOR]);
    expect(logs.some((line) => line.includes('"ghost" is not connected'))).toBe(true);
  });
});

describe('LlmDecider view regions', () => {
  function viewProfile(): Profile {
    return ProfileSchema.parse({
      id: 'p-view',
      name: 'view',
      regions: [
        {
          id: 'r-view',
          name: 'Table',
          purpose: 'view',
          monitorKey: MONITOR,
          rect: { x: 400, y: 200, width: 800, height: 600 },
          condition: { type: 'regionAverageColor', color: { r: 0, g: 0, b: 0 }, tolerance: 0 },
          actions: [],
        },
      ],
      settings: { mode: 'llm' },
    } satisfies ProfileInput);
  }

  it('sends the view crop instead of full monitors, and keeps it out of the landmarks', async () => {
    const { decider, source } = buildDecider(decisionOf([{ type: 'wait' }]), viewProfile());
    await decider.decide(input);
    const request = source.requests[0]!;
    expect(request.screenshots).toMatchObject([
      {
        label: 'Table',
        monitorKey: MONITOR,
        originX: 400,
        originY: 200,
        captureWidth: 800,
        captureHeight: 600,
      },
    ]);
    expect(request.landmarks).toEqual([]);
  });

  it('translates clickPoint coordinates from the crop back to the monitor', async () => {
    const { decider } = buildDecider(
      decisionOf([{ type: 'clickPoint', monitorKey: 'table', x: 10, y: 20 }]),
      viewProfile(),
    );
    const requests = await decider.decide(input);
    // Crop (10,20) + view origin (400,200) = capture (410,220), doubled by the mapper.
    expect(requests[0]!.steps).toEqual([
      { type: 'click', button: 'left', double: false, target: { x: 820, y: 440 } },
    ]);
  });

  it('assumes the single view when the model omits monitorKey, and marks on the crop', async () => {
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickPoint', x: 10, y: 20 }]),
      viewProfile(),
    );
    const requests = await decider.decide(input);
    expect(requests[0]!.steps).toEqual([
      { type: 'click', button: 'left', double: false, target: { x: 820, y: 440 } },
    ]);
    expect(records[0]!.markers).toEqual([
      { screenshotLabel: 'Table', x: 10, y: 20, label: '1. click (10, 20)' },
    ]);
  });

  it('maps a landmark click onto the containing view crop', async () => {
    const profile = ProfileSchema.parse({
      id: 'p-view-lm',
      name: 'view+landmark',
      regions: [
        ...viewProfile().regions,
        {
          id: 'r-fold',
          name: 'Fold button',
          purpose: 'landmark',
          monitorKey: MONITOR,
          rect: { x: 500, y: 700, width: 40, height: 20 },
          condition: { type: 'regionAverageColor', color: { r: 0, g: 0, b: 0 }, tolerance: 0 },
          actions: [],
        },
      ],
      settings: { mode: 'llm' },
    } satisfies ProfileInput);
    const { decider, records } = buildDecider(
      decisionOf([{ type: 'clickRegion', regionName: 'Fold button' }]),
      profile,
    );
    await decider.decide(input);
    // Landmark centre (520, 710) minus the view origin (400, 200).
    expect(records[0]!.markers).toEqual([
      { screenshotLabel: 'Table', x: 120, y: 510, label: '1. click "Fold button"' },
    ]);
  });
});
