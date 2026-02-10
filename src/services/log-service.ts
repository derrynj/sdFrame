import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { LogLevel } from '../shared/types';
import { LOG_FILE_NAME, LOG_MAX_SIZE_BYTES } from '../shared/constants';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class LogService {
  private logPath: string = '';
  private currentLevel: LogLevel = 'info';
  private writeStream: fs.WriteStream | null = null;
  private initialized = false;
  private isClosing = false;
  private pendingRotations = 0;

  initialize(): void {
    if (this.initialized) return;
    const userDataPath = app.getPath('userData');
    this.logPath = path.join(userDataPath, LOG_FILE_NAME);
    this.initializeStream();
    this.initialized = true;
  }

  private initializeStream(): void {
    this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.info(`Log level set to: ${level}`);
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLevel];
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.isClosing) return;
    
    this.pendingRotations++;
    try {
      const stats = await fs.promises.stat(this.logPath);
      if (stats.size >= LOG_MAX_SIZE_BYTES) {
        this.writeStream?.end();
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = this.logPath.replace('.log', `-${timestamp}.log`);
        await fs.promises.rename(this.logPath, rotatedPath);
        
        this.initializeStream();
        this.info('Log file rotated');

        await this.cleanOldLogs();
      }
    } catch {
      // File doesn't exist yet, that's fine
    } finally {
      this.pendingRotations--;
    }
  }

  private async cleanOldLogs(): Promise<void> {
    const userDataPath = app.getPath('userData');
    const files = await fs.promises.readdir(userDataPath);
    const logFiles = files
      .filter(f => f.startsWith('sdframe-') && f.endsWith('.log'))
      .sort()
      .reverse();

    for (const file of logFiles.slice(5)) {
      await fs.promises.unlink(path.join(userDataPath, file));
    }
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    if (!this.initialized) return;
    if (this.isClosing) return;
    
    try {
      const formattedMessage = this.formatMessage(level, message, meta);
      // Check if stream is still writable before writing
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.write(formattedMessage);
        void this.rotateIfNeeded();
      }
    } catch {
      // Ignore write errors (e.g., broken pipe, stream closed)
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  async close(): Promise<void> {
    this.isClosing = true;
    
    // Wait for any pending rotations to complete
    while (this.pendingRotations > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Close the write stream
    if (this.writeStream && !this.writeStream.destroyed) {
      return new Promise<void>((resolve) => {
        this.writeStream!.end(() => {
          resolve();
        });
      });
    }
  }
}

export const logService = new LogService();
