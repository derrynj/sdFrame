import { app, screen } from 'electron';
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
    logService.info('Application starting');
    
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

  app.on('before-quit', async () => {
    logService.info('Application quitting');
    windowManager.prepareQuit();
    configService.saveSync();
    trayManager.destroy();
    await logService.close();
  });

  app.on('activate', () => {
    windowManager.openSettingsWindow();
  });
}
