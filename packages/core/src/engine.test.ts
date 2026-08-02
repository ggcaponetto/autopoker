import {
  ProfileSchema,
  type Profile,
  type ProfileInput,
  type RegionInput,
} from '@autopoker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionQueue } from './action-queue';
import { RegionRuleDecider } from './decider';
import { MonitoringEngine, type EngineStopReason } from './engine';
import { FakeCapturer, RecordingExecutor, RecordingInput, solidFrame } from './testing';
import type { ActionExecutor, Frame } from './types';

const MONITOR = 'M@0,0';
const red = { r: 255, g: 0, b: 0 };
const black = { r: 0, g: 0, b: 0 };
const redFrame = solidFrame(8, 8, red);
const blackFrame = solidFrame(8, 8, black);

const identityMapper = { toScreen: (_key: string, point: { x: number; y: number }) => point };

function profileOf(regions: RegionInput[], settings: ProfileInput['settings']): Profile {
  return ProfileSchema.parse({ id: 'p1', name: 'Test', regions, settings } satisfies ProfileInput);
}

function redDetector(overrides: Partial<RegionInput> = {}): RegionInput {
  return {
    id: 'r1',
    name: 'Red detector',
    monitorKey: MONITOR,
    rect: { x: 0, y: 0, width: 8, height: 8 },
    condition: { type: 'colorAtPoint', point: { x: 1, y: 1 }, color: red, tolerance: 0 },
    actions: [{ type: 'click' }],
    confirmTicks: 1,
    cooldownMs: 0,
    rearm: 'afterCooldown',
    ...overrides,
  };
}

interface Harness {
  engine: MonitoringEngine;
  capturer: FakeCapturer;
  executor: RecordingExecutor;
  input: RecordingInput;
  triggeredAt: number[];
  logs: string[];
  stopped: EngineStopReason[];
}

function buildEngine(
  frames: Frame[],
  profile: Profile,
  executorOverride?: ActionExecutor,
): Harness {
  const capturer = new FakeCapturer({ [MONITOR]: frames });
  const executor = new RecordingExecutor();
  const input = new RecordingInput();
  const triggeredAt: number[] = [];
  const logs: string[] = [];
  const stopped: EngineStopReason[] = [];
  const engine = new MonitoringEngine({
    capturer,
    decider: new RegionRuleDecider(identityMapper),
    queue: new ActionQueue(executorOverride ?? executor),
    baselines: { get: () => undefined },
    input,
    events: {
      onTriggered: (event) => triggeredAt.push(event.at),
      onLog: (_level, message) => logs.push(message),
      onStopped: (reason) => stopped.push(reason),
    },
  });
  engine.start(profile);
  return { engine, capturer, executor, input, triggeredAt, logs, stopped };
}

