import type { ActionStep, Modifier, MouseButton, Point, Region } from '@autopoker/shared';

/** Raw RGBA image, 4 bytes per pixel, row-major, in capture (physical) pixels. */
export interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface MonitorDescriptor {
  key: string;
  name: string;
  /** Origin and size in the OS virtual-screen coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
  /** Size of captured images in physical pixels. */
  captureWidth: number;
  captureHeight: number;
}

export interface ScreenCapturer {
  listMonitors(): Promise<MonitorDescriptor[]>;
  capture(monitorKey: string): Promise<Frame>;
  /** JPEG-encoded capture for UI previews. */
  captureJpeg(monitorKey: string): Promise<Uint8Array>;
}

export interface InputController {
  moveMouse(point: Point): void;
  click(button: MouseButton, double: boolean): void;
  typeText(text: string): void;
  keyTap(key: string, modifiers: Modifier[]): void;
  getMousePos(): Point;
}

export interface CoordinateMapper {
  /** Map a capture-space point on a monitor to virtual-screen coordinates. */
  toScreen(monitorKey: string, point: Point): Point;
}

export interface ActionRequest {
  regionId: string;
  regionName: string;
  steps: ActionStep[];
  /** Virtual-screen coordinates the 'regionCenter' target resolves to. */
  regionCenter: Point;
}

export interface ActionExecutor {
  execute(request: ActionRequest): Promise<void>;
}

export interface ActionQueueLike {
  /** Returns false when the request was dropped because the queue is at capacity. */
  enqueue(request: ActionRequest): boolean;
  clear(): void;
  readonly busy: boolean;
}

export interface RegionEvaluation {
  region: Region;
  matched: boolean;
  /** Condition-specific measurement (diff percentage or color distance). */
  value?: number;
  /** True when the region's state machine fired on this tick. */
  triggered: boolean;
}

export interface DeciderInput {
  tick: number;
  now: number;
  evaluations: RegionEvaluation[];
  /** Full monitor frames captured this tick, keyed by monitor. */
  frames: Map<string, Frame>;
}

/**
 * Turns a tick's evaluations into action requests. The rule-based decider reads only
 * the evaluations; the LLM decider also looks at the frames. Async so a model call
 * can be awaited inside the tick — the engine never overlaps ticks, so awaiting here
 * is what keeps concurrent model calls from happening.
 */
export interface Decider {
  decide(input: DeciderInput): ActionRequest[] | Promise<ActionRequest[]>;
}

export interface BaselineProvider {
  get(baselineId: string): Frame | undefined;
}
