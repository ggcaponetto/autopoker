import { z } from 'zod';
import { ActionStepSchema, ModifierSchema, MouseButtonSchema } from './actions';

export const LlmProviderSchema = z.enum([
  'ollama',
  'anthropic',
  'openai',
  'google',
  'openai-compatible',
  'mock',
]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmSettingsSchema = z.object({
  provider: LlmProviderSchema.default('ollama'),
  /** Model id as the provider names it, e.g. 'llama3.2-vision' or 'claude-opus-5'. */
  model: z.string().min(1).default('llama3.2-vision'),
  /** Overrides the provider's default endpoint; required for openai-compatible. */
  baseUrl: z.string().optional(),
  /**
   * Monitor keys whose screenshots are sent to the model. `null` (the default)
   * means every monitor; an empty array sends none, leaving the model blind.
   * Ignored while any enabled 'view' region exists — views send crops instead.
   */
  monitorKeys: z.array(z.string()).nullable().default(null),
  /**
   * 'off' disables the model's reasoning trace (Ollama thinking models such as
   * qwen3-vl / deepseek-r1) — usually the single biggest latency cut on local
   * models. 'auto' leaves the model's default behaviour untouched.
   */
  thinking: z.enum(['auto', 'off']).default('auto'),
  /** Name of the environment variable holding the API key. Keys are never stored in profiles. */
  apiKeyEnv: z.string().optional(),
  maxOutputTokens: z.number().int().min(256).max(32_000).default(2_000),
  /**
   * Left unset by default: Claude 5-family models reject temperature with a 400,
   * and the SDK only sends the parameter when it is defined.
   */
  temperature: z.number().min(0).max(2).optional(),
  requestTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
  /** Minimum wait between LLM consultations; the main cost/rate control. */
  minIntervalMs: z.number().int().min(0).max(3_600_000).default(5_000),
  /** Decisions below this confidence are logged but never executed. */
  minConfidence: z.number().min(0).max(1).default(0.5),
  maxActionsPerDecision: z.number().int().min(1).max(20).default(4),
  /**
   * How many past decisions (including waits and skips) to replay to the model.
   * This is the model's only memory of the current hand, so for turn-based games
   * it should comfortably cover one full round of action.
   */
  historySize: z.number().int().min(0).max(50).default(8),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;
export type LlmSettingsInput = z.input<typeof LlmSettingsSchema>;

export function createDefaultLlmSettings(): LlmSettings {
  return LlmSettingsSchema.parse({});
}

export const AttachmentKindSchema = z.enum(['image', 'pdf', 'text']);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

export const StrategyAttachmentSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  kind: AttachmentKindSchema,
  sizeBytes: z.number().int().min(0),
});
export type StrategyAttachment = z.infer<typeof StrategyAttachmentSchema>;

export const StrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  /** The strategy itself, authored in markdown and sent verbatim to the model. */
  markdown: z.string().default(''),
  attachments: z.array(StrategyAttachmentSchema).default([]),
  updatedAt: z.number().int().default(0),
});
export type Strategy = z.infer<typeof StrategySchema>;
export type StrategyInput = z.input<typeof StrategySchema>;

/**
 * Actions as the model emits them.
 *
 * Deliberately a flat object with optional fields rather than a discriminated union:
 * small local vision models produce it far more reliably, and translating it into the
 * strict ActionStep union in code gives better error messages than a schema rejection.
 */
export const LlmActionSchema = z.object({
  type: z.enum(['clickRegion', 'clickPoint', 'moveMouse', 'typeText', 'keyTap', 'delay', 'wait']),
  /** For clickRegion: the name of a registered region, matched case-insensitively. */
  regionName: z.string().optional(),
  /** For clickPoint/moveMouse: capture-pixel coordinates on `monitorKey`. */
  monitorKey: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  button: MouseButtonSchema.optional(),
  double: z.boolean().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  modifiers: z.array(ModifierSchema).optional(),
  ms: z.number().optional(),
});
export type LlmAction = z.infer<typeof LlmActionSchema>;

