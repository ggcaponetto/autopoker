import { Monitor } from 'node-screenshots';
import type { Frame, MonitorDescriptor, ScreenCapturer } from '../types';

/**
 * Monitor names are not unique on Windows (two identical displays report the same
 * name), so the stable key includes the virtual-screen origin.
 */
export function monitorKeyOf(monitor: Monitor): string {
  return `${monitor.name()}@${monitor.x()},${monitor.y()}`;
}

export class NodeScreenshotsCapturer implements ScreenCapturer {
  async listMonitors(): Promise<MonitorDescriptor[]> {
    return Monitor.all().map((monitor) => ({
      key: monitorKeyOf(monitor),
      name: monitor.name(),
      x: monitor.x(),
      y: monitor.y(),
      width: monitor.width(),
      height: monitor.height(),
      scaleFactor: monitor.scaleFactor(),
      isPrimary: monitor.isPrimary(),
      captureWidth: Math.round(monitor.width() * monitor.scaleFactor()),
      captureHeight: Math.round(monitor.height() * monitor.scaleFactor()),
    }));
  }

  async capture(monitorKey: string): Promise<Frame> {
    const image = await this.find(monitorKey).captureImage();
    return { width: image.width, height: image.height, rgba: await image.toRaw() };
  }

  async captureJpeg(monitorKey: string): Promise<Uint8Array> {
    const image = await this.find(monitorKey).captureImage();
    return image.toJpeg();
  }

  private find(monitorKey: string): Monitor {
    const monitor = Monitor.all().find((candidate) => monitorKeyOf(candidate) === monitorKey);
    if (!monitor) throw new Error(`monitor not found: ${monitorKey}`);
    return monitor;
  }
}
