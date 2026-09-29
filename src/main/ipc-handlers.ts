import { ipcMain, app, BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/constants';
import {
  FrameAddPayloadSchema,
  FrameUpdatePayloadSchema,
  FrameRemovePayloadSchema,
  FrameFocusPayloadSchema,
  FrameResetLayoutPayloadSchema,
  ConfigSetPayloadSchema,
  FrameUnsnapPayloadSchema,
  PageRetryPayloadSchema,
  TrayShowMenuPayloadSchema,
} from '../shared/schemas';
import { windowManager } from './window-manager';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';
import { trayManager } from './tray-manager';

function assertSettingsSender(event: IpcMainInvokeEvent): boolean {
  if (windowManager.isSettingsSender(event.sender.id)) {
    return true;
  }
  logService.error('IPC rejected: sender is not the settings window', { channel: event.senderFrame?.url ?? '' });
  return false;
}

function isMainFrameSender(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame === event.sender.mainFrame;
}

function rejectUnless(allow: boolean, channel: string): { success: false; error: string } | null {
  if (allow) return null;
  return { success: false, error: 'This web page is not authorized to perform this action' };
}

function handleValidatedForFrame<T>(channel: string, schema: z.ZodType<T>, getFrameId: (payload: T) => string, run: (payload: T) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    try {
      const validated = schema.parse(payload);
      const frameId = getFrameId(validated);
      const denied = rejectUnless(
        isMainFrameSender(event) &&
          (windowManager.isSettingsSender(event.sender.id) ||
            windowManager.isKnownFrameSender(event.sender.id, frameId)),
        channel
      );
      if (denied) return denied;
      return await run(validated);
    } catch (error) {
      logService.error(`IPC ${channel} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

function handleValidatedKnownSender<T>(channel: string, schema: z.ZodType<T>, run: (payload: T, event: IpcMainInvokeEvent) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    try {
      const validated = schema.parse(payload);
      const denied = rejectUnless(
        isMainFrameSender(event) &&
          (windowManager.isSettingsSender(event.sender.id) ||
            windowManager.isKnownFrameSender(event.sender.id)),
        channel
      );
      if (denied) return denied;
      return await run(validated, event);
    } catch (error) {
      logService.error(`IPC ${channel} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

function handleValidatedForSettings<T>(channel: string, schema: z.ZodType<T>, run: (payload: T) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    const denied = rejectUnless(assertSettingsSender(event) && isMainFrameSender(event), channel);
    if (denied) return denied;
    try {
      const validated = schema.parse(payload);
      return await run(validated);
    } catch (error) {
      logService.error(`IPC ${channel} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

function handleForSettings(channel: string, run: () => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent) => {
    const denied = rejectUnless(assertSettingsSender(event) && isMainFrameSender(event), channel);
    if (denied) return denied;
    try {
      return await run();
    } catch (error) {
      logService.error(`IPC ${channel} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export function registerIPCHandlers(): void {
  handleValidatedForSettings(IPC_CHANNELS.FRAME_ADD, FrameAddPayloadSchema, async (v) => {
    await windowManager.createFrame(v.url, v.name, v.bounds);
    trayManager.updateContextMenu();
    logService.debug('Frame added successfully', { url: v.url, name: v.name });
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.FRAME_UPDATE, FrameUpdatePayloadSchema, async (v) => {
    logService.debug('Frame update received', { id: v.id, config: v.config });
    windowManager.updateFrame(v.id, v.config);
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.FRAME_REMOVE, FrameRemovePayloadSchema, async (v) => {
    await windowManager.removeFrame(v.id);
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.FRAME_FOCUS, FrameFocusPayloadSchema, async (v) => {
    windowManager.focusFrame(v.id);
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.FRAME_RESET_LAYOUT, FrameResetLayoutPayloadSchema, async (v) => {
    windowManager.resetLayout(v.id);
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.CONFIG_SET, ConfigSetPayloadSchema, async (v) => {
    switch (v.key) {
      case 'layoutLocked':
        windowManager.setLayoutLocked(v.value);
        break;
      case 'alwaysOnTop':
        windowManager.setAlwaysOnTop(v.value);
        break;
      case 'frameSize':
        // When frame size changes, reset all frame dimensions
        configService.set('frameSize', v.value);
        windowManager.resetAllFrameDimensions();
        break;
      default:
        configService.set(v.key, v.value as never);
        break;
    }

    trayManager.updateContextMenu();
    return { success: true };
  });

  handleValidatedForFrame(IPC_CHANNELS.FRAME_UNSNAP, FrameUnsnapPayloadSchema, (v) => v.id, async (v) => {
    windowManager.unsnapFrame(v.id, { edge: v.edge, all: v.all });
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleValidatedForFrame(IPC_CHANNELS.PAGE_RETRY, PageRetryPayloadSchema, (v) => v.frameId, async (v) => {
    await windowManager.retryLoadUrl(v.frameId);
    return { success: true };
  });

  handleValidatedKnownSender(IPC_CHANNELS.TRAY_SHOW_MENU, TrayShowMenuPayloadSchema, async (v, event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow) trayManager.showContextMenuAt(sourceWindow, v.x, v.y);
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.FRAME_ENABLE_ALL, async () => {
    windowManager.enableAllFrames();
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.FRAME_DISABLE_ALL, async () => {
    windowManager.disableAllFrames();
    trayManager.updateContextMenu();
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.FRAME_GET_ALL, async () => {
    const frames = configService.getFrames();
    return { success: true, frames };
  });

  handleForSettings(IPC_CHANNELS.CONFIG_GET, async () => {
    const config = configService.get();
    return { success: true, config };
  });

  handleForSettings(IPC_CHANNELS.APP_QUIT, async () => {
    configService.saveSync();
    app.quit();
  });

  logService.info('IPC handlers registered');
}