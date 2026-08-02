import { z } from 'zod';
import { PointSchema } from './geometry';

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
