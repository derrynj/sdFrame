import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type {
  FrameAddPayload,
  FrameUpdatePayload,
  FrameRemovePayload,
  FrameFocusPayload,
  FrameResetLayoutPayload,
  FrameGroupHeightPayload,
  FrameUnsnapPayload,
  ConfigSetPayload,
} from '../shared/types';

const fullApi = {
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

    resetDimensions: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_RESET_DIMENSIONS),

    setGroupHeight: (payload: FrameGroupHeightPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_SET_GROUP_HEIGHT, payload),

    getAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_GET_ALL),

    unsnap: (payload: FrameUnsnapPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_UNSNAP, payload),

    enableAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_ENABLE_ALL),

    disableAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FRAME_DISABLE_ALL),
  },

  tray: {
    showMenu: (x: number, y: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRAY_SHOW_MENU, { x, y }),
  },

  config: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),

    set: (payload: ConfigSetPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, payload),

    import: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_IMPORT),

    applyImport: (payload: {
      config: unknown;
      selectedFrameIds: string[];
      includeSettings: boolean;
      mode: 'add' | 'replace';
    }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_IMPORT_APPLY, payload),

    export: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_EXPORT),
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

const restrictedApi = {
  frame: {
    unsnap: fullApi.frame.unsnap,
  },
  tray: fullApi.tray,
  page: fullApi.page,
  on: fullApi.on,
  getQueryParams: fullApi.getQueryParams,
};

const isSettingsWindow = process.argv.includes('--sdframe-settings');
contextBridge.exposeInMainWorld('sdFrame', isSettingsWindow ? fullApi : restrictedApi);

type SdFrameApi = typeof fullApi;
type SdFrameRestrictedApi = typeof restrictedApi;

declare global {
  interface Window {
    sdFrame: SdFrameRestrictedApi | SdFrameApi;
  }
}