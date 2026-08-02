/** Engine behaviour specific to LLM mode: when the model is consulted, and how often. */
import { ProfileSchema, type Profile, type ProfileInput } from '@autopoker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionQueue } from './action-queue';
import { MonitoringEngine } from './engine';
import { FakeCapturer, RecordingExecutor, RecordingInput, solidFrame } from './testing';
import type { DeciderInput } from './types';

const MONITOR = 'M@0,0';
const red = { r: 255, g: 0, b: 0 };
const black = { r: 0, g: 0, b: 0 };
const redFrame = solidFrame(8, 8, red);
const blackFrame = solidFrame(8, 8, black);

function profileOf(settings: Partial<ProfileInput['settings']>): Profile {
  return ProfileSchema.parse({
    id: 'p1',
    name: 'LLM',
    regions: [
      {
        id: 'r1',
        name: 'Turn indicator',
        monitorKey: MONITOR,
        rect: { x: 0, y: 0, width: 8, height: 8 },
        // Matches only on the red frame.
        condition: { type: 'colorAtPoint', point: { x: 1, y: 1 }, color: red, tolerance: 0 },
        purpose: 'landmark',
        actions: [],
        confirmTicks: 1,
        cooldownMs: 0,
        rearm: 'afterCooldown',
      },
    ],
    settings: { mode: 'llm', intervalMs: 500, dryRun: true, ...settings },
  } satisfies ProfileInput);
}

function buildEngine(frames: ReturnType<typeof solidFrame>[], profile: Profile) {
  const consultedAt: number[] = [];
  const engine = new MonitoringEngine({
    capturer: new FakeCapturer({ [MONITOR]: frames }),
    decider: {
      decide: (input: DeciderInput) => {
        consultedAt.push(input.now);
        return [];
      },
    },
    queue: new ActionQueue(new RecordingExecutor()),
    baselines: { get: () => undefined },
    input: new RecordingInput(),
  });
  engine.start(profile);
  return { engine, consultedAt };
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

describe('LLM mode triggering', () => {
  it('onRegionTrigger consults the model only when a region fires', async () => {
    // black (no match), red (match), black (no match).
    const { engine, consultedAt } = buildEngine(
      [blackFrame, redFrame, blackFrame],
      profileOf({ llmTrigger: 'onRegionTrigger', llm: { minIntervalMs: 0 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(consultedAt).toEqual([]);
    await ticks(2);
    expect(consultedAt).toEqual([500]);
    engine.stop();
  });

  it('everyTick consults the model even when nothing fires', async () => {
    const { engine, consultedAt } = buildEngine(
      [blackFrame],
      profileOf({ llmTrigger: 'everyTick', llm: { minIntervalMs: 0 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await ticks(2);
    expect(consultedAt).toEqual([0, 500, 1000]);
    engine.stop();
  });

  it('enforces minIntervalMs between consultations', async () => {
    const { engine, consultedAt } = buildEngine(
      [blackFrame],
      profileOf({ llmTrigger: 'everyTick', llm: { minIntervalMs: 1500 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await ticks(6);
    // Ticks at 0,500,1000,...; with a 1500ms floor only 0, 1500 and 3000 are eligible.
    expect(consultedAt).toEqual([0, 1500, 3000]);
    engine.stop();
  });

  it('rate-limits region-triggered consultations too', async () => {
    const { engine, consultedAt } = buildEngine(
      [redFrame],
      profileOf({ llmTrigger: 'onRegionTrigger', llm: { minIntervalMs: 1500 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await ticks(4);
    expect(consultedAt.length).toBeLessThanOrEqual(2);
    expect(consultedAt[0]).toBe(0);
    engine.stop();
  });

  it('manual mode ignores the llm trigger settings entirely', async () => {
    const { engine, consultedAt } = buildEngine(
      [blackFrame],
      profileOf({ mode: 'manual', llmTrigger: 'everyTick', llm: { minIntervalMs: 0 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await ticks(3);
    expect(consultedAt).toEqual([]);
    engine.stop();
  });

  it('waits for a slow model instead of overlapping calls', async () => {
    let active = 0;
    let maxActive = 0;
    let resolveCall: (() => void) | null = null;
    const engine = new MonitoringEngine({
      capturer: new FakeCapturer({ [MONITOR]: [blackFrame] }),
      decider: {
        decide: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => {
            resolveCall = resolve;
          });
          active -= 1;
          return [];
        },
      },
      queue: new ActionQueue(new RecordingExecutor()),
      baselines: { get: () => undefined },
      input: new RecordingInput(),
    });
    engine.start(profileOf({ llmTrigger: 'everyTick', llm: { minIntervalMs: 0 } }));

    await vi.advanceTimersByTimeAsync(0);
    await ticks(4); // the loop is parked inside the decider for all of these
    expect(maxActive).toBe(1);
    resolveCall!();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxActive).toBe(1);
    engine.stop();
  });
});
