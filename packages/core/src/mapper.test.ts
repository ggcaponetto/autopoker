import { describe, expect, it } from 'vitest';
import { ScaledCoordinateMapper } from './mapper';
import type { MonitorDescriptor } from './types';

function monitor(overrides: Partial<MonitorDescriptor>): MonitorDescriptor {
  return {
    key: 'M@0,0',
    name: 'M',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    isPrimary: true,
    captureWidth: 1920,
    captureHeight: 1080,
    ...overrides,
  };
}

describe('ScaledCoordinateMapper', () => {
  it('is identity plus origin at scale 1', () => {
    const mapper = new ScaledCoordinateMapper([
      monitor({}),
      monitor({ key: 'M@-1920,0', x: -1920, isPrimary: false }),
    ]);
    expect(mapper.toScreen('M@0,0', { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(mapper.toScreen('M@-1920,0', { x: 100, y: 50 })).toEqual({ x: -1820, y: 50 });
  });

  it('scales capture pixels down to logical pixels on high-DPI monitors', () => {
    const mapper = new ScaledCoordinateMapper([
      monitor({ scaleFactor: 1.5, captureWidth: 2880, captureHeight: 1620 }),
    ]);
    expect(mapper.toScreen('M@0,0', { x: 2880, y: 1620 })).toEqual({ x: 1920, y: 1080 });
    expect(mapper.toScreen('M@0,0', { x: 1440, y: 810 })).toEqual({ x: 960, y: 540 });
  });

  it('throws for unknown monitors', () => {
    expect(() => new ScaledCoordinateMapper([]).toScreen('nope', { x: 0, y: 0 })).toThrow();
  });
});
