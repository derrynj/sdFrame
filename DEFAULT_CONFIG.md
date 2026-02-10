# Default Configuration Guide

## Overview

The `default-config.json` file allows you to preconfigure frames (windows) that will be created automatically when users run the application for the first time.

## Location

- **Development**: `default-config.json` in the project root
- **Production**: Bundled in the executable's resources

## Configuration Structure

```json
{
  "version": 1,
  "snapEnabled": true,
  "snapThreshold": 10,
  "groupMovementEnabled": true,
  "layoutLocked": false,
  "alwaysOnTop": false,
  "logLevel": "info",
  "frames": [
    {
      "id": "unique-uuid-here",
      "url": "https://example.com",
      "enabled": true,
      "bounds": {
        "x": 100,
        "y": 100,
        "width": 800,
        "height": 600
      },
      "color": "#FF6B6B",
      "snappedTo": []
    }
  ]
}
```

## Frame Configuration

### Required Fields

- **id**: A unique UUID (must be valid UUIDv4 format)
  - For static configs, you can use sequential UUIDs like:
    - `00000000-0000-0000-0000-000000000001`
    - `00000000-0000-0000-0000-000000000002`
    - etc.

- **url**: The URL to load in the frame (must be a valid URL with `http://` or `https://`)

- **enabled**: Boolean, set to `true` to create the frame on startup

- **bounds**: Window position and size
  - `x`: Horizontal position (pixels from left edge of screen)
  - `y`: Vertical position (pixels from top edge of screen)
  - `width`: Window width in pixels (minimum 100)
  - `height`: Window height in pixels (minimum 100)

- **color**: Hex color code for the frame's border (e.g., `#FF6B6B`)
  - Available colors in constants: `#FF6B6B`, `#4ECDC4`, `#45B7D1`, `#96CEB4`, etc.

- **snappedTo**: Array of snap targets that this frame is connected to
  - Usually empty `[]` on first run
  - Format: `[{ "frameId": "uuid", "edge": "left|right|top|bottom", "distance": 0 }]`
  - **edge**: Which edge of this frame is snapped to the other frame
  - **distance**: Pixel distance from the snap edge (0 = exact snap)

### SnappedTo Format

The `snappedTo` field tracks which edges are snapped to which frames:

```json
"snappedTo": [
  {
    "frameId": "00000000-0000-0000-0000-000000000002",
    "edge": "right",
    "distance": 0
  },
  {
    "frameId": "00000000-0000-0000-0000-000000000003",
    "edge": "bottom",
    "distance": 5
  }
]
```

**Edge Values:**
- `left`: This frame's left edge is snapped to another frame
- `right`: This frame's right edge is snapped to another frame
- `top`: This frame's top edge is snapped to another frame
- `bottom`: This frame's bottom edge is snapped to another frame

### Application Settings

- **snapEnabled**: Enable/disable magnetic snapping between windows
- **snapThreshold**: Distance in pixels for snap detection (1-50)
- **groupMovementEnabled**: Move snapped windows together as a group
- **layoutLocked**: Prevent users from moving/resizing windows
- **alwaysOnTop**: Keep all frame windows on top of other applications
- **logLevel**: Logging level (`"debug"`, `"info"`, `"warn"`, `"error"`)

## Example Configurations

### Single Frame
```json
{
  "version": 1,
  "snapEnabled": true,
  "snapThreshold": 10,
  "groupMovementEnabled": true,
  "layoutLocked": false,
  "alwaysOnTop": true,
  "logLevel": "info",
  "frames": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "url": "https://dashboard.example.com",
      "enabled": true,
      "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
      "color": "#FF6B6B",
      "snappedTo": []
    }
  ]
}
```

