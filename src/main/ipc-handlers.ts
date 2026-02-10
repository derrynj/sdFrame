import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { FrameUnsnapPayload } from '../shared/types';
import {
  FrameAddPayloadSchema,
  FrameUpdatePayloadSchema,
  FrameRemovePayloadSchema,
  FrameFocusPayloadSchema,
  FrameResetLayoutPayloadSchema,
  ConfigSetPayloadSchema,
  FrameUnsnapPayloadSchema,
} from '../shared/schemas';
import { windowManager } from './window-manager';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';
import { trayManager } from './tray-manager';
import { app } from 'electron';

export function registerIPCHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FRAME_ADD, async (_event, payload: unknown) => {
    try {
      const validated = FrameAddPayloadSchema.parse(payload);
      await windowManager.createFrame(validated.url, validated.bounds);
      trayManager.updateContextMenu();
      logService.debug('Frame added successfully', { url: validated.url });
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:add failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_UPDATE, async (_event, payload: unknown) => {
    try {
      const validated = FrameUpdatePayloadSchema.parse(payload);
      windowManager.updateFrame(validated.id, validated.config);
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:update failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_REMOVE, async (_event, payload: unknown) => {
    try {
      const validated = FrameRemovePayloadSchema.parse(payload);
      await windowManager.removeFrame(validated.id);
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:remove failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_ENABLE_ALL, async () => {
    try {
      windowManager.enableAllFrames();
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:enable-all failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_DISABLE_ALL, async () => {
    try {
      windowManager.disableAllFrames();
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:disable-all failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_FOCUS, async (_event, payload: unknown) => {
    try {
      const validated = FrameFocusPayloadSchema.parse(payload);
      windowManager.focusFrame(validated.id);
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:focus failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_RESET_LAYOUT, async (_event, payload: unknown) => {
    try {
      const validated = FrameResetLayoutPayloadSchema.parse(payload);
      windowManager.resetLayout(validated.id);
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:reset-layout failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_UNSNAP, async (_event, payload: unknown) => {
    try {
      const validated = FrameUnsnapPayloadSchema.parse(payload) as FrameUnsnapPayload;
      windowManager.unsnapFrame(validated.id, {
        edge: validated.edge,
        all: validated.all,
      });
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC frame:unsnap failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FRAME_GET_ALL, async () => {
    try {
      const frames = configService.getFrames();
      return { success: true, frames };
    } catch (error) {
      logService.error('IPC frame:get-all failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => {
    try {
      const config = configService.get();
      return { success: true, config };
    } catch (error) {
      logService.error('IPC config:get failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, payload: unknown) => {
    try {
      const validated = ConfigSetPayloadSchema.parse(payload);
      
      if (validated.key === 'layoutLocked') {
        windowManager.setLayoutLocked(validated.value as boolean);
      } else if (validated.key === 'alwaysOnTop') {
        windowManager.setAlwaysOnTop(validated.value as boolean);
      } else {
        configService.set(validated.key, validated.value as never);
      }
      
      trayManager.updateContextMenu();
      return { success: true };
    } catch (error) {
      logService.error('IPC config:set failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_RETRY, async (_event, payload: { frameId: string }) => {
    try {
      await windowManager.retryLoadUrl(payload.frameId);
      return { success: true };
    } catch (error) {
      logService.error('IPC page:retry failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_QUIT, async () => {
    configService.saveSync();
    app.quit();
  });

  logService.info('IPC handlers registered');
}