async function ticks(count: number, intervalMs = 500): Promise<void> {
  for (let i = 0; i < count; i++) await vi.advanceTimersByTimeAsync(intervalMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MonitoringEngine', () => {
  it('debounces with confirmTicks: fires only after N consecutive matches', async () => {
    const profile = profileOf([redDetector({ confirmTicks: 3, cooldownMs: 60_000 })], {
      dryRun: true,
    });
    const { triggeredAt } = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0); // tick 1
    await ticks(1); // tick 2
    expect(triggeredAt).toHaveLength(0);
    await ticks(1); // tick 3 -> third consecutive match
    expect(triggeredAt).toHaveLength(1);
  });

  it('resets the confirm counter when the condition drops out mid-confirmation', async () => {
    const profile = profileOf([redDetector({ confirmTicks: 2, cooldownMs: 60_000 })], {
      dryRun: true,
    });
    const { triggeredAt } = buildEngine([redFrame, blackFrame, redFrame, redFrame], profile);
    await vi.advanceTimersByTimeAsync(0); // match 1
    await ticks(3); // drop, match 1, match 2
    expect(triggeredAt).toHaveLength(1);
  });

  it("rearm 'afterConditionClears' holds while the condition stays matched", async () => {
    const profile = profileOf([redDetector({ cooldownMs: 1000, rearm: 'afterConditionClears' })], {
      dryRun: true,
      intervalMs: 500,
    });
    // red red red black red -> second trigger only after the clear.
    const { triggeredAt } = buildEngine(
      [redFrame, redFrame, redFrame, blackFrame, redFrame],
      profile,
    );
    await vi.advanceTimersByTimeAsync(0); // t=0 trigger
    await ticks(4);
    expect(triggeredAt).toEqual([0, 2000]);
  });

  it("rearm 'afterCooldown' refires on a persistent condition once cooldown elapses", async () => {
    const profile = profileOf([redDetector({ cooldownMs: 1000, rearm: 'afterCooldown' })], {
      dryRun: true,
      intervalMs: 500,
    });
    const { triggeredAt } = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0); // t=0 trigger, cooldown until 1000
    await ticks(3); // t=500 cooldown, t=1000 re-arm, t=1500 trigger
    expect(triggeredAt).toEqual([0, 1500]);
  });

  it('emits triggers but never enqueues actions in dry-run', async () => {
    const profile = profileOf([redDetector()], { dryRun: true });
    const { triggeredAt, executor } = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(triggeredAt).toHaveLength(1);
    expect(executor.requests).toHaveLength(0);
  });

  it('executes actions when live, resolving the region center', async () => {
    const profile = profileOf([redDetector()], { dryRun: false });
    const { executor } = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]).toMatchObject({ regionId: 'r1', regionCenter: { x: 4, y: 4 } });
  });

  it('drops triggers and warns while an action is still running', async () => {
    const profile = profileOf([redDetector()], { dryRun: false, intervalMs: 500 });
    const never: ActionExecutor = { execute: () => new Promise(() => {}) };
    const { logs, triggeredAt } = buildEngine([redFrame], profile, never);
    await vi.advanceTimersByTimeAsync(0); // trigger 1 occupies the queue forever
    await ticks(2); // cooldown 0 + afterCooldown -> retriggers, but queue is busy
    expect(triggeredAt.length).toBeGreaterThan(1);
    expect(logs.some((message) => message.includes('queue busy'))).toBe(true);
  });

  it('stops via the corner failsafe without capturing', async () => {
    const profile = profileOf([redDetector()], { dryRun: true });
    const harness = buildEngine([redFrame], profile);
    harness.input.mousePos = { x: 2, y: 3 };
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stopped).toEqual(['corner']);
    expect(harness.engine.running).toBe(false);
    expect(harness.capturer.captureCount(MONITOR)).toBe(0);
  });

  it('stop() halts the loop', async () => {
    const profile = profileOf([redDetector({ cooldownMs: 60_000 })], { dryRun: true });
    const harness = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0);
    const captures = harness.capturer.captureCount(MONITOR);
    harness.engine.stop();
    await ticks(5);
    expect(harness.capturer.captureCount(MONITOR)).toBe(captures);
    expect(harness.stopped).toEqual(['user']);
  });

  it('logs capture failures and keeps ticking', async () => {
    const profile = profileOf([redDetector({ monitorKey: 'ghost' })], { dryRun: true });
    const harness = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0);
    await ticks(1);
    expect(harness.logs.filter((message) => message.includes('capture failed'))).toHaveLength(2);
    expect(harness.engine.running).toBe(true);
  });

  it('consults the decider in dry-run but never enqueues its requests', async () => {
    const profile = profileOf([redDetector()], { dryRun: true });
    const calls: number[] = [];
    const capturer = new FakeCapturer({ [MONITOR]: [redFrame] });
    const executor = new RecordingExecutor();
    const engine = new MonitoringEngine({
      capturer,
      decider: {
        decide: (deciderInput) => {
          calls.push(deciderInput.tick);
          return [
            {
              regionId: 'r1',
              regionName: 'Red detector',
              steps: [{ type: 'delay', ms: 1 }],
              regionCenter: { x: 0, y: 0 },
            },
          ];
        },
      },
      queue: new ActionQueue(executor),
      baselines: { get: () => undefined },
      input: new RecordingInput(),
    });
    engine.start(profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(executor.requests).toHaveLength(0);
    engine.stop();
  });

  it('skips disabled regions', async () => {
    const profile = profileOf([redDetector({ enabled: false })], { dryRun: true });
    const harness = buildEngine([redFrame], profile);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.triggeredAt).toHaveLength(0);
    expect(harness.capturer.captureCount(MONITOR)).toBe(0);
  });
});
