import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { windowManager } from './window-manager';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';

export class TrayManager {
  private tray: Tray | null = null;

  initialize(): void {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    let icon: Electron.NativeImage;
    
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        icon = this.createDefaultIcon();
      }
    } catch {
      icon = this.createDefaultIcon();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('sdFrame');
    this.updateContextMenu();

    this.tray.on('click', () => {
      this.updateContextMenu();
    });

    logService.info('Tray initialized');
  }

  private createDefaultIcon(): Electron.NativeImage {
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        canvas[idx] = 100;     // R
        canvas[idx + 1] = 150; // G
        canvas[idx + 2] = 200; // B
        canvas[idx + 3] = 255; // A
      }
    }
    
    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  updateContextMenu(): void {
    if (!this.tray) return;

    const config = configService.get();
    const frames = configService.getFrames();

    const frameMenuItems: Electron.MenuItemConstructorOptions[] = frames.map(frame => ({
      label: `${frame.enabled ? '●' : '○'} Frame ${frame.id.slice(0, 8)}`,
      submenu: [
        {
          label: frame.url.length > 40 ? frame.url.slice(0, 40) + '...' : frame.url,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Focus',
          click: () => windowManager.focusFrame(frame.id),
        },
        {
          label: frame.enabled ? 'Disable' : 'Enable',
          click: () => windowManager.updateFrame(frame.id, { enabled: !frame.enabled }),
        },
        {
          label: 'Edit URL...',
          click: () => this.promptEditUrl(frame.id, frame.url),
        },
        {
          label: 'Reset Position',
          click: () => windowManager.resetLayout(frame.id),
        },
        { type: 'separator' },
        {
          label: 'Remove',
          click: () => windowManager.removeFrame(frame.id),
        },
      ],
    }));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Add Frame...',
        click: () => windowManager.openSettingsWindow(),
      },
      { type: 'separator' },
      ...(frameMenuItems.length > 0
        ? [...frameMenuItems, { type: 'separator' as const }]
        : [{ label: 'No frames configured', enabled: false }]),
      {
        label: 'Enable All Frames',
        click: () => {
          windowManager.enableAllFrames();
          this.updateContextMenu();
        },
      },
      {
        label: 'Disable All Frames',
        click: () => {
          windowManager.disableAllFrames();
          this.updateContextMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Snapping',
        submenu: [
          {
            label: 'Enable Snapping',
            type: 'checkbox',
            checked: config.snapEnabled,
            click: (menuItem) => {
              configService.set('snapEnabled', menuItem.checked);
              this.updateContextMenu();
            },
          },
          {
            label: 'Group Movement',
            type: 'checkbox',
            checked: config.groupMovementEnabled,
            enabled: config.snapEnabled,
            click: (menuItem) => {
              configService.set('groupMovementEnabled', menuItem.checked);
              this.updateContextMenu();
            },
          },
          { type: 'separator' },
          {
            label: `Snap Threshold: ${config.snapThreshold}px`,
            submenu: [5, 10, 15, 20, 25, 30].map(value => ({
              label: `${value}px`,
              type: 'radio' as const,
              checked: config.snapThreshold === value,
              click: () => {
                configService.set('snapThreshold', value);
                this.updateContextMenu();
              },
            })),
          },
        ],
      },
      {
        label: config.layoutLocked ? 'Unlock Layout' : 'Lock Layout',
        click: () => {
          windowManager.setLayoutLocked(!config.layoutLocked);
          this.updateContextMenu();
        },
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: config.alwaysOnTop,
        click: () => {
          windowManager.setAlwaysOnTop(!config.alwaysOnTop);
          this.updateContextMenu();
        },
      },
      {
        label: 'Reset All Positions',
        click: () => windowManager.resetLayout(),
      },
      { type: 'separator' },
      {
        label: 'Settings...',
        click: () => windowManager.openSettingsWindow(),
      },
      {
        label: 'Log Level',
        submenu: (['debug', 'info', 'warn', 'error'] as const).map(level => ({
          label: level.charAt(0).toUpperCase() + level.slice(1),
          type: 'radio' as const,
          checked: config.logLevel === level,
          click: () => {
            configService.set('logLevel', level);
            this.updateContextMenu();
          },
        })),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          configService.saveSync();
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  private promptEditUrl(frameId: string, currentUrl: string): void {
    windowManager.openSettingsWindow();
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayManager = new TrayManager();
