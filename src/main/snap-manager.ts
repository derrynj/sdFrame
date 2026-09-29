import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import type { Bounds, SnapEdge } from '../shared/types';
import { configService } from '../services/config-service';
import { logService } from '../services/log-service';

interface EdgeInfo {
  frameId: string;
  edge: SnapEdge;
  position: number;
  start: number;
  end: number;
}

export interface SnapStatusChangeCallback {
  (frameId: string, isSnapped: boolean, snappedToColor?: string): void;
}

export class SnapManager {
  private windows: Map<string, BrowserWindow> = new Map();
  private isDragging = false;
  private dragStartPositions: Map<string, Bounds> = new Map();
  private groupMoveInProgress = false;
  private previousBounds: Map<string, Bounds> = new Map();
  private snapStatusChangeCallbacks: SnapStatusChangeCallback[] = [];
  suppressSnapping = false;

  registerWindow(id: string, window: BrowserWindow): void {
    this.windows.set(id, window);
    this.previousBounds.set(id, window.getBounds());
    this.setupWindowListeners(id, window);
    logService.debug('Window registered for snapping', { id });
  }

  unregisterWindow(id: string): void {
    this.windows.delete(id);
    this.previousBounds.delete(id);
    logService.debug('Window unregistered from snapping', { id });
  }

  onSnapStatusChange(callback: SnapStatusChangeCallback): void {
    this.snapStatusChangeCallbacks.push(callback);
  }

  private notifySnapStatusChange(frameId: string, isSnapped: boolean, snappedToColor?: string): void {
    this.snapStatusChangeCallbacks.forEach(callback => {
      callback(frameId, isSnapped, snappedToColor);
    });
  }

  private isFrameSnapped(id: string): boolean {
    const frame = configService.getFrame(id);
    return frame ? frame.snappedTo.length > 0 : false;
  }

  private getSnappedToColor(id: string): string | undefined {
    const frame = configService.getFrame(id);
    if (!frame || frame.snappedTo.length === 0) return undefined;

    // Find all connected frames in this snap group
    const group = this.getGroup(id);
    if (group.length === 0) return undefined;

    // Use the smallest frame ID as the color authority (deterministic)
    const originId = group.sort()[0];
    const originFrame = configService.getFrame(originId);
    return originFrame?.color;
  }

