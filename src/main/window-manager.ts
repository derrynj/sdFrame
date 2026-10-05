import { BrowserWindow, screen, shell, dialog, session } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MessageBoxOptions } from 'electron';
import type { Bounds, FrameConfig, SnapEdge } from '../shared/types';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';
import { snapManager } from './snap-manager';
import {
  FRAME_COLORS,
  FOCUS_BORDER_WIDTH,
  IPC_CHANNELS,
} from '../shared/constants';

function isAbortedNavigationError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('ERR_ABORTED');
}

export class WindowManager {
  private frameWindows: Map<string, BrowserWindow> = new Map();
  private settingsWindow: BrowserWindow | null = null;
  private usedColors: Set<string> = new Set();
  private isQuitting = false;
  private intentionalClosing = new Set<string>();
  private reloadCounts = new Map<string, number>();
  private autoReloadTimers = new Map<string, NodeJS.Timeout>();
  private autoReloadCountdownIntervals = new Map<string, NodeJS.Timeout>();
  private autoReloadDeadlines = new Map<string, number>();
  private autoReloadFailures = new Map<string, string>();
  private notFoundMonitorInitialized = false;

  constructor() {
    this.setupSnapStatusCallback();
  }

  initializeNotFoundAutoReload(): void {
    if (this.notFoundMonitorInitialized) return;
    this.notFoundMonitorInitialized = true;

    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
          const frameId = this.getFrameIdByWebContentsId(details.webContentsId);
          if (frameId) {
            if (details.statusCode === 404) {
              this.autoReloadFailures.set(frameId, 'HTTP 404');
              this.scheduleAutoReload(frameId);
            } else {
              this.autoReloadFailures.delete(frameId);
              this.clearNotFoundReload(frameId);
            }
          }
        }
        callback({});
      }
    );
  }

  private scheduleAutoReload(frameId: string): void {
    if (this.autoReloadTimers.has(frameId)) return;
    const config = configService.get();
    if (!config.autoReloadOn404) return;
    const delayMs = config.autoReload404IntervalSeconds * 1000;
    this.autoReloadDeadlines.set(frameId, Date.now() + delayMs);
    const failure = this.autoReloadFailures.get(frameId) ?? 'page load failure';

    logService.info('Frame retry scheduled after load failure', {
      frameId,
      failure,
      delayMs,
    });
    this.updateNotFoundReloadCountdown(frameId);
    this.autoReloadCountdownIntervals.set(
      frameId,
      setInterval(() => this.updateNotFoundReloadCountdown(frameId), 1000)
    );

    const timer = setTimeout(() => {
      this.autoReloadTimers.delete(frameId);
      this.clearNotFoundReloadCountdown(frameId);
      this.autoReloadFailures.delete(frameId);
      const window = this.frameWindows.get(frameId);
      const frameConfig = configService.getFrame(frameId);
      if (!window || window.isDestroyed() || !frameConfig?.enabled) return;

      logService.info('Retrying frame after load failure', { frameId, failure, url: frameConfig.url });
      void (async () => {
        await this.loadLoadingPage(window, frameConfig);
        await window.loadURL(frameConfig.url);
      })().catch(error => {
        logService.error('Automatic retry failed', {
          frameId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
    this.autoReloadTimers.set(frameId, timer);
  }

  updateNotFoundAutoReloadSettings(): void {
    for (const frameId of this.autoReloadTimers.keys()) {
      this.clearNotFoundReload(frameId);
    }
    if (!configService.get().autoReloadOn404) return;
    for (const frameId of this.autoReloadFailures.keys()) {
      this.scheduleAutoReload(frameId);
    }
  }

  private clearNotFoundReload(frameId: string): void {
    const timer = this.autoReloadTimers.get(frameId);
    if (timer) {
      clearTimeout(timer);
      this.autoReloadTimers.delete(frameId);
    }
    this.clearNotFoundReloadCountdown(frameId);
  }

  private clearNotFoundReloadCountdown(frameId: string): void {
    const interval = this.autoReloadCountdownIntervals.get(frameId);
    if (interval) {
      clearInterval(interval);
      this.autoReloadCountdownIntervals.delete(frameId);
    }
    const hadDeadline = this.autoReloadDeadlines.delete(frameId);
    if (!hadDeadline) return;

    const window = this.frameWindows.get(frameId);
    if (!window || window.isDestroyed()) return;
    window.webContents.executeJavaScript(`
      (function() {
        ['sdframe-reload-countdown', 'retry-countdown'].forEach(function(id) {
          const status = document.getElementById(id);
          if (status) {
            status.hidden = true;
            status.textContent = '';
          }
        });
      })();
    `).catch(error => {
      logService.debug('Failed to clear retry countdown', {
        frameId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private updateNotFoundReloadCountdown(frameId: string): void {
    const deadline = this.autoReloadDeadlines.get(frameId);
    if (deadline === undefined) return;

    const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const window = this.frameWindows.get(frameId);
    if (!window || window.isDestroyed()) return;
    window.webContents.executeJavaScript(`
      (function() {
        const message = 'Retrying in ${remainingSeconds}s';
        ['sdframe-reload-countdown', 'retry-countdown'].forEach(function(id) {
          const status = document.getElementById(id);
          if (status) {
            status.textContent = message;
            status.hidden = false;
          }
        });
      })();
    `).catch(error => {
      logService.debug('Failed to update retry countdown', {
        frameId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private setupSnapStatusCallback(): void {
    snapManager.onSnapStatusChange((frameId, isSnapped, snappedToColor) => {
      const window = this.frameWindows.get(frameId);
      if (!window) return;

      // Send IPC message to renderer to update snap status
      window.webContents.send(IPC_CHANNELS.FRAME_SNAP_STATUS_CHANGED, {
        isSnapped,
        snappedToColor,
      });

      // Update frame color to match snapped window (visual only, not config)
      if (isSnapped && snappedToColor) {
        this.updateFrameColor(frameId, snappedToColor);
      } else if (!isSnapped) {
        // Revert to original color from config when unsnapping
        const config = configService.getFrame(frameId);
        if (config) {
          this.updateFrameColor(frameId, config.color);
        }
      }
    });
  }

  private updateFrameColor(frameId: string, newColor: string): void {
    // Update only the visual appearance (CSS), not the config
    const window = this.frameWindows.get(frameId);
    if (window) {
      const css = `
        #sdframe-drag-handle {
          background: linear-gradient(to bottom, ${newColor}dd, ${newColor}88) !important;
        }
      `;
      window.webContents.insertCSS(css).catch(() => {});
    }

    logService.debug('Frame color updated visually', { frameId, newColor });
  }

  loadExistingColors(): void {
    const frames = configService.getFrames();
    frames.forEach(frame => {
      this.usedColors.add(frame.color);
    });
  }

  private getNextColor(): string {
    for (const color of FRAME_COLORS) {
      if (!this.usedColors.has(color)) {
        this.usedColors.add(color);
        return color;
      }
    }
    const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    this.usedColors.add(randomColor);
    return randomColor;
  }

  private releaseColor(color: string): void {
    this.usedColors.delete(color);
  }

  private getDefaultBounds(): Bounds {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const config = configService.get();
    const frameWidth = config.frameSize.width || Math.floor(width / 4);
    const frameHeight = config.frameSize.height || Math.floor(height / 4) + 24;
    return {
      x: Math.floor((width - frameWidth) / 2),
      y: Math.floor((height - frameHeight) / 2),
      width: frameWidth,
      height: frameHeight,
    };
  }

  private validateBounds(bounds: Bounds): Bounds {
    const display = screen.getDisplayMatching(bounds);
    const wa = display.workArea;
    let { x, y, width, height } = bounds;
    width = Math.min(Math.max(width, 100), wa.width);
    height = Math.min(Math.max(height, 100), wa.height);
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - width);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - height);
    return { x, y, width, height };
  }

  async createFrame(url: string, name?: string, partialBounds?: Partial<Bounds>): Promise<void> {
    const id = crypto.randomUUID();
    logService.debug('Creating frame', { id, url, name });
    
    const color = this.getNextColor();
    const defaultBounds = this.getDefaultBounds();
    const bounds = this.validateBounds({
      ...defaultBounds,
      ...partialBounds,
    });

    const frameConfig: FrameConfig = {
      id,
      name,
      url,
      enabled: true,
      bounds,
      color,
      snappedTo: [],
    };

    configService.addFrame(frameConfig);
    logService.debug('Frame config added to service', { id });
    
    await this.openFrameWindow(frameConfig);

    logService.info('Frame created', { id, url, name });
  }

  private createFrameWindow(config: FrameConfig): BrowserWindow {
    const appConfig = configService.get();
    const window = new BrowserWindow({
      ...config.bounds,
      icon: path.join(
        __dirname,
        '..',
        '..',
        'assets',
        process.platform === 'win32' ? 'icon.ico' : 'icon.png'
      ),
      frame: false,
      resizable: !appConfig.layoutLocked,
      movable: !appConfig.layoutLocked,
      alwaysOnTop: appConfig.alwaysOnTop,
      skipTaskbar: false,
      show: false, // Don't show until positioned
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    window.on('focus', () => {
      if (
        this.settingsWindow &&
        !this.settingsWindow.isDestroyed() &&
        this.settingsWindow.isVisible() &&
        !this.settingsWindow.isMinimized()
      ) {
        setImmediate(() => this.bringSettingsToFront());
      }
    });

    window.webContents.on('will-navigate', (event, navigationUrl) => {
      try {
        const configuredOrigin = new URL(config.url).origin;
        const targetOrigin = new URL(navigationUrl).origin;
        if (targetOrigin !== configuredOrigin) {
          event.preventDefault();
          logService.warn('Blocked navigation to different origin', {
            from: configuredOrigin,
            to: targetOrigin
          });
        }
      } catch {
        event.preventDefault();
      }
    });

    window.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (!isMainFrame) return;
      this.injectDragHandle(window, config);
    });

    window.webContents.on('dom-ready', () => {
      this.injectDragHandle(window, config);
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      } else {
        logService.warn('Blocked opening non-http(s) URL externally', {
          frameId: config.id,
          url
        });
      }
      return { action: 'deny' };
    });

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorDescription === 'ERR_ABORTED') return;
      logService.error('Page load failed', {
        frameId: config.id,
        errorCode,
        errorDescription
      });
      if (errorDescription === 'ERR_CONNECTION_TIMED_OUT') {
        this.autoReloadFailures.set(config.id, 'connection timeout');
        this.scheduleAutoReload(config.id);
      }
      this.loadErrorPage(window, config.id, config.url, errorDescription);
    });

    window.webContents.on('render-process-gone', (_event, details) => {
      logService.error('Renderer process gone', {
        frameId: config.id,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      if (details.reason === 'clean-exit') return;

      const count = (this.reloadCounts.get(config.id) ?? 0) + 1;
      this.reloadCounts.set(config.id, count);

      if (details.reason !== 'oom' && count <= 2) {
        window.webContents.reload();
      } else {
        this.reloadCounts.delete(config.id);
        this.loadErrorPage(window, config.id, config.url, `Renderer crashed (${details.reason})`);
      }
    });

    window.webContents.on('did-finish-load', () => {
      this.reloadCounts.delete(config.id);
    });

    window.on('close', (event) => {
      if (this.isQuitting || this.intentionalClosing.has(config.id)) {
        // Allow closing during app shutdown or intentional removal
        return;
      }
      event.preventDefault();
      logService.info('Window close prevented - use Settings to disable frame', { id: config.id });
    });

    window.on('focus', () => {
      window.webContents.send(IPC_CHANNELS.FRAME_SHOW_BORDER, {
        color: config.color,
        width: FOCUS_BORDER_WIDTH,
      });
    });

    window.on('restore', () => {
      this.restoreFrameGroup(config.id);
    });

    window.on('blur', () => {
      window.webContents.send(IPC_CHANNELS.FRAME_HIDE_BORDER);
    });

    window.on('closed', () => {
      this.frameWindows.delete(config.id);
      this.intentionalClosing.delete(config.id);
      this.autoReloadFailures.delete(config.id);
      this.clearNotFoundReload(config.id);
      snapManager.unregisterWindow(config.id);
    });

    this.frameWindows.set(config.id, window);
    snapManager.registerWindow(config.id, window);

    return window;
  }

  private async openFrameWindow(config: FrameConfig): Promise<BrowserWindow> {
    const window = this.createFrameWindow(config);
    await this.loadLoadingPage(window, config);
    window.show();

    try {
      await window.loadURL(config.url);
    } catch (error) {
      if (!isAbortedNavigationError(error)) {
        logService.error('Failed to load URL', {
          frameId: config.id,
          url: config.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Ensure settings window stays on top after showing a new frame
    this.bringSettingsToFront();

    return window;
  }

  private async loadLoadingPage(window: BrowserWindow, config: FrameConfig): Promise<void> {
    const loadingPagePath = path.join(__dirname, '..', 'renderer', 'loading', 'index.html');
    try {
      await window.loadFile(loadingPagePath, {
        query: {
          frameId: config.id,
          name: config.name ?? config.id.slice(0, 8),
          color: config.color,
          snapped: String(config.snappedTo.length > 0),
        },
      });
    } catch (error) {
      logService.warn('Failed to load loading page', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private loadErrorPage(window: BrowserWindow, frameId: string, url: string, error: string): void {
    const errorPagePath = path.join(__dirname, '..', 'renderer', 'error', 'index.html');
    window.loadFile(errorPagePath, {
      query: { frameId, url, error },
    });
  }

  private injectDragHandle(window: BrowserWindow, config: FrameConfig): void {
    const css = `
      ::-webkit-scrollbar {
        display: none;
      }
      html, body {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      #sdframe-drag-handle {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 24px;
        background: linear-gradient(to bottom, ${config.color}dd, ${config.color}88);
        -webkit-app-region: drag;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 11px;
        color: #fff;
        text-shadow: 0 1px 1px rgba(0,0,0,0.3);
        opacity: 0.9;
        transition: opacity 0.2s;
      }
      #sdframe-drag-handle:hover {
        opacity: 1;
      }
      #sdframe-drag-handle .frame-id {
        opacity: 0.8;
        font-weight: 500;
      }
      #sdframe-reload-countdown {
        position: fixed;
        z-index: 999998;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        padding: 10px 16px;
        border: 1px solid rgba(78, 205, 196, 0.35);
        border-radius: 6px;
        background: rgba(26, 26, 46, 0.92);
        color: #8ce8e1;
        font: 600 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        white-space: nowrap;
        pointer-events: none;
        -webkit-app-region: no-drag;
      }
      #sdframe-drag-handle .unsnap-btn {
        -webkit-app-region: no-drag;
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 10px;
        cursor: pointer;
        opacity: 0.8;
        display: none; /* Hidden by default, shown when snapped */
      }
      #sdframe-drag-handle .unsnap-btn:hover {
        background: rgba(255,255,255,0.3);
        opacity: 1;
      }
      #sdframe-drag-handle .unsnap-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      #sdframe-drag-handle .menu-btn {
        -webkit-app-region: no-drag;
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        opacity: 0.8;
        transition: opacity 0.2s, background 0.2s;
      }
      #sdframe-drag-handle .menu-btn:hover {
        background: rgba(255,255,255,0.3);
        opacity: 1;
      }
      #sdframe-drag-handle .minimize-btn {
        -webkit-app-region: no-drag;
        width: 22px;
        height: 20px;
        padding: 0;
        background: rgba(255,255,255,0.2);
        border: none;
        border-radius: 3px;
        color: #fff;
        font-size: 16px;
        line-height: 16px;
        cursor: pointer;
        opacity: 0.8;
      }
      #sdframe-drag-handle .minimize-btn:hover {
        background: rgba(255,255,255,0.3);
        opacity: 1;
      }
      #sdframe-drag-handle .disable-btn {
        -webkit-app-region: no-drag;
        width: 22px;
        height: 20px;
        padding: 0;
        background: rgba(255,255,255,0.2);
        border: none;
        border-radius: 3px;
        color: #fff;
        font-size: 16px;
        line-height: 16px;
        cursor: pointer;
        opacity: 0.8;
      }
      #sdframe-drag-handle .disable-btn:hover {
        background: #e55353;
        opacity: 1;
      }
      #sdframe-drag-handle .frame-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        -webkit-app-region: no-drag;
      }
    `;

    const isInitiallySnapped = config.snappedTo && config.snappedTo.length > 0;
    const retryDeadline = this.autoReloadDeadlines.get(config.id);
    const retrySeconds = retryDeadline === undefined
      ? null
      : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

    const js = `
      (function() {
        const titleBarId = 'sdframe-drag-handle';
        if (document.getElementById(titleBarId) || !document.body) return false;
        const handle = document.createElement('div');
        handle.id = titleBarId;
        const frameIdSpan = document.createElement('span');
        frameIdSpan.className = 'frame-id';
        frameIdSpan.textContent = ${JSON.stringify(config.name ?? config.id.slice(0, 8))};
        let reloadCountdown = null;
        if (!document.getElementById('retry-countdown')) {
          reloadCountdown = document.createElement('div');
          reloadCountdown.id = 'sdframe-reload-countdown';
          reloadCountdown.setAttribute('role', 'status');
          reloadCountdown.setAttribute('aria-live', 'polite');
          reloadCountdown.hidden = ${retrySeconds === null};
          reloadCountdown.textContent = ${JSON.stringify(retrySeconds === null ? '' : `Retrying in ${retrySeconds}s`)};
          document.body.appendChild(reloadCountdown);
        }
        const unsnapBtn = document.createElement('button');
        unsnapBtn.className = 'unsnap-btn';
        unsnapBtn.id = 'sdframe-unsnap';
        unsnapBtn.textContent = 'Unsnap';
        const menuBtn = document.createElement('button');
        menuBtn.className = 'menu-btn';
        menuBtn.id = 'sdframe-menu-btn';
        menuBtn.textContent = '⋮';
        menuBtn.title = 'Click for menu';
        const minimizeBtn = document.createElement('button');
        minimizeBtn.className = 'minimize-btn';
        minimizeBtn.textContent = '−';
        minimizeBtn.title = 'Minimize frame';
        minimizeBtn.setAttribute('aria-label', 'Minimize frame');
        const disableBtn = document.createElement('button');
        disableBtn.className = 'disable-btn';
        disableBtn.textContent = '×';
        disableBtn.title = 'Disable frame';
        disableBtn.setAttribute('aria-label', 'Disable frame');
        const actions = document.createElement('div');
        actions.className = 'frame-actions';
        handle.appendChild(frameIdSpan);
        actions.appendChild(unsnapBtn);
        actions.appendChild(minimizeBtn);
        actions.appendChild(disableBtn);
        actions.appendChild(menuBtn);
        handle.appendChild(actions);
        document.body.insertBefore(handle, document.body.firstChild);

        unsnapBtn.style.display = ${isInitiallySnapped ? "'inline-block'" : "'none'"};

        if (window.sdFrame) {
          unsnapBtn.addEventListener('click', function() {
            window.sdFrame.frame.unsnap({ id: ${JSON.stringify(config.id)}, all: true });
          });

          menuBtn.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            window.sdFrame.tray.showMenu(event.clientX, event.clientY);
          });

          minimizeBtn.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            window.sdFrame.frame.minimize();
          });

          disableBtn.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            window.sdFrame.frame.disable();
          });

          window.sdFrame.on.snapStatusChanged(function(data) {
            unsnapBtn.style.display = data.isSnapped ? 'inline-block' : 'none';
          });
        }
        return true;
      })();
    `;

    window.webContents.executeJavaScript(js).then(result => {
      if (result) {
        window.webContents.insertCSS(css).catch(error => {
          logService.warn('Failed to insert frame title bar CSS', {
            frameId: config.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }).catch(error => {
      logService.error('Failed to execute drag handle JavaScript', {
        frameId: config.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private updateDragHandleName(window: BrowserWindow, frameId: string, name: string | undefined): void {
    const displayName = name || frameId.slice(0, 8);
    const js = `
      (function() {
        const frameIdSpan = document.querySelector('#sdframe-drag-handle .frame-id');
        if (frameIdSpan) {
          frameIdSpan.textContent = ${JSON.stringify(displayName)};
        }
      })();
    `;
    window.webContents.executeJavaScript(js).catch((error) => {
      logService.error('Failed to update drag handle name', {
        frameId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async retryLoadUrl(frameId: string): Promise<void> {
    const window = this.frameWindows.get(frameId);
    const config = configService.getFrame(frameId);
    if (window && config) {
      this.clearNotFoundReload(frameId);
      this.autoReloadFailures.delete(frameId);
      try {
        await this.loadLoadingPage(window, config);
        await window.loadURL(config.url);
        logService.info('Retry successful', { frameId });
      } catch (error) {
        logService.error('Retry failed', { 
          frameId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private bringSettingsToFront(): void {
    if (
      this.settingsWindow &&
      !this.settingsWindow.isDestroyed() &&
      this.settingsWindow.isVisible() &&
      !this.settingsWindow.isMinimized()
    ) {
      this.settingsWindow.setAlwaysOnTop(true);
      this.settingsWindow.moveTop();
      this.settingsWindow.focus();
    }
  }

  updateFrame(id: string, updates: Partial<Omit<FrameConfig, 'id'>>): void {
    const window = this.frameWindows.get(id);
    const currentConfig = configService.getFrame(id);
    if (!currentConfig) return;

    // Handle partial bounds updates (always merge to ensure complete bounds object)
    if (updates.bounds && typeof updates.bounds === 'object') {
      const boundsUpdate = updates.bounds as Partial<Bounds>;
      // Always merge with current bounds to ensure complete bounds object
      const newBounds = {
        x: boundsUpdate.x ?? currentConfig.bounds.x,
        y: boundsUpdate.y ?? currentConfig.bounds.y,
        width: boundsUpdate.width ?? currentConfig.bounds.width,
        height: boundsUpdate.height ?? currentConfig.bounds.height,
      };

      // If size changed, clear snaps
      if (boundsUpdate.width !== undefined || boundsUpdate.height !== undefined) {
        configService.updateSnappedTo(id, []);
        snapManager.removeAllSnapConnectionsForFrame(id);

        // Notify about snap status change
        if (window) {
          window.webContents.send(IPC_CHANNELS.FRAME_SNAP_STATUS_CHANGED, {
            isSnapped: false,
          });
        }
      }

      // Replace partial bounds with complete bounds in updates
      updates = { ...updates, bounds: newBounds };
    }

    configService.updateFrame(id, updates);

    if (window) {
      if (updates.url && updates.url !== currentConfig.url) {
        this.clearNotFoundReload(id);
        this.autoReloadFailures.delete(id);
        window.loadURL(updates.url).catch(error => {
          logService.error('Failed to load updated URL', {
            frameId: id,
            url: updates.url,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      if (updates.name !== undefined && updates.name !== currentConfig.name) {
        this.updateDragHandleName(window, id, updates.name);
      }

      if (updates.bounds) {
        window.setBounds(this.validateBounds(updates.bounds));
      }

      if (updates.enabled === false) {
        window.hide();
      } else if (updates.enabled === true) {
        window.show();
        // Bring settings window to front after showing a frame
        this.bringSettingsToFront();
      }
    }

    logService.debug('Frame updated', { id, updates });
  }

  async removeFrame(id: string): Promise<void> {
    const window = this.frameWindows.get(id);
    const config = configService.getFrame(id);

    if (!config) {
      logService.warn('Frame not found for removal', { id });
      return;
    }

    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Remove', 'Cancel'],
      title: 'Remove Frame?',
      message: 'Are you sure you want to remove this frame?',
      detail: `Name: ${config.name || config.id.slice(0, 8)}\nURL: ${config.url}`,
      defaultId: 1, // Default to Cancel
      cancelId: 1,
    };
    const choice = this.settingsWindow && !this.settingsWindow.isDestroyed()
      ? dialog.showMessageBoxSync(this.settingsWindow, options)
      : dialog.showMessageBoxSync(options);

    if (choice === 0) {
      // User confirmed removal
      if (window) {
        this.intentionalClosing.add(id);
        window.close();
      }
      this.releaseColor(config.color);
      configService.removeFrame(id);
      logService.info('Frame removed', { id });
    } else {
      logService.info('Frame removal cancelled', { id });
    }
  }

  focusFrame(id: string): void {
    const window = this.frameWindows.get(id);
    if (window) {
      this.restoreFrameGroup(id);
      window.focus();
    }
  }

  minimizeFrame(id: string): void {
    this.getFrameGroup(id).forEach(frameId => {
      const window = this.frameWindows.get(frameId);
      if (window && !window.isDestroyed()) window.minimize();
    });
  }

  private restoreFrameGroup(id: string): void {
    this.getFrameGroup(id).forEach(frameId => {
      const window = this.frameWindows.get(frameId);
      if (window && !window.isDestroyed() && window.isMinimized()) {
        window.restore();
      }
    });
  }

  disableFrame(id: string): void {
    this.getFrameGroup(id).forEach(frameId => {
      this.updateFrame(frameId, { enabled: false });
    });
    logService.info('Frame group disabled', { id });
  }

  private getFrameGroup(id: string): string[] {
    return snapManager.getGroup(id);
  }

  setGroupHeight(id: string, height: number): number {
    if (!this.frameWindows.has(id)) {
      throw new Error('The selected frame is not enabled');
    }

    const group = snapManager.getGroup(id);
    let frameCount = 0;

    group.forEach(frameId => {
      const window = this.frameWindows.get(frameId);
      if (!window) return;

      const bounds = this.validateBounds({ ...window.getBounds(), height });
      snapManager.setBounds(frameId, bounds);
      configService.updateFrameBounds(frameId, bounds);
      frameCount++;
    });

    group.forEach(frameId => snapManager.updateSnapConnections(frameId));
    logService.info('Snapped group height changed', { id, height, frameCount });
    return frameCount;
  }

  resetLayout(id?: string): void {
    if (id) {
      const window = this.frameWindows.get(id);
      if (window) {
        const defaultBounds = this.getDefaultBounds();
        snapManager.removeAllSnapConnectionsForFrame(id);
        window.setBounds(defaultBounds);
        configService.updateFrameBounds(id, defaultBounds);
      }
    } else {
      const frames = configService.getFrames();
      const defaultBounds = this.getDefaultBounds();
      
      frames.forEach((frame, index) => {
        const window = this.frameWindows.get(frame.id);
        if (window) {
          const offset = index * 30;
          const bounds = {
            ...defaultBounds,
            x: defaultBounds.x + offset,
            y: defaultBounds.y + offset,
          };
          snapManager.removeAllSnapConnectionsForFrame(frame.id);
          window.setBounds(bounds);
          configService.updateFrameBounds(frame.id, bounds);
        }
      });
    }
    logService.info('Layout reset', { id: id ?? 'all' });
  }

  resetAllFrameDimensions(): void {
    const frames = configService.getFrames();
    const defaultBounds = this.getDefaultBounds();

    frames.forEach(frame => {
      const window = this.frameWindows.get(frame.id);
      const currentBounds = window?.getBounds() ?? frame.bounds;
      const bounds = this.validateBounds({
        ...currentBounds,
        width: defaultBounds.width,
        height: defaultBounds.height,
      });

      if (bounds.width !== currentBounds.width || bounds.height !== currentBounds.height) {
        snapManager.removeAllSnapConnectionsForFrame(frame.id);
      }

      window?.setBounds(bounds);
      configService.updateFrameBounds(frame.id, bounds);
    });
    logService.info('All frame dimensions reset');
  }

  alignAndSnapAllFrames(): void {
    const frames = configService.getFrames().filter(frame => frame.enabled && this.frameWindows.has(frame.id));
    if (frames.length === 0) return;

    if (frames.length > 6) {
      const options: MessageBoxOptions = {
        type: 'warning',
        title: 'Too many frames',
        message: 'Align and snap supports up to 6 enabled frames.',
        detail: 'Disable one or more frames and try again.',
      };
      if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
        void dialog.showMessageBox(this.settingsWindow, options);
      } else {
        void dialog.showMessageBox(options);
      }
      return;
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    const appConfig = configService.get();
    const frameHeight = Math.min(
      appConfig.frameSize.height || Math.floor(workArea.height / 4) + 24,
      workArea.height
    );
    const defaultWidth = appConfig.frameSize.width || Math.floor(workArea.width / 4);
    const frameWidth = frames.length === 1
      ? Math.min(defaultWidth, workArea.width)
      : Math.floor(workArea.width / frames.length);

    if (frameWidth < 100 || frameHeight < 100) {
      const options: MessageBoxOptions = {
        type: 'warning',
        title: 'Screen too small',
        message: 'There is not enough space to align these frames.',
      };
      if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
        void dialog.showMessageBox(this.settingsWindow, options);
      } else {
        void dialog.showMessageBox(options);
      }
      return;
    }

    const y = workArea.y + Math.floor((workArea.height - frameHeight) / 2);
    frames.forEach((frame, index) => {
      const x = frames.length === 1
        ? workArea.x + Math.floor((workArea.width - frameWidth) / 2)
        : workArea.x + index * frameWidth;
      const width = frames.length > 1 && index === frames.length - 1
        ? workArea.x + workArea.width - x
        : frameWidth;
      const bounds = { x, y, width, height: frameHeight };
      this.frameWindows.get(frame.id)?.setBounds(bounds);
      configService.updateFrameBounds(frame.id, bounds);
    });

    snapManager.connectFramesInSequence(frames.map(frame => frame.id));
    logService.info('All frames aligned and snapped', { count: frames.length, frameHeight });
  }

  setLayoutLocked(locked: boolean): void {
    configService.set('layoutLocked', locked);
    
    for (const window of this.frameWindows.values()) {
      window.setResizable(!locked);
      window.setMovable(!locked);
    }
    
    logService.info('Layout lock changed', { locked });
  }

  setAlwaysOnTop(onTop: boolean): void {
    configService.set('alwaysOnTop', onTop);
    
    for (const window of this.frameWindows.values()) {
      window.setAlwaysOnTop(onTop);
    }
    
    logService.info('Always on top changed', { onTop });
  }

  unsnapFrame(id: string, options?: { edge?: SnapEdge; all?: boolean }): void {
    const { edge, all } = options || {};
    logService.info('Frame unsnap initiated', { id, edge, all });

    if (all || !edge) {
      snapManager.removeAllSnapConnectionsForFrame(id);
      return;
    }

    const frame = configService.getFrame(id);
    if (!frame) return;

    const affectedTargets = frame.snappedTo
      .filter(t => t.edge === edge || t.edge === 'unknown')
      .map(t => t.frameId);

    if (affectedTargets.length === 0) {
      snapManager.notifySnapStatus(id);
      return;
    }

    affectedTargets.forEach(targetId => {
      snapManager.removeSnapConnection(id, targetId, edge);
      snapManager.removeSnapConnection(targetId, id, snapManager.getOppositeEdge(edge));
    });

    snapManager.notifySnapStatus(id);
    affectedTargets.forEach(targetId => snapManager.notifySnapStatus(targetId));
  }

  async restoreFrames(): Promise<void> {
    const frames = configService.getFrames().filter(frame => frame.enabled);
    
    // Step 1: Create all windows and load loading pages
    const windows: Array<{ window: BrowserWindow; config: FrameConfig }> = [];
    const loadingPromises = frames.map(async (frame) => {
      const window = this.createFrameWindow(frame);
      await this.loadLoadingPage(window, frame);
      windows.push({ window, config: frame });
      return window;
    });

    // Wait for all loading pages to load
    await Promise.all(loadingPromises);

    // Step 2: Show all windows at their configured positions with loading page
    windows.forEach(({ window }) => window.show());

    // Step 3: Trigger snap detection immediately since all windows are created
    snapManager.handleDisplayChange();

    // Step 4: Load actual URLs concurrently (non-blocking)
    const urlLoadPromises = windows.map(({ window, config }) =>
      window.loadURL(config.url).catch(error => {
        if (isAbortedNavigationError(error)) return;
        logService.error('Failed to load URL', {
          frameId: config.id,
          url: config.url,
          error: error instanceof Error ? error.message : String(error)
        });
        if (!window.isDestroyed()) {
          this.loadErrorPage(window, config.id, config.url, 'Failed to load page');
        }
      })
    );

    // Wait for all URLs to load in background
    await Promise.all(urlLoadPromises);

    // Step 5: Notify all frames of their snap status to apply group colors
    snapManager.notifyAllSnapStatuses();

    // Ensure settings window stays on top after restoring frames
    this.bringSettingsToFront();

    logService.info('Frames restored', { count: frames.length });
  }

  async importConfig(config: unknown): Promise<AppConfig> {
    const importedConfig = configService.replace(config);
    this.updateNotFoundAutoReloadSettings();
    this.usedColors.clear();
    importedConfig.frames.forEach(frame => this.usedColors.add(frame.color));

    const closePromises = Array.from(this.frameWindows.entries()).map(([id, window]) => {
      if (window.isDestroyed()) return Promise.resolve();
      this.intentionalClosing.add(id);
      return new Promise<void>(resolve => {
        window.once('closed', () => resolve());
        window.close();
      });
    });
    await Promise.all(closePromises);

    for (const window of this.frameWindows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    await this.restoreFrames();
    return importedConfig;
  }

  async addImportedFrames(config: unknown, addedFrameIds: string[]): Promise<AppConfig> {
    const importedConfig = configService.replace(config);
    this.updateNotFoundAutoReloadSettings();
    this.usedColors.clear();
    importedConfig.frames.forEach(frame => this.usedColors.add(frame.color));

    for (const window of this.frameWindows.values()) {
      if (window.isDestroyed()) continue;
      window.setResizable(!importedConfig.layoutLocked);
      window.setMovable(!importedConfig.layoutLocked);
      window.setAlwaysOnTop(importedConfig.alwaysOnTop);
    }

    for (const frameId of addedFrameIds) {
      const frame = importedConfig.frames.find(candidate => candidate.id === frameId);
      if (frame?.enabled) {
        await this.openFrameWindow(frame);
      }
    }

    snapManager.handleDisplayChange();
    snapManager.notifyAllSnapStatuses();
    this.bringSettingsToFront();
    return importedConfig;
  }

  openSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      if (this.settingsWindow.isMinimized()) {
        this.settingsWindow.restore();
      }
      this.settingsWindow.show();
      setImmediate(() => this.bringSettingsToFront());
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 1060,
      height: 850,
      minWidth: 780,
      minHeight: 640,
      frame: false,
      resizable: true,
      minimizable: true,
      maximizable: false,
      alwaysOnTop: true,
      title: 'sdFrame Settings',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: ['--sdframe-settings'],
      },
    });

    const settingsPath = path.join(__dirname, '..', 'renderer', 'settings', 'index.html');
    this.settingsWindow.loadFile(settingsPath);

    const settingsWindow = this.settingsWindow;
    settingsWindow.on('restore', () => {
      setImmediate(() => this.bringSettingsToFront());
    });

    settingsWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        settingsWindow.hide();
        logService.info('Settings window hidden to tray');
      }
    });

    settingsWindow.on('closed', () => {
      if (this.settingsWindow === settingsWindow) {
        this.settingsWindow = null;
      }
    });

    logService.debug('Settings window opened');
  }

  closeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
    }
  }

  minimizeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.minimize();
    }
  }

  hideSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.hide();
      logService.info('Settings window hidden to tray');
    }
  }

  closeAllFrames(): void {
    this.frameWindows.forEach((_window, id) => {
      this.intentionalClosing.add(id);
    });
    for (const window of this.frameWindows.values()) {
      window.close();
    }
    this.frameWindows.clear();
  }

  prepareQuit(): void {
    this.isQuitting = true;
    this.intentionalClosing.clear();
    // Close all windows (they will now be allowed to close)
    for (const window of this.frameWindows.values()) {
      if (!window.isDestroyed()) {
        window.close();
      }
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
    }
  }

  enableAllFrames(): void {
    const frames = configService.getFrames();
    frames.forEach(frame => {
      this.updateFrame(frame.id, { enabled: true });
    });
    // Ensure settings window stays on top after enabling all frames
    this.bringSettingsToFront();
    logService.info('All frames enabled');
  }

  disableAllFrames(): void {
    const frames = configService.getFrames();
    frames.forEach(frame => {
      this.updateFrame(frame.id, { enabled: false });
    });
    logService.info('All frames disabled');
  }

  getFrameWindows(): Map<string, BrowserWindow> {
    return this.frameWindows;
  }

  getFrameIdByWebContentsId(webContentsId: number): string | undefined {
    for (const [id, window] of this.frameWindows) {
      if (!window.isDestroyed() && window.webContents.id === webContentsId) {
        return id;
      }
    }
    return undefined;
  }

  isSettingsSender(webContentsId: number): boolean {
    return Boolean(
      this.settingsWindow &&
        !this.settingsWindow.isDestroyed() &&
        this.settingsWindow.webContents.id === webContentsId
    );
  }

  isKnownFrameSender(webContentsId: number, frameId?: string): boolean {
    for (const [id, window] of this.frameWindows) {
      if (window.isDestroyed() || window.webContents.id !== webContentsId) continue;
      return frameId === undefined || frameId === id;
    }
    return false;
  }
}

export const windowManager = new WindowManager();
