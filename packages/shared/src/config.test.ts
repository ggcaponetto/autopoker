import { describe, expect, it } from 'vitest';
import {
  ConditionSchema,
  createDefaultSettings,
  ProfileSchema,
  RegionSchema,
  type RegionInput,
} from './config';

const minimalRegion: RegionInput = {
  id: 'r1',
  name: 'Call button',
  monitorKey: 'DISPLAY1',
  rect: { x: 10, y: 20, width: 100, height: 40 },
  condition: {
    type: 'colorAtPoint',
    point: { x: 5, y: 5 },
    color: { r: 200, g: 40, b: 40 },
  },
  actions: [{ type: 'click' }],
};

describe('RegionSchema', () => {
  it('applies defaults to a minimal region', () => {
    const region = RegionSchema.parse(minimalRegion);
    expect(region.enabled).toBe(true);
    expect(region.confirmTicks).toBe(2);
    expect(region.cooldownMs).toBe(3_000);
    expect(region.rearm).toBe('afterConditionClears');
    expect(region.condition).toMatchObject({ tolerance: 10 });
    expect(region.actions[0]).toEqual({
      type: 'click',
      button: 'left',
      double: false,
      target: 'regionCenter',
    });
  });

  it('rejects a region without actions', () => {
    expect(() => RegionSchema.parse({ ...minimalRegion, actions: [] })).toThrow();
  });

  it('rejects a rect with non-positive dimensions', () => {
    expect(() =>
      RegionSchema.parse({ ...minimalRegion, rect: { x: 0, y: 0, width: 0, height: 10 } }),
    ).toThrow();
  });

  it('survives a JSON round-trip unchanged', () => {
    const region = RegionSchema.parse(minimalRegion);
    const roundTripped = RegionSchema.parse(JSON.parse(JSON.stringify(region)));
    expect(roundTripped).toEqual(region);
  });
});

describe('ConditionSchema', () => {
  it('rejects unknown condition types', () => {
    expect(() => ConditionSchema.parse({ type: 'sorcery' })).toThrow();
  });

  it('rejects out-of-range tolerance', () => {
    expect(() =>
      ConditionSchema.parse({
        type: 'regionAverageColor',
        color: { r: 0, g: 0, b: 0 },
        tolerance: 300,
      }),
    ).toThrow();
  });

  it('parses baseline conditions with defaults', () => {
    expect(ConditionSchema.parse({ type: 'baselineMatch', baselineId: 'b1' })).toEqual({
      type: 'baselineMatch',
      baselineId: 'b1',
      maxDiffPercent: 2,
    });
    expect(ConditionSchema.parse({ type: 'baselineChanged', baselineId: 'b1' })).toEqual({
      type: 'baselineChanged',
      baselineId: 'b1',
      minDiffPercent: 10,
    });
  });
});

describe('ProfileSchema', () => {
  it('parses a full profile and applies settings defaults', () => {
    const profile = ProfileSchema.parse({
      id: 'p1',
      name: 'Test profile',
      regions: [minimalRegion],
      settings: {},
    });
    expect(profile.settings).toMatchObject({
      mode: 'manual',
      intervalMs: 500,
      dryRun: true,
      killSwitchHotkey: 'Escape',
      cornerFailsafe: true,
      strategyId: null,
    });
    expect(profile.regions).toHaveLength(1);
  });

  it('createDefaultSettings defaults to dry-run', () => {
    expect(createDefaultSettings().dryRun).toBe(true);
  });
});
