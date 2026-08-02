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

/** An encoded screenshot ready to send as a file part. */
export interface ScreenshotInput {
  monitorKey: string;
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

/** A previous decision, replayed so the model can stay coherent across turns. */
export interface HistoryEntry {
  at: number;
  observation: string;
  actionSummary: string;
}

export interface DecisionRequest {
  settings: LlmSettings;
  context: StrategyContext | null;
  screenshots: ScreenshotInput[];
  landmarks: Landmark[];
  history: HistoryEntry[];
  /** Names of regions whose condition fired this tick, when that is what woke the model. */
  triggeredRegionNames: string[];
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
