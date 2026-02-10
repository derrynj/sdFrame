# Window Behavior Analysis & User Experience Recommendations

## Executive Summary

This document analyzes the current window behavior of the sdFrame application and provides recommendations to improve user experience. The analysis identifies several critical issues that affect usability, particularly around window lifecycle management and process behavior.

---

## Current Window Behavior Overview

### Window Types
The application manages two types of windows:
1. **Frame Windows** - Browser windows displaying configured URLs
2. **Settings Window** - Configuration interface

### Key Components
- [`WindowManager`](src/main/window-manager.ts:16) - Manages all window creation, updates, and lifecycle
- [`TrayManager`](src/main/tray-manager.ts:7) - Provides system tray menu for window control
- [`IPC Handlers`](src/main/ipc-handlers.ts:19) - Handle communication between renderer and main process

---

## Identified Issues

### 1. No Way to Reopen Closed Windows (Critical)

**Problem:**
When a user closes a frame window (via the X button), the window is permanently closed and removed from the [`frameWindows`](src/main/window-manager.ts:17) map. The frame configuration remains in the config, but there is no mechanism to reopen it.

**Code Evidence:**
```typescript
// window-manager.ts:166-169
window.on('closed', () => {
  this.frameWindows.delete(config.id);
  snapManager.unregisterWindow(config.id);
});
```

The `closed` event handler only removes the window from the map but doesn't provide any way to recreate it. The [`removeFrame()`](src/main/window-manager.ts:337) method permanently deletes the frame from config.

**User Impact:**
- Users must manually recreate frames through settings if accidentally closed
- No "reopen" option in tray menu
- Loss of productivity when windows are accidentally closed

---

### 2. Process Remains Running After All Windows Closed (Critical)

**Problem:**
The application intentionally keeps running in the background even when all windows are closed, but users have no clear indication of this and no easy way to quit the application completely.

**Code Evidence:**
```typescript
// index.ts:47-49
app.on('window-all-closed', () => {
  // Keep app running in tray even when all windows are closed
});
```

The only way to quit is through the tray menu's "Quit" option, which may not be obvious to all users.

**User Impact:**
- Confusion when the app appears closed but process continues running
- Resource waste when users think they've closed the app
- Difficulty finding the quit option

---

### 3. Settings Window Cannot Be Reopened After Closure (High)

**Problem:**
The settings window can be closed, and while there's a tray menu option to open it, there's no other way to access settings if the tray is not used.

**Code Evidence:**
```typescript
// window-manager.ts:511-515
openSettingsWindow(): void {
  if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
    this.settingsWindow.focus();
    return;
  }
  // ... creates new window
}
```

The [`activate`](src/main/index.ts:58) event only opens settings, but this only triggers on macOS dock clicks.

**User Impact:**
- Users may lose access to settings if they close the window and don't know about the tray
- No keyboard shortcut to open settings

---

### 4. No Window Minimize/Restore Functionality (Medium)

**Problem:**
Frame windows have no minimize button (frameless windows), and there's no mechanism to minimize or restore windows programmatically.

**Code Evidence:**
```typescript
// window-manager.ts:105-119
const window = new BrowserWindow({
  ...config.bounds,
  frame: false,  // No native window frame
  resizable: !appConfig.layoutLocked,
  movable: !appConfig.layoutLocked,
  // ...
});
```

**User Impact:**
- Cannot temporarily hide windows without closing them
- No way to declutter the workspace temporarily

---

### 5. No Window State Persistence (Medium)

**Problem:**
When a window is closed, its state (position, size, URL) is preserved in config, but there's no way to restore individual windows. The [`restoreFrames()`](src/main/window-manager.ts:472) method only runs on app startup.

**Code Evidence:**
```typescript
// index.ts:42-44
logService.info('Restoring frames from config');
await windowManager.restoreFrames();
```

**User Impact:**
- Cannot restore a specific closed window without restarting the app
- No "restore all" option after closing all windows

---

### 6. Limited Tray Menu Options for Window Management (Medium)

**Problem:**
The tray menu provides frame-specific actions but lacks some useful window management options.

