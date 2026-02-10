# Edge-Snapping System Analysis

## Executive Summary

This document provides a complete analysis of the edge-snapping system in sdFrame, identifies fundamental architectural issues, and proposes solutions.

---

## 1. How Edge-Snapping Works

### 1.1 Architecture Overview

The edge-snapping system is implemented across three main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Edge-Snapping Architecture                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐         ┌──────────────┐                      │
│  │   Window     │         │   Window     │                      │
│  │   Manager    │────────▶│   Snap       │                      │
│  │              │         │   Manager    │                      │
│  └──────────────┘         └──────┬───────┘                      │
│                                  │                               │
│                                  ▼                               │
│                          ┌──────────────┐                       │
│                          │   Config     │                       │
│                          │   Service    │                       │
│                          └──────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

#### 1.2.1 Window Registration

When a frame window is created:

1. [`WindowManager.createFrameWindow()`](src/main/window-manager.ts:103) creates a BrowserWindow
2. [`SnapManager.registerWindow()`](src/main/snap-manager.ts:21) is called
3. [`setupWindowListeners()`](src/main/snap-manager.ts:32) attaches event handlers:
   - `will-move`: Triggers when drag starts
   - `move`: Triggers during drag (for group movement)
   - `moved`: Triggers when drag completes
   - `resized`: Triggers when window is resized

#### 1.2.2 Snap Detection Process

The snap detection happens in two phases:

**Phase 1: Apply Snapping (during `moved` event)**

[`applySnapping()`](src/main/snap-manager.ts:121) is called when a window finishes moving:

```typescript
private applySnapping(id: string): void {
  const window = this.windows.get(id);
  if (!window) return;

  const config = configService.get();
  const threshold = config.snapThreshold;  // Default: 10px
  const bounds = window.getBounds();
  const edges = this.getEdges(id, bounds);  // Get all 4 edges

  let snapX: number | null = null;
  let snapY: number | null = null;
  let alignY: number | null = null;
  let bestSnapEdge: SnapEdge | null = null;

  // Check against all other windows
  for (const [otherId, otherWindow] of this.windows) {
    if (otherId === id) continue;

    const otherBounds = otherWindow.getBounds();
    const otherEdges = this.getEdges(otherId, otherBounds);

    // Compare each edge pair
    for (const edge of edges) {
      for (const otherEdge of otherEdges) {
        // Check if edges can snap (opposite edges only)
        if (!this.edgesCanSnap(edge.edge, otherEdge.edge)) continue;

        // Check if edges overlap
        if (!this.edgesOverlap(edge, otherEdge)) continue;

        // Calculate distance
        const distance = Math.abs(edge.position - otherEdge.position);
        if (distance <= threshold) {
          // Found a snap candidate
          if (edge.edge === 'left' || edge.edge === 'right') {
            const adjustment = otherEdge.position - edge.position;
            if (snapX === null || Math.abs(adjustment) < Math.abs(snapX)) {
              snapX = adjustment;
              bestSnapEdge = edge.edge;
              // Also align tops if close
              const topDiff = otherBounds.y - bounds.y;
              if (Math.abs(topDiff) <= threshold) {
                alignY = topDiff;
              }
            }
          } else {
            const adjustment = otherEdge.position - edge.position;
            if (snapY === null || Math.abs(adjustment) < Math.abs(snapY)) {
              snapY = adjustment;
              bestSnapEdge = edge.edge;
            }
          }
        }
      }
    }
  }

  // Apply the snap adjustment
  if (snapX !== null || snapY !== null || alignY !== null) {
    window.setBounds({
      ...bounds,
      x: bounds.x + (snapX ?? 0),
      y: bounds.y + (snapY ?? 0) + (alignY ?? 0),
    });
  }
}
```

**Phase 2: Update Snap Connections (after `moved` event)**

[`updateSnapConnections()`](src/main/snap-manager.ts:234) is called to persist snap relationships:

```typescript
updateSnapConnections(id: string): void {
  const window = this.windows.get(id);
  if (!window) return;

  const config = configService.get();
  const threshold = config.snapThreshold;
  const bounds = window.getBounds();
  const snappedTo: SnapTarget[] = [];

  for (const [otherId, otherWindow] of this.windows) {
    if (otherId === id) continue;

    const otherBounds = otherWindow.getBounds();
    const snapInfo = this.detectSnap(bounds, otherBounds, threshold);

    if (snapInfo) {
      snappedTo.push({
        frameId: otherId,
        edge: snapInfo.edge,
        distance: snapInfo.distance,
      });
    }
  }

  configService.updateSnappedTo(id, snappedTo);
}
```

