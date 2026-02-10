# Edge-Aware Snapping Architecture Overhaul

## Executive Summary

The current snapping system has fundamental limitations:
- Only stores which frames are snapped, not **which edge** is snapped
- `snappedTo: string[]` is insufficient for multi-edge snapping
- `SnapConnection` type exists but is unused
- Unsnap is unreliable due to incomplete connection cleanup

This plan redesigns the snapping system to track edge information, enabling reliable multi-frame, multi-edge snapping.

---

## 1. Type Changes ([`src/shared/types.ts`](src/shared/types.ts))

### Current State
```typescript
interface FrameConfig {
  // ...
  snappedTo: string[];  // Only stores IDs
}
```

### Proposed Changes

```typescript
// NEW: Represents one edge snap connection
interface SnapTarget {
  frameId: string;
  edge: 'left' | 'right' | 'top' | 'bottom';
  distance?: number;  // Optional: pixel distance from edge (0 = exact snap)
}

// UPDATED: FrameConfig uses SnapTarget array
interface FrameConfig {
  id: string;
  url: string;
  enabled: boolean;
  bounds: Bounds;
  color: string;
  snappedTo: SnapTarget[];  // Changed from string[] to SnapTarget[]
}
```

### Benefits
- **Edge awareness**: Know exactly which edge is snapped
- **Multi-edge support**: Frame can snap to multiple frames on different edges
- **Selective unsnap**: Unsnap from specific edge while keeping others
- **Better grouping**: Group logic can use edge info for smarter movement

---

## 2. Schema Updates ([`src/shared/schemas.ts`](src/shared/schemas.ts))

### Current State (Line 16)
```typescript
snappedTo: z.array(z.string().uuid()),
```

### Proposed Changes

```typescript
// NEW: SnapTarget schema
export const SnapTargetSchema = z.object({
  frameId: z.string().uuid(),
  edge: z.enum(['left', 'right', 'top', 'bottom']),
  distance: z.number().optional(),
});

// UPDATED: FrameConfigSchema
export const FrameConfigSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  enabled: z.boolean(),
  bounds: BoundsSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  snappedTo: z.array(SnapTargetSchema),  // Changed
});

// NEW: Edge-aware unsnap payload
export const FrameUnsnapPayloadSchema = z.object({
  id: z.string().uuid(),
  edge: z.enum(['left', 'right', 'top', 'bottom']).optional(),  // Optional - unsnap all if not specified
  all: z.boolean().optional(),  // Unsnap from all edges
});
```

---

## 3. SnapManager Overhaul ([`src/main/snap-manager.ts`](src/main/snap-manager.ts))

### Key Changes

#### 3.1 Update `applySnapping()` to Track Edge Info

**Current**: Only snaps and adjusts position, doesn't persist edge info.

**Proposed**: 
- Detect which edge is snapping
- Store the snap target with edge information
- Log edge details for debugging

```typescript
private applySnapping(id: string): void {
  // ... existing setup ...
  
  // NEW: Track best snap with edge info
  let bestSnap: {
    targetId: string;
    edge: Edge;
    adjustmentX: number;
    adjustmentY: number;
  } | null = null;

  // ... existing snap detection logic, but populate bestSnap with edge info ...

  if (bestSnap) {
    // Apply snap with edge tracking
    this.recordSnapConnection(id, bestSnap.targetId, bestSnap.edge);
    // ... apply bounds ...
  }
}
```

#### 3.2 New Method: `recordSnapConnection()`

```typescript
/**
 * Records a snap connection with edge information.
 * Called when snapping is applied to persist the relationship.
 */
private recordSnapConnection(fromId: string, toId: string, edge: Edge): void {
  const frame = configService.getFrame(fromId);
  if (!frame) return;

  // Check if already recorded
  const existing = frame.snappedTo.find(s => s.frameId === toId);
  if (existing) {
    existing.edge = edge;  // Update edge
  } else {
    frame.snappedTo.push({ frameId: toId, edge });
  }
  
  configService.updateSnappedTo(fromId, frame.snappedTo);
}
```

#### 3.3 New Method: `removeSnapConnection()`

```typescript
/**
 * Removes a snap connection by frame ID and optionally edge.
 */
removeSnapConnection(fromId: string, toId: string, edge?: Edge): void {
  const frame = configService.getFrame(fromId);
  if (!frame) return;

  if (edge) {
    // Remove specific edge connection
    frame.snappedTo = frame.snappedTo.filter(
      s => !(s.frameId === toId && s.edge === edge)
    );
  } else {
    // Remove all connections to that frame
    frame.snappedTo = frame.snappedTo.filter(s => s.frameId !== toId);
  }
  
  configService.updateSnappedTo(fromId, frame.snappedTo);
}
```

