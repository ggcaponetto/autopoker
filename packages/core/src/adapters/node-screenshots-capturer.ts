import type { Rect } from '@autopoker/shared';
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

  async captureJpegRect(monitorKey: string, rect: Rect): Promise<Uint8Array> {
    const image = await this.find(monitorKey).captureImage();
    // Clamp to the captured image so a rect drawn on a slightly stale preview
    // cannot make the native crop throw.
    const x = Math.max(0, Math.min(Math.round(rect.x), image.width - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), image.height - 1));
    const width = Math.max(1, Math.min(Math.round(rect.width), image.width - x));
    const height = Math.max(1, Math.min(Math.round(rect.height), image.height - y));
    const cropped = await image.crop(x, y, width, height);
    return cropped.toJpeg();
  }

  private find(monitorKey: string): Monitor {
    const monitor = Monitor.all().find((candidate) => monitorKeyOf(candidate) === monitorKey);
    if (!monitor) throw new Error(`monitor not found: ${monitorKey}`);
    return monitor;
  }
}
