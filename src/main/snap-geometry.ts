import type { Bounds, SnapEdge, SnapTarget } from '../shared/types';

export interface SnapAdjustment {
  targetId: string;
  edge: SnapEdge;
  adjustment: number;
  kind: 'edge' | 'alignment' | 'alignment-assist';
}

export function selectBestSnapAdjustment(
  candidates: readonly SnapAdjustment[],
): SnapAdjustment | null {
  let best: SnapAdjustment | null = null;

  for (const candidate of candidates) {
    if (
      best === null ||
      Math.abs(candidate.adjustment) < Math.abs(best.adjustment) ||
      (Math.abs(candidate.adjustment) === Math.abs(best.adjustment) &&
        candidate.kind === 'edge' &&
        best.kind !== 'edge')
    ) {
      best = candidate;
    }
  }

  return best;
}

export function selectBestSnapAdjustments(
  xCandidates: readonly SnapAdjustment[],
  yCandidates: readonly SnapAdjustment[],
  xAlignmentAssistCandidates: readonly SnapAdjustment[] = [],
  yAlignmentAssistCandidates: readonly SnapAdjustment[] = [],
): { x: SnapAdjustment | null; y: SnapAdjustment | null } {
  const bestXEdge = selectBestSnapAdjustment(xCandidates.filter(candidate => candidate.kind === 'edge'));
  const bestYEdge = selectBestSnapAdjustment(yCandidates.filter(candidate => candidate.kind === 'edge'));

  if (bestXEdge || bestYEdge) {
    return {
      x: bestXEdge ?? (bestYEdge
        ? selectBestSnapAdjustment(xAlignmentAssistCandidates.filter(candidate => candidate.targetId === bestYEdge.targetId))
        : null),
      y: bestYEdge ?? (bestXEdge
        ? selectBestSnapAdjustment(yAlignmentAssistCandidates.filter(candidate => candidate.targetId === bestXEdge.targetId))
        : null),
    };
  }

  return {
    x: selectBestSnapAdjustment(xCandidates),
    y: selectBestSnapAdjustment(yCandidates),
  };
}

export function createAlignmentAssistCandidate(
  edgeSnap: SnapAdjustment,
  bounds: Bounds,
  targetBounds: Bounds,
  threshold: number,
): SnapAdjustment | null {
  if (edgeSnap.kind !== 'edge') return null;

  const sideBySide = edgeSnap.edge === 'left' || edgeSnap.edge === 'right';
  const edge = sideBySide ? 'align-top' : 'align-left';
  const adjustment = sideBySide
    ? targetBounds.y - bounds.y
    : targetBounds.x - bounds.x;

  if (Math.abs(adjustment) > threshold) return null;

  return {
    targetId: edgeSnap.targetId,
    edge,
    adjustment,
    kind: 'alignment-assist',
  };
}

export function addSnapTarget(
  targets: readonly SnapTarget[],
  frameId: string,
  edge: SnapEdge,
): SnapTarget[] {
  if (targets.some(target => target.frameId === frameId && target.edge === edge)) {
    return [...targets];
  }

  return [...targets, { frameId, edge }];
}

export function removeSnapTarget(
  targets: readonly SnapTarget[],
  frameId: string,
  edge?: SnapEdge,
): SnapTarget[] {
  return targets.filter(target =>
    target.frameId !== frameId ||
    (edge !== undefined && target.edge !== edge && target.edge !== 'unknown')
  );
}

export function removeSnapReferencesTo(
  targets: readonly SnapTarget[],
  frameId: string,
): SnapTarget[] {
  return targets.filter(target => target.frameId !== frameId);
}