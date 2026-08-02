import { describe, expect, it } from 'vitest';
import { averageColor, colorAt, cropRgba } from './frame';
import { makeFrame, solidFrame } from './testing';

const red = { r: 255, g: 0, b: 0 };
const black = { r: 0, g: 0, b: 0 };

describe('cropRgba', () => {
  it('copies the requested rect', () => {
    // 4x4 frame with a red 2x2 square at (1,1).
    const frame = makeFrame(4, 4, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 2 ? red : black));
    const crop = cropRgba(frame, { x: 1, y: 1, width: 2, height: 2 });
    expect(crop).not.toBeNull();
    expect(crop!.width).toBe(2);
    expect(crop!.height).toBe(2);
    expect(averageColor(crop!)).toEqual(red);
  });

  it('clamps rects overflowing the frame', () => {
    const frame = solidFrame(4, 4, red);
    const crop = cropRgba(frame, { x: 2, y: 2, width: 10, height: 10 });
    expect(crop).toMatchObject({ width: 2, height: 2 });
  });

  it('returns null for rects fully outside the frame', () => {
    expect(cropRgba(solidFrame(4, 4, red), { x: 10, y: 10, width: 2, height: 2 })).toBeNull();
  });
});

describe('colorAt', () => {
  it('reads the pixel color', () => {
    const frame = makeFrame(3, 3, (x, y) => (x === 1 && y === 2 ? red : black));
    expect(colorAt(frame, { x: 1, y: 2 })).toEqual(red);
    expect(colorAt(frame, { x: 0, y: 0 })).toEqual(black);
  });

  it('returns null out of bounds', () => {
    expect(colorAt(solidFrame(2, 2, red), { x: 2, y: 0 })).toBeNull();
    expect(colorAt(solidFrame(2, 2, red), { x: 0, y: -1 })).toBeNull();
  });
});

describe('averageColor', () => {
  it('averages across all pixels', () => {
    // Half white, half black.
    const frame = makeFrame(2, 2, (x) => (x === 0 ? { r: 255, g: 255, b: 255 } : black));
    expect(averageColor(frame)).toEqual({ r: 128, g: 128, b: 128 });
  });
});
