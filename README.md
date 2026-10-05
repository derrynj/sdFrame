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
- Preload exposes only specific, allowlisted IPC methods — no generic channel passthrough
- Remote pages get a minimal API subset (unsnap, tray menu, snap status); full API only on local pages
- Navigation restricted to configured origin
- Popups blocked; only `http(s)` URLs open externally
- All permission requests (geolocation, notifications, etc.) denied
- Frame URLs restricted to `http`/`https`
- CSP enforced for settings UI

## Logging

Logs are written to `%APPDATA%/sdframe/sdframe.log` with automatic rotation at 1MB. Configure log level via tray menu or settings UI.

## Building

```bash
# Refresh third-party license attributions after dependency changes
npm run notices

# Windows installer only
npm run installer

# Windows portable EXE only
npm run portable

# Build both Windows versions
npm run dist

# macOS universal DMG and updater ZIP (run on macOS)
npm run mac

# Linux x64 AppImage (run on Linux)
npm run linux
```

`npm run installer` creates `release/sdFrame-{version}-setup.exe`, an installable Windows app with automatic updates. `npm run portable` creates `release/sdFrame-{version}-portable.exe`; the portable build does not self-update. `npm run dist` builds the configured targets for the current host OS. The `mac` and `linux` scripts must be run on their respective operating systems.

Tagged GitHub releases build Windows x64, a universal macOS DMG/ZIP, and a Linux x64 AppImage. The Linux AppImage and installed Windows build support automatic updates. macOS automatic updates require a Developer ID signing certificate. To enable signed (and optionally notarized) macOS release builds, add the repository Actions secrets `MACOS_CERTIFICATE_P12` (base64-encoded Developer ID Application `.p12`) and `MACOS_CERTIFICATE_PASSWORD`; for notarization also add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Without the certificate, the workflow still creates unsigned macOS builds, but macOS automatic updates will not work and Gatekeeper may warn.

### Installing and launching

Download the build for your operating system from the [sdFrame GitHub Releases](https://github.com/derrynj/sdFrame/releases).

#### macOS

1. Download and open the `.dmg` file.
2. Drag **sdFrame** into **Applications**, then eject the mounted disk image.
3. Open sdFrame from Applications. For an unsigned release, macOS may block the first launch because the developer cannot be verified. If you trust the download, use **System Settings → Privacy & Security → Open Anyway**, then confirm the prompt.

Unsigned macOS builds are not eligible for automatic updates. A signed and notarized release avoids the usual first-launch Gatekeeper warning.

#### Linux

1. Download the `.AppImage` file.
2. Make it executable, then launch it. For example, from a terminal in the download folder:

   ```bash
   chmod +x sdFrame-*.AppImage
   ./sdFrame-*.AppImage
   ```

   In a file manager, you can instead open the file's **Properties → Permissions** and enable **Allow executing file as program**, then choose **Run**. Do not choose **Disk Image Mounter**.

AppImages are intended to run across many Linux distributions, but require a 64-bit x86 system and compatible system libraries. If the AppImage reports a missing FUSE library, install the FUSE 2 compatibility package provided by your distribution.

Third-party notices for production npm dependencies are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and included with packaged builds. Regenerate the file with `npm run notices` after changing production dependencies. Build-time development dependencies are not part of the packaged app.

Published GitHub Releases are checked automatically at startup on supported installable builds. Updates download in the background; use **Restart to install** in Settings when a download is ready. To publish a release, push a version tag matching the package version, such as `v2.0.5`. GitHub Actions builds the Windows, macOS, and Linux artifacts and publishes them with update metadata to the [sdFrame GitHub Releases](https://github.com/derrynj/sdFrame/releases). Local platform build scripts do not publish.

### Code Signing

Local Windows builds can be signed with a code-signing certificate. To enable signing:

1. Place your `.pfx` certificate file in the `.cert/` directory (e.g., `.cert/signingCert.pfx`)
2. Add the certificate password to your `.env` file:
   ```
   CSC_KEY_PASSWORD=your_password
   ```
3. Run the signed build:
   ```bash
   npm run dist:signed
   ```

The `dist:signed` script automatically sets the `CSC_LINK` environment variable to point to your certificate file and loads the password from `.env`.

**Note:** The `.cert/` directory and `.env` file are excluded from version control (see `.gitignore`) to keep your credentials secure.
GitHub Actions releases are unsigned unless signing credentials are configured in the workflow. Windows may show a SmartScreen warning for unsigned downloads.

## Preconfiguring Frames

You can bundle a default configuration with the executable to preconfigure frames for users. See [DEFAULT_CONFIG.md](DEFAULT_CONFIG.md) for detailed instructions.

Quick example:
1. Edit `default-config.json` with your desired URLs and layout
2. Run `npm run dist`
3. The bundled config will be used on first run only

## License

sdFrame is licensed under the MIT License. See [LICENSE](LICENSE) for the full text.