#### 1.2.3 Edge Detection

[`getEdges()`](src/main/snap-manager.ts:184) extracts edge information:

```typescript
private getEdges(id: string, bounds: Bounds): EdgeInfo[] {
  return [
    { frameId: id, edge: 'left',   position: bounds.x,                      start: bounds.y, end: bounds.y + bounds.height },
    { frameId: id, edge: 'right',  position: bounds.x + bounds.width,       start: bounds.y, end: bounds.y + bounds.height },
    { frameId: id, edge: 'top',    position: bounds.y,                      start: bounds.x, end: bounds.x + bounds.width },
    { frameId: id, edge: 'bottom', position: bounds.y + bounds.height,      start: bounds.x, end: bounds.x + bounds.width },
  ];
}
```

#### 1.2.4 Edge Compatibility Check

[`edgesCanSnap()`](src/main/snap-manager.ts:193) determines if two edges can snap:

```typescript
private edgesCanSnap(edge1: SnapEdge, edge2: SnapEdge): boolean {
  if (edge1 === 'unknown' || edge2 === 'unknown') return false;
  return (
    (edge1 === 'left'   && edge2 === 'right')  ||
    (edge1 === 'right'  && edge2 === 'left')   ||
    (edge1 === 'top'    && edge2 === 'bottom') ||
    (edge1 === 'bottom' && edge2 === 'top')
  );
}
```

**Only opposite edges can snap together.**

#### 1.2.5 Edge Overlap Check

[`edgesOverlap()`](src/main/snap-manager.ts:203) checks if edges have overlapping ranges:

```typescript
private edgesOverlap(edge1: EdgeInfo, edge2: EdgeInfo): boolean {
  return edge1.start < edge2.end && edge1.end > edge2.start;
}
```

This ensures that edges only snap if they have some overlap in their perpendicular dimension.

### 1.3 Group Movement

When a window is dragged and [`groupMovementEnabled`](src/shared/constants.ts:7) is true:

1. [`will-move`](src/main/snap-manager.ts:35) event captures start positions of all windows in the group
2. [`move`](src/main/snap-manager.ts:51) event calculates delta and moves all group members
3. [`getGroup()`](src/main/snap-manager.ts:307) uses DFS to find all connected windows via snap relationships

```typescript
getGroup(id: string): string[] {
  const frames = configService.getFrames();
  const visited = new Set<string>();
  const group: string[] = [];

  const dfs = (currentId: string): void => {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    group.push(currentId);

    const frame = frames.find(f => f.id === currentId);
    if (frame) {
      // Follow outgoing snap connections
      frame.snappedTo.forEach(snapTarget => {
        if (this.windows.has(snapTarget.frameId)) {
          dfs(snapTarget.frameId);
        }
      });
    }

    // Follow incoming snap connections
    frames.forEach(otherFrame => {
      if (otherFrame.snappedTo.some(s => s.frameId === currentId) && this.windows.has(otherFrame.id)) {
        dfs(otherFrame.id);
      }
    });
  };

  dfs(id);
  return group;
}
```

### 1.4 Unsnap Operation

The unsnap operation in [`WindowManager.unsnapFrame()`](src/main/window-manager.ts:410):

```typescript
unsnapFrame(id: string, options?: { edge?: SnapEdge; all?: boolean }): void {
  const window = this.frameWindows.get(id);
  if (!window) return;

  const { edge, all } = options || {};

  logService.info('Frame unsnap initiated', { id, edge, all });
  snapManager.suppressSnapping = true;  // Prevent re-snapping

  const bounds = window.getBounds();
  const config = configService.get();
  const threshold = config.snapThreshold;

  // Use a larger offset to guarantee snap break
  const offset = threshold * 2 + 10;

  // Move window to break snap
  const newBounds = {
    ...bounds,
    x: bounds.x + (edge === 'left' ? -offset : edge === 'right' ? offset : offset),
    y: bounds.y + (edge === 'top' ? -offset : edge === 'bottom' ? offset : 0),
  };

  window.setBounds(newBounds);

  // Wait for move events to process
  setTimeout(() => {
    if (all || !edge) {
      snapManager.removeAllSnapConnectionsForFrame(id);
    } else {
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

    // Recalculate connections for remaining group members
    const group = snapManager.getGroup(id);
    group.forEach(groupId => {
      snapManager.updateSnapConnections(groupId);
    });

    snapManager.suppressSnapping = false;
    logService.info('Frame unsnapped', { id, edge, all, groupSize: group.length });
  }, 100);
}
```