#### 3.4 New Method: `removeAllSnapConnectionsForFrame()`

```typescript
/**
 * Completely removes all snap connections for a frame.
 */
removeAllSnapConnectionsForFrame(id: string): void {
  const group = this.getGroup(id);
  
  // Remove from this frame
  configService.updateSnappedTo(id, []);
  
  // Remove from other frames that reference this one
  const allFrames = configService.getFrames();
  allFrames.forEach(frame => {
    const hadConnection = frame.snappedTo.some(s => s.frameId === id);
    if (hadConnection) {
      frame.snappedTo = frame.snappedTo.filter(s => s.frameId !== id);
      configService.updateSnappedTo(frame.id, frame.snappedTo);
    }
  });
}
```

#### 3.5 Update `updateSnapConnections()` for Edge Tracking

```typescript
private updateSnapConnections(id: string): void {
  const window = this.windows.get(id);
  if (!window) return;

  const config = configService.get();
  const threshold = config.snapThreshold;
  const bounds = window.getBounds();
  
  const snapTargets: SnapTarget[] = [];

  for (const [otherId, otherWindow] of this.windows) {
    if (otherId === id) continue;

    const otherBounds = otherWindow.getBounds();
    const snapInfo = this.detectSnap(bounds, otherBounds, threshold);
    
    if (snapInfo) {
      snapTargets.push({
        frameId: otherId,
        edge: snapInfo.edge,
        distance: snapInfo.distance,
      });
    }
  }

  configService.updateSnappedTo(id, snapTargets);
}
```

#### 3.6 New Method: `detectSnap()`

```typescript
/**
 * Detects if two windows are snapped and returns edge/distance info.
 */
private detectSnap(bounds1: Bounds, bounds2: Bounds, threshold: number): {
  edge: Edge;
  distance: number;
} | null {
  const verticalOverlap = bounds1.y < bounds2.y + bounds2.height && bounds1.y + bounds1.height > bounds2.y;
  const horizontalOverlap = bounds1.x < bounds2.x + bounds2.width && bounds1.x + bounds1.width > bounds2.x;

  // Check each edge pair
  const checks = [
    { edge: 'left', distance: Math.abs(bounds1.x + bounds1.width - bounds2.x), overlap: verticalOverlap },
    { edge: 'right', distance: Math.abs(bounds2.x + bounds2.width - bounds1.x), overlap: verticalOverlap },
    { edge: 'top', distance: Math.abs(bounds1.y + bounds1.height - bounds2.y), overlap: horizontalOverlap },
    { edge: 'bottom', distance: Math.abs(bounds2.y + bounds2.height - bounds1.y), overlap: horizontalOverlap },
  ];

  for (const check of checks) {
    if (check.distance <= threshold && check.overlap) {
      return { edge: check.edge as Edge, distance: check.distance };
    }
  }

  return null;
}
```

---

## 4. WindowManager Updates ([`src/main/window-manager.ts`](src/main/window-manager.ts))

### Updated `unsnapFrame()` Method

```typescript
unsnapFrame(id: string, options?: { edge?: Edge; all?: boolean }): void {
  const window = this.frameWindows.get(id);
  if (!window) return;

  const { edge, all } = options || {};
  
  logService.info('Frame unsnap initiated', { id, edge, all });
  snapManager.suppressSnapping = true;

  const bounds = window.getBounds();
  const config = configService.get();
  const threshold = config.snapThreshold;
  
  // Calculate offset based on edge if specified
  const offset = threshold * 2 + 10;

  // Move window to break snap
  const newBounds = {
    ...bounds,
    x: bounds.x + (edge === 'left' ? -offset : edge === 'right' ? offset : 0),
    y: bounds.y + (edge === 'top' ? -offset : edge === 'bottom' ? offset : 0),
  };

  window.setBounds(newBounds);

  setTimeout(() => {
    if (all || !edge) {
      // Unsnap from all connections
      snapManager.removeAllSnapConnectionsForFrame(id);
    } else {
      // Unsnap from specific edge
      const frame = configService.getFrame(id);
      if (frame) {
        frame.snappedTo.forEach(target => {
          if (target.edge === edge) {
            snapManager.removeSnapConnection(id, target.frameId, edge);
          }
        });
      }
    }

    // Move back to original position
    window.setBounds(bounds);

    // Recalculate remaining connections
    snapManager.recalculateAllConnections();

    snapManager.suppressSnapping = false;
    logService.info('Frame unsnapped', { id, edge, all });
  }, 100);
}
```