**Code Evidence:**
```typescript
// tray-manager.ts:57-87
const frameMenuItems: Electron.MenuItemConstructorOptions[] = frames.map(frame => ({
  label: `${frame.enabled ? '●' : '○'} Frame ${frame.id.slice(0, 8)}`,
  submenu: [
    { label: 'Focus', ... },
    { label: frame.enabled ? 'Disable' : 'Enable', ... },
    { label: 'Edit URL...', ... },
    { label: 'Reset Position', ... },
    { label: 'Remove', ... },
  ],
}));
```

**User Impact:**
- No "Reopen" option for closed windows
- No "Minimize/Restore" option
- No "Close" option (only "Remove" which deletes from config)

---

### 7. No Confirmation Before Removing Frames (Low)

**Problem:**
The "Remove" action in both tray menu and settings UI immediately deletes the frame without confirmation.

**Code Evidence:**
```typescript
// settings/index.ts:180-188
elements.framesContainer.querySelectorAll('.remove-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const id = (e.target as HTMLElement).dataset.id;
    if (id) {
      await window.sdFrame.frame.remove({ id });
      await loadFrames();
    }
  });
});
```

**User Impact:**
- Accidental frame deletion
- No undo mechanism

---

## Recommendations

### Priority 1: Critical Issues

#### 1.1 Add "Reopen" Functionality for Closed Windows

**Implementation:**
1. Add a new method to [`WindowManager`](src/main/window-manager.ts:16) to reopen a closed frame:
   ```typescript
   reopenFrame(id: string): void {
     const config = configService.getFrame(id);
     if (config && !this.frameWindows.has(id)) {
       this.openFrameWindow(config);
     }
   }
   ```

2. Add "Reopen" option to tray menu for disabled/closed frames:
   ```typescript
   {
     label: 'Reopen',
     click: () => windowManager.reopenFrame(frame.id),
     visible: !this.frameWindows.has(frame.id),
   }
   ```

3. Add "Reopen All" option to main tray menu:
   ```typescript
   {
     label: 'Reopen All Frames',
     click: () => windowManager.restoreFrames(),
   }
   ```

4. Add IPC handler for reopen functionality:
   ```typescript
   ipcMain.handle(IPC_CHANNELS.FRAME_REOPEN, async (_event, payload) => {
     // ...
   });
   ```

#### 1.2 Improve Process Quit Behavior

**Implementation:**
1. Add a "Close All Windows" option to tray menu that keeps app running:
   ```typescript
   {
     label: 'Close All Windows',
     click: () => windowManager.closeAllFrames(),
   }
   ```

2. Add a confirmation dialog when quitting from tray:
   ```typescript
   {
     label: 'Quit',
     click: () => {
       const choice = dialog.showMessageBoxSync({
         type: 'question',
         buttons: ['Quit', 'Cancel'],
         title: 'Quit sdFrame?',
         message: 'Are you sure you want to quit sdFrame?',
       });
       if (choice === 0) {
         configService.saveSync();
         app.quit();
       }
     },
   }
   ```

3. Add keyboard shortcut (Ctrl+Q / Cmd+Q) to quit:
   ```typescript
   app.on('ready', () => {
     globalShortcut.register('CommandOrControl+Q', () => {
       app.quit();
     });
   });
   ```

---

### Priority 2: High Priority

#### 2.1 Add Minimize/Restore Functionality

**Implementation:**
1. Add minimize button to frame drag handle:
   ```typescript
   const js = `
     const handle = document.createElement('div');
     handle.id = 'sdframe-drag-handle';
     handle.innerHTML = `
       <span class="frame-id">${config.id.slice(0, 8)}</span>
       <div class="frame-controls">
         <button class="minimize-btn" id="sdframe-minimize">−</button>
         <button class="unsnap-btn" id="sdframe-unsnap">Unsnap</button>
       </div>
     `;
   `;
   ```

2. Add minimize/restore methods to [`WindowManager`](src/main/window-manager.ts:16):
   ```typescript
   minimizeFrame(id: string): void {
     const window = this.frameWindows.get(id);
     if (window) {
       window.minimize();
     }
   }

   restoreFrame(id: string): void {
     const window = this.frameWindows.get(id);
     if (window) {
       window.restore();
       window.focus();
     }
   }
   ```

