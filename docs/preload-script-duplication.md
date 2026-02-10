# Preload Script IPC_CHANNELS Duplication

## Overview

The `IPC_CHANNELS` constant is duplicated in two locations:
- `src/shared/constants.ts` - Used by main process and renderer process
- `src/main/preload.ts` - Used by the sandboxed preload script

## Why This Duplication Exists

The preload script runs in a **sandboxed context** in Electron, which has strict security restrictions:

1. **No external module imports**: Sandboxed preload scripts cannot use `require()` or `import` to load external modules
2. **Self-contained requirement**: The preload script must be a single, self-contained file
3. **Electron's internal bundler**: When Electron loads a sandboxed preload script, it uses an internal bundler that attempts to bundle all dependencies. However, this bundler cannot resolve external CommonJS modules with relative paths

### The Problem We Solved

Before this fix, the preload script tried to import `../shared/constants`:

```typescript
import { IPC_CHANNELS } from '../shared/constants';
```

This compiled to:

```javascript
const constants_1 = require("../shared/constants");
```

When Electron tried to load this in a sandboxed context, it failed with:

```
Error: module not found: ../shared/constants
    at preloadRequire (VM4 sandbox_bundle:2:144993)
```

This caused the preload script to fail loading, which meant `window.sdFrame` was never exposed to the renderer process, leading to errors like:

```
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'config')
```

## Why We Chose This Solution

We evaluated three options:

### Option 1: Inline the constant (✅ CHOSEN)
- **Pros**: Simple, maintains security, no new dependencies
- **Cons**: Code duplication
- **Verdict**: Best balance of simplicity and security

### Option 2: Use webpack/esbuild bundling
- **Pros**: No duplication, proper dependency management
- **Cons**: Complex setup, additional dependencies, longer build time
- **Verdict**: Overkill for this use case

### Option 3: Disable sandbox
- **Pros**: Quickest fix
- **Cons**: Security risk, violates best practices
- **Verdict**: Not acceptable for production

## Maintenance Guidelines

### When Adding New IPC Channels

1. Add the new channel to `src/shared/constants.ts` first
2. Copy the same channel to `src/main/preload.ts`
3. Update both files in the same commit to ensure they stay in sync

### When Modifying Existing IPC Channels

1. Update the channel in `src/shared/constants.ts`
2. Make the exact same change in `src/main/preload.ts`
3. Commit both changes together

### When Removing IPC Channels

1. Remove from `src/shared/constants.ts`
2. Remove from `src/main/preload.ts`
3. Search the codebase for any remaining references

## Validation Strategy

To ensure the two definitions stay in sync, consider implementing one of these validation approaches:

### Option A: TypeScript Type Assertion (Recommended)

Create a shared type definition and use it in both files:

```typescript
// In src/shared/types.ts
export type IPCChannelKeys = {
  FRAME_ADD: 'frame:add';
  FRAME_UPDATE: 'frame:update';
  // ... all channels
};

// In both files, use:
export const IPC_CHANNELS: IPCChannelKeys = {
  FRAME_ADD: 'frame:add',
  FRAME_UPDATE: 'frame:update',
  // ... all channels
} as const;
```

This ensures TypeScript will catch any mismatches.

### Option B: Automated Validation Script

Create a script that compares the two definitions and fails if they don't match:

```javascript
// scripts/validate-ipc-channels.js
const fs = require('fs');
const path = require('path');

const sharedConstants = fs.readFileSync('src/shared/constants.ts', 'utf8');
const preloadScript = fs.readFileSync('src/main/preload.ts', 'utf8');

// Extract IPC_CHANNELS from both files
// Compare and exit with error if they don't match
```

Add this to the build process in `package.json`:

```json
{
  "scripts": {
    "validate-ipc": "node scripts/validate-ipc-channels.js",
    "build": "npm run validate-ipc && tsc && npm run copy-assets"
  }
}
```

### Option C: Pre-commit Hook

Use a git pre-commit hook to validate that both files are updated together:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check if IPC_CHANNELS was modified in one file but not the other
if git diff --cached src/shared/constants.ts | grep -q "IPC_CHANNELS"; then
  if ! git diff --cached src/main/preload.ts | grep -q "IPC_CHANNELS"; then
    echo "ERROR: IPC_CHANNELS modified in shared/constants.ts but not in preload.ts"
    echo "Please update both files to keep them in sync."
    exit 1
  fi
fi
```

## Future Improvements

If the duplication becomes problematic, consider these long-term solutions:

1. **Migrate to webpack/esbuild**: Set up proper bundling for the preload script
2. **Use Electron's preload script bundling**: Leverage newer Electron features for preload script handling
3. **Refactor to reduce IPC usage**: Consider alternative architectures that reduce the need for shared constants

## Related Files

- `src/shared/constants.ts` - Main definition of IPC_CHANNELS
- `src/main/preload.ts` - Duplicated definition for sandboxed context
- `src/main/window-manager.ts` - Uses IPC_CHANNELS from shared/constants
- `src/main/ipc-handlers.ts` - Registers IPC handlers using these channels
- `src/renderer/settings/index.ts` - Uses IPC_CHANNELS via window.sdFrame

## References

- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron Preload Scripts](https://www.electronjs.org/docs/latest/tutorial/preload-scripts)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
