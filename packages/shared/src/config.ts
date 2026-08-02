import { z } from 'zod';
import { PointSchema, RectSchema, RgbSchema } from './geometry';

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

export const MouseButtonSchema = z.enum(['left', 'right', 'middle']);
export type MouseButton = z.infer<typeof MouseButtonSchema>;

/** 'regionCenter' resolves to the region's center; a Point is in virtual-screen coordinates. */
export const ClickTargetSchema = z.union([z.literal('regionCenter'), PointSchema]);
export type ClickTarget = z.infer<typeof ClickTargetSchema>;

export const ModifierSchema = z.enum(['control', 'shift', 'alt', 'command']);
export type Modifier = z.infer<typeof ModifierSchema>;

export const ActionStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('moveMouse'),
    target: ClickTargetSchema.default('regionCenter'),
  }),
  z.object({
    type: z.literal('click'),
    button: MouseButtonSchema.default('left'),
    double: z.boolean().default(false),
    target: ClickTargetSchema.default('regionCenter'),
  }),
  z.object({
    type: z.literal('typeText'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('keyTap'),
    key: z.string().min(1),
    modifiers: z.array(ModifierSchema).default([]),
  }),
  z.object({
    type: z.literal('delay'),
    ms: z.number().int().min(0).max(60_000),
  }),
]);
export type ActionStep = z.infer<typeof ActionStepSchema>;

export const RearmPolicySchema = z.enum(['afterCooldown', 'afterConditionClears']);
export type RearmPolicy = z.infer<typeof RearmPolicySchema>;

export const RegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  monitorKey: z.string().min(1),
  /** Rect in capture pixels, relative to the monitor's captured image. */
  rect: RectSchema,
  condition: ConditionSchema,
  actions: z.array(ActionStepSchema).min(1),
  /** Number of consecutive matching ticks required before triggering (debounce). */
  confirmTicks: z.number().int().min(1).max(100).default(2),
  cooldownMs: z.number().int().min(0).max(3_600_000).default(3_000),
  rearm: RearmPolicySchema.default('afterConditionClears'),
});
export type Region = z.infer<typeof RegionSchema>;
export type RegionInput = z.input<typeof RegionSchema>;

export const EngineSettingsSchema = z.object({
  intervalMs: z.number().int().min(100).max(60_000).default(500),
  dryRun: z.boolean().default(true),
  killSwitchHotkey: z.string().default('Escape'),
  cornerFailsafe: z.boolean().default(true),
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
