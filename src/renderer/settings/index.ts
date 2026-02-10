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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  frameSize: FrameSizeSettings;
  frames: FrameConfig[];
}

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
  logLevel: document.getElementById('log-level') as HTMLSelectElement,
  frameWidth: document.getElementById('frame-width') as HTMLInputElement,
  frameHeight: document.getElementById('frame-height') as HTMLInputElement,
  resetDimensionsBtn: document.getElementById('reset-dimensions-btn') as HTMLButtonElement,
  resetAllBtn: document.getElementById('reset-all-btn') as HTMLButtonElement,
};

async function loadConfig(): Promise<void> {
  const response = await window.sdFrame.config.get();
  if (response && response.success && response.config) {
    const config = response.config;
    elements.snapEnabled.checked = config.snapEnabled;
    elements.groupMovement.checked = config.groupMovementEnabled;
    elements.snapThreshold.value = String(config.snapThreshold);
    elements.layoutLocked.checked = config.layoutLocked;
    elements.alwaysOnTop.checked = config.alwaysOnTop;
    elements.logLevel.value = config.logLevel;
    elements.frameWidth.value = String(config.frameSize.width);
    elements.frameHeight.value = String(config.frameSize.height);
  }
}

async function loadFrames(): Promise<void> {
  const response = await window.sdFrame.frame.getAll();
  if (response && response.success && response.frames) {
    renderFrames(response.frames as FrameConfig[]);
  }
}

function renderFrames(frames: FrameConfig[]): void {
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function attachFrameListeners(): void {
  elements.framesContainer.querySelectorAll('.focus-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        await window.sdFrame.frame.focus({ id });
      }
    });
  });

  elements.framesContainer.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id;
      if (id) {
        const response = await window.sdFrame.frame.getAll();
        if (response && response.success && response.frames) {
          const frame = (response.frames as FrameConfig[]).find(f => f.id === id);
          if (frame) {
            await window.sdFrame.frame.update({ id, config: { enabled: !frame.enabled } });
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
        await window.sdFrame.frame.unsnap({ id, all: true });
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
          const currentFramesResponse = await window.sdFrame.frame.getAll();
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
          
          await window.sdFrame.frame.update({ id, config });
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
        await window.sdFrame.frame.remove({ id });
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
      const result = await window.sdFrame.frame.add(payload);
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
  await window.sdFrame.config.set({ key: 'snapEnabled', value: elements.snapEnabled.checked });
});

elements.groupMovement.addEventListener('change', async () => {
  await window.sdFrame.config.set({ key: 'groupMovementEnabled', value: elements.groupMovement.checked });
});

elements.snapThreshold.addEventListener('change', async () => {
  await window.sdFrame.config.set({ key: 'snapThreshold', value: parseInt(elements.snapThreshold.value, 10) });
});

elements.layoutLocked.addEventListener('change', async () => {
  await window.sdFrame.config.set({ key: 'layoutLocked', value: elements.layoutLocked.checked });
});

elements.alwaysOnTop.addEventListener('change', async () => {
  await window.sdFrame.config.set({ key: 'alwaysOnTop', value: elements.alwaysOnTop.checked });
});

elements.logLevel.addEventListener('change', async () => {
  const value = elements.logLevel.value as 'debug' | 'info' | 'warn' | 'error';
  await window.sdFrame.config.set({ key: 'logLevel', value });
});

elements.frameWidth.addEventListener('change', async () => {
  const width = parseInt(elements.frameWidth.value, 10);
  if (width >= 100 && width <= 5000) {
    const response = await window.sdFrame.config.get();
    if (response && response.success && response.config) {
      const newFrameSize = {
        width,
        height: response.config.frameSize.height,
      };
      await window.sdFrame.config.set({ key: 'frameSize', value: newFrameSize });
    }
  }
});

elements.frameHeight.addEventListener('change', async () => {
  const height = parseInt(elements.frameHeight.value, 10);
  if (height >= 100 && height <= 5000) {
    const response = await window.sdFrame.config.get();
    if (response && response.success && response.config) {
      const newFrameSize = {
        width: response.config.frameSize.width,
        height,
      };
      await window.sdFrame.config.set({ key: 'frameSize', value: newFrameSize });
    }
  }
});

elements.resetDimensionsBtn.addEventListener('click', async () => {
  // Reset to default screen width/4 for width and screen height/4 for height
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const newFrameSize = {
    width: Math.floor(screenWidth / 4),
    height: Math.floor(screenHeight / 4),
  };
  await window.sdFrame.config.set({ key: 'frameSize', value: newFrameSize });
  elements.frameWidth.value = String(newFrameSize.width);
  elements.frameHeight.value = String(newFrameSize.height);
});

elements.resetAllBtn.addEventListener('click', async () => {
  await window.sdFrame.frame.resetLayout({});
});

elements.enableAllBtn.addEventListener('click', async () => {
  await window.sdFrame.frame.enableAll();
  await loadFrames();
});

elements.disableAllBtn.addEventListener('click', async () => {
  await window.sdFrame.frame.disableAll();
  await loadFrames();
});

loadConfig();
loadFrames();
