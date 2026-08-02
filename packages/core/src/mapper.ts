import type { Point } from '@autopoker/shared';
import type { CoordinateMapper, MonitorDescriptor } from './types';

/**
 * Maps capture-space (physical pixel) points to virtual-screen coordinates.
 *
 * Smoke-verified on Windows: robotjs addresses the virtual screen in the same logical
 * coordinate space that node-screenshots reports monitor origins in, so a capture-space
 * point only needs the monitor origin added and the capture→logical scale applied.
 */
export class ScaledCoordinateMapper implements CoordinateMapper {
  private readonly byKey: Map<string, MonitorDescriptor>;

  constructor(monitors: MonitorDescriptor[]) {
    this.byKey = new Map(monitors.map((monitor) => [monitor.key, monitor]));
  }

  toScreen(monitorKey: string, point: Point): Point {
    const monitor = this.byKey.get(monitorKey);
    if (!monitor) throw new Error(`unknown monitor: ${monitorKey}`);
    return {
      x: monitor.x + Math.round(point.x * (monitor.width / monitor.captureWidth)),
      y: monitor.y + Math.round(point.y * (monitor.height / monitor.captureHeight)),
    };
  }
}