3. Add minimize/restore options to tray menu:
   ```typescript
   {
     label: window.isMinimized() ? 'Restore' : 'Minimize',
     click: () => {
       if (window.isMinimized()) {
         windowManager.restoreFrame(frame.id);
       } else {
         windowManager.minimizeFrame(frame.id);
       }
     },
   }
   ```

#### 2.2 Add Global Keyboard Shortcuts

**Implementation:**
1. Add shortcuts for common actions:
   - `Ctrl+Shift+S` - Open Settings
   - `Ctrl+Shift+N` - Add new frame
   - `Ctrl+Shift+R` - Restore all frames
   - `Ctrl+Shift+W` - Close all frames

2. Register shortcuts in [`index.ts`](src/main/index.ts:1):
   ```typescript
   import { globalShortcut } from 'electron';

   app.whenReady().then(() => {
     globalShortcut.register('CommandOrControl+Shift+S', () => {
       windowManager.openSettingsWindow();
     });
     // ... other shortcuts
   });
   ```

---

### Priority 3: Medium Priority

#### 3.1 Add Window State Persistence

**Implementation:**
1. Track window state (minimized, maximized, hidden) in config:
   ```typescript
   interface FrameConfig {
     id: string;
     url: string;
     enabled: boolean;
     bounds: Bounds;
     color: string;
     snappedTo: SnapTarget[];
     windowState?: 'normal' | 'minimized' | 'maximized' | 'hidden';
   }
   ```

2. Save window state on state change:
   ```typescript
   window.on('minimize', () => {
     configService.updateFrame(config.id, { windowState: 'minimized' });
   });

   window.on('restore', () => {
     configService.updateFrame(config.id, { windowState: 'normal' });
   });
   ```

3. Restore window state on startup:
   ```typescript
   private async openFrameWindow(config: FrameConfig): Promise<BrowserWindow> {
     const window = this.createFrameWindow(config);
     // ... load URL

     if (config.windowState === 'minimized') {
       window.minimize();
     }

     return window;
   }
   ```

#### 3.2 Add "Close" vs "Remove" Distinction

**Implementation:**
1. Add a "Close" option that just closes the window but keeps config:
   ```typescript
   closeFrame(id: string): void {
     const window = this.frameWindows.get(id);
     if (window) {
       window.close();
     }
     // Note: Don't remove from config
   }
   ```

2. Update tray menu to have both options:
   ```typescript
   {
     label: 'Close Window',
     click: () => windowManager.closeFrame(frame.id),
   },
   {
     label: 'Remove Frame',
     click: () => windowManager.removeFrame(frame.id),
   }
   ```

3. Update settings UI to have both buttons:
   ```html
   <button class="btn btn-secondary btn-small close-btn" data-id="${frame.id}">Close</button>
   <button class="btn btn-danger btn-small remove-btn" data-id="${frame.id}">Remove</button>
   ```

---

### Priority 4: Low Priority

#### 4.1 Add Confirmation Dialogs

**Implementation:**
1. Add confirmation before removing frames:
   ```typescript
   async removeFrame(id: string): Promise<void> {
     const window = this.frameWindows.get(id);
     const config = configService.getFrame(id);

     const choice = dialog.showMessageBoxSync({
       type: 'question',
       buttons: ['Remove', 'Cancel'],
       title: 'Remove Frame?',
       message: 'Are you sure you want to remove this frame?',
       detail: config ? `URL: ${config.url}` : '',
     });

     if (choice === 0) {
       if (window) {
         window.close();
       }
       if (config) {
         this.releaseColor(config.color);
       }
       configService.removeFrame(id);
       logService.info('Frame removed', { id });
     }
   }
   ```

2. Add confirmation before closing all frames:
   ```typescript
   async closeAllFrames(): Promise<void> {
     const count = this.frameWindows.size;
     if (count === 0) return;

     const choice = dialog.showMessageBoxSync({
       type: 'question',
       buttons: ['Close All', 'Cancel'],
       title: 'Close All Frames?',
       message: `Are you sure you want to close all ${count} frame(s)?`,
     });

     if (choice === 0) {
       for (const window of this.frameWindows.values()) {
         window.close();
       }
     }
   }
   ```

#### 4.2 Add Window List View in Settings

