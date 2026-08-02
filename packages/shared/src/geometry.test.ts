import { describe, expect, it } from 'vitest';
import { clampRectToBounds, colorDistance, isPointInRect, rectCenter } from './geometry';

describe('rectCenter', () => {
  it('returns the integer center of a rect', () => {
    expect(rectCenter({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 60, y: 45 });
  });
});

describe('isPointInRect', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  it('includes the top-left corner and excludes the bottom-right edge', () => {
    expect(isPointInRect({ x: 0, y: 0 }, rect)).toBe(true);
    expect(isPointInRect({ x: 9, y: 9 }, rect)).toBe(true);
    expect(isPointInRect({ x: 10, y: 10 }, rect)).toBe(false);
  });
});

describe('clampRectToBounds', () => {
  it('keeps a fully contained rect unchanged', () => {
    const rect = { x: 5, y: 5, width: 10, height: 10 };
    expect(clampRectToBounds(rect, 100, 100)).toEqual(rect);
  });

  it('clips a rect overflowing the bounds', () => {
    expect(clampRectToBounds({ x: 90, y: -5, width: 20, height: 20 }, 100, 100)).toEqual({
      x: 90,
      y: 0,
      width: 10,
      height: 15,
    });
  });

  it('returns null when there is no overlap', () => {
    expect(clampRectToBounds({ x: 200, y: 200, width: 10, height: 10 }, 100, 100)).toBeNull();
  });
});

describe('colorDistance', () => {
  it('is the largest per-channel difference', () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 15, g: 5, b: 30 })).toBe(15);
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toBe(0);
  });
});
