import type { Modifier, MouseButton, Point, Rgb } from '@autopoker/shared';
import type {
  ActionExecutor,
  ActionRequest,
  Frame,
  InputController,
  MonitorDescriptor,
  ScreenCapturer,
} from './types';

/** Build a frame by asking the painter for each pixel's color (alpha is always 255). */
export function makeFrame(
  width: number,
  height: number,
  painter: (x: number, y: number) => Rgb,
): Frame {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const color = painter(x, y);
      rgba[i] = color.r;
      rgba[i + 1] = color.g;
      rgba[i + 2] = color.b;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

export function solidFrame(width: number, height: number, color: Rgb): Frame {
  return makeFrame(width, height, () => color);
}

/** Serves scripted frame sequences per monitor key; repeats the last frame when exhausted. */
export class FakeCapturer implements ScreenCapturer {
  private readonly calls = new Map<string, number>();

  constructor(
    private readonly sequences: Record<string, Frame[]>,
    private readonly monitors: MonitorDescriptor[] = [],
  ) {}

  captureCount(monitorKey: string): number {
    return this.calls.get(monitorKey) ?? 0;
  }

  async listMonitors(): Promise<MonitorDescriptor[]> {
    return this.monitors;
  }

  async capture(monitorKey: string): Promise<Frame> {
    const sequence = this.sequences[monitorKey];
    if (!sequence || sequence.length === 0) throw new Error(`no frames for ${monitorKey}`);
    const call = this.calls.get(monitorKey) ?? 0;
    this.calls.set(monitorKey, call + 1);
    return sequence[Math.min(call, sequence.length - 1)]!;
  }

  async captureJpeg(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async captureJpegRect(): Promise<Uint8Array> {
    return new Uint8Array();
  }
}

export type RecordedInput =
  | { kind: 'moveMouse'; point: Point }
  | { kind: 'click'; button: MouseButton; double: boolean }
  | { kind: 'typeText'; text: string }
  | { kind: 'keyTap'; key: string; modifiers: Modifier[] };

/** Records every call instead of touching real input devices. */
export class RecordingInput implements InputController {
  readonly recorded: RecordedInput[] = [];
  mousePos: Point = { x: 500, y: 500 };

  moveMouse(point: Point): void {
    this.recorded.push({ kind: 'moveMouse', point });
  }

  click(button: MouseButton, double: boolean): void {
    this.recorded.push({ kind: 'click', button, double });
  }

  typeText(text: string): void {
    this.recorded.push({ kind: 'typeText', text });
  }

  keyTap(key: string, modifiers: Modifier[]): void {
    this.recorded.push({ kind: 'keyTap', key, modifiers });
  }

  getMousePos(): Point {
    return this.mousePos;
  }
}

/** Resolves immediately and records the requests it received. */
export class RecordingExecutor implements ActionExecutor {
  readonly requests: ActionRequest[] = [];

  async execute(request: ActionRequest): Promise<void> {
    this.requests.push(request);
  }
}