---

## 2. Fundamental Issues

### 2.1 Issue #1: Snap Detection and Connection Recording are Decoupled

**Severity: HIGH**

**Problem:**
The snap detection happens in two separate phases that are not synchronized:

1. [`applySnapping()`](src/main/snap-manager.ts:121) applies the physical snap adjustment
2. [`updateSnapConnections()`](src/main/snap-manager.ts:234) records the snap relationship

These are called sequentially in the [`moved`](src/main/snap-manager.ts:87) event handler, but they operate independently:

```typescript
window.on('moved', () => {
  // ...
  if (config.snapEnabled) {
    this.applySnapping(id);  // Applies snap, but doesn't record which edge
  }

  if (!this.suppressSnapping) {
    this.updateSnapConnections(id);  // Records connections AFTER snap applied
    this.persistBounds(id);
  }
  // ...
});
```

**Consequences:**
- The `applySnapping()` method doesn't know which edge was snapped when it applies the adjustment
- The `updateSnapConnections()` method re-detects snaps after the fact, which may not match what was actually applied
- If multiple snap candidates exist within threshold, the best one chosen by `applySnapping()` may differ from what `updateSnapConnections()` records

**Example Scenario:**
```
Window A is moved near Window B and Window C.

applySnapping() chooses to snap to Window B's right edge (distance: 5px)
updateSnapConnections() detects snap to Window C's left edge (distance: 3px)

Result: Window A is physically snapped to B, but recorded as snapped to C
```

### 2.2 Issue #2: No Persistence of Which Edge Was Snapped During Application

**Severity: HIGH**

**Problem:**
The [`applySnapping()`](src/main/snap-manager.ts:121) method applies snap adjustments but doesn't record which specific edge was snapped:

```typescript
private applySnapping(id: string): void {
  // ... detection logic ...

  if (snapX !== null || snapY !== null || alignY !== null) {
    window.setBounds({
      ...bounds,
      x: bounds.x + (snapX ?? 0),
      y: bounds.y + (snapY ?? 0) + (alignY ?? 0),
    });
    // ❌ No call to record which edge was snapped
    logService.debug('Window snapped', { id, snapX, snapY, alignY, edge: bestSnapEdge });
  }
}
```

The `bestSnapEdge` variable is calculated but never used to update the snap connections.

**Consequences:**
- The snap connection is only recorded later by `updateSnapConnections()`, which may detect a different edge
- There's no guarantee that the recorded snap matches the applied snap
- Debugging is difficult because the log shows `bestSnapEdge` but it's not persisted

### 2.3 Issue #3: Top Alignment is Applied but Not Tracked

**Severity: MEDIUM**

**Problem:**
When snapping horizontally, the system also aligns tops if they're close:

```typescript
// When snapping horizontally, also align tops if close
const topDiff = otherBounds.y - bounds.y;
if (Math.abs(topDiff) <= threshold) {
  alignY = topDiff;
}
```

This alignment is applied to the window bounds, but:
- It's not recorded as a snap connection
- It's not considered in `updateSnapConnections()`
- It's not considered in `getGroup()` for group movement

**Consequences:**
- Windows may appear aligned but not be considered "snapped" together
- Group movement may not work as expected for top-aligned windows
- Unsnapping may not break the top alignment

### 2.4 Issue #4: Unsnap Uses Fragile Timeout-Based Approach

**Severity: HIGH**

**Problem:**
The unsnap operation uses a `setTimeout` to wait for move events to process:

```typescript
window.setBounds(newBounds);  // Move to break snap

setTimeout(() => {
  // Remove snap connections
  // ...

  window.setBounds(bounds);  // Move back to original position
}, 100);
```

**Consequences:**
- The 100ms timeout is arbitrary and may not be sufficient on slower systems
- If the system is busy, the move events may not have processed in time
- Race conditions can occur if the user interacts during the timeout
- The window visibly jumps away and back, which is poor UX

### 2.5 Issue #5: Edge Overlap Check is Too Permissive

**Severity: MEDIUM**

**Problem:**
The [`edgesOverlap()`](src/main/snap-manager.ts:203) check only requires any overlap:

