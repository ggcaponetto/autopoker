import type {
  LlmDecision,
  LlmSettings,
  Rect,
  Strategy,
  StrategyAttachment,
} from '@autopoker/shared';

/** An attachment plus its bytes, loaded by the caller (the LLM package never touches disk). */
export interface LoadedAttachment {
  attachment: StrategyAttachment;
  data: Uint8Array;
}

export interface StrategyContext {
  strategy: Strategy;
  attachments: LoadedAttachment[];
}

/** An encoded screenshot ready to send as a file part — a full monitor or a view crop. */
export interface ScreenshotInput {
  /** What the model should call this image: the monitor key, or the view region's name. */
  label: string;
  monitorKey: string;
  /** Top-left of this image in the monitor's capture space; (0,0) for a full screen. */
  originX: number;
  originY: number;
  mediaType: string;
  data: Uint8Array;
  captureWidth: number;
  captureHeight: number;
}

/** A named region the model may click by name instead of guessing coordinates. */
export interface Landmark {
  name: string;
  description: string;
  monitorKey: string;
  rect: Rect;
}

/**
 * A previous decision, replayed so the model can stay coherent across turns. Every
 * decision is remembered — including waits and skipped ones — because for turn-based
 * games the sequence of observations IS the game history.
 */
export interface HistoryEntry {
  at: number;
  observation: string;
  /** What happened, e.g. 'clickRegion(Fold)' or 'wait' or 'clickPoint — skipped: …'. */
  actionSummary: string;
  /** True only when the actions really ran on the machine. */
  executed: boolean;
}

export interface DecisionRequest {
  settings: LlmSettings;
  context: StrategyContext | null;
  screenshots: ScreenshotInput[];
  landmarks: Landmark[];
  history: HistoryEntry[];
  /** Names of regions whose condition fired this tick, when that is what woke the model. */
  triggeredRegionNames: string[];
  /** When this request was assembled — the clock history entry ages are computed from. */
  at: number;
  signal?: AbortSignal;
}

export interface DecisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface DecisionResult {
  decision: LlmDecision;
  latencyMs: number;
  model: string;
  usage?: DecisionUsage;
}

/**
 * The seam between the engine and any LLM. Core depends only on this interface,
 * so it stays free of the AI SDK and fully unit-testable.
 */
export interface DecisionSource {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
