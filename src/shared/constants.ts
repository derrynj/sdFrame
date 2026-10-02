import type { AppConfig } from './types';

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  snapEnabled: true,
  snapThreshold: 10,
  groupMovementEnabled: true,
  layoutLocked: false,
  alwaysOnTop: false,
  logLevel: 'info',
  frameSize: {
    width: 0, // Will be calculated as screen width/4 at runtime
    height: 0, // Will be calculated as screen height/4 + 24px (drag handle) at runtime
  },
  frames: [],
};

export const FRAME_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F8B500',
  '#00CED1',
  '#FF7F50',
  '#9370DB',
  '#20B2AA',
];

export const DEFAULT_FRAME_WIDTH = 800;
export const DEFAULT_FRAME_HEIGHT = 624;

export const CONFIG_FILE_NAME = 'config.json';
export const LOG_FILE_NAME = 'sdframe.log';
export const LOG_MAX_SIZE_BYTES = 1024 * 1024; // 1MB

export const FOCUS_BORDER_WIDTH = 2;

// IPC_CHANNELS is shared directly: src/main/preload.ts imports it from here.
// The preload is bundled by scripts/bundle-preload.js (esbuild) so it can be
// loaded in Electron's sandboxed context. See docs/preload-script-duplication.md.
export const IPC_CHANNELS = {
  FRAME_ADD: 'frame:add',
  FRAME_UPDATE: 'frame:update',
  FRAME_REMOVE: 'frame:remove',
  FRAME_FOCUS: 'frame:focus',
  FRAME_RESET_LAYOUT: 'frame:reset-layout',
  FRAME_RESET_DIMENSIONS: 'frame:reset-dimensions',
  FRAME_SET_GROUP_HEIGHT: 'frame:set-group-height',
  FRAME_GET_ALL: 'frame:get-all',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_IMPORT: 'config:import',
  CONFIG_IMPORT_APPLY: 'config:import:apply',
  CONFIG_EXPORT: 'config:export',
  APP_QUIT: 'app:quit',
  FRAME_LIST: 'frame:list',
  CONFIG_UPDATED: 'config:updated',
  FRAME_CREATED: 'frame:created',
  FRAME_REMOVED: 'frame:removed',
  FRAME_SHOW_BORDER: 'frame:show-border',
  FRAME_HIDE_BORDER: 'frame:hide-border',
  PAGE_LOAD_FAILED: 'page:load-failed',
  PAGE_RETRY: 'page:retry',
  OPEN_SETTINGS: 'open:settings',
  FRAME_UNSNAP: 'frame:unsnap',
  FRAME_ENABLE_ALL: 'frame:enable-all',
  FRAME_DISABLE_ALL: 'frame:disable-all',
  FRAME_SNAP_STATUS_CHANGED: 'frame:snap-status-changed',
  TRAY_SHOW_MENU: 'tray:show-menu',
} as const;