```typescript
private edgesOverlap(edge1: EdgeInfo, edge2: EdgeInfo): boolean {
  return edge1.start < edge2.end && edge1.end > edge2.start;
}
```

This means edges can snap even with minimal overlap (e.g., 1 pixel).

**Consequences:**
- Windows can snap in unintuitive ways
- A small corner overlap can trigger a snap
- Users may experience unexpected snapping behavior

### 2.6 Issue #6: No Minimum Overlap Requirement

**Severity: MEDIUM**

**Problem:**
There's no minimum overlap requirement for edges to snap. Combined with Issue #5, this allows:
- Corner snaps (minimal overlap)
- Edge snaps with tiny overlaps
- Unstable snap connections

**Consequences:**
- Snap connections feel "loose" or unreliable
- Windows may snap when the user doesn't intend them to
- Visual feedback doesn't match the snap behavior

### 2.7 Issue #7: Group Movement Doesn't Consider Edge Types

**Severity: MEDIUM**

**Problem:**
The [`getGroup()`](src/main/snap-manager.ts:307) method treats all snap connections equally:

```typescript
frame.snappedTo.forEach(snapTarget => {
  if (this.windows.has(snapTarget.frameId)) {
    dfs(snapTarget.frameId);
  }
});
```

It doesn't consider:
- Which edge is snapped
- Whether the snap is horizontal or vertical
- Whether the snap is a primary or secondary connection

**Consequences:**
- Group movement may not work optimally for complex snap configurations
- Windows may move in unexpected ways when part of a group
- No differentiation between "strong" and "weak" snap connections

### 2.8 Issue #8: No Visual Feedback During Snap

**Severity: LOW**

**Problem:**
There's no visual indication when a window is about to snap or has snapped.

**Consequences:**
- Users don't know when snapping will occur
- Users can't predict snap behavior
- Difficult to understand why windows moved after dragging

### 2.9 Issue #9: Snap Threshold is Global

**Severity: LOW**

**Problem:**
The snap threshold is a single global value ([`snapThreshold`](src/shared/constants.ts:6)):

```typescript
snapThreshold: z.number().min(1).max(50),
```

**Consequences:**
- Can't have different thresholds for horizontal vs vertical snapping
- Can't have different thresholds for different edge types
- Users can't fine-tune snapping behavior

### 2.10 Issue #10: No Snap Preview

**Severity: LOW**

**Problem:**
There's no preview of where a window will snap before releasing the mouse.

**Consequences:**
- Users must release to see where the window will snap
- Can't make fine adjustments without releasing
- Poor user experience

---

## 3. Proposed Solutions

### 3.1 Solution for Issue #1 & #2: Unified Snap Detection and Recording

**Approach:**
Modify [`applySnapping()`](src/main/snap-manager.ts:121) to record the snap connection immediately when applying the snap.

```typescript
private applySnapping(id: string): void {
  const window = this.windows.get(id);
  if (!window) return;

  if (this.suppressSnapping) return;

  const config = configService.get();
  const threshold = config.snapThreshold;
  const bounds = window.getBounds();
  const edges = this.getEdges(id, bounds);

  let snapX: number | null = null;
  let snapY: number | null = null;
  let alignY: number | null = null;
  let bestSnapTarget: { targetId: string; edge: SnapEdge } | null = null;

  for (const [otherId, otherWindow] of this.windows) {
    if (otherId === id) continue;

    const otherBounds = otherWindow.getBounds();
    const otherEdges = this.getEdges(otherId, otherBounds);

    for (const edge of edges) {
      for (const otherEdge of otherEdges) {
        if (!this.edgesCanSnap(edge.edge, otherEdge.edge)) continue;
        if (!this.edgesOverlap(edge, otherEdge)) continue;

        const distance = Math.abs(edge.position - otherEdge.position);
        if (distance <= threshold) {
          if (edge.edge === 'left' || edge.edge === 'right') {
            const adjustment = otherEdge.position - edge.position;
            if (snapX === null || Math.abs(adjustment) < Math.abs(snapX)) {
              snapX = adjustment;
              bestSnapTarget = { targetId: otherId, edge: edge.edge };
              const topDiff = otherBounds.y - bounds.y;
              if (Math.abs(topDiff) <= threshold) {
                alignY = topDiff;
              }
            }
          } else {
            const adjustment = otherEdge.position - edge.position;
            if (snapY === null || Math.abs(adjustment) < Math.abs(snapY)) {
              snapY = adjustment;
              bestSnapTarget = { targetId: otherId, edge: edge.edge };
            }
          }
        }
      }
    }
  }

  if (snapX !== null || snapY !== null || alignY !== null) {
    window.setBounds({
      ...bounds,
      x: bounds.x + (snapX ?? 0),
      y: bounds.y + (snapY ?? 0) + (alignY ?? 0),
    });

    // ✅ Record the snap connection immediately
    if (bestSnapTarget) {
      this.recordSnapConnection(id, bestSnapTarget.targetId, bestSnapTarget.edge);
    }

    logService.debug('Window snapped', { id, snapX, snapY, alignY, edge: bestSnapTarget?.edge });
  }
}

/**
 * Records a snap connection with edge information.
 */
private recordSnapConnection(fromId: string, toId: string, edge: SnapEdge): void {
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

**Benefits:**
- Snap connection is recorded at the same time the snap is applied
- Guarantees consistency between applied and recorded snaps
- Eliminates the need for `updateSnapConnections()` to re-detect snaps

### 3.2 Solution for Issue #3: Track Top Alignment as a Snap Type

**Approach:**
Add a new snap type for top alignment and track it separately.

```typescript
// In types.ts
export type SnapEdge = 'left' | 'right' | 'top' | 'bottom' | 'align-top' | 'align-bottom' | 'align-left' | 'align-right';

