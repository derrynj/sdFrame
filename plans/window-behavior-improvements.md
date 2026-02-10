# Window Behavior Improvements - Implementation Plan

## Overview

This plan implements a simplified approach to window management by removing the ability to close individual windows and using enable/disable for frame visibility. This reduces confusion and provides a clearer user experience.

---

## Changes Summary

1. **Remove window close functionality** - Frame windows cannot be closed individually
2. **Use enable/disable for visibility** - Disabled frames are hidden but preserved in config
3. **Add confirmation for frame removal** - Prevent accidental deletion
4. **Add Enable All / Disable All buttons** - Bulk frame management
5. **Auto-open settings when no frames enabled** - Ensure users can configure frames

---

## Implementation Details

### 1. Remove Window Close Functionality

#### Files to Modify:
- [`src/main/window-manager.ts`](src/main/window-manager.ts)

#### Changes:

**1.1 Prevent window closing via the close button and context menu**

Add a `beforeunload` handler to prevent accidental closing via right-click context menu:

```typescript
window.webContents.on('beforeunload', (event) => {
  event.preventDefault();
  logService.info('Window close prevented - use Settings to disable frame', { id: config.id });
});
```

**1.2 Remove the `closed` event handler that deletes from config**

The current implementation removes the window from the map when closed, but we want to prevent closing entirely. The `beforeunload` handler above will prevent the window from closing, so this handler should remain for cleanup when the app quits:

```typescript
// Keep this handler for cleanup when app quits (lines 166-169):
window.on('closed', () => {
  this.frameWindows.delete(config.id);
  snapManager.unregisterWindow(config.id);
});
```

**1.3 Update `removeFrame()` to require explicit removal**

The `removeFrame()` method should only be called via the Settings UI with confirmation, not via window close.

---

### 2. Use Enable/Disable for Frame Visibility

#### Files to Modify:
- [`src/main/window-manager.ts`](src/main/window-manager.ts)
- [`src/main/index.ts`](src/main/index.ts)

#### Changes:

**2.1 Update `updateFrame()` to handle enable/disable properly**

The current implementation already handles this (lines 327-331), but we should ensure it works correctly:

```typescript
if (updates.enabled === false) {
  window.hide();
} else if (updates.enabled === true) {
  window.show();
}
```

**2.2 Update `restoreFrames()` to only open enabled frames**

The current implementation already does this (line 473):

```typescript
const frames = configService.getFrames().filter(frame => frame.enabled);
```

**2.3 Add `enableAllFrames()` and `disableAllFrames()` methods**

```typescript
enableAllFrames(): void {
  const frames = configService.getFrames();
  frames.forEach(frame => {
    this.updateFrame(frame.id, { enabled: true });
  });
  logService.info('All frames enabled');
}

disableAllFrames(): void {
  const frames = configService.getFrames();
  frames.forEach(frame => {
    this.updateFrame(frame.id, { enabled: false });
  });
  logService.info('All frames disabled');
}
```

---

### 3. Add Confirmation for Frame Removal

#### Files to Modify:
- [`src/main/window-manager.ts`](src/main/window-manager.ts)
- [`src/main/ipc-handlers.ts`](src/main/ipc-handlers.ts)
- [`src/renderer/settings/index.ts`](src/renderer/settings/index.ts)

#### Changes:

**3.1 Update `removeFrame()` to show confirmation dialog**

```typescript
import { dialog } from 'electron';

async removeFrame(id: string): Promise<void> {
  const window = this.frameWindows.get(id);
  const config = configService.getFrame(id);

  if (!config) {
    logService.warn('Frame not found for removal', { id });
    return;
  }

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Remove', 'Cancel'],
    title: 'Remove Frame?',
    message: 'Are you sure you want to remove this frame?',
    detail: `URL: ${config.url}\nID: ${config.id.slice(0, 8)}`,
    defaultId: 1, // Default to Cancel
    cancelId: 1,
  });

  if (choice === 0) {
    // User confirmed removal
    if (window) {
      window.close();
    }
    this.releaseColor(config.color);
    configService.removeFrame(id);
    logService.info('Frame removed', { id });
  } else {
    logService.info('Frame removal cancelled', { id });
  }
}
```

**3.2 Update IPC handler to handle async removal**

```typescript
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
```

**3.3 Update Settings UI to handle async removal**

The current implementation already uses async/await, so no changes needed here.

---

### 4. Add Enable All / Disable All Buttons

#### Files to Modify:
- [`src/renderer/settings/index.html`](src/renderer/settings/index.html)
- [`src/renderer/settings/index.ts`](src/renderer/settings/index.ts)
- [`src/main/ipc-handlers.ts`](src/main/ipc-handlers.ts)
- [`src/shared/constants.ts`](src/shared/constants.ts)
- [`src/shared/types.ts`](src/shared/types.ts)

#### Changes:

**4.1 Add IPC channels**

```typescript
// src/shared/constants.ts
export const IPC_CHANNELS = {
  // ... existing channels
  FRAME_ENABLE_ALL: 'frame:enable-all',
  FRAME_DISABLE_ALL: 'frame:disable-all',
} as const;
```

**4.2 Add IPC handlers**

