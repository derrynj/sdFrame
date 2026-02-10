import { z } from 'zod';

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(100),
  height: z.number().min(100),
});

export const SnapEdgeSchema = z.enum(['left', 'right', 'top', 'bottom', 'align-top', 'align-bottom', 'align-left', 'align-right', 'unknown']);

export const SnapTargetSchema = z.object({
  frameId: z.string().uuid(),
  edge: SnapEdgeSchema,
  distance: z.number().optional(),
});

export const FrameConfigSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  enabled: z.boolean(),
  bounds: BoundsSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  snappedTo: z.array(SnapTargetSchema),
});

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const FrameSizeSettingsSchema = z.object({
  width: z.number().min(100),
  height: z.number().min(100),
});

export const AppConfigSchema = z.object({
  version: z.literal(1),
  snapEnabled: z.boolean(),
  snapThreshold: z.number().min(1).max(50),
  groupMovementEnabled: z.boolean(),
  layoutLocked: z.boolean(),
  alwaysOnTop: z.boolean(),
  logLevel: LogLevelSchema,
  frameSize: FrameSizeSettingsSchema,
  frames: z.array(FrameConfigSchema),
});

export const FrameAddPayloadSchema = z.object({
  url: z.string().url(),
  bounds: BoundsSchema.partial().optional(),
});

export const FrameUpdatePayloadSchema = z.object({
  id: z.string().uuid(),
  config: FrameConfigSchema.omit({ id: true }).partial(),
});

export const FrameRemovePayloadSchema = z.object({
  id: z.string().uuid(),
});

export const FrameFocusPayloadSchema = z.object({
  id: z.string().uuid(),
});

export const FrameResetLayoutPayloadSchema = z.object({
  id: z.string().uuid().optional(),
});

export const ConfigSetPayloadSchema = z.object({
  key: z.enum(['snapEnabled', 'snapThreshold', 'groupMovementEnabled', 'layoutLocked', 'alwaysOnTop', 'logLevel', 'frameSize']),
  value: z.union([z.boolean(), z.number(), LogLevelSchema, FrameSizeSettingsSchema]),
});

export const FrameUnsnapPayloadSchema = z.object({
  id: z.string().uuid(),
  edge: SnapEdgeSchema.optional(),
  all: z.boolean().optional(),
});