// In snap-manager.ts
private applySnapping(id: string): void {
  // ... existing logic ...

  let snapX: number | null = null;
  let snapY: number | null = null;
  let alignX: number | null = null;  // NEW
  let alignY: number | null = null;
  let bestSnapTarget: { targetId: string; edge: SnapEdge } | null = null;
  let bestAlignTarget: { targetId: string; edge: SnapEdge } | null = null;  // NEW

  // ... existing snap detection ...

  // NEW: Check for alignment snaps
  for (const [otherId, otherWindow] of this.windows) {
    if (otherId === id) continue;

    const otherBounds = otherWindow.getBounds();

    // Check top alignment
    const topDiff = otherBounds.y - bounds.y;
    if (Math.abs(topDiff) <= threshold) {
      const horizontalOverlap = bounds.x < otherBounds.x + otherBounds.width &&
                                bounds.x + bounds.width > otherBounds.x;
      if (horizontalOverlap) {
        if (alignY === null || Math.abs(topDiff) < Math.abs(alignY)) {
          alignY = topDiff;
          bestAlignTarget = { targetId: otherId, edge: 'align-top' };
        }
      }
    }

    // Check left alignment
    const leftDiff = otherBounds.x - bounds.x;
    if (Math.abs(leftDiff) <= threshold) {
      const verticalOverlap = bounds.y < otherBounds.y + otherBounds.height &&
                              bounds.y + bounds.height > otherBounds.y;
      if (verticalOverlap) {
        if (alignX === null || Math.abs(leftDiff) < Math.abs(alignX)) {
          alignX = leftDiff;
          bestAlignTarget = { targetId: otherId, edge: 'align-left' };
        }
      }
    }
  }

  if (snapX !== null || snapY !== null || alignX !== null || alignY !== null) {
    window.setBounds({
      ...bounds,
      x: bounds.x + (snapX ?? 0) + (alignX ?? 0),
      y: bounds.y + (snapY ?? 0) + (alignY ?? 0),
    });

    // Record edge snap
    if (bestSnapTarget) {
      this.recordSnapConnection(id, bestSnapTarget.targetId, bestSnapTarget.edge);
    }

    // Record alignment snap
    if (bestAlignTarget) {
      this.recordSnapConnection(id, bestAlignTarget.targetId, bestAlignTarget.edge);
    }
  }
}
```

**Benefits:**
- Top alignment is tracked as a first-class snap type
- Group movement considers alignment connections
- Unsnapping can break alignment connections

### 3.3 Solution for Issue #4: Event-Based Unsnap

**Approach:**
Replace the timeout-based approach with event-driven unsnap.

```typescript
unsnapFrame(id: string, options?: { edge?: SnapEdge; all?: boolean }): void {
  const window = this.frameWindows.get(id);
  if (!window) return;

  const { edge, all } = options || {};

  logService.info('Frame unsnap initiated', { id, edge, all });
  snapManager.suppressSnapping = true;

  const bounds = window.getBounds();
  const config = configService.get();
  const threshold = config.snapThreshold;
  const offset = threshold * 2 + 10;

  // Calculate new bounds to break snap
  const newBounds = {
    ...bounds,
    x: bounds.x + (edge === 'left' ? -offset : edge === 'right' ? offset : offset),
    y: bounds.y + (edge === 'top' ? -offset : edge === 'bottom' ? offset : 0),
  };

  // Use a one-time event listener to detect when move completes
  const onMoveComplete = () => {
    window.removeListener('move', onMoveComplete);

    // Remove snap connections
    if (all || !edge) {
      snapManager.removeAllSnapConnectionsForFrame(id);
    } else {
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

    // Recalculate connections for remaining group members
    const group = snapManager.getGroup(id);
    group.forEach(groupId => {
      snapManager.updateSnapConnections(groupId);
    });

    snapManager.suppressSnapping = false;
    logService.info('Frame unsnapped', { id, edge, all, groupSize: group.length });
  };

  window.on('move', onMoveComplete);
  window.setBounds(newBounds);
}
```

**Benefits:**
- No arbitrary timeout
- Waits for actual move event completion
- More reliable across different system speeds
- Better handles race conditions

### 3.4 Solution for Issue #5 & #6: Minimum Overlap Requirement

**Approach:**
Add a minimum overlap percentage requirement.

```typescript
// In constants.ts
export const MIN_OVERLAP_PERCENTAGE = 0.2;  // 20% minimum overlap

// In snap-manager.ts
private edgesOverlap(edge1: EdgeInfo, edge2: EdgeInfo): boolean {
  const overlapStart = Math.max(edge1.start, edge2.start);
  const overlapEnd = Math.min(edge1.end, edge2.end);
  const overlapLength = overlapEnd - overlapStart;

  if (overlapLength <= 0) return false;

  // Calculate overlap percentage relative to the shorter edge
  const edge1Length = edge1.end - edge1.start;
  const edge2Length = edge2.end - edge2.start;
  const minLength = Math.min(edge1Length, edge2Length);
  const overlapPercentage = overlapLength / minLength;

  return overlapPercentage >= MIN_OVERLAP_PERCENTAGE;
}
```

**Benefits:**
- Prevents corner snaps with minimal overlap
- Makes snap behavior more predictable
- Improves user experience

### 3.5 Solution for Issue #7: Edge-Aware Group Movement

**Approach:**
Modify group movement to consider edge types and snap strength.

```typescript
private moveGroup(id: string, deltaX: number, deltaY: number): void {
  const group = this.getGroup(id);
  if (group.length <= 1) return;

  this.groupMoveInProgress = true;

  // Build a dependency graph of snap connections
  const snapGraph = this.buildSnapGraph(group);

  // Calculate movement for each window based on its snap constraints
  const movements = new Map<string, { x: number; y: number }>();

  group.forEach(groupId => {
    const startPos = this.dragStartPositions.get(groupId);
    if (!startPos) return;

    const constraints = snapGraph.get(groupId);
    if (!constraints) {
      // No constraints - move freely
      movements.set(groupId, { x: deltaX, y: deltaY });
      return;
    }

    // Calculate constrained movement
    let constrainedDeltaX = deltaX;
    let constrainedDeltaY = deltaY;

    constraints.forEach(constraint => {
      if (constraint.edge === 'left' || constraint.edge === 'right') {
        // Horizontal snap - constrain Y movement
        constrainedDeltaY = 0;
      } else if (constraint.edge === 'top' || constraint.edge === 'bottom') {
        // Vertical snap - constrain X movement
        constrainedDeltaX = 0;
      }
    });

    movements.set(groupId, { x: constrainedDeltaX, y: constrainedDeltaY });
  });

  // Apply movements
  group.forEach(groupId => {
    const win = this.windows.get(groupId);
    const startPos = this.dragStartPositions.get(groupId);
    const movement = movements.get(groupId);
    if (win && startPos && movement) {
      win.setBounds({
        ...startPos,
        x: startPos.x + movement.x,
        y: startPos.y + movement.y,
      });
    }
  });

  this.groupMoveInProgress = false;
}

private buildSnapGraph(groupIds: string[]): Map<string, Array<{ targetId: string; edge: SnapEdge }>> {
  const graph = new Map<string, Array<{ targetId: string; edge: SnapEdge }>>();
  const frames = configService.getFrames();

  groupIds.forEach(id => {
    const frame = frames.find(f => f.id === id);
    if (frame) {
      const constraints = frame.snappedTo
        .filter(snap => groupIds.includes(snap.frameId))
        .map(snap => ({ targetId: snap.frameId, edge: snap.edge }));
      graph.set(id, constraints);
    }
  });

  return graph;
}
```

**Benefits:**
- Group movement respects snap constraints
- Windows move more predictably
- Better handling of complex snap configurations

### 3.6 Solution for Issue #8: Visual Snap Feedback

**Approach:**
Add visual indicators when snapping is about to occur.

```typescript
// In window-manager.ts
private injectDragHandle(window: BrowserWindow, config: FrameConfig): void {
  const css = `
    /* ... existing CSS ... */

    #sdframe-snap-indicator {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 3px solid #00ff00;
      pointer-events: none;
      z-index: 999998;
      display: none;
      opacity: 0.7;
    }

    #sdframe-snap-indicator.active {
      display: block;
    }
  `;

  const js = `
    (function() {
      // ... existing code ...

      // Add snap indicator
      const indicator = document.createElement('div');
      indicator.id = 'sdframe-snap-indicator';
      document.body.appendChild(indicator);

      // Listen for snap events
      window.sdFrame.ipc.on('snap:preview', (data) => {
        if (data.willSnap) {
          indicator.classList.add('active');
        } else {
          indicator.classList.remove('active');
        }
      });
    })();
  `;

  window.webContents.insertCSS(css).catch(() => {});
  window.webContents.executeJavaScript(js).catch(() => {});
}
```

**Benefits:**
- Users know when snapping will occur
- Better user experience
- Reduces confusion

### 3.7 Solution for Issue #9: Per-Edge Snap Thresholds

**Approach:**
Allow different thresholds for different edge types.

```typescript
// In types.ts
export interface SnapThresholds {
  horizontal: number;  // For left/right edges
  vertical: number;    // For top/bottom edges
  alignment: number;   // For alignment snaps
}

// In AppConfig
export interface AppConfig {
  // ...
  snapThresholds: SnapThresholds;
}

// In constants.ts
export const DEFAULT_SNAP_THRESHOLDS: SnapThresholds = {
  horizontal: 10,
  vertical: 10,
  alignment: 5,
};

// In snap-manager.ts
private applySnapping(id: string): void {
  const config = configService.get();
  const thresholds = config.snapThresholds;
  const bounds = window.getBounds();
  const edges = this.getEdges(id, bounds);

  // Use appropriate threshold based on edge type
  for (const edge of edges) {
    const threshold = (edge.edge === 'left' || edge.edge === 'right')
      ? thresholds.horizontal
      : (edge.edge === 'top' || edge.edge === 'bottom')
        ? thresholds.vertical
        : thresholds.alignment;

    // ... rest of logic ...
  }
}
```

**Benefits:**
- More fine-grained control over snapping behavior
- Users can customize thresholds for different scenarios
- Better UX for different use cases

### 3.8 Solution for Issue #10: Snap Preview

**Approach:**
Show a preview of where the window will snap before releasing.

```typescript
// In snap-manager.ts
private setupWindowListeners(id: string, window: BrowserWindow): void {
  let moveStartBounds: Bounds | null = null;
  let previewWindow: BrowserWindow | null = null;

  window.on('will-move', () => {
    // ... existing code ...
  });

  window.on('move', () => {
    if (this.groupMoveInProgress) return;
    if (!this.isDragging) return;
    if (configService.get().layoutLocked) return;

    const bounds = window.getBounds();
    const snapPreview = this.calculateSnapPreview(id, bounds);

    if (snapPreview) {
      // Show preview
      if (!previewWindow) {
        previewWindow = this.createPreviewWindow(snapPreview);
      } else {
        previewWindow.setBounds(snapPreview);
      }
      previewWindow.show();

      // Send preview event to renderer
      window.webContents.send('snap:preview', { willSnap: true, bounds: snapPreview });
    } else {
      // Hide preview
      if (previewWindow) {
        previewWindow.hide();
      }
      window.webContents.send('snap:preview', { willSnap: false });
    }
  });

  window.on('moved', () => {
    // Hide preview
    if (previewWindow) {
      previewWindow.close();
      previewWindow = null;
    }

    // ... existing code ...
  });
}

private calculateSnapPreview(id: string, bounds: Bounds): Bounds | null {
  const config = configService.get();
  const threshold = config.snapThreshold;

  // Similar logic to applySnapping, but returns the preview bounds
  // instead of applying them
  // ...
}

private createPreviewWindow(bounds: Bounds): BrowserWindow {
  return new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
}
```

**Benefits:**
- Users can see where the window will snap before releasing
- Better control over window placement
- Improved user experience

---

## 4. Implementation Priority

| Priority | Issue | Solution | Impact |
|----------|-------|----------|--------|
| P0 | #1, #2 | Unified Snap Detection and Recording | Fixes core inconsistency |
| P0 | #4 | Event-Based Unsnap | Fixes unreliable unsnap |
| P1 | #5, #6 | Minimum Overlap Requirement | Improves snap predictability |
| P1 | #3 | Track Top Alignment | Completes snap tracking |
| P2 | #7 | Edge-Aware Group Movement | Improves group behavior |
| P2 | #8 | Visual Snap Feedback | Improves UX |
| P3 | #9 | Per-Edge Thresholds | Adds customization |
| P3 | #10 | Snap Preview | Adds advanced UX feature |

---

## 5. Testing Strategy

### 5.1 Unit Tests

1. **Edge Detection Tests**
   - Verify `getEdges()` returns correct edge positions
   - Verify `edgesCanSnap()` allows only opposite edges
   - Verify `edgesOverlap()` correctly calculates overlap

2. **Snap Detection Tests**
   - Test single edge snap scenarios
   - Test multi-edge snap scenarios
   - Test alignment snap scenarios
   - Test threshold boundary conditions

3. **Group Movement Tests**
   - Test simple 2-window group
   - Test complex multi-window group
   - Test edge-constrained movement

### 5.2 Integration Tests

1. **Snap/Unsnap Cycle**
   - Snap two windows together
   - Verify snap connection is recorded
   - Unsnap windows
   - Verify connection is removed

2. **Multi-Edge Snap**
   - Snap window A to B (right edge)
   - Snap window A to C (left edge)
   - Verify both connections are recorded
   - Unsnap from one edge
   - Verify other connection remains

3. **Group Movement**
   - Create 3-window group
   - Drag one window
   - Verify all windows move together
   - Verify movement respects snap constraints

### 5.3 Manual Testing

1. **Edge Cases**
   - Snap windows at screen edges
   - Snap windows with minimal overlap
   - Snap windows with maximum overlap
   - Test with different window sizes

2. **Performance**
   - Test with 10+ windows
   - Test rapid dragging
   - Test on slower systems

3. **UX Testing**
   - Verify snap feedback is visible
   - Verify snap preview is accurate
   - Verify unsnap feels responsive

---

## 6. Migration Plan

### 6.1 Data Migration

The config service already has migration logic in place ([`migrateConfig()`](src/services/config-service.ts:42)):

```typescript
function migrateConfig(config: AppConfig): AppConfig {
  let needsMigration = false;

  const migratedFrames = config.frames.map(frame => {
    if (typeof frame.snappedTo[0] === 'string') {
      needsMigration = true;
      return {
        ...frame,
        snappedTo: migrateSnappedTo(frame.snappedTo),
      };
    }
    return frame;
  });

  if (needsMigration) {
    logService.info('Migrated config from string[] to SnapTarget[] format');
    return {
      ...config,
      frames: migratedFrames,
    };
  }

  return config;
}
```

This migration is already implemented and working.

### 6.2 Code Migration

1. Update [`snap-manager.ts`](src/main/snap-manager.ts) with unified snap detection
2. Update [`window-manager.ts`](src/main/window-manager.ts) with event-based unsnap
3. Update types and schemas if adding new snap types
4. Update UI components for visual feedback

### 6.3 User Migration

No user action required. Changes are backward compatible.

---

## 7. Conclusion

The edge-snapping system in sdFrame has a solid foundation but suffers from several fundamental issues:

1. **Core Issue**: Snap detection and connection recording are decoupled, leading to inconsistencies
2. **Reliability Issue**: Unsnap uses a fragile timeout-based approach
3. **UX Issues**: Lack of visual feedback and snap preview
4. **Predictability Issues**: Permissive overlap checks and no minimum overlap requirement

The proposed solutions address these issues systematically:

- **P0 fixes** (unified detection, event-based unsnap) address the most critical reliability issues
- **P1 fixes** (minimum overlap, alignment tracking) improve predictability
- **P2/P3 fixes** (edge-aware movement, visual feedback, per-edge thresholds, snap preview) enhance UX

Implementing these solutions will result in a robust, predictable, and user-friendly edge-snapping system.
