import { describe, expect, it } from 'vitest';
import { evaluateCondition } from './conditions';
import { makeFrame, solidFrame } from './testing';
import type { BaselineProvider, Frame } from './types';

const red = { r: 200, g: 40, b: 40 };
const nearRed = { r: 205, g: 44, b: 36 };
const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };

const noBaselines: BaselineProvider = { get: () => undefined };

function baselines(map: Record<string, Frame>): BaselineProvider {
  return { get: (baselineId) => map[baselineId] };
}

describe('colorAtPoint', () => {
  it('matches within tolerance and reports the distance', () => {
    const frame = solidFrame(4, 4, nearRed);
    const result = evaluateCondition(
      { type: 'colorAtPoint', point: { x: 1, y: 1 }, color: red, tolerance: 5 },
      frame,
      noBaselines,
    );
    expect(result).toEqual({ matched: true, value: 5 });
  });

  it('does not match beyond tolerance', () => {
    const frame = solidFrame(4, 4, nearRed);
    const result = evaluateCondition(
      { type: 'colorAtPoint', point: { x: 1, y: 1 }, color: red, tolerance: 4 },
      frame,
      noBaselines,
    );
    expect(result.matched).toBe(false);
  });

  it('does not match when the point is outside the region', () => {
    const result = evaluateCondition(
      { type: 'colorAtPoint', point: { x: 99, y: 99 }, color: red, tolerance: 255 },
      solidFrame(4, 4, red),
      noBaselines,
    );
    expect(result).toEqual({ matched: false });
  });
});

describe('regionAverageColor', () => {
  it('matches on the average of the region', () => {
    const frame = makeFrame(2, 2, (x) => (x === 0 ? white : black));
    const result = evaluateCondition(
      { type: 'regionAverageColor', color: { r: 128, g: 128, b: 128 }, tolerance: 1 },
      frame,
      noBaselines,
    );
    expect(result.matched).toBe(true);
  });
});

describe('baseline conditions', () => {
  const size = 10;
  const baseline = solidFrame(size, size, black);
  const identical = solidFrame(size, size, black);
  // Bottom half flipped to white: 50% of pixels differ.
  const halfChanged = makeFrame(size, size, (_x, y) => (y >= size / 2 ? white : black));

  it('baselineMatch fires when the region still looks like the baseline', () => {
    const result = evaluateCondition(
      { type: 'baselineMatch', baselineId: 'b1', maxDiffPercent: 2 },
      identical,
      baselines({ b1: baseline }),
    );
    expect(result).toEqual({ matched: true, value: 0 });
  });

  it('baselineMatch does not fire once the region diverges', () => {
    const result = evaluateCondition(
      { type: 'baselineMatch', baselineId: 'b1', maxDiffPercent: 2 },
      halfChanged,
      baselines({ b1: baseline }),
    );
    expect(result.matched).toBe(false);
    expect(result.value).toBeCloseTo(50, 0);
  });

  it('baselineChanged fires on divergence', () => {
    const result = evaluateCondition(
      { type: 'baselineChanged', baselineId: 'b1', minDiffPercent: 10 },
      halfChanged,
      baselines({ b1: baseline }),
    );
    expect(result.matched).toBe(true);
  });

  it('does not match when the baseline is missing or has different dimensions', () => {
    expect(
      evaluateCondition(
        { type: 'baselineMatch', baselineId: 'missing', maxDiffPercent: 100 },
        identical,
        noBaselines,
      ).matched,
    ).toBe(false);
    expect(
      evaluateCondition(
        { type: 'baselineMatch', baselineId: 'b1', maxDiffPercent: 100 },
        solidFrame(4, 4, black),
        baselines({ b1: baseline }),
      ).matched,
    ).toBe(false);
  });
});