### Multiple Side-by-Side Frames (Pre-snapped)
```json
{
  "version": 1,
  "snapEnabled": true,
  "snapThreshold": 10,
  "groupMovementEnabled": true,
  "layoutLocked": true,
  "alwaysOnTop": true,
  "logLevel": "info",
  "frames": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "url": "https://monitoring.example.com",
      "enabled": true,
      "bounds": { "x": 0, "y": 0, "width": 960, "height": 1080 },
      "color": "#FF6B6B",
      "snappedTo": [
        {
          "frameId": "00000000-0000-0000-0000-000000000002",
          "edge": "right",
          "distance": 0
        }
      ]
    },
    {
      "id": "00000000-0000-0000-0000-000000000002",
      "url": "https://analytics.example.com",
      "enabled": true,
      "bounds": { "x": 960, "y": 0, "width": 960, "height": 1080 },
      "color": "#4ECDC4",
      "snappedTo": [
        {
          "frameId": "00000000-0000-0000-0000-000000000001",
          "edge": "left",
          "distance": 0
        }
      ]
    }
  ]
}
```

### Grid Layout (2x2)
```json
{
  "version": 1,
  "snapEnabled": true,
  "snapThreshold": 10,
  "groupMovementEnabled": true,
  "layoutLocked": true,
  "alwaysOnTop": true,
  "logLevel": "info",
  "frames": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "url": "https://dashboard1.example.com",
      "enabled": true,
      "bounds": { "x": 0, "y": 0, "width": 960, "height": 540 },
      "color": "#FF6B6B",
      "snappedTo": [
        { "frameId": "00000000-0000-0000-0000-000000000002", "edge": "right", "distance": 0 },
        { "frameId": "00000000-0000-0000-0000-000000000003", "edge": "bottom", "distance": 0 }
      ]
    },
    {
      "id": "00000000-0000-0000-0000-000000000002",
      "url": "https://dashboard2.example.com",
      "enabled": true,
      "bounds": { "x": 960, "y": 0, "width": 960, "height": 540 },
      "color": "#4ECDC4",
      "snappedTo": [
        { "frameId": "00000000-0000-0000-0000-000000000001", "edge": "left", "distance": 0 },
        { "frameId": "00000000-0000-0000-0000-000000000004", "edge": "bottom", "distance": 0 }
      ]
    },
    {
      "id": "00000000-0000-0000-0000-000000000003",
      "url": "https://dashboard3.example.com",
      "enabled": true,
      "bounds": { "x": 0, "y": 540, "width": 960, "height": 540 },
      "color": "#45B7D1",
      "snappedTo": [
        { "frameId": "00000000-0000-0000-0000-000000000001", "edge": "top", "distance": 0 },
        { "frameId": "00000000-0000-0000-0000-000000000004", "edge": "right", "distance": 0 }
      ]
    },
    {
      "id": "00000000-0000-0000-0000-000000000004",
      "url": "https://dashboard4.example.com",
      "enabled": true,
      "bounds": { "x": 960, "y": 540, "width": 960, "height": 540 },
      "color": "#96CEB4",
      "snappedTo": [
        { "frameId": "00000000-0000-0000-0000-000000000002", "edge": "top", "distance": 0 },
        { "frameId": "00000000-0000-0000-0000-000000000003", "edge": "left", "distance": 0 }
      ]
    }
  ]
}
```

## Validation

The configuration is validated using Zod schemas when loaded. Invalid configurations will fall back to the hardcoded defaults (empty frames array).

### Migration

When loading old configurations with `snappedTo: string[]` format (simple UUID array), the system automatically migrates to the new `snappedTo: SnapTarget[]` format. The `edge` will be set to `"unknown"` and will be updated on the next snap event.

## Deployment Workflow

1. Edit `default-config.json` with your desired configuration
2. Build the application: `npm run dist`
3. The config will be bundled into the executable
4. On first run, users will see your preconfigured frames
5. User changes are saved to their local config file and won't be overwritten

## Testing

To test your default config during development:
1. Delete your local config: `%APPDATA%/sdframe/config.json` (Windows) or `~/Library/Application Support/sdframe/config.json` (macOS)
2. Run: `npm run dev`
3. Your `default-config.json` should be loaded

## Important Notes

- The default config is only used when no user config exists (first run)
- Once a user has a config file, the default config is ignored
- User modifications are always saved to their local config file
- To reset to defaults, users must delete their local config file
- The `snappedTo` field is automatically managed by the application - you typically don't need to set it manually
