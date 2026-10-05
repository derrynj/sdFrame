import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from '../shared/constants';
import { logService } from '../services/log-service';

export interface UpdateStatus {
  state: 'unsupported' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'installing';
  message: string;
  version?: string;
  percent?: number;
}

class UpdateService {
  private status: UpdateStatus = {
    state: 'unsupported',
    message: 'Automatic updates are available in installed Windows builds.',
  };

  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.isSupported()) {
      logService.info('Automatic updates are disabled for this build');
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.setStatus({ state: 'checking', message: 'Checking for updates…' });
    });
    autoUpdater.on('update-available', (info) => {
      this.setStatus({
        state: 'available',
        message: `Version ${info.version} is available. Downloading…`,
        version: info.version,
      });
    });
    autoUpdater.on('update-not-available', () => {
      this.setStatus({
        state: 'up-to-date',
        message: `You’re up to date (v${app.getVersion()}).`,
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      this.setStatus({
        state: 'downloading',
        message: `Downloading update… ${percent}%`,
        percent,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({
        state: 'downloaded',
        message: `Version ${info.version} is ready to install.`,
        version: info.version,
      });
    });
    autoUpdater.on('error', (error) => {
      logService.error('Automatic update failed', { error: error.message });
      this.setStatus({
        state: 'error',
        message: `Update check failed: ${error.message}`,
      });
    });

    setTimeout(() => {
      void this.checkForUpdates();
    }, 5000);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!this.isSupported()) return this.status;
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.status;
    }

    this.setStatus({ state: 'checking', message: 'Checking for updates…' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logService.error('Could not check for application updates', { error: message });
      this.setStatus({ state: 'error', message: `Update check failed: ${message}` });
    }
    return this.status;
  }

  installUpdate(): void {
    if (this.status.state !== 'downloaded') {
      throw new Error('There is no downloaded update ready to install.');
    }

    this.setStatus({ ...this.status, state: 'installing', message: 'Restarting to install the update…' });
    autoUpdater.quitAndInstall(false, true);
  }

  isInstallingUpdate(): boolean {
    return this.status.state === 'installing';
  }

  private isSupported(): boolean {
    return app.isPackaged &&
      process.platform === 'win32' &&
      !process.env.PORTABLE_EXECUTABLE_DIR;
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.webContents.getURL().includes('settings/index.html')) {
        window.webContents.send(IPC_CHANNELS.APP_UPDATE_STATUS, status);
      }
    }
  }
}

export const updateService = new UpdateService();
