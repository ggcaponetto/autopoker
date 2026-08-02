import type { ScreenCapturer } from '@autopoker/core';
import type { ClientConnection, PreviewControl } from './handlers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures JPEG frames per monitor while at least one client is subscribed and
 * pushes them over the socket. One capture loop per monitor, shared by subscribers.
 */
export class PreviewPublisher implements PreviewControl {
  private readonly subscribers = new Map<string, Map<ClientConnection, number>>();
  private readonly looping = new Set<string>();
  private readonly seq = new Map<string, number>();

  constructor(
    private readonly capturer: ScreenCapturer,
    private readonly onLog: (message: string) => void = () => {},
  ) {}

  subscribe(client: ClientConnection, monitorKey: string, maxFps = 1): void {
    const clients = this.subscribers.get(monitorKey) ?? new Map<ClientConnection, number>();
    clients.set(client, Math.min(Math.max(maxFps, 0.2), 10));
    this.subscribers.set(monitorKey, clients);
    if (!this.looping.has(monitorKey)) {
      this.looping.add(monitorKey);
      void this.loop(monitorKey);
    }
  }

  unsubscribe(client: ClientConnection, monitorKey: string): void {
    this.subscribers.get(monitorKey)?.delete(client);
  }

  /** Remove a disconnected client from every monitor's subscription list. */
  drop(client: ClientConnection): void {
    for (const clients of this.subscribers.values()) clients.delete(client);
  }

  private async loop(monitorKey: string): Promise<void> {
    try {
      for (;;) {
        const clients = this.subscribers.get(monitorKey);
        if (!clients || clients.size === 0) return;
        const fps = Math.max(...clients.values());
        try {
          const jpeg = await this.capturer.captureJpeg(monitorKey);
          const seq = (this.seq.get(monitorKey) ?? 0) + 1;
          this.seq.set(monitorKey, seq);
          const frame = {
            type: 'previewFrame' as const,
            monitorKey,
            seq,
            capturedAt: Date.now(),
            jpegBase64: Buffer.from(jpeg).toString('base64'),
          };
          for (const client of clients.keys()) client.send(frame);
        } catch (error) {
          this.onLog(`preview capture failed for ${monitorKey}: ${String(error)}`);
          await sleep(2000);
        }
        await sleep(1000 / fps);
      }
    } finally {
      this.looping.delete(monitorKey);
    }
  }
}
