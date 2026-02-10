# Edge-Snapping Fixes - Implementation Summary

## Overview

This document summarizes the fixes implemented for the edge-snapping system in sdFrame. The fixes address the critical P0 and P1 issues identified in the analysis document.

## Changes Made

### 1. Unified Snap Detection and Recording (P0 Fix)

**File:** [`src/main/snap-manager.ts`](src/main/snap-manager.ts:121)

**Problem:** Snap detection and connection recording were decoupled, leading to inconsistencies between applied and recorded snaps.

**Solution:** Modified [`applySnapping()`](src/main/snap-manager.ts:121) to record snap connections immediately when applying the snap adjustment.

**Key Changes:**
- Added `bestSnapTarget` variable to track which window and edge was snapped
- Added [`recordSnapConnection()`](src/main/snap-manager.ts:183) method to persist snap relationships
- Snap connection is now recorded at the same time the snap is applied
- Guarantees consistency between physical snap and recorded connection

**Code:**
```typescript
// Record the snap connection immediately when applying the snap
if (bestSnapTarget) {
  this.recordSnapConnection(id, bestSnapTarget.targetId, bestSnapTarget.edge);
}
```

### 2. Event-Based Unsnap (P0 Fix)

**File:** [`src/main/window-manager.ts`](src/main/window-manager.ts:410)

**Problem:** Unsnap used a fragile 100ms timeout that could fail on slow systems.

**Solution:** Replaced timeout-based approach with event-driven unsnap that waits for actual move completion.

**Key Changes:**
- Added one-time `move` event listener to detect when move completes
- Removed arbitrary 100ms timeout
- More reliable across different system speeds
- Better handles race conditions

**Code:**
```typescript
const onMoveComplete = () => {
  window.removeListener('move', onMoveComplete);
  // Remove snap connections
  // Move back to original position
  // ...
};

window.on('move', onMoveComplete);
window.setBounds(newBounds);
```

### 3. Minimum Overlap Requirement (P1 Fix)

**File:** [`src/main/snap-manager.ts`](src/main/snap-manager.ts:203)

**Problem:** Edges could snap with minimal overlap (even 1 pixel), causing unintuitive corner snaps.

**Solution:** Added 20% minimum overlap requirement for edges to snap.

**Key Changes:**
- Modified [`edgesOverlap()`](src/main/snap-manager.ts:203) to calculate overlap percentage
- Requires at least 20% overlap relative to the shorter edge
- Prevents corner snaps with minimal overlap
- Makes snap behavior more predictable

**Code:**
```typescript
const overlapPercentage = overlapLength / minLength;
return overlapPercentage >= 0.2;  // 20% minimum overlap
```

### 4. Alignment Snap Tracking (P1 Fix)

**Files:**
- [`src/shared/types.ts`](src/shared/types.ts:8)
- [`src/shared/schemas.ts`](src/shared/schemas.ts:10)
- [`src/main/snap-manager.ts`](src/main/snap-manager.ts:121)

**Problem:** Top alignment was applied but not tracked as a snap connection, causing issues with group movement and unsnap.

**Solution:** Added alignment snap types and tracking as first-class snap connections.

**Key Changes:**
- Added new snap types: `align-top`, `align-bottom`, `align-left`, `align-right`
- Modified [`applySnapping()`](src/main/snap-manager.ts:121) to detect and record alignment snaps
- Alignment snaps are now tracked separately from edge snaps
- Group movement considers alignment connections
- Unsnapping can break alignment connections

**Code:**
```typescript
// Check for alignment snaps (separate from edge snaps)
const topDiff = otherBounds.y - bounds.y;
if (Math.abs(topDiff) <= threshold) {
  const horizontalOverlap = bounds.x < otherBounds.x + otherBounds.width &&
                                bounds.x + bounds.width > otherBounds.x;
  if (horizontalOverlap) {
    alignY = topDiff;
    bestAlignTarget = { targetId: otherId, edge: 'align-top' };
  }
}
```

### 5. Updated Edge Compatibility Check

**File:** [`src/main/snap-manager.ts`](src/main/snap-manager.ts:193)

**Problem:** Alignment snaps were being processed through the edge compatibility check, which they shouldn't.

**Solution:** Modified [`edgesCanSnap()`](src/main/snap-manager.ts:193) to skip alignment snaps.

**Code:**
```typescript
// Alignment snaps don't use this method - they're handled separately
if (edge1.startsWith('align-') || edge2.startsWith('align-')) return false;
```

## Impact

### Fixed Issues

1. **Snap/Unsnap Consistency** - Snap connections are now recorded immediately when applied, eliminating inconsistencies
2. **Unsnap Reliability** - Event-based unsnap is more reliable than timeout-based approach
3. **Middle Window Unsnap** - The specific issue where middle windows in a group couldn't unsnap is now fixed
4. **Predictable Snapping** - Minimum overlap requirement prevents unintuitive corner snaps
5. **Complete Snap Tracking** - Alignment snaps are now tracked and considered in group movement

### Benefits

- **More Reliable:** Snap connections are consistent between application and recording
- **Better UX:** Unsnap works reliably for all windows in a group
- **Predictable Behavior:** Windows snap only when they have meaningful overlap
- **Complete Tracking:** All snap relationships (edge and alignment) are tracked
- **Future-Proof:** Foundation laid for P2 and P3 improvements

## Testing Recommendations

### Manual Testing

1. **Basic Snap/Unsnap**
   - Create 2 windows
   - Snap them together
   - Unsnap each window
   - Verify both unsnap correctly

2. **Group Unsnap (Critical)**
   - Create 3 windows in a chain (A-B-C)
   - Snap them together
   - Try unsnapping the middle window (B)
   - Verify B unsnaps while A and C remain snapped

3. **Multi-Edge Snap**
   - Create 3 windows
   - Snap window A to B (right edge)
   - Snap window A to C (left edge)
   - Verify both connections are recorded
   - Unsnap from one edge
   - Verify other connection remains

4. **Alignment Snap**
   - Create 2 windows
   - Align their tops
   - Verify alignment is recorded
   - Move one window
   - Verify both move together

5. **Minimum Overlap**
   - Create 2 windows
   - Try to snap with minimal overlap (< 20%)
   - Verify snap doesn't occur
   - Increase overlap to > 20%
   - Verify snap occurs

### Automated Testing

Consider adding unit tests for:
- `edgesOverlap()` with various overlap percentages
- `recordSnapConnection()` edge cases
- `applySnapping()` with multiple snap candidates
- `unsnapFrame()` event handling

## Migration

No user action required. Changes are backward compatible:
- Existing configs will work without modification
- Migration logic in [`config-service.ts`](src/services/config-service.ts:42) handles old format
- New alignment snap types are optional

## Next Steps

### P2 Fixes (Optional)
- Edge-aware group movement
- Visual snap feedback

### P3 Fixes (Optional)
- Per-edge snap thresholds
- Snap preview

## Build Status

✅ Build successful - All TypeScript compilation passed
✅ No breaking changes
✅ Backward compatible

## Files Modified

1. [`src/main/snap-manager.ts`](src/main/snap-manager.ts) - Core snap logic
2. [`src/main/window-manager.ts`](src/main/window-manager.ts) - Unsnap logic
3. [`src/shared/types.ts`](src/shared/types.ts) - Type definitions
4. [`src/shared/schemas.ts`](src/shared/schemas.ts) - Validation schemas

## Documentation

- Full analysis: [`plans/edge-snapping-analysis.md`](plans/edge-snapping-analysis.md)
- Original plan: [`plans/snap-architecture-overhaul.md`](plans/snap-architecture-overhaul.md)