---

## 5. IPC Handler Updates ([`src/main/ipc-handlers.ts`](src/main/ipc-handlers.ts))

```typescript
ipcMain.handle(IPC_CHANNELS.FRAME_UNSNAP, async (_event, payload: unknown) => {
  try {
    const validated = FrameUnsnapPayloadSchema.parse(payload);
    windowManager.unsnapFrame(validated.id, {
      edge: validated.edge,
      all: validated.all,
    });
    trayManager.updateContextMenu();
    return { success: true };
  } catch (error) {
    logService.error('IPC frame:unsnap failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});
```

---

## 6. Config Service Updates ([`src/services/config-service.ts`](src/services/config-service.ts))

No major changes needed - existing methods handle arrays, just need to ensure SnapTarget[] is properly persisted.

---

## 7. Data Migration Strategy

### Challenge
Existing configs have `snappedTo: string[]` but new schema requires `SnapTarget[]`.

### Solution
Add migration in config service:

```typescript
private load(): AppConfig {
  try {
    if (fs.existsSync(this.configPath)) {
      const data = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // MIGRATE: Convert old string[] to SnapTarget[]
      if (parsed.frames) {
        parsed.frames.forEach((frame: any) => {
          if (frame.snappedTo && frame.snappedTo.length > 0) {
            // Check if already migrated (has edge property)
            if (typeof frame.snappedTo[0] === 'string') {
              // Old format - convert to new format
              frame.snappedTo = frame.snappedTo.map((id: string) => ({
                frameId: id,
                edge: 'unknown',  // Will be re-detected on next snap
              }));
            }
          }
        });
      }
      
      const validated = AppConfigSchema.parse(parsed);
      logService.info('Config loaded successfully');
      return validated;
    }
    // ...
  }
}
```

---

## 8. UI Integration

### Current UI
The unsnap button is a simple button that sends `{ id }`.

### Proposed UI
Add a dropdown menu for edge selection:

```typescript
// In injectDragHandle():
handle.innerHTML = `
  <span class="frame-id">${config.id.slice(0, 8)}</span>
  <div class="unsnap-dropdown">
    <button class="unsnap-btn" id="sdframe-unsnap">Unsnap ▾</button>
    <div class="unsnap-menu" id="sdframe-unsnap-menu" style="display:none">
      <button data-edge="left">Left Edge</button>
      <button data-edge="right">Right Edge</button>
      <button data-edge="top">Top Edge</button>
      <button data-edge="bottom">Bottom Edge</button>
      <button data-action="all">All Connections</button>
    </div>
  </div>
`;

// Add dropdown toggle logic...
// Add edge-specific handlers...
```

---

## 9. Implementation Priority

| Priority | Task | Reason |
|----------|------|--------|
| P0 | Update types.ts with SnapTarget | Foundation |
| P0 | Update schemas.ts | Validation |
| P0 | Update config-service.ts migration | Backward compatibility |
| P1 | Add snap detection with edge info | Core functionality |
| P1 | Update unsnapFrame with edge awareness | User-facing fix |
| P1 | Update IPC handler | Communication layer |
| P2 | Add UI dropdown for edge selection | UX improvement |
| P2 | Update getGroup for edge-aware grouping | Better group behavior |

---

## 10. Testing Considerations

1. **Single edge snap/unsnap**: Frame A snaps to Frame B's right edge → Unsnap from right
2. **Multi-edge snap**: Frame A snaps to Frame B's right AND Frame C's left → Selective unsnap
3. **Group unsnap**: 3 frames in a chain → Unsnap middle frame → Ends remain snapped to each other
4. **Migration**: Old config loads correctly with new format
5. **Re-snap behavior**: After unsnap, moving windows can re-snap correctly

---

## 11. Migration Path for Users

1. **Version 0.x → 1.0**: Automatic migration on first load
2. **No user action required**: All existing snap data is preserved
3. **Rollback**: If issues occur, delete `config.json` to reset

---

## Summary

This architecture overhaul addresses the core limitation of the current snapping system by:

1. **Tracking edge information** for each snap connection
2. **Supporting multi-edge snapping** (one frame can snap to multiple others)
3. **Enabling selective unsnap** from specific edges
4. **Maintaining backward compatibility** through migration
5. **Improving reliability** with proper connection cleanup

The result is a robust snapping system that users can trust to unsnap reliably and predictably.