  private setupWindowListeners(id: string, window: BrowserWindow): void {
    let moveStartBounds: Bounds | null = null;

    window.on('will-move', () => {
      if (this.groupMoveInProgress) return;
      if (configService.isLayoutLocked()) return;

      moveStartBounds = window.getBounds();
      this.isDragging = true;

      const group = this.getGroup(id);
      group.forEach(groupId => {
        const win = this.windows.get(groupId);
        if (win) {
          this.dragStartPositions.set(groupId, win.getBounds());
        }
      });
    });

    window.on('move', () => {
      if (this.groupMoveInProgress) return;
      if (!this.isDragging) return;
      if (configService.isLayoutLocked()) return;

      if (!configService.isGroupMovementEnabled()) return;

      const group = this.getGroup(id);
      if (group.length <= 1) return;

      const currentBounds = window.getBounds();
      const startBounds = this.dragStartPositions.get(id);
      if (!startBounds) return;

      const deltaX = currentBounds.x - startBounds.x;
      const deltaY = currentBounds.y - startBounds.y;

      this.groupMoveInProgress = true;

      group.forEach(groupId => {
        if (groupId === id) return;
        const win = this.windows.get(groupId);
        const startPos = this.dragStartPositions.get(groupId);
        if (win && startPos) {
          win.setBounds({
            ...startPos,
            x: startPos.x + deltaX,
            y: startPos.y + deltaY,
          });
        }
      });

      this.groupMoveInProgress = false;
    });

    window.on('moved', () => {
      if (this.groupMoveInProgress) return;
      this.isDragging = false;

      if (configService.isLayoutLocked()) return;

      const wasSnapped = this.isFrameSnapped(id);

      if (configService.isSnappingEnabled()) {
        this.applySnapping(id);
      }

      if (!this.suppressSnapping) {
        this.updateSnapConnections(id);
        this.persistBounds(id);
      }

      const isNowSnapped = this.isFrameSnapped(id);

      // Notify snap status change for this frame
      if (wasSnapped !== isNowSnapped) {
        const snappedToColor = isNowSnapped ? this.getSnappedToColor(id) : undefined;
        this.notifySnapStatusChange(id, isNowSnapped, snappedToColor);
      }

      // Notify all frames that this frame is now snapped to (if any)
      // Since we now have bidirectional connections, the target frames will have
      // this frame in their snappedTo array, so they'll be notified when we call
      // updateSnapConnections on them. But we need to notify them here as well
      // to ensure the UI updates immediately.
      if (isNowSnapped) {
        const frame = configService.getFrame(id);
        if (frame && frame.snappedTo.length > 0) {
          frame.snappedTo.forEach(snapTarget => {
            const targetFrame = configService.getFrame(snapTarget.frameId);
            if (targetFrame) {
              const targetIsSnapped = targetFrame.snappedTo.length > 0;
              const targetSnappedToColor = targetIsSnapped ? this.getSnappedToColor(snapTarget.frameId) : undefined;
              this.notifySnapStatusChange(snapTarget.frameId, targetIsSnapped, targetSnappedToColor);
            }
          });
        }
      }

      const group = this.getGroup(id);
      group.forEach(groupId => {
        if (groupId !== id) {
          this.persistBounds(groupId);
        }
      });

      this.dragStartPositions.clear();
      moveStartBounds = null;
      this.previousBounds.set(id, window.getBounds());
    });

    window.on('resized', () => {
      if (configService.isLayoutLocked()) return;

      const currentBounds = window.getBounds();
      const previousBounds = this.previousBounds.get(id);

      // Auto-unsnap if dimensions changed (width or height)
      if (previousBounds && (currentBounds.width !== previousBounds.width || currentBounds.height !== previousBounds.height)) {
        const wasSnapped = this.isFrameSnapped(id);
        if (wasSnapped) {
          logService.debug('Auto-unsnap due to dimension change', { id, previousBounds, currentBounds });
          this.removeAllSnapConnectionsForFrame(id);
          this.notifySnapStatusChange(id, false);
        }
      }

      this.previousBounds.set(id, currentBounds);
      this.updateSnapConnections(id);
      this.persistBounds(id);
    });
  }

