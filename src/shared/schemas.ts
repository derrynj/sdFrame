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

export const HTTP_URL_REGEX = /^https?:\/\//i;

export const isHttpUrl = (u: string): boolean => HTTP_URL_REGEX.test(u);

export const HttpUrlSchema = z.string().url().refine(isHttpUrl, { message: 'Only http and https URLs are supported' });

export const FrameConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  url: HttpUrlSchema,
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
  autoReloadOn404: z.boolean(),
  autoReload404IntervalSeconds: z.number().int().min(15).max(300),
  logLevel: LogLevelSchema,
  frameSize: FrameSizeSettingsSchema,
  frames: z.array(FrameConfigSchema),
});

export const FrameAddPayloadSchema = z.object({
  name: z.string().optional(),
  url: HttpUrlSchema,
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

export const FrameGroupHeightPayloadSchema = z.object({
  id: z.string().uuid(),
  height: z.number().min(100).max(5000),
});

export const ConfigSetPayloadSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('snapEnabled'), value: z.boolean() }),
  z.object({ key: z.literal('snapThreshold'), value: z.number().min(1).max(50) }),
  z.object({ key: z.literal('groupMovementEnabled'), value: z.boolean() }),
  z.object({ key: z.literal('layoutLocked'), value: z.boolean() }),
  z.object({ key: z.literal('alwaysOnTop'), value: z.boolean() }),
  z.object({ key: z.literal('autoReloadOn404'), value: z.boolean() }),
  z.object({ key: z.literal('autoReload404IntervalSeconds'), value: z.number().int().min(15).max(300) }),
  z.object({ key: z.literal('logLevel'), value: LogLevelSchema }),
  z.object({ key: z.literal('frameSize'), value: FrameSizeSettingsSchema }),
]);

export const FrameUnsnapPayloadSchema = z.object({
  id: z.string().uuid(),
  edge: SnapEdgeSchema.optional(),
  all: z.boolean().optional(),
});

export const PageRetryPayloadSchema = z.object({ frameId: z.string().uuid() });

export const TrayShowMenuPayloadSchema = z.object({ x: z.number(), y: z.number() });
