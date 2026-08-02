import { z } from 'zod';
import { ActionStepSchema } from './actions';
import { PointSchema, RectSchema, RgbSchema } from './geometry';
import { LlmSettingsSchema } from './llm';

export const ConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('colorAtPoint'),
    /** Point in region-relative capture pixels. */
    point: PointSchema,
    color: RgbSchema,
    tolerance: z.number().min(0).max(255).default(10),
  }),
  z.object({
    type: z.literal('regionAverageColor'),
    color: RgbSchema,
    tolerance: z.number().min(0).max(255).default(10),
  }),
  z.object({
    /** Fires when the region looks like the stored baseline (e.g. a button appeared). */
    type: z.literal('baselineMatch'),
    baselineId: z.string().min(1),
    maxDiffPercent: z.number().min(0).max(100).default(2),
  }),
  z.object({
    /** Fires when the region diverges from the stored baseline (something changed). */
    type: z.literal('baselineChanged'),
    baselineId: z.string().min(1),
    minDiffPercent: z.number().min(0).max(100).default(10),
  }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const RearmPolicySchema = z.enum(['afterCooldown', 'afterConditionClears']);
export type RearmPolicy = z.infer<typeof RearmPolicySchema>;

/**
 * 'automate' regions run their own action list when their condition fires (manual mode).
 * 'landmark' regions carry no actions: they exist so the LLM can click them by name.
 */
export const RegionPurposeSchema = z.enum(['automate', 'landmark']);
export type RegionPurpose = z.infer<typeof RegionPurposeSchema>;

export const RegionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Free-text hint passed to the LLM, e.g. "the pot size, top center of the table". */
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    purpose: RegionPurposeSchema.default('automate'),
    monitorKey: z.string().min(1),
    /** Rect in capture pixels, relative to the monitor's captured image. */
    rect: RectSchema,
    condition: ConditionSchema,
    actions: z.array(ActionStepSchema).default([]),
    /** Number of consecutive matching ticks required before triggering (debounce). */
    confirmTicks: z.number().int().min(1).max(100).default(2),
    cooldownMs: z.number().int().min(0).max(3_600_000).default(3_000),
    rearm: RearmPolicySchema.default('afterConditionClears'),
  })
  .superRefine((region, ctx) => {
    if (region.purpose === 'automate' && region.actions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'an automate region needs at least one action',
      });
    }
  });
export type Region = z.infer<typeof RegionSchema>;
export type RegionInput = z.input<typeof RegionSchema>;

/** Manual mode runs region rules only; llm mode asks the model what to do. */
export const EngineModeSchema = z.enum(['manual', 'llm']);
export type EngineMode = z.infer<typeof EngineModeSchema>;

/**
 * 'everyTick' consults the model on every eligible tick (subject to minIntervalMs);
 * 'onRegionTrigger' only consults it once a region condition fires, which is much
 * cheaper — a pixel rule detects "it's my turn", the model decides what to do.
 */
export const LlmTriggerSchema = z.enum(['everyTick', 'onRegionTrigger']);
export type LlmTrigger = z.infer<typeof LlmTriggerSchema>;

export const EngineSettingsSchema = z.object({
  mode: EngineModeSchema.default('manual'),
  intervalMs: z.number().int().min(100).max(60_000).default(500),
  dryRun: z.boolean().default(true),
  killSwitchHotkey: z.string().default('Escape'),
  cornerFailsafe: z.boolean().default(true),
  strategyId: z.string().nullable().default(null),
  llmTrigger: LlmTriggerSchema.default('onRegionTrigger'),
  // A parsed default, not a literal `{}`: zod returns object defaults verbatim without
  // applying the nested schema's own defaults, which makes parse() non-idempotent.
  llm: LlmSettingsSchema.default(() => LlmSettingsSchema.parse({})),
});
export type EngineSettings = z.infer<typeof EngineSettingsSchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  regions: z.array(RegionSchema).default([]),
  settings: EngineSettingsSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;

export function createDefaultSettings(): EngineSettings {
  return EngineSettingsSchema.parse({});
}
