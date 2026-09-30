import type { SnapEdge, SnapTarget } from '../shared/types';

export interface SnapAdjustment {
  targetId: string;
  edge: SnapEdge;
  adjustment: number;
  kind: 'edge' | 'alignment';
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
): { x: SnapAdjustment | null; y: SnapAdjustment | null } {
  return {
    x: selectBestSnapAdjustment(xCandidates),
    y: selectBestSnapAdjustment(yCandidates),
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