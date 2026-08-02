import { z } from 'zod';
import { ActionStepSchema, ProfileSchema } from './config';
import { RectSchema } from './geometry';

const id = z.string().optional();

export const MonitorInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** Origin and size in the OS virtual-screen (logical) coordinate space. */
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  scaleFactor: z.number(),
  isPrimary: z.boolean(),
  /** Size of captured images in physical pixels; regions are defined in this space. */
  captureWidth: z.number().int(),
  captureHeight: z.number().int(),
});
export type MonitorInfo = z.infer<typeof MonitorInfoSchema>;

export const EngineStateSchema = z.object({
  running: z.boolean(),
  dryRun: z.boolean(),
  profileId: z.string().nullable(),
  intervalMs: z.number().int().nullable(),
  killSwitchArmed: z.boolean(),
});
export type EngineState = z.infer<typeof EngineStateSchema>;

export const RegionRunStateSchema = z.enum(['armed', 'confirming', 'cooldown']);
export type RegionRunState = z.infer<typeof RegionRunStateSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('listMonitors') }),
  z.object({ id, type: z.literal('listProfiles') }),
  z.object({ id, type: z.literal('saveProfile'), profile: ProfileSchema }),
  z.object({ id, type: z.literal('deleteProfile'), profileId: z.string().min(1) }),
  z.object({ id, type: z.literal('start'), profileId: z.string().min(1) }),
  z.object({ id, type: z.literal('stop') }),
  z.object({ id, type: z.literal('setDryRun'), enabled: z.boolean() }),
  z.object({ id, type: z.literal('captureBaseline'), monitorKey: z.string(), rect: RectSchema }),
  z.object({
    id,
    type: z.literal('subscribePreview'),
    monitorKey: z.string(),
    maxFps: z.number().positive().max(10).optional(),
  }),
  z.object({ id, type: z.literal('unsubscribePreview'), monitorKey: z.string() }),
  z.object({
    id,
    type: z.literal('testActions'),
    profileId: z.string().min(1),
    regionId: z.string().min(1),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('hello'),
    serverVersion: z.string(),
    engineState: EngineStateSchema,
  }),
  z.object({ id, type: z.literal('monitors'), list: z.array(MonitorInfoSchema) }),
  z.object({ id, type: z.literal('profiles'), list: z.array(ProfileSchema) }),
  z.object({ id, type: z.literal('engineState'), state: EngineStateSchema }),
  z.object({
    type: z.literal('previewFrame'),
    monitorKey: z.string(),
    seq: z.number().int(),
    capturedAt: z.number(),
    jpegBase64: z.string(),
  }),
  z.object({
    id,
    type: z.literal('baselineCaptured'),
    baselineId: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    pngBase64: z.string(),
  }),
  z.object({
    type: z.literal('regionStatus'),
    regionId: z.string(),
    matched: z.boolean(),
    state: RegionRunStateSchema,
    /** Condition-specific measurement, e.g. diff percentage or color distance. */
    value: z.number().optional(),
  }),
  z.object({
    type: z.literal('triggered'),
    regionId: z.string(),
    regionName: z.string(),
    at: z.number(),
    dryRun: z.boolean(),
    steps: z.array(ActionStepSchema),
  }),
  z.object({ type: z.literal('killSwitch'), reason: z.enum(['hotkey', 'corner']) }),
  z.object({
    type: z.literal('log'),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    at: z.number(),
  }),
  z.object({ id, type: z.literal('error'), message: z.string() }),
  z.object({ id, type: z.literal('ack') }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function decodeClientMessage(raw: string): ClientMessage {
  return ClientMessageSchema.parse(JSON.parse(raw));
}

export function decodeServerMessage(raw: string): ServerMessage {
  return ServerMessageSchema.parse(JSON.parse(raw));
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
