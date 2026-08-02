/**
 * Regression tests for the WebSocket hook's socket lifecycle. React StrictMode
 * double-mounts effects in dev, so the socket from the first mount closes *after* its
 * replacement exists — its late events must not clobber the live socket's state.
 */
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServer } from './useServer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    // Real close events are asynchronous: they arrive after the replacement socket
    // from a StrictMode remount has already been created and stored.
    queueMicrotask(() => this.onclose?.());
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  sentTypes(): string[] {
    return this.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useServer under StrictMode', () => {
  it('keeps working after the dev double-mount closes the first socket', async () => {
    const { result } = renderHook(() => useServer('ws://test'), { wrapper: StrictMode });

    // StrictMode: mount, unmount (closes socket #1), remount (socket #2).
    expect(FakeWebSocket.instances).toHaveLength(2);
    const [stale, live] = FakeWebSocket.instances as [FakeWebSocket, FakeWebSocket];
    expect(stale.readyState).toBe(FakeWebSocket.CLOSED);

    // Let the stale socket's late close event fire before the live socket opens.
    await act(async () => {});
    await act(async () => live.open());

    expect(result.current.state.connected).toBe(true);
    expect(live.sentTypes()).toEqual(['listMonitors', 'listProfiles']);

    // UI interactions go through send(); they must reach the live socket.
    await act(async () => result.current.send({ type: 'stop' }));
    expect(live.sentTypes()).toContain('stop');
    expect(result.current.state.connected).toBe(true);
  });

  it('reduces server messages into state and notifies subscribers', async () => {
    const { result } = renderHook(() => useServer('ws://test'), { wrapper: StrictMode });
    await act(async () => {});
    const live = FakeWebSocket.instances[1]!;
    const seen: string[] = [];
    result.current.subscribe((message) => seen.push(message.type));

    await act(async () => {
      live.open();
      live.receive({
        type: 'monitors',
        list: [
          {
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
          },
        ],
      });
    });

    expect(result.current.state.monitors).toHaveLength(1);
    expect(result.current.state.monitors[0]!.key).toBe('M@0,0');
    expect(seen).toContain('monitors');
  });
});