**Implementation:**
1. Add a visual indicator showing which windows are currently open:
   ```typescript
   function renderFrames(frames: FrameConfig[]): void {
     const html = frames.map(frame => `
       <div class="frame-item ${this.frameWindows.has(frame.id) ? 'open' : 'closed'}">
         <div class="frame-status-indicator">
           ${this.frameWindows.has(frame.id) ? '● Open' : '○ Closed'}
         </div>
         <!-- ... rest of frame item -->
       </div>
     `).join('');
   }
   ```

2. Add "Open/Close" toggle button:
   ```typescript
   {
     label: this.frameWindows.has(frame.id) ? 'Close' : 'Open',
     click: () => {
       if (this.frameWindows.has(frame.id)) {
         windowManager.closeFrame(frame.id);
       } else {
         windowManager.reopenFrame(frame.id);
       }
     },
   }
   ```

---

## Proposed Architecture Changes

### New IPC Channels

Add to [`IPC_CHANNELS`](src/shared/constants.ts:47):

```typescript
export const IPC_CHANNELS = {
  // ... existing channels
  FRAME_REOPEN: 'frame:reopen',
  FRAME_CLOSE: 'frame:close',
  FRAME_MINIMIZE: 'frame:minimize',
  FRAME_RESTORE: 'frame:restore',
  FRAME_RESTORE_ALL: 'frame:restore-all',
  FRAME_CLOSE_ALL: 'frame:close-all',
} as const;
```

### New WindowManager Methods

```typescript
class WindowManager {
  // ... existing methods

  reopenFrame(id: string): void;
  closeFrame(id: string): void;
  minimizeFrame(id: string): void;
  restoreFrame(id: string): void;
  restoreAllFrames(): Promise<void>;
  closeAllFrames(): Promise<void>;
  isFrameOpen(id: string): boolean;
}
```

### Updated Tray Menu Structure

```
├── Add Frame...
├── ──────────────
├── Frame abc12345
│   ├── ● Open / ○ Closed
│   ├── https://example.com
│   ├── ──────────────
│   ├── Focus
│   ├── Open / Close
│   ├── Minimize / Restore
│   ├── Enable / Disable
│   ├── Edit URL...
│   ├── Reset Position
│   ├── ──────────────
│   └── Remove
├── ──────────────
├── Reopen All Frames
├── Close All Windows
├── ──────────────
├── Snapping
│   ├── Enable Snapping
│   ├── Group Movement
│   └── Snap Threshold
├── Lock Layout / Unlock Layout
├── Always on Top
├── Reset All Positions
├── ──────────────
├── Settings...
├── Log Level
├── ──────────────
└── Quit
```

---

## Implementation Priority Matrix

| Feature | Priority | Complexity | Impact |
|---------|----------|------------|--------|
| Reopen closed windows | Critical | Low | High |
| Close all windows option | Critical | Low | High |
| Quit confirmation | Critical | Low | Medium |
| Minimize/restore | High | Medium | High |
| Keyboard shortcuts | High | Low | Medium |
| Window state persistence | Medium | Medium | Medium |
| Close vs Remove distinction | Medium | Low | Medium |
| Confirmation dialogs | Low | Low | Low |
| Window list view | Low | Low | Low |

---

## Testing Recommendations

1. **Window Lifecycle Testing**
   - Test opening, closing, and reopening frames
   - Test closing all windows and reopening
   - Test minimize/restore functionality

2. **Process Behavior Testing**
   - Verify app stays running after all windows closed
   - Verify quit functionality works correctly
   - Verify quit confirmation dialog appears

3. **Tray Menu Testing**
   - Verify all menu options work correctly
   - Verify menu updates dynamically based on window state
   - Verify submenu items show correct state

4. **Keyboard Shortcut Testing**
   - Test all registered shortcuts
   - Verify shortcuts work when windows are minimized
   - Verify shortcuts don't conflict with browser shortcuts

---

## Conclusion

The current window behavior has several usability issues that can significantly impact user experience. The most critical issues are:

1. No way to reopen closed windows
2. Process remains running without clear indication
3. Settings window cannot be easily reopened

Implementing the recommended changes will significantly improve the user experience by providing:
- Clear window lifecycle management
- Intuitive ways to reopen and restore windows
- Better process control
- Enhanced productivity through keyboard shortcuts

The proposed changes are relatively low complexity but have high impact on usability.