```typescript
// src/main/ipc-handlers.ts
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
```

**4.3 Add buttons to Settings UI**

```html
<!-- src/renderer/settings/index.html -->
<div class="bulk-actions">
  <button id="enable-all-btn" class="btn btn-secondary">Enable All</button>
  <button id="disable-all-btn" class="btn btn-secondary">Disable All</button>
</div>
```

**4.4 Add button handlers in Settings**

```typescript
// src/renderer/settings/index.ts
const elements = {
  // ... existing elements
  enableAllBtn: document.getElementById('enable-all-btn') as HTMLButtonElement,
  disableAllBtn: document.getElementById('disable-all-btn') as HTMLButtonElement,
};

elements.enableAllBtn.addEventListener('click', async () => {
  await window.sdFrame.frame.enableAll();
  await loadFrames();
});

elements.disableAllBtn.addEventListener('click', async () => {
  await window.sdFrame.frame.disableAll();
  await loadFrames();
});
```

**4.5 Update preload script**

```typescript
// src/main/preload.ts
contextBridge.exposeInMainWorld('sdFrame', {
  // ... existing methods
  frame: {
    // ... existing methods
    enableAll: () => ipcRenderer.invoke(IPC_CHANNELS.FRAME_ENABLE_ALL),
    disableAll: () => ipcRenderer.invoke(IPC_CHANNELS.FRAME_DISABLE_ALL),
  },
});
```

---

### 5. Auto-Open Settings When No Frames Enabled

#### Files to Modify:
- [`src/main/index.ts`](src/main/index.ts)

#### Changes:

**5.1 Check if any frames are enabled before restoring**

```typescript
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
```

---

## Updated Tray Menu Structure

The tray menu should be updated to reflect the new behavior:

```
├── Add Frame...
├── ──────────────
├── Frame abc12345
│   ├── ● Enabled / ○ Disabled
│   ├── https://example.com
│   ├── ──────────────
│   ├── Focus
│   ├── Enable / Disable
│   ├── Edit URL...
│   ├── Reset Position
│   ├── ──────────────
│   └── Remove
├── ──────────────
├── Enable All Frames
├── Disable All Frames
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

## Implementation Steps

### Step 1: Update WindowManager
- [ ] Remove `closed` event handler
- [ ] Add `beforeunload` handler to prevent closing
- [ ] Add `enableAllFrames()` method
- [ ] Add `disableAllFrames()` method
- [ ] Update `removeFrame()` to show confirmation dialog

### Step 2: Update IPC Handlers
- [ ] Add `FRAME_ENABLE_ALL` handler
- [ ] Add `FRAME_DISABLE_ALL` handler
- [ ] Update `FRAME_REMOVE` handler to be async

### Step 3: Update Shared Types and Constants
- [ ] Add `FRAME_ENABLE_ALL` to IPC_CHANNELS
- [ ] Add `FRAME_DISABLE_ALL` to IPC_CHANNELS

### Step 4: Update Preload Script
- [ ] Add `enableAll()` to frame API
- [ ] Add `disableAll()` to frame API

### Step 5: Update Settings UI
- [ ] Add "Enable All" and "Disable All" buttons to HTML
- [ ] Add button event handlers
- [ ] Update CSS for bulk actions section

### Step 6: Update Tray Manager
- [ ] Add "Enable All Frames" menu item
- [ ] Add "Disable All Frames" menu item

### Step 7: Update Main Entry Point
- [ ] Add check for enabled frames before restoring
- [ ] Open settings if no frames are enabled

---

## Testing Checklist

- [ ] Verify frame windows cannot be closed via X button
- [ ] Verify enable/disable hides/shows windows correctly
- [ ] Verify confirmation dialog appears when removing a frame
- [ ] Verify "Enable All" enables all frames and shows windows
- [ ] Verify "Disable All" disables all frames and hides windows
- [ ] Verify settings opens automatically when no frames are enabled
- [ ] Verify settings opens on first run
- [ ] Verify tray menu items work correctly
- [ ] Verify frame removal can be cancelled
- [ ] Verify app stays running when all frames are disabled

---

## Files to Modify

| File | Changes |
|------|---------|
| [`src/main/window-manager.ts`](src/main/window-manager.ts) | Remove closed handler, add beforeunload, add enableAll/disableAll, update removeFrame |
| [`src/main/ipc-handlers.ts`](src/main/ipc-handlers.ts) | Add enableAll/disableAll handlers |
| [`src/main/index.ts`](src/main/index.ts) | Add check for enabled frames |
| [`src/main/tray-manager.ts`](src/main/tray-manager.ts) | Add Enable All/Disable All menu items |
| [`src/main/preload.ts`](src/main/preload.ts) | Add enableAll/disableAll to API |
| [`src/shared/constants.ts`](src/shared/constants.ts) | Add new IPC channels |
| [`src/renderer/settings/index.html`](src/renderer/settings/index.html) | Add bulk action buttons |
| [`src/renderer/settings/index.ts`](src/renderer/settings/index.ts) | Add button handlers |
| [`src/renderer/settings/styles.css`](src/renderer/settings/styles.css) | Add styles for bulk actions |
