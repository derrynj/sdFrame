# sdFrame

Multi-window, kiosk-style web container for displaying multiple web pages in frameless windows.

## Features

- **Multiple Frameless Windows**: Create N independent windows, each loading a configurable URL
- **Magnetic Snapping**: Windows snap to each other with configurable threshold
- **Group Movement**: Snapped windows move together as a unit
- **Layout Persistence**: Window positions and sizes saved across launches
- **Monitor Recovery**: Gracefully handles display changes
- **System Tray**: Minimal footprint with tray-based management
- **Security**: Sandboxed renderers, CSP enforced, navigation restricted

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build for production
npm run dist
```

## Configuration

All settings are stored in `%APPDATA%/sdframe/config.json` (Windows) or `~/Library/Application Support/sdframe/config.json` (macOS).

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `snapEnabled` | Enable magnetic snapping | `true` |
| `snapThreshold` | Snap distance in pixels | `10` |
| `groupMovementEnabled` | Move snapped windows together | `true` |
| `layoutLocked` | Prevent window move/resize | `false` |
| `logLevel` | Logging verbosity | `info` |

## Usage

1. **First Run**: Opens settings window to add your first frame
2. **Add Frame**: Enter a URL to create a new frameless window
3. **Manage**: Right-click tray icon to access all settings
4. **Position**: Drag windows to desired positions; they snap automatically
5. **Lock**: Enable layout lock to prevent accidental moves

## Window Identification

When a frame window is focused, it displays a 2px colored border with a frame ID badge. This fades when focus is lost.

## Architecture

```
src/
├── main/           # Main process (window lifecycle, IPC)
├── renderer/       # Settings UI and error pages
├── services/       # Config persistence, logging
└── shared/         # Types, schemas, constants
```

## Security Model

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- Navigation restricted to configured origin
- Popups blocked (open externally instead)
- CSP enforced for settings UI

## Logging

Logs are written to `%APPDATA%/sdframe/sdframe.log` with automatic rotation at 1MB. Configure log level via tray menu or settings UI.

## Building

```bash
# Windows portable EXE
npm run dist
```

Output: `release/sdFrame-{version}-portable.exe`

## Preconfiguring Frames

You can bundle a default configuration with the executable to preconfigure frames for users. See [DEFAULT_CONFIG.md](DEFAULT_CONFIG.md) for detailed instructions.

Quick example:
1. Edit `default-config.json` with your desired URLs and layout
2. Run `npm run dist`
3. The bundled config will be used on first run only

## License

MIT
