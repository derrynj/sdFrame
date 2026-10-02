import { app, screen, session } from 'electron';
import { windowManager } from './window-manager';
import { trayManager } from './tray-manager';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';
import { snapManager } from './snap-manager';
import { registerIPCHandlers } from './ipc-handlers';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager.openSettingsWindow();
  });

  app.whenReady().then(async () => {
    logService.initialize();
    configService.initialize();
    windowManager.loadExistingColors();
    logService.info('Application starting');

    windowManager.initializeNotFoundAutoReload();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, _permission, requestingOrigin) => {
      return requestingOrigin === 'file://';
    });

    registerIPCHandlers();
    trayManager.initialize();

    screen.on('display-removed', () => {
      logService.info('Display removed, adjusting windows');
      snapManager.handleDisplayChange();
    });

    screen.on('display-metrics-changed', () => {
      logService.info('Display metrics changed, adjusting windows');
      snapManager.handleDisplayChange();
    });

    const isFirstRun = configService.isFirstRun();
    const frames = configService.getFrames();
    const hasEnabledFrames = frames.some(frame => frame.enabled);

    if (isFirstRun) {
      logService.info('First run detected, opening settings');
      windowManager.openSettingsWindow();
    } else if (!hasEnabledFrames) {
      logService.info('No enabled frames detected, opening settings');
      windowManager.openSettingsWindow();
    } else {
      logService.info('Restoring frames from config');
      await windowManager.restoreFrames();
    }
  });

  app.on('window-all-closed', () => {
    // Keep app running in tray even when all windows are closed
  });

  let isCleaningUp = false;
  app.on('before-quit', (event) => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    event.preventDefault();

    void (async () => {
      try {
        logService.info('Application quitting');
        windowManager.prepareQuit();
        configService.saveSync();
        trayManager.destroy();
        await logService.close();
      } catch (error) {
        logService.error('Error during quit cleanup', {
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        app.exit(0);
      }
    })();
  });

  app.on('activate', () => {
    windowManager.openSettingsWindow();
  });
}
