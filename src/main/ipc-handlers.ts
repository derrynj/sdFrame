import { ipcMain, app, BrowserWindow, dialog, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/constants';
import {
  FrameAddPayloadSchema,
  FrameUpdatePayloadSchema,
  FrameRemovePayloadSchema,
  FrameFocusPayloadSchema,
  FrameResetLayoutPayloadSchema,
  FrameGroupHeightPayloadSchema,
  ConfigSetPayloadSchema,
  FrameUnsnapPayloadSchema,
  PageRetryPayloadSchema,
  TrayShowMenuPayloadSchema,
} from '../shared/schemas';
import { windowManager } from './window-manager';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';
import { trayManager } from './tray-manager';

const ConfigImportApplySchema = z.object({
  config: z.unknown(),
  selectedFrameIds: z.array(z.string().uuid()).refine(ids => new Set(ids).size === ids.length),
  includeSettings: z.boolean(),
  mode: z.enum(['add', 'replace']),
});

function validateConfigForImport(config: unknown) {
  try {
    return configService.validateImport(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const location = issue.path.length > 0 ? issue.path.join('.') : 'config';
      throw new Error(`Invalid sdFrame config at ${location}: ${issue.message}`);
    }
    throw error;
  }
}

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

  handleForSettings(IPC_CHANNELS.FRAME_RESET_DIMENSIONS, async () => {
    windowManager.resetAllFrameDimensions();
    return { success: true };
  });

  handleValidatedForSettings(IPC_CHANNELS.FRAME_SET_GROUP_HEIGHT, FrameGroupHeightPayloadSchema, async (v) => {
    const frameCount = windowManager.setGroupHeight(v.id, v.height);
    return { success: true, frameCount };
  });

  handleValidatedForSettings(IPC_CHANNELS.CONFIG_SET, ConfigSetPayloadSchema, async (v) => {
    switch (v.key) {
      case 'layoutLocked':
        windowManager.setLayoutLocked(v.value);
        break;
      case 'alwaysOnTop':
        windowManager.setAlwaysOnTop(v.value);
        break;
      case 'autoReloadOn404':
      case 'autoReload404IntervalSeconds':
        configService.set(v.key, v.value);
        windowManager.updateNotFoundAutoReloadSettings();
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

  ipcMain.handle(IPC_CHANNELS.FRAME_MINIMIZE, async (event: IpcMainInvokeEvent) => {
    const denied = rejectUnless(
      isMainFrameSender(event) && windowManager.isKnownFrameSender(event.sender.id),
      IPC_CHANNELS.FRAME_MINIMIZE
    );
    if (denied) return denied;

    try {
      const frameId = windowManager.getFrameIdByWebContentsId(event.sender.id);
      if (!frameId) throw new Error('Frame window not found');
      windowManager.minimizeFrame(frameId);
      return { success: true };
    } catch (error) {
      logService.error(`IPC ${IPC_CHANNELS.FRAME_MINIMIZE} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_DISABLE, async (event: IpcMainInvokeEvent) => {
    const denied = rejectUnless(
      isMainFrameSender(event) && windowManager.isKnownFrameSender(event.sender.id),
      IPC_CHANNELS.FRAME_DISABLE
    );
    if (denied) return denied;

    try {
      const frameId = windowManager.getFrameIdByWebContentsId(event.sender.id);
      if (!frameId) throw new Error('Frame window not found');
      windowManager.disableFrame(frameId);
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error(`IPC ${IPC_CHANNELS.FRAME_DISABLE} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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

  handleForSettings(IPC_CHANNELS.CONFIG_IMPORT, async () => {
    const settingsWindow = BrowserWindow.getAllWindows().find(window =>
      window.webContents.getURL().includes('settings/index.html')
    );
    const options: OpenDialogOptions = {
      title: 'Import sdFrame Config',
      properties: ['openFile'],
      filters: [{ name: 'JSON Config', extensions: ['json'] }],
    };
    const result = settingsWindow
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const fileContents = await fs.readFile(result.filePaths[0], 'utf-8');
    let importedConfig: unknown;
    try {
      importedConfig = JSON.parse(fileContents);
    } catch {
      throw new Error('This file is not valid JSON. Choose an sdFrame config file.');
    }
    const config = validateConfigForImport(importedConfig);
    return {
      success: true,
      config,
      fileName: path.basename(result.filePaths[0]),
    };
  });

  handleValidatedForSettings(IPC_CHANNELS.CONFIG_IMPORT_APPLY, ConfigImportApplySchema, async payload => {
    const imported = validateConfigForImport(payload.config);
    const selectedIds = new Set(payload.selectedFrameIds);
    const selectedFrames = imported.frames.filter(frame => selectedIds.has(frame.id));
    if (selectedFrames.length !== selectedIds.size) {
      throw new Error('The import selection contains a frame that is not in the selected file.');
    }

    const current = configService.get();
    const importedFrameIds = new Set(selectedFrames.map(frame => frame.id));
    const idMap = new Map<string, string>();
    if (payload.mode === 'add') {
      selectedFrames.forEach(frame => idMap.set(frame.id, crypto.randomUUID()));
    } else {
      selectedFrames.forEach(frame => idMap.set(frame.id, frame.id));
    }
    const frames = selectedFrames.map(frame => {
      const id = idMap.get(frame.id);
      if (!id) {
        throw new Error('Could not prepare the selected frames for import.');
      }
      return {
        ...frame,
        id,
        snappedTo: frame.snappedTo.flatMap(target => {
          const mappedId = importedFrameIds.has(target.frameId)
            ? idMap.get(target.frameId)
            : undefined;
          return mappedId ? [{ ...target, frameId: mappedId }] : [];
        }),
      };
    });

    const backupPath = payload.mode === 'replace' && current.frames.length > 0
      ? configService.backupCurrent()
      : undefined;
    const settings = payload.includeSettings ? imported : current;
    const nextConfig = {
      ...settings,
      version: current.version,
      frames: payload.mode === 'replace' ? frames : [...current.frames, ...frames],
    };
    const config = payload.mode === 'add'
      ? await windowManager.addImportedFrames(nextConfig, frames.map(frame => frame.id))
      : await windowManager.importConfig(nextConfig);
    trayManager.updateContextMenu();
    return {
      success: true,
      config,
      importedFrameCount: frames.length,
      mode: payload.mode,
      includedSettings: payload.includeSettings,
      backupPath,
    };
  });

  handleForSettings(IPC_CHANNELS.CONFIG_EXPORT, async () => {
    const settingsWindow = BrowserWindow.getAllWindows().find(window =>
      window.webContents.getURL().includes('settings/index.html')
    );
    const options: SaveDialogOptions = {
      title: 'Export sdFrame Config',
      defaultPath: 'sdFrame-config.json',
      filters: [{ name: 'JSON Config', extensions: ['json'] }],
    };
    const result = settingsWindow
      ? await dialog.showSaveDialog(settingsWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { success: true, canceled: true };
    }

    await fs.writeFile(result.filePath, JSON.stringify(configService.get(), null, 2), 'utf-8');
    return { success: true, fileName: path.basename(result.filePath) };
  });

  handleForSettings(IPC_CHANNELS.SETTINGS_MINIMIZE, async () => {
    windowManager.minimizeSettingsWindow();
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.SETTINGS_HIDE, async () => {
    windowManager.hideSettingsWindow();
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.APP_GET_VERSION, async () => ({
    success: true,
    version: app.getVersion(),
  }));

  handleForSettings(IPC_CHANNELS.DEBUG_VIEW_LOG, async () => {
    const error = await shell.openPath(logService.getLogPath());
    if (error) {
      throw new Error(`Could not open the logfile: ${error}`);
    }
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.DEBUG_OPEN_DEVTOOLS, async () => {
    const settingsWindow = BrowserWindow.getAllWindows().find(window =>
      window.webContents.getURL().includes('settings/index.html')
    );
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      throw new Error('The Settings window is not available.');
    }
    settingsWindow.webContents.openDevTools({ mode: 'detach' });
    return { success: true };
  });

  handleForSettings(IPC_CHANNELS.APP_QUIT, async () => {
    configService.saveSync();
    app.quit();
  });

  logService.info('IPC handlers registered');
}