interface SnapTarget {
  frameId: string;
  edge: 'left' | 'right' | 'top' | 'bottom' | 'align-top' | 'align-bottom' | 'align-left' | 'align-right' | 'unknown';
  distance?: number;
}

interface FrameConfig {
  id: string;
  name?: string;
  url: string;
  enabled: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  snappedTo: SnapTarget[];
}

interface FrameSizeSettings {
  width: number;
  height: number;
}

interface AppConfig {
  version: 1;
  snapEnabled: boolean;
  snapThreshold: number;
  groupMovementEnabled: boolean;
  layoutLocked: boolean;
  alwaysOnTop: boolean;
  autoReloadOn404: boolean;
  autoReload404IntervalSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  frameSize: FrameSizeSettings;
  frames: FrameConfig[];
}

interface UpdateStatus {
  state: 'unsupported' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'installing';
  message: string;
  version?: string;
  percent?: number;
}

// The settings window is the only context guaranteed to receive the full API.
type SdFrameFullApi = {
  frame: {
    add: (p: { name?: string; url: string; bounds?: Partial<FrameConfig['bounds']> }) => Promise<{ success: boolean; error?: string }>;
    update: (p: { id: string; config: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>;
    remove: (p: { id: string }) => Promise<{ success: boolean; error?: string }>;
    focus: (p: { id: string }) => Promise<{ success: boolean; error?: string }>;
    resetLayout: (p: { id?: string }) => Promise<{ success: boolean; error?: string }>;
    resetDimensions: () => Promise<{ success: boolean; error?: string }>;
    setGroupHeight: (p: { id: string; height: number }) => Promise<{ success: boolean; error?: string; frameCount?: number }>;
    getAll: () => Promise<{ success: boolean; frames?: FrameConfig[] }>;
    unsnap: (p: { id: string; edge?: string; all?: boolean }) => Promise<{ success: boolean; error?: string }>;
    enableAll: () => Promise<{ success: boolean }>;
    disableAll: () => Promise<{ success: boolean }>;
  };
  tray: {
    showMenu: (x: number, y: number) => Promise<{ success: boolean; error?: string }>;
  };
  settings: {
    minimize: () => Promise<{ success: boolean; error?: string }>;
    hide: () => Promise<{ success: boolean; error?: string }>;
    onUpdateStatusChanged: (callback: (status: UpdateStatus) => void) => void;
  };
  debug: {
    viewLog: () => Promise<{ success: boolean; error?: string }>;
    openDevTools: () => Promise<{ success: boolean; error?: string }>;
  };
  config: {
    get: () => Promise<{ success: boolean; config?: AppConfig; error?: string }>;
    set: (p: { key: string; value: unknown }) => Promise<{ success: boolean; error?: string }>;
    import: () => Promise<{ success: boolean; canceled?: boolean; error?: string; config?: AppConfig; fileName?: string }>;
    applyImport: (p: {
      config: AppConfig;
      selectedFrameIds: string[];
      includeSettings: boolean;
      mode: 'add' | 'replace';
    }) => Promise<{
      success: boolean;
      error?: string;
      config?: AppConfig;
      importedFrameCount?: number;
      mode?: 'add' | 'replace';
      includedSettings?: boolean;
      backupPath?: string;
    }>;
    export: () => Promise<{ success: boolean; canceled?: boolean; error?: string; fileName?: string }>;
  };
  page: {
    retry: (frameId: string) => Promise<{ success: boolean; error?: string }>;
  };
  app: {
    getVersion: () => Promise<{ success: boolean; version?: string }>;
    getUpdateStatus: () => Promise<{ success: boolean; status?: UpdateStatus }>;
    checkForUpdates: () => Promise<{ success: boolean; status?: UpdateStatus; error?: string }>;
    installUpdate: () => Promise<{ success: boolean; error?: string }>;
    quit: () => Promise<{ success: boolean }>;
  };
  getQueryParams: () => Record<string, string>;
};

const sdFrame = window.sdFrame as unknown as SdFrameFullApi;
let framesLoadSequence = 0;

const elements = {
  addFrameForm: document.getElementById('add-frame-form') as HTMLFormElement,
  nameInput: document.getElementById('name-input') as HTMLInputElement,
  urlInput: document.getElementById('url-input') as HTMLInputElement,
  framesContainer: document.getElementById('frames-container') as HTMLDivElement,
  enableAllBtn: document.getElementById('enable-all-btn') as HTMLButtonElement,
  disableAllBtn: document.getElementById('disable-all-btn') as HTMLButtonElement,
  snapEnabled: document.getElementById('snap-enabled') as HTMLInputElement,
  groupMovement: document.getElementById('group-movement') as HTMLInputElement,
  snapThreshold: document.getElementById('snap-threshold') as HTMLSelectElement,
  layoutLocked: document.getElementById('layout-locked') as HTMLInputElement,
  alwaysOnTop: document.getElementById('always-on-top') as HTMLInputElement,
  autoReload404: document.getElementById('auto-reload-404') as HTMLInputElement,
  autoReload404Interval: document.getElementById('auto-reload-404-interval') as HTMLSelectElement,
  logLevel: document.getElementById('log-level') as HTMLSelectElement,
  frameWidth: document.getElementById('frame-width') as HTMLInputElement,
  frameHeight: document.getElementById('frame-height') as HTMLInputElement,
  groupHeightFrame: document.getElementById('group-height-frame') as HTMLSelectElement,
  groupHeight: document.getElementById('group-height-input') as HTMLInputElement,
  applyGroupHeightBtn: document.getElementById('apply-group-height-btn') as HTMLButtonElement,
  groupHeightStatus: document.getElementById('group-height-status') as HTMLParagraphElement,
  resetDimensionsBtn: document.getElementById('reset-dimensions-btn') as HTMLButtonElement,
  resetAllBtn: document.getElementById('reset-all-btn') as HTMLButtonElement,
  importConfigBtn: document.getElementById('import-config-btn') as HTMLButtonElement,
  exportConfigBtn: document.getElementById('export-config-btn') as HTMLButtonElement,
  configFileStatus: document.getElementById('config-file-status') as HTMLParagraphElement,
  frameCount: document.getElementById('frame-count') as HTMLSpanElement,
  frameSummary: document.getElementById('frame-summary') as HTMLSpanElement,
  appVersion: document.getElementById('app-version') as HTMLSpanElement,
  checkUpdatesBtn: document.getElementById('check-updates-btn') as HTMLButtonElement,
  installUpdateBtn: document.getElementById('install-update-btn') as HTMLButtonElement,
  updateStatus: document.getElementById('update-status') as HTMLParagraphElement,
  menuButton: document.getElementById('settings-menu-btn') as HTMLButtonElement,
  minimizeButton: document.getElementById('settings-minimize-btn') as HTMLButtonElement,
  closeButton: document.getElementById('settings-close-btn') as HTMLButtonElement,
  viewLogButton: document.getElementById('view-log-btn') as HTMLButtonElement,
  openDevConsoleButton: document.getElementById('open-dev-console-btn') as HTMLButtonElement,
  debugStatus: document.getElementById('debug-status') as HTMLParagraphElement,
  importDialog: document.getElementById('config-import-dialog') as HTMLDialogElement,
  importFile: document.getElementById('config-import-file') as HTMLParagraphElement,
  importSettings: document.getElementById('import-settings-checkbox') as HTMLInputElement,
  importFrameList: document.getElementById('import-frame-list') as HTMLDivElement,
  importFrameCount: document.getElementById('import-frame-count') as HTMLParagraphElement,
  importDialogStatus: document.getElementById('import-dialog-status') as HTMLParagraphElement,
  selectAllImportFrames: document.getElementById('select-all-import-frames') as HTMLButtonElement,
  clearImportFrames: document.getElementById('clear-import-frames') as HTMLButtonElement,
  cancelImportBtn: document.getElementById('cancel-import-btn') as HTMLButtonElement,
  applyImportBtn: document.getElementById('apply-import-btn') as HTMLButtonElement,
};

let pendingImportConfig: AppConfig | null = null;
let pendingImportFileName = '';

async function loadConfig(): Promise<void> {
  const response = await sdFrame.config.get();
  if (response && response.success && response.config) {
    applyConfig(response.config);
  }
}

async function loadAppVersion(): Promise<void> {
  const response = await sdFrame.app.getVersion();
  if (response?.success && response.version) {
    elements.appVersion.textContent = `v${response.version}`;
  }
}

function renderUpdateStatus(status: UpdateStatus): void {
  elements.updateStatus.textContent = status.message;
  elements.checkUpdatesBtn.disabled = status.state === 'checking' || status.state === 'downloading';
  elements.installUpdateBtn.hidden = status.state !== 'downloaded';
}

async function loadUpdateStatus(): Promise<void> {
  const response = await sdFrame.app.getUpdateStatus();
  if (response?.success && response.status) {
    renderUpdateStatus(response.status);
  }
}

function applyConfig(config: AppConfig): void {
  elements.snapEnabled.checked = config.snapEnabled;
  elements.groupMovement.checked = config.groupMovementEnabled;
  elements.snapThreshold.value = String(config.snapThreshold);
  elements.layoutLocked.checked = config.layoutLocked;
  elements.alwaysOnTop.checked = config.alwaysOnTop;
  elements.autoReload404.checked = config.autoReloadOn404;
  elements.autoReload404Interval.value = String(config.autoReload404IntervalSeconds);
  elements.autoReload404Interval.disabled = !config.autoReloadOn404;
  elements.logLevel.value = config.logLevel;
  elements.frameWidth.value = String(config.frameSize.width);
  elements.frameHeight.value = String(config.frameSize.height);
}

async function loadFrames(): Promise<void> {
  const requestSequence = ++framesLoadSequence;
  const response = await sdFrame.frame.getAll();
  if (requestSequence === framesLoadSequence && response && response.success && response.frames) {
    renderFrames(response.frames as FrameConfig[]);
  }
}

function renderFrames(frames: FrameConfig[]): void {
  const activeCount = frames.filter(frame => frame.enabled).length;
  elements.frameCount.textContent = String(frames.length);
  elements.frameSummary.textContent = `${activeCount} active · ${frames.length} total`;

  const previouslySelectedId = elements.groupHeightFrame.value;
  const enabledFrames = frames.filter(frame => frame.enabled);
  elements.groupHeightFrame.innerHTML = enabledFrames.map(frame =>
    `<option value="${frame.id}">${escapeHtml(frame.name || frame.id.slice(0, 8))}</option>`
  ).join('');
  elements.groupHeightFrame.disabled = enabledFrames.length === 0;
  elements.groupHeight.disabled = enabledFrames.length === 0;
  elements.applyGroupHeightBtn.disabled = enabledFrames.length === 0;

  if (enabledFrames.length > 0) {
    const selectedFrame = enabledFrames.find(frame => frame.id === previouslySelectedId) ?? enabledFrames[0];
    elements.groupHeightFrame.value = selectedFrame.id;
    if (selectedFrame.id !== previouslySelectedId) {
      elements.groupHeight.value = String(selectedFrame.bounds.height);
    }

  }

  if (frames.length === 0) {
    elements.framesContainer.innerHTML = '<p class="no-frames">No frames configured</p>';
    return;
  }

  const html = frames.map(frame => `
    <div class="frame-item" style="border-left-color: ${frame.color}" data-id="${frame.id}">
      <div class="frame-header">
        <div class="frame-color" style="background: ${frame.color}"></div>
        <div class="frame-info">
          <div class="frame-id">${escapeHtml(frame.name || frame.id.slice(0, 8))}</div>
          <div class="frame-url" title="${escapeHtml(frame.url)}">${escapeHtml(frame.url)}</div>
        </div>
        <span class="frame-status ${frame.enabled ? '' : 'disabled'}">
          ${frame.enabled ? 'Active' : 'Disabled'}
        </span>
      </div>
      <div class="frame-actions">
        <button class="btn btn-secondary btn-small focus-btn" data-id="${frame.id}">Focus</button>
        <button class="btn btn-secondary btn-small toggle-btn" data-id="${frame.id}">
          ${frame.enabled ? 'Disable' : 'Enable'}
        </button>
        <button class="btn btn-secondary btn-small unsnap-btn" data-id="${frame.id}" ${frame.snappedTo.length === 0 ? 'disabled' : ''}>Unsnap</button>
        <button class="btn btn-secondary btn-small edit-btn" data-id="${frame.id}">Edit</button>
        <button class="btn btn-danger btn-small remove-btn" data-id="${frame.id}">Remove</button>
      </div>
      <div class="edit-form hidden" data-edit-id="${frame.id}">
        <input type="text" class="edit-name-input" value="${escapeHtml(frame.name || '')}" placeholder="Frame name">
        <input type="url" class="edit-url-input" value="${escapeHtml(frame.url)}" placeholder="https://example.com">
        <div class="edit-size-inputs">
          <div class="edit-size-input">
            <label for="edit-width-${frame.id}">Width</label>
            <input type="number" id="edit-width-${frame.id}" class="edit-width-input" value="${frame.bounds.width}" min="100" max="5000" step="10">
          </div>
          <div class="edit-size-input">
            <label for="edit-height-${frame.id}">Height</label>
            <input type="number" id="edit-height-${frame.id}" class="edit-height-input" value="${frame.bounds.height}" min="100" max="5000" step="10">
          </div>
        </div>
        <div class="edit-actions">
          <button class="btn btn-primary btn-small save-edit-btn" data-id="${frame.id}">Save</button>
          <button class="btn btn-secondary btn-small cancel-edit-btn" data-id="${frame.id}">Cancel</button>
        </div>
      </div>
    </div>
  `).join('');

  elements.framesContainer.innerHTML = html;
  attachFrameListeners();
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function attachFrameListeners(): void {
  elements.framesContainer.querySelectorAll('.focus-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await sdFrame.frame.focus({ id });
      }
    });
  });

  elements.framesContainer.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        const response = await sdFrame.frame.getAll();
        if (response && response.success && response.frames) {
          const frame = (response.frames as FrameConfig[]).find(f => f.id === id);
          if (frame) {
            await sdFrame.frame.update({ id, config: { enabled: !frame.enabled } });
            await loadFrames();
          }
        }
      }
    });
  });

  elements.framesContainer.querySelectorAll('.unsnap-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await sdFrame.frame.unsnap({ id, all: true });
        await loadFrames();
      }
    });
  });

  elements.framesContainer.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        const editForm = elements.framesContainer.querySelector(`[data-edit-id="${id}"]`);
        if (editForm) {
          editForm.classList.toggle('hidden');
        }
      }
    });
  });

  elements.framesContainer.querySelectorAll('.save-edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        const editForm = elements.framesContainer.querySelector(`[data-edit-id="${id}"]`);
        const nameInput = editForm?.querySelector('.edit-name-input') as HTMLInputElement;
        const urlInput = editForm?.querySelector('.edit-url-input') as HTMLInputElement;
        const widthInput = editForm?.querySelector('.edit-width-input') as HTMLInputElement;
        const heightInput = editForm?.querySelector('.edit-height-input') as HTMLInputElement;
        
        if (urlInput && urlInput.value) {
          const config: any = { url: urlInput.value };
          
          // Always include name, even if empty
          if (nameInput) {
            config.name = nameInput.value.trim() || undefined;
          }
          
          // Fetch current frame config to merge bounds values
          const currentFramesResponse = await sdFrame.frame.getAll();
          let currentBounds = { x: 0, y: 0, width: 800, height: 600 };
          
          if (currentFramesResponse && currentFramesResponse.success && currentFramesResponse.frames) {
            const currentFrame = (currentFramesResponse.frames as FrameConfig[]).find(f => f.id === id);
            if (currentFrame) {
              currentBounds = currentFrame.bounds;
            }
          }
          
          if (widthInput && widthInput.value) {
            const width = parseInt(widthInput.value, 10);
            if (width >= 100 && width <= 5000) {
              // Merge with current x/y values
              config.bounds = { 
                x: currentBounds.x,
                y: currentBounds.y,
                width: width,
                height: currentBounds.height 
              };
            }
          }
          
          if (heightInput && heightInput.value) {
            const height = parseInt(heightInput.value, 10);
            if (height >= 100 && height <= 5000) {
              // Merge with current x/y values and width if already set
              if (!config.bounds) config.bounds = {};
              config.bounds = { 
                x: currentBounds.x,
                y: currentBounds.y,
                width: config.bounds.width || currentBounds.width,
                height: height 
              };
            }
          }
          
          await sdFrame.frame.update({ id, config });
          await loadFrames();
        }
      }
    });
  });

  elements.framesContainer.querySelectorAll('.cancel-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        const editForm = elements.framesContainer.querySelector(`[data-edit-id="${id}"]`);
        if (editForm) {
          editForm.classList.add('hidden');
        }
      }
    });
  });

  elements.framesContainer.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await sdFrame.frame.remove({ id });
        await loadFrames();
      }
    });
  });
}

