# Preload Script Bundling

## Overview

`src/main/preload.ts` imports `IPC_CHANNELS` (and types) directly from `src/shared/`. There is **no duplication** anymore — the sandboxed-preload limitation that previously forced a hand-maintained copy in `preload.ts` is solved at build time with esbuild.

## Why Duplication Existed

Sandboxed preload scripts cannot `require()` relative modules at runtime — Electron's sandbox loader only exposes a small polyfilled module set (`electron`, `events`, `timers`, `path`). When `preload.ts` compiled to CommonJS with `require('../shared/constants')`, the sandbox threw:

```
Error: module not found: ../shared/constants
```

and `window.sdFrame` was never exposed to the renderer.

## The Fix: esbuild Bundling

The build pipeline now bundles the preload into a single self-contained file before Electron loads it:

```
npm run build   →   tsc && npm run bundle-preload && npm run copy-assets
```

`scripts/bundle-preload.js` runs esbuild with:

- `bundle: true` — inlines `../shared/constants` and `../shared/types` (types are erased, constants inlined)
- `platform: 'node'`, `format: 'cjs'`
- `external: ['electron']` — the only runtime require, which the sandbox provides
- output: `dist/main/preload.js` (overwrites the plain `tsc` emit of the same path, so it must run **after** `tsc`)

Because the bundle is self-contained, the sandboxed preload loads cleanly and `preload.ts` can share the single source of truth for IPC channels and payload types with the main process.

## Maintenance Guidelines

- Add new IPC channels only to `src/shared/constants.ts` and use them from `preload.ts` via the import — no second copy to keep in sync.
- New IPC payloads go in `src/shared/types.ts`; the preload imports them.
- If you add a new runtime module to the preload, esbuild bundles it automatically (as long as it only depends on `electron` and local files).

## Related Files

- `src/main/preload.ts` — the preload script (imports shared constants/types)
- `src/shared/constants.ts` — single definition of `IPC_CHANNELS`
- `scripts/bundle-preload.js` — esbuild bundling step
- `package.json` — `build` script ordering (`tsc` → `bundle-preload` → `copy-assets`)

## References

- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron Preload Scripts](https://www.electronjs.org/docs/latest/tutorial/preload-scripts)
- [Electron Process Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)