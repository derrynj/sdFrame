import * as fs from 'fs';
import * as path from 'path';
import { app, screen } from 'electron';
import { AppConfigSchema } from '../shared/schemas';
import type { AppConfig, FrameConfig, SnapTarget, FrameSizeSettings } from '../shared/types';
import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from '../shared/constants';
import { logService } from './log-service';

function getDefaultConfigPath(): string {
  // In production, resources are in app.asar or extraResources
  // In development, they're in the project root
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'default-config.json');
  } else {
    return path.join(app.getAppPath(), 'default-config.json');
  }
}

/**
 * Gets the default frame size based on screen width/4 for width and screen height/4 for height.
 */
function getDefaultFrameSize(): FrameSizeSettings {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return {
    width: Math.floor(width / 4),
    height: Math.floor(height / 4),
  };
}

/**
 * Migrates old string[] snappedTo format to SnapTarget[] format.
 */
function migrateSnappedTo(snappedTo: string[] | SnapTarget[]): SnapTarget[] {
  if (snappedTo.length === 0) {
    return [];
  }
  
  // Check if already migrated (has edge property)
  if (typeof snappedTo[0] === 'object' && 'edge' in (snappedTo[0] as SnapTarget)) {
    return snappedTo as SnapTarget[];
  }
  
  // Old format - convert to new format
  return (snappedTo as string[]).map(id => ({
    frameId: id,
    edge: 'unknown' as const,
  }));
}

/**
 * Checks if config needs migration and migrates if necessary.
 */
function migrateConfig(config: any): AppConfig {
  let needsMigration = false;
  let migratedConfig: any = { ...config };
  
  // Migrate frameSize if not present
  if (!migratedConfig.frameSize) {
    needsMigration = true;
    logService.info('Migrating config to add frameSize setting');
    migratedConfig.frameSize = getDefaultFrameSize();
  }
  
  const migratedFrames = migratedConfig.frames.map((frame: any) => {
    if (frame.snappedTo && frame.snappedTo.length > 0 && typeof frame.snappedTo[0] === 'string') {
      needsMigration = true;
      return {
        ...frame,
        snappedTo: migrateSnappedTo(frame.snappedTo),
      };
    }
    return frame;
  });
  
  if (needsMigration) {
    if (migratedFrames !== migratedConfig.frames) {
      logService.info('Migrated config from string[] to SnapTarget[] format');
      migratedConfig.frames = migratedFrames;
    }
    return AppConfigSchema.parse(migratedConfig);
  }
  
  return AppConfigSchema.parse(migratedConfig);
}

class ConfigService {
  private configPath: string = '';
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private saveTimeout: NodeJS.Timeout | null = null;
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, CONFIG_FILE_NAME);
    this.config = this.load();
    logService.setLevel(this.config.logLevel);
    this.initialized = true;
  }

  private load(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Apply migration if needed
        const migrated = migrateConfig(parsed);
        const validated = AppConfigSchema.parse(migrated);
        
        // Save migrated config immediately
        if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
          this.config = validated;
          this.saveImmediate();
        }
        
        logService.info('Config loaded successfully');
        return validated;
      } else {
        // First run - try to load bundled default config
        const defaultConfigPath = getDefaultConfigPath();
        if (fs.existsSync(defaultConfigPath)) {
          try {
            const data = fs.readFileSync(defaultConfigPath, 'utf-8');
            const parsed = JSON.parse(data);
            const migrated = migrateConfig(parsed);
            const validated = AppConfigSchema.parse(migrated);
            logService.info('Loaded bundled default config');
            // Save it immediately to user config location
            this.config = validated;
            this.saveImmediate();
            return validated;
          } catch (error) {
            logService.warn('Failed to load bundled default config', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } catch (error) {
      logService.error('Failed to load config, using defaults', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    // Initialize frameSize with default values
    return {
      ...DEFAULT_CONFIG,
      frameSize: getDefaultFrameSize(),
    };
  }

  private saveImmediate(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logService.debug('Config saved');
    } catch (error) {
      logService.error('Failed to save config', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  save(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveImmediate();
      this.saveTimeout = null;
    }, 500);
  }

  saveSync(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveImmediate();
  }

  get(): AppConfig {
    return { ...this.config };
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config[key] = value;
    if (key === 'logLevel') {
      logService.setLevel(value as AppConfig['logLevel']);
    }
    this.save();
    logService.debug(`Config updated: ${key}`, { value });
  }

  getFrames(): FrameConfig[] {
    return [...this.config.frames];
  }

  getFrame(id: string): FrameConfig | undefined {
    return this.config.frames.find(f => f.id === id);
  }

  addFrame(frame: FrameConfig): void {
    this.config.frames.push(frame);
    this.save();
    logService.info('Frame added', { id: frame.id, url: frame.url });
  }

  updateFrame(id: string, updates: Partial<Omit<FrameConfig, 'id'>>): void {
    const index = this.config.frames.findIndex(f => f.id === id);
    if (index !== -1) {
      this.config.frames[index] = { ...this.config.frames[index], ...updates };
      this.save();
      logService.debug('Frame updated', { id, updates });
    }
  }

  removeFrame(id: string): void {
    const index = this.config.frames.findIndex(f => f.id === id);
    if (index !== -1) {
      this.config.frames.splice(index, 1);
      this.config.frames.forEach(frame => {
        // Filter out SnapTarget references to removed frame
        frame.snappedTo = frame.snappedTo.filter(snap => snap.frameId !== id);
      });
      this.save();
      logService.info('Frame removed', { id });
    }
  }

  updateFrameBounds(id: string, bounds: FrameConfig['bounds']): void {
    const frame = this.getFrame(id);
    if (frame) {
      this.updateFrame(id, { bounds });
    }
  }

  updateSnappedTo(id: string, snappedTo: SnapTarget[]): void {
    this.updateFrame(id, { snappedTo });
  }

  isFirstRun(): boolean {
    return this.config.frames.length === 0;
  }
}

export const configService = new ConfigService();