  private applySnapping(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;

    // Skip snapping if suppressed (e.g., during unsnap operation)
    if (this.suppressSnapping) return;

    const threshold = configService.getSnapThreshold();
    const bounds = window.getBounds();
    const edges = this.getEdges(id, bounds);

    let snapX: number | null = null;
    let snapY: number | null = null;
    let alignX: number | null = null;
    let alignY: number | null = null;
    let bestSnapTarget: { targetId: string; edge: SnapEdge } | null = null;
    let bestAlignTarget: { targetId: string; edge: SnapEdge } | null = null;

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

      // Check for alignment snaps (separate from edge snaps)
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

      // Check bottom alignment
      const bottomDiff = otherBounds.y + otherBounds.height - (bounds.y + bounds.height);
      if (Math.abs(bottomDiff) <= threshold) {
        const horizontalOverlap = bounds.x < otherBounds.x + otherBounds.width &&
                                  bounds.x + bounds.width > otherBounds.x;
        if (horizontalOverlap) {
          if (alignY === null || Math.abs(bottomDiff) < Math.abs(alignY)) {
            alignY = bottomDiff;
            bestAlignTarget = { targetId: otherId, edge: 'align-bottom' };
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

      // Check right alignment
      const rightDiff = otherBounds.x + otherBounds.width - (bounds.x + bounds.width);
      if (Math.abs(rightDiff) <= threshold) {
        const verticalOverlap = bounds.y < otherBounds.y + otherBounds.height &&
                                bounds.y + bounds.height > otherBounds.y;
        if (verticalOverlap) {
          if (alignX === null || Math.abs(rightDiff) < Math.abs(alignX)) {
            alignX = rightDiff;
            bestAlignTarget = { targetId: otherId, edge: 'align-right' };
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

      // Record the edge snap connection immediately when applying the snap
      if (bestSnapTarget) {
        this.recordSnapConnection(id, bestSnapTarget.targetId, bestSnapTarget.edge);
      }

      // Record the alignment snap connection
      if (bestAlignTarget) {
        this.recordSnapConnection(id, bestAlignTarget.targetId, bestAlignTarget.edge);
      }

      logService.debug('Window snapped', { id, snapX, snapY, alignX, alignY, edge: bestSnapTarget?.edge, alignEdge: bestAlignTarget?.edge });
    }
  }

  /**
   * Records a snap connection with edge information.
   * Called when snapping is applied to persist the relationship.
   * Records bidirectional connections so both frames know they're snapped.
   */
  private recordSnapConnection(fromId: string, toId: string, edge: SnapEdge): void {
    const frame = configService.getFrame(fromId);
    if (!frame) return;

    // Record connection from fromId to toId
    const existing = frame.snappedTo.find(s => s.frameId === toId);
    if (existing) {
      existing.edge = edge;  // Update edge
    } else {
      frame.snappedTo.push({ frameId: toId, edge });
    }
    configService.updateSnappedTo(fromId, frame.snappedTo);

    // Record reverse connection from toId to fromId
    const toFrame = configService.getFrame(toId);
    if (toFrame) {
      // Get the opposite edge for the reverse connection
      const oppositeEdge = this.getOppositeEdge(edge);
      const reverseExisting = toFrame.snappedTo.find(s => s.frameId === fromId);
      if (reverseExisting) {
        reverseExisting.edge = oppositeEdge;  // Update edge
      } else {
        toFrame.snappedTo.push({ frameId: fromId, edge: oppositeEdge });
      }
      configService.updateSnappedTo(toId, toFrame.snappedTo);
    }
  }

  connectFramesInSequence(frameIds: string[]): void {
    const registeredFrameIds = frameIds.filter(id => this.windows.has(id));
    registeredFrameIds.forEach(id => this.removeAllSnapConnectionsForFrame(id));
    registeredFrameIds.forEach(id => {
      const window = this.windows.get(id);
      if (window) this.previousBounds.set(id, window.getBounds());
    });

    for (let index = 0; index < registeredFrameIds.length - 1; index++) {
      this.recordSnapConnection(registeredFrameIds[index], registeredFrameIds[index + 1], 'right');
    }

    registeredFrameIds.forEach(id => this.notifySnapStatus(id));
    logService.info('Frames connected as snap group', { frameIds: registeredFrameIds });
  }

  /**
   * Gets the opposite edge for a bidirectional snap connection.
   */
  getOppositeEdge(edge: SnapEdge): SnapEdge {
    switch (edge) {
      case 'left': return 'right';
      case 'right': return 'left';
      case 'top': return 'bottom';
      case 'bottom': return 'top';
      default: return edge; // For alignment edges, return as-is
    }
  }

  private getEdges(id: string, bounds: Bounds): EdgeInfo[] {
    return [
      { frameId: id, edge: 'left', position: bounds.x, start: bounds.y, end: bounds.y + bounds.height },
      { frameId: id, edge: 'right', position: bounds.x + bounds.width, start: bounds.y, end: bounds.y + bounds.height },
      { frameId: id, edge: 'top', position: bounds.y, start: bounds.x, end: bounds.x + bounds.width },
      { frameId: id, edge: 'bottom', position: bounds.y + bounds.height, start: bounds.x, end: bounds.x + bounds.width },
    ];
  }

  private edgesCanSnap(edge1: SnapEdge, edge2: SnapEdge): boolean {
    if (edge1 === 'unknown' || edge2 === 'unknown') return false;

    // Alignment snaps don't use this method - they're handled separately
    if (edge1.startsWith('align-') || edge2.startsWith('align-')) return false;

    return (
      (edge1 === 'left' && edge2 === 'right') ||
      (edge1 === 'right' && edge2 === 'left') ||
      (edge1 === 'top' && edge2 === 'bottom') ||
      (edge1 === 'bottom' && edge2 === 'top')
    );
  }

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

    // Require at least 20% overlap to snap
    return overlapPercentage >= 0.2;
  }

  /**
   * Detects snap relations between two windows, covering both hard edge
   * snaps and alignment snaps using criteria that match applySnapping.
   */
  private detectRelations(bounds: Bounds, otherBounds: Bounds, threshold: number): SnapEdge[] {
    const relations: SnapEdge[] = [];
    const myEdges = this.getEdges('self', bounds);
    const otherEdges = this.getEdges('other', otherBounds);

    for (const edge of myEdges) {
      for (const otherEdge of otherEdges) {
        if (!this.edgesCanSnap(edge.edge, otherEdge.edge)) continue;
        if (!this.edgesOverlap(edge, otherEdge)) continue;
        if (Math.abs(otherEdge.position - edge.position) <= threshold) {
          relations.push(edge.edge);
        }
      }
    }

    const horizontalOverlap = bounds.x < otherBounds.x + otherBounds.width && bounds.x + bounds.width > otherBounds.x;
    const verticalOverlap = bounds.y < otherBounds.y + otherBounds.height && bounds.y + bounds.height > otherBounds.y;

    if (horizontalOverlap) {
      if (Math.abs(otherBounds.y - bounds.y) <= threshold) relations.push('align-top');
      if (Math.abs(otherBounds.y + otherBounds.height - (bounds.y + bounds.height)) <= threshold) relations.push('align-bottom');
    }
    if (verticalOverlap) {
      if (Math.abs(otherBounds.x - bounds.x) <= threshold) relations.push('align-left');
      if (Math.abs(otherBounds.x + otherBounds.width - (bounds.x + bounds.width)) <= threshold) relations.push('align-right');
    }

    return relations;
  }

  updateSnapConnections(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;

    const threshold = configService.getSnapThreshold();
    const bounds = window.getBounds();

    const detected = new Map<string, Set<SnapEdge>>();
    for (const [otherId, otherWindow] of this.windows) {
      if (otherId === id) continue;
      const otherBounds = otherWindow.getBounds();
      detected.set(otherId, new Set(this.detectRelations(bounds, otherBounds, threshold)));
    }

    const current = configService.getFrame(id)?.snappedTo ?? [];
    const kept = current.filter(t => {
      const det = detected.get(t.frameId);
      // Targets not currently registered (disabled / not-yet-created frames) are
      // preserved rather than pruned — their geometry hasn't been assessed here.
      if (det === undefined) return true;
      return det.has(t.edge) || (t.edge === 'unknown' && det.size > 0);
    });

    const sameEdges =
      kept.length === current.length &&
      kept.every((t, i) => t.frameId === current[i].frameId && t.edge === current[i].edge);

    if (sameEdges) return;

    configService.updateSnappedTo(id, kept);

    // Prune the reverse references on any frame whose connection was dropped
    const dropped = current.filter(t => {
      const det = detected.get(t.frameId);
      if (det === undefined) return false;
      return !det.has(t.edge) && !(t.edge === 'unknown' && det.size > 0);
    });
    for (const t of dropped) {
      const otherFrame = configService.getFrame(t.frameId);
      if (!otherFrame) continue;
      const reverseEdge = this.getOppositeEdge(t.edge);
      const remaining = otherFrame.snappedTo.filter(s => !(s.frameId === id && s.edge === reverseEdge));
      if (remaining.length !== otherFrame.snappedTo.length) {
        configService.updateSnappedTo(t.frameId, remaining);
        this.notifySnapStatus(t.frameId);
      }
    }
  }

  /**
   * Removes a snap connection from a frame to another frame.
   * Optionally specifies which edge to remove.
   */
  removeSnapConnection(fromId: string, toId: string, edge?: SnapEdge): void {
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
    logService.debug('Removed snap connection', { fromId, toId, edge });
  }

  /**
   * Removes all snap connections for a frame and clears reverse references.
   */
  removeAllSnapConnectionsForFrame(id: string): void {
    // Remove all snap connections from this frame
    const frame = configService.getFrame(id);
    if (frame) {
      frame.snappedTo = [];
      configService.updateSnappedTo(id, []);
    }

    // Remove this frame from other frames' snap connections and notify them
    const allFrames = configService.getFrames();
    allFrames.forEach(otherFrame => {
      const hadConnection = otherFrame.snappedTo.some(s => s.frameId === id);
      if (hadConnection) {
        otherFrame.snappedTo = otherFrame.snappedTo.filter(s => s.frameId !== id);
        configService.updateSnappedTo(otherFrame.id, otherFrame.snappedTo);

        // Notify the other frame about the snap status change
        this.notifySnapStatusChange(otherFrame.id, otherFrame.snappedTo.length > 0);
      }
    });

    // Notify about snap status change for this frame
    this.notifySnapStatusChange(id, false);

    logService.debug('Removed all snap connections for frame', { id });
  }

  getGroup(id: string): string[] {
    const frames = configService.getFramesRef();
    const visited = new Set<string>();
    const group: string[] = [];

    const dfs = (currentId: string): void => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      group.push(currentId);

      const frame = frames.find(f => f.id === currentId);
      if (frame) {
        frame.snappedTo.forEach(snapTarget => {
          if (this.windows.has(snapTarget.frameId)) {
            dfs(snapTarget.frameId);
          }
        });
      }

      frames.forEach(otherFrame => {
        if (otherFrame.snappedTo.some(s => s.frameId === currentId) && this.windows.has(otherFrame.id)) {
          dfs(otherFrame.id);
        }
      });
    };

    dfs(id);
    return group;
  }

  private persistBounds(id: string): void {
    const window = this.windows.get(id);
    if (window) {
      configService.updateFrameBounds(id, window.getBounds());
    }
  }

  recalculateAllConnections(): void {
    for (const id of this.windows.keys()) {
      this.updateSnapConnections(id);
    }
    logService.info('Recalculated all snap connections');
  }

  /**
   * Notifies all frames of their current snap status.
   * This should be called after frames are restored to ensure
   * group colors are applied immediately.
   */
  notifySnapStatus(id: string): void {
    const isSnapped = this.isFrameSnapped(id);
    const snappedToColor = isSnapped ? this.getSnappedToColor(id) : undefined;
    this.notifySnapStatusChange(id, isSnapped, snappedToColor);
  }

  notifyAllSnapStatuses(): void {
    for (const id of this.windows.keys()) {
      const isSnapped = this.isFrameSnapped(id);
      const snappedToColor = isSnapped ? this.getSnappedToColor(id) : undefined;
      this.notifySnapStatusChange(id, isSnapped, snappedToColor);
    }
    logService.info('Notified all frames of snap status');
  }

  handleDisplayChange(): void {
    for (const [id, window] of this.windows) {
      const bounds = window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const wa = display.workArea;
      let needsUpdate = false;
      const newBounds = { ...bounds };

      if (newBounds.x < wa.x) { newBounds.x = wa.x; needsUpdate = true; }
      if (newBounds.y < wa.y) { newBounds.y = wa.y; needsUpdate = true; }
      if (newBounds.x + newBounds.width > wa.x + wa.width) {
        newBounds.x = Math.max(wa.x, wa.x + wa.width - newBounds.width);
        needsUpdate = true;
      }
      if (newBounds.y + newBounds.height > wa.y + wa.height) {
        newBounds.y = Math.max(wa.y, wa.y + wa.height - newBounds.height);
        needsUpdate = true;
      }

      if (needsUpdate) {
        window.setBounds(newBounds);
        this.persistBounds(id);
        logService.info('Window bounds adjusted for display change', { id, newBounds });
      }
    }

    this.recalculateAllConnections();
  }
}

export const snapManager = new SnapManager();