export const LlmDecisionSchema = z.object({
  /** What the model sees in the screenshot. */
  observation: z.string(),
  /** Why it chose these actions, per the strategy. */
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  actions: z.array(LlmActionSchema),
});
export type LlmDecision = z.infer<typeof LlmDecisionSchema>;

/**
 * The decision as the model is allowed to answer it. Local vision models routinely
 * report confidence as a percentage despite being asked for 0..1, so the wire schema
 * accepts 0..100 and normalizeLlmDecision() maps it back before anything else sees it.
 */
export const LlmDecisionWireSchema = LlmDecisionSchema.extend({
  // min(1) reaches providers that enforce the schema as a generation grammar
  // (Ollama structured outputs), pushing degenerate empty answers off the table.
  observation: z.string().min(1).describe('What you see on screen. Never empty.'),
  reasoning: z.string().min(1).describe('Why, against the strategy. Never empty.'),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe('How sure you are, from 0 to 1. Values above 1 are read as percentages.'),
});
export type LlmDecisionWire = z.infer<typeof LlmDecisionWireSchema>;

/** Collapse a wire decision to the strict shape: percent confidences become fractions. */
export function normalizeLlmDecision(wire: LlmDecisionWire): LlmDecision {
  const confidence = wire.confidence > 1 ? wire.confidence / 100 : wire.confidence;
  return { ...wire, confidence: Math.min(1, Math.max(0, confidence)) };
}

/** One screenshot exactly as it was sent to the model, kept for debugging. */
export const LlmSentScreenshotSchema = z.object({
  /** What the model knows this image as: the monitor key, or a view region's name. */
  label: z.string(),
  monitorKey: z.string(),
  /** Top-left of this image in the monitor's capture space; (0,0) for full screens. */
  originX: z.number().default(0),
  originY: z.number().default(0),
  jpegBase64: z.string(),
  captureWidth: z.number().int(),
  captureHeight: z.number().int(),
});
export type LlmSentScreenshot = z.infer<typeof LlmSentScreenshotSchema>;

/**
 * Where a decision's action would land, in pixels of one sent screenshot (matched by
 * label). Best-effort debug info: computed even for decisions that were never executed.
 */
export const LlmClickMarkerSchema = z.object({
  /** Label of the sent screenshot this marker belongs on. */
  screenshotLabel: z.string(),
  x: z.number(),
  y: z.number(),
  /** e.g. '1. click "Fold button"' — numbered in action order. */
  label: z.string(),
});
export type LlmClickMarker = z.infer<typeof LlmClickMarkerSchema>;

/** A decision plus everything the UI needs to display and audit it. */
export const LlmDecisionRecordSchema = z.object({
  at: z.number(),
  decision: LlmDecisionSchema,
  /** Steps the decision translated into; empty when nothing was executable. */
  steps: z.array(ActionStepSchema),
  executed: z.boolean(),
  /** Why the decision was not executed (dry-run, low confidence, unresolved region...). */
  skippedReason: z.string().optional(),
  /** The exact images the model saw, so a bad decision can be diagnosed visually. */
  screenshots: z.array(LlmSentScreenshotSchema).default([]),
  /** Where the decision's clicks/moves would land on those images. */
  markers: z.array(LlmClickMarkerSchema).default([]),
  latencyMs: z.number(),
  model: z.string(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
      cacheWriteTokens: z.number().optional(),
    })
    .optional(),
});
export type LlmDecisionRecord = z.infer<typeof LlmDecisionRecordSchema>;

export const LlmProbeResultSchema = z.object({
  ok: z.boolean(),
  provider: LlmProviderSchema,
  message: z.string(),
  /** Models the provider reports as available, when it can be queried (Ollama). */
  models: z.array(z.string()).default([]),
});
export type LlmProbeResult = z.infer<typeof LlmProbeResultSchema>;
