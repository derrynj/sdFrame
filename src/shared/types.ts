export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapEdge = 'left' | 'right' | 'top' | 'bottom' | 'align-top' | 'align-bottom' | 'align-left' | 'align-right' | 'unknown';

export interface SnapTarget {
  frameId: string;
  edge: SnapEdge;
  distance?: number;
}

export interface FrameConfig {
  id: string;
  name?: string;
  url: string;
  enabled: boolean;
  bounds: Bounds;
  color: string;
  snappedTo: SnapTarget[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FrameSizeSettings {
  width: number;
  height: number;
}

export interface AppConfig {
  version: 1;
  snapEnabled: boolean;
  snapThreshold: number;
  groupMovementEnabled: boolean;
  layoutLocked: boolean;
  alwaysOnTop: boolean;
  logLevel: LogLevel;
  frameSize: FrameSizeSettings;
  frames: FrameConfig[];
}

export type IPCMainChannels =
  | 'frame:add'
  | 'frame:update'
  | 'frame:remove'
  | 'frame:focus'
  | 'frame:reset-layout'
  | 'frame:get-all'
  | 'config:get'
  | 'config:set'
  | 'app:quit';

export type IPCRendererChannels =
  | 'frame:list'
  | 'config:updated'
  | 'frame:created'
  | 'frame:removed';

export interface FrameAddPayload {
  name?: string;
  url: string;
  bounds?: Partial<Bounds>;
}

export interface FrameUpdatePayload {
  id: string;
  config: Partial<Omit<FrameConfig, 'id'>>;
}

export interface FrameRemovePayload {
  id: string;
}

export interface FrameFocusPayload {
  id: string;
}

export interface FrameResetLayoutPayload {
  id?: string;
}

export interface ConfigSetPayload {
  key: keyof Omit<AppConfig, 'version' | 'frames'>;
  value: boolean | number | LogLevel | FrameSizeSettings;
}

export interface FrameUnsnapPayload {
  id: string;
  edge?: SnapEdge;
  all?: boolean;
}