elements.addFrameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = elements.nameInput.value.trim();
  const url = elements.urlInput.value.trim();
  if (url) {
    try {
      const payload: any = { url };
      if (name) {
        payload.name = name;
      }
      const result = await sdFrame.frame.add(payload);
      console.log('Add frame result:', result);
      if (result && !result.success) {
        alert('Failed to add frame: ' + result.error);
      }
      elements.nameInput.value = '';
      elements.urlInput.value = '';
      await loadFrames();
    } catch (err) {
      console.error('Add frame error:', err);
      alert('Error adding frame: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
});

elements.snapEnabled.addEventListener('change', async () => {
  await sdFrame.config.set({ key: 'snapEnabled', value: elements.snapEnabled.checked });
});

elements.groupMovement.addEventListener('change', async () => {
  await sdFrame.config.set({ key: 'groupMovementEnabled', value: elements.groupMovement.checked });
});

elements.snapThreshold.addEventListener('change', async () => {
  await sdFrame.config.set({ key: 'snapThreshold', value: parseInt(elements.snapThreshold.value, 10) });
});

elements.layoutLocked.addEventListener('change', async () => {
  await sdFrame.config.set({ key: 'layoutLocked', value: elements.layoutLocked.checked });
});

elements.alwaysOnTop.addEventListener('change', async () => {
  await sdFrame.config.set({ key: 'alwaysOnTop', value: elements.alwaysOnTop.checked });
});

elements.autoReload404.addEventListener('change', async () => {
  elements.autoReload404Interval.disabled = !elements.autoReload404.checked;
  await sdFrame.config.set({ key: 'autoReloadOn404', value: elements.autoReload404.checked });
});

elements.autoReload404Interval.addEventListener('change', async () => {
  await sdFrame.config.set({
    key: 'autoReload404IntervalSeconds',
    value: parseInt(elements.autoReload404Interval.value, 10),
  });
});

elements.logLevel.addEventListener('change', async () => {
  const value = elements.logLevel.value as 'debug' | 'info' | 'warn' | 'error';
  await sdFrame.config.set({ key: 'logLevel', value });
});

elements.frameWidth.addEventListener('change', async () => {
  const width = parseInt(elements.frameWidth.value, 10);
  if (width >= 100 && width <= 5000) {
    const response = await sdFrame.config.get();
    if (response && response.success && response.config) {
      const newFrameSize = {
        width,
        height: response.config.frameSize.height,
      };
      await sdFrame.config.set({ key: 'frameSize', value: newFrameSize });
    }
  }
});

elements.frameHeight.addEventListener('change', async () => {
  const height = parseInt(elements.frameHeight.value, 10);
  if (height >= 100 && height <= 5000) {
    const response = await sdFrame.config.get();
    if (response && response.success && response.config) {
      const newFrameSize = {
        width: response.config.frameSize.width,
        height,
      };
      await sdFrame.config.set({ key: 'frameSize', value: newFrameSize });
    }
  }
});

elements.groupHeightFrame.addEventListener('change', async () => {
  const response = await sdFrame.frame.getAll();
  const frame = response?.frames?.find(candidate => candidate.id === elements.groupHeightFrame.value);
  if (frame) {
    elements.groupHeight.value = String(frame.bounds.height);
    elements.groupHeightStatus.textContent = '';
  }
});

elements.applyGroupHeightBtn.addEventListener('click', async () => {
  const height = parseInt(elements.groupHeight.value, 10);
  if (!Number.isInteger(height) || height < 100 || height > 5000) {
    elements.groupHeightStatus.textContent = 'Enter a height between 100 and 5000 pixels.';
    return;
  }

  const response = await sdFrame.frame.setGroupHeight({
    id: elements.groupHeightFrame.value,
    height,
  });
  if (!response?.success) {
    elements.groupHeightStatus.textContent = response?.error || 'Could not change the group height.';
    return;
  }

  const frameCount = response.frameCount ?? 0;
  elements.groupHeightStatus.textContent = `Height applied to ${frameCount} frame${frameCount === 1 ? '' : 's'}.`;
  await loadFrames();
});

elements.resetDimensionsBtn.addEventListener('click', async () => {
  await sdFrame.frame.resetDimensions();
});

elements.resetAllBtn.addEventListener('click', async () => {
  await sdFrame.frame.resetLayout({});
});

elements.enableAllBtn.addEventListener('click', async () => {
  await sdFrame.frame.enableAll();
  await loadFrames();
});

elements.disableAllBtn.addEventListener('click', async () => {
  await sdFrame.frame.disableAll();
  await loadFrames();
});

elements.menuButton.addEventListener('click', async () => {
  const bounds = elements.menuButton.getBoundingClientRect();
  const response = await sdFrame.tray.showMenu(Math.round(bounds.left), Math.round(bounds.bottom));
  if (!response?.success) {
    elements.configFileStatus.textContent = response?.error || 'Could not open the menu.';
  }
});

elements.minimizeButton.addEventListener('click', async () => {
  const response = await sdFrame.settings.minimize();
  if (!response?.success) {
    elements.configFileStatus.textContent = response?.error || 'Could not minimize the window.';
  }
});

elements.closeButton.addEventListener('click', async () => {
  const response = await sdFrame.settings.hide();
  if (!response?.success) {
    elements.configFileStatus.textContent = response?.error || 'Could not close the window to the tray.';
  }
});

elements.checkUpdatesBtn.addEventListener('click', async () => {
  elements.checkUpdatesBtn.disabled = true;
  try {
    const response = await sdFrame.app.checkForUpdates();
    if (response?.status) {
      renderUpdateStatus(response.status);
    } else if (!response?.success) {
      elements.updateStatus.textContent = response?.error || 'Could not check for updates.';
      elements.checkUpdatesBtn.disabled = false;
    }
  } catch (error) {
    elements.updateStatus.textContent = error instanceof Error ? error.message : 'Could not check for updates.';
    elements.checkUpdatesBtn.disabled = false;
  }
});

elements.installUpdateBtn.addEventListener('click', async () => {
  elements.installUpdateBtn.disabled = true;
  try {
    const response = await sdFrame.app.installUpdate();
    if (!response?.success) {
      elements.updateStatus.textContent = response?.error || 'Could not install the update.';
      elements.installUpdateBtn.disabled = false;
    }
  } catch (error) {
    elements.updateStatus.textContent = error instanceof Error ? error.message : 'Could not install the update.';
    elements.installUpdateBtn.disabled = false;
  }
});

sdFrame.settings.onUpdateStatusChanged(renderUpdateStatus);

elements.viewLogButton.addEventListener('click', async () => {
  elements.debugStatus.textContent = '';
  elements.viewLogButton.disabled = true;
  try {
    const response = await sdFrame.debug.viewLog();
    elements.debugStatus.textContent = response?.success
      ? 'Opening logfile…'
      : response?.error || 'Could not open the logfile.';
  } catch (error) {
    elements.debugStatus.textContent = error instanceof Error ? error.message : 'Could not open the logfile.';
  } finally {
    elements.viewLogButton.disabled = false;
  }
});

elements.openDevConsoleButton.addEventListener('click', async () => {
  elements.debugStatus.textContent = '';
  elements.openDevConsoleButton.disabled = true;
  try {
    const response = await sdFrame.debug.openDevTools();
    elements.debugStatus.textContent = response?.success
      ? 'Developer console opened.'
      : response?.error || 'Could not open the developer console.';
  } catch (error) {
    elements.debugStatus.textContent = error instanceof Error ? error.message : 'Could not open the developer console.';
  } finally {
    elements.openDevConsoleButton.disabled = false;
  }
});

elements.importConfigBtn.addEventListener('click', async () => {
  elements.configFileStatus.textContent = '';
  elements.importConfigBtn.disabled = true;
  const originalText = elements.importConfigBtn.textContent;
  elements.importConfigBtn.textContent = 'Choose config...';
  try {
    const response = await sdFrame.config.import();
    if (!response?.success) {
      elements.configFileStatus.textContent = response?.error || 'Could not open the config file.';
      return;
    }
    if (response.canceled || !response.config) {
      return;
    }

    pendingImportConfig = response.config;
    pendingImportFileName = response.fileName || 'Selected config';
    elements.importFile.textContent = `${pendingImportFileName} — config validated. Choose settings and frames below.`;
    elements.importSettings.checked = true;
    const addMode = document.querySelector<HTMLInputElement>('input[name="import-mode"][value="add"]');
    if (addMode) addMode.checked = true;
    elements.cancelImportBtn.disabled = false;
    elements.importDialogStatus.textContent = '';
    elements.importFrameList.innerHTML = response.config.frames.length
      ? response.config.frames.map(frame => `
        <label class="import-frame-option">
          <input class="import-frame-checkbox" type="checkbox" value="${escapeHtml(frame.id)}" checked>
          <span class="import-frame-details">
            <span class="import-frame-name">${escapeHtml(frame.name || frame.id.slice(0, 8))}${frame.enabled ? '' : ' (disabled)'}</span>
            <span class="import-frame-url">${escapeHtml(frame.url)}</span>
          </span>
        </label>
      `).join('')
      : '<p class="import-empty">This config contains no frames.</p>';
    updateImportSelection();
    elements.importDialog.showModal();
  } catch (error) {
    elements.configFileStatus.textContent = error instanceof Error ? error.message : 'Could not read the config file.';
  } finally {
    elements.importConfigBtn.disabled = false;
    elements.importConfigBtn.textContent = originalText;
  }
});

function getSelectedImportMode(): 'add' | 'replace' {
  const selected = document.querySelector<HTMLInputElement>('input[name="import-mode"]:checked');
  return selected?.value === 'replace' ? 'replace' : 'add';
}

function updateImportSelection(): void {
  const checkedCount = elements.importFrameList.querySelectorAll<HTMLInputElement>('.import-frame-checkbox:checked').length;
  const totalCount = elements.importFrameList.querySelectorAll<HTMLInputElement>('.import-frame-checkbox').length;
  elements.importFrameCount.textContent = `${checkedCount} of ${totalCount} frame${totalCount === 1 ? '' : 's'} selected.`;
  elements.applyImportBtn.disabled = !elements.importSettings.checked && checkedCount === 0;
  elements.applyImportBtn.textContent = 'Import selected';
}

elements.importFrameList.addEventListener('change', updateImportSelection);
elements.importSettings.addEventListener('change', updateImportSelection);
document.querySelectorAll<HTMLInputElement>('input[name="import-mode"]').forEach(input => {
  input.addEventListener('change', updateImportSelection);
});

elements.selectAllImportFrames.addEventListener('click', () => {
  elements.importFrameList.querySelectorAll<HTMLInputElement>('.import-frame-checkbox').forEach(input => {
    input.checked = true;
  });
  updateImportSelection();
});

elements.clearImportFrames.addEventListener('click', () => {
  elements.importFrameList.querySelectorAll<HTMLInputElement>('.import-frame-checkbox').forEach(input => {
    input.checked = false;
  });
  updateImportSelection();
});

elements.cancelImportBtn.addEventListener('click', () => {
  pendingImportConfig = null;
  elements.importDialog.close();
});

elements.importDialog.addEventListener('cancel', () => {
  pendingImportConfig = null;
});

elements.applyImportBtn.addEventListener('click', async () => {
  if (!pendingImportConfig) {
    elements.importDialogStatus.textContent = 'Choose a config file to continue.';
    return;
  }
  elements.applyImportBtn.disabled = true;
  elements.cancelImportBtn.disabled = true;
  elements.importDialogStatus.textContent = 'Checking current config...';
  try {
    const selectedFrameIds = Array.from(
      elements.importFrameList.querySelectorAll<HTMLInputElement>('.import-frame-checkbox:checked'),
      input => input.value
    );
    const mode = getSelectedImportMode();
    const currentResponse = await sdFrame.config.get();
    if (!currentResponse?.success || !currentResponse.config) {
      elements.importDialogStatus.textContent = currentResponse?.error || 'Could not read your current config.';
      return;
    }
    const currentFrameCount = currentResponse.config.frames.length;

    if (mode === 'replace') {
      const backupNotice = currentFrameCount > 0
        ? ` Your current config will be backed up automatically first (${currentFrameCount} saved frame${currentFrameCount === 1 ? '' : 's'} found).`
        : ' No current frames were found, so no frame backup will be created.';
      const settingsNotice = elements.importSettings.checked
        ? ' Global settings will also be replaced.'
        : ' Your current global settings will be kept.';
      const frameNotice = selectedFrameIds.length > 0
        ? ` Replace your existing frames with ${selectedFrameIds.length} selected frame${selectedFrameIds.length === 1 ? '' : 's'} from "${pendingImportFileName}"?`
        : ` Remove all existing frames using "${pendingImportFileName}"?`;
      if (!window.confirm(`${frameNotice}${settingsNotice}${backupNotice}`)) {
        elements.importDialogStatus.textContent = '';
        return;
      }
    }

    elements.importDialogStatus.textContent = 'Applying config...';
    const response = await sdFrame.config.applyImport({
      config: pendingImportConfig,
      selectedFrameIds,
      includeSettings: elements.importSettings.checked,
      mode,
    });
    if (!response?.success || !response.config) {
      elements.importDialogStatus.textContent = response?.error || 'Could not complete the import.';
      return;
    }

    framesLoadSequence++;
    applyConfig(response.config);
    renderFrames(response.config.frames);
    const count = response.importedFrameCount ?? 0;
    const action = mode === 'replace' ? 'Replaced frames with' : 'Added';
    const settingsResult = response.includedSettings ? ' Imported settings.' : '';
    const backupResult = response.backupPath ? ` Backup saved to ${response.backupPath}.` : '';
    elements.configFileStatus.textContent = `${action} ${count} frame${count === 1 ? '' : 's'}.${settingsResult}${backupResult}`;
    pendingImportConfig = null;
    elements.importDialog.close();
  } catch (error) {
    elements.importDialogStatus.textContent = error instanceof Error ? error.message : 'Could not complete the import.';
  } finally {
    if (elements.importDialog.open) {
      elements.applyImportBtn.disabled = false;
      elements.cancelImportBtn.disabled = false;
      updateImportSelection();
    }
  }
});

elements.exportConfigBtn.addEventListener('click', async () => {
  elements.configFileStatus.textContent = '';
  elements.exportConfigBtn.disabled = true;
  const originalText = elements.exportConfigBtn.textContent;
  elements.exportConfigBtn.textContent = 'Exporting...';
  try {
    const response = await sdFrame.config.export();
    if (!response?.success) {
      elements.configFileStatus.textContent = response?.error || 'Export failed.';
    } else if (!response.canceled) {
      elements.configFileStatus.textContent = `Config exported${response.fileName ? ` as ${response.fileName}` : ''}.`;
    }
  } catch (error) {
    elements.configFileStatus.textContent = error instanceof Error ? error.message : 'Export failed.';
  } finally {
    elements.exportConfigBtn.disabled = false;
    elements.exportConfigBtn.textContent = originalText;
  }
});

loadConfig();
loadFrames();
loadAppVersion();
loadUpdateStatus();
