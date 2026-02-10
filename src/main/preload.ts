import { contextBridge, ipcRenderer } from 'electron';

// NOTE: IPC_CHANNELS is duplicated here from src/shared/constants.ts
// This is necessary because the preload script runs in a sandboxed context
// and cannot import external modules. See docs/preload-script-duplication.md
// for details on why this duplication exists and how to maintain it.
const IPC_CHANNELS = {
  FRAME_ADD: 'frame:add',
  FRAME_UPDATE: 'frame:update',
  FRAME_REMOVE: 'frame:remove',
  FRAME_FOCUS: 'frame:focus',
  FRAME_RESET_LAYOUT: 'frame:reset-layout',
  FRAME_GET_ALL: 'frame:get-all',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
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

interface FrameAddPayload {
  url: string;
  bounds?: { x?: number; y?: number; width?: number; height?: number };
}

interface FrameUpdatePayload {
  id: string;
  config: Record<string, unknown>;
}

interface FrameRemovePayload {
  id: string;
}

interface FrameFocusPayload {
  id: string;
}

interface FrameResetLayoutPayload {
  id?: string;
}

interface FrameUnsnapPayload {
  id: string;
  edge?: 'left' | 'right' | 'top' | 'bottom' | 'align-top' | 'align-bottom' | 'align-left' | 'align-right';
  all?: boolean;
}

interface ConfigSetPayload {
  key: string;
  value: unknown;
}

const api = {
  frame: {
    add: (payload: FrameAddPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_ADD, payload),
    
    update: (payload: FrameUpdatePayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_UPDATE, payload),
    
    remove: (payload: FrameRemovePayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_REMOVE, payload),
    
    focus: (payload: FrameFocusPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_FOCUS, payload),
    
    resetLayout: (payload: FrameResetLayoutPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_RESET_LAYOUT, payload),
    
    getAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_GET_ALL),

    unsnap: (payload: FrameUnsnapPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_UNSNAP, payload),

    enableAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_ENABLE_ALL),

    disableAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_DISABLE_ALL),
  },

  ipc: {
    invoke: ipcRenderer.invoke,
  },

  channels: IPC_CHANNELS,

  config: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    
    set: (payload: ConfigSetPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, payload),
  },

  page: {
    retry: (frameId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PAGE_RETRY, { frameId }),
  },

  app: {
    quit: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT),
  },

  on: {
    showBorder: (callback: (data: { color: string; width: number }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.FRAME_SHOW_BORDER, (_event, data) => callback(data));
    },

    hideBorder: (callback: () => void) => {
      ipcRenderer.on(IPC_CHANNELS.FRAME_HIDE_BORDER, () => callback());
    },

    snapStatusChanged: (callback: (data: { isSnapped: boolean; snappedToColor?: string }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.FRAME_SNAP_STATUS_CHANGED, (_event, data) => callback(data));
    },
  },

  getQueryParams: (): Record<string, string> => {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  },
};

contextBridge.exposeInMainWorld('sdFrame', api);

declare global {
  interface Window {
    sdFrame: typeof api;
  }
}
