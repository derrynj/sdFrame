import * as fs from 'fs';
import * as path from 'path';
import { app, screen } from 'electron';
import { AppConfigSchema, isHttpUrl } from '../shared/schemas';
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
function migrateConfig(config: any, dropInvalidUrls = true): AppConfig {
  let migratedConfig: any = { ...config };
  
  // Migrate frameSize if not present
  if (!migratedConfig.frameSize) {
    logService.info('Migrating config to add frameSize setting');
    migratedConfig.frameSize = getDefaultFrameSize();
  }

  if (migratedConfig.autoReloadOn404 === undefined) {
    migratedConfig.autoReloadOn404 = DEFAULT_CONFIG.autoReloadOn404;
  }
  if (migratedConfig.autoReload404IntervalSeconds === undefined) {
    migratedConfig.autoReload404IntervalSeconds = DEFAULT_CONFIG.autoReload404IntervalSeconds;
  }
  
  if (Array.isArray(migratedConfig.frames)) {
    const hasLegacySnapTargets = migratedConfig.frames.some((frame: any) =>
      Array.isArray(frame?.snappedTo) &&
      frame.snappedTo.length > 0 &&
      typeof frame.snappedTo[0] === 'string'
    );
    if (hasLegacySnapTargets) {
      migratedConfig.frames = migratedConfig.frames.map((frame: any) => {
        if (frame.snappedTo && frame.snappedTo.length > 0 && typeof frame.snappedTo[0] === 'string') {
          return { ...frame, snappedTo: migrateSnappedTo(frame.snappedTo) };
        }
        return frame;
      });
      logService.info('Migrated config from string[] to SnapTarget[] format');
    }
  }

  // Drop frames with non-http(s) URLs rather than failing the whole parse
  // (a single legacy file:// frame should not nuke the entire config).
  if (dropInvalidUrls && Array.isArray(migratedConfig.frames)) {
    const droppedIds = new Set<string>();
    const before = migratedConfig.frames.length;
    migratedConfig.frames = migratedConfig.frames.filter((frame: any) => {
      if (frame && typeof frame.url === 'string' && !isHttpUrl(frame.url)) {
        logService.warn('Dropping frame with non-http(s) URL', { id: frame.id, url: frame.url });
        if (frame.id) droppedIds.add(frame.id);
        return false;
      }
      return true;
    });
    if (migratedConfig.frames.length !== before) {
      // Prune dangling snappedTo references to dropped frames
      migratedConfig.frames = migratedConfig.frames.map((frame: any) => {
        if (frame && Array.isArray(frame.snappedTo) && droppedIds.size > 0) {
          const filtered = frame.snappedTo.filter((t: any) => t && !droppedIds.has(t.frameId));
          if (filtered.length !== frame.snappedTo.length) {
            return { ...frame, snappedTo: filtered };
          }
        }
        return frame;
      });
    }
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
          this.backupBeforeMigrate();
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
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.configPath}.corrupt-${stamp}`;
        fs.copyFileSync(this.configPath, backupPath);
        logService.warn('Backed up corrupt config file', { backupPath });
      } catch {
        // Backup failed, nothing more we can do
      }
    }
    // Initialize frameSize with default values
    return {
      ...DEFAULT_CONFIG,
      frameSize: getDefaultFrameSize(),
    };
  }

  private backupBeforeMigrate(): void {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.configPath}.migrate-${stamp}`;
      fs.copyFileSync(this.configPath, backupPath);
      logService.info('Backed up config before migration', { backupPath });
    } catch (error) {
      logService.warn('Failed to back up config before migration', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
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
    return structuredClone(this.config);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config[key] = value;
    if (key === 'logLevel') {
      logService.setLevel(value as AppConfig['logLevel']);
    }
    this.save();
    logService.debug(`Config updated: ${key}`, { value });
  }

  replace(config: unknown): AppConfig {
    const validated = AppConfigSchema.parse(config);
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.config = validated;
    logService.setLevel(validated.logLevel);
    this.saveSync();
    return this.get();
  }

  validateImport(config: unknown): AppConfig {
    const validated = migrateConfig(config, false);
    const frameIds = validated.frames.map(frame => frame.id);
    if (new Set(frameIds).size !== frameIds.length) {
      throw new Error('The config contains duplicate frame IDs.');
    }
    return validated;
  }

  backupCurrent(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.dirname(this.configPath);
    const baseName = path.basename(this.configPath, path.extname(this.configPath));
    const backupPath = path.join(dir, `${baseName}.backup-${stamp}.json`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(backupPath, JSON.stringify(this.config, null, 2), 'utf-8');
    logService.info('Created config backup before import', { backupPath });
    return backupPath;
  }

  getFrames(): FrameConfig[] {
    return structuredClone(this.config.frames);
  }

  getFrame(id: string): FrameConfig | undefined {
    const found = this.config.frames.find(f => f.id === id);
    return found ? structuredClone(found) : undefined;
  }

  // Read-only references for internal hot paths (snap/geometry). Callers MUST
  // NOT mutate these; mutation goes through updateFrame/updateSnappedTo only.
  getFramesRef(): FrameConfig[] {
    return this.config.frames;
  }

  getFrameRef(id: string): FrameConfig | undefined {
    return this.config.frames.find(f => f.id === id);
  }

  getSnapThreshold(): number {
    return this.config.snapThreshold;
  }

  isLayoutLocked(): boolean {
    return this.config.layoutLocked;
  }

  isGroupMovementEnabled(): boolean {
    return this.config.groupMovementEnabled;
  }

  isSnappingEnabled(): boolean {
    return this.config.snapEnabled;
  }

  addFrame(frame: FrameConfig): void {
    this.config.frames.push(frame);
    this.save();
    logService.info('Frame added', { id: frame.id, url: frame.url });
  }

  updateFrame(id: string, updates: Partial<Omit<FrameConfig, 'id'>>): void {
    const index = this.config.frames.findIndex(f => f.id === id);
    if (index !== -1) {
      const currentFrame = this.config.frames[index];
      let updatedFrame = { ...currentFrame, ...updates };

      // Handle partial bounds updates - merge with existing bounds
      if (updates.bounds && typeof updates.bounds === 'object') {
        const boundsUpdate = updates.bounds as Partial<FrameConfig['bounds']>;
        updatedFrame = {
          ...updatedFrame,
          bounds: {
            x: boundsUpdate.x ?? currentFrame.bounds.x,
            y: boundsUpdate.y ?? currentFrame.bounds.y,
            width: boundsUpdate.width ?? currentFrame.bounds.width,
            height: boundsUpdate.height ?? currentFrame.bounds.height,
          },
        };
      }

      this.config.frames[index] = updatedFrame;
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
