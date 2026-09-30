const assert = require('node:assert/strict');
const test = require('node:test');
const {
  addSnapTarget,
  createAlignmentAssistCandidate,
  removeSnapReferencesTo,
  removeSnapTarget,
  selectBestSnapAdjustment,
  selectBestSnapAdjustments,
} = require('../dist/main/snap-geometry.js');

test('selects the nearest correction rather than stacking candidates', () => {
  const candidates = [
    { targetId: 'edge-target', edge: 'right', adjustment: 8, kind: 'edge' },
    { targetId: 'align-target', edge: 'align-left', adjustment: -3, kind: 'alignment' },
  ];

  assert.equal(selectBestSnapAdjustment(candidates), candidates[1]);
});

test('prefers an edge snap when correction distances tie', () => {
  const candidates = [
    { targetId: 'align-target', edge: 'align-top', adjustment: -4, kind: 'alignment' },
    { targetId: 'edge-target', edge: 'bottom', adjustment: 4, kind: 'edge' },
  ];

  assert.equal(selectBestSnapAdjustment(candidates), candidates[1]);
});

test('returns null when no snap candidate is available', () => {
  assert.equal(selectBestSnapAdjustment([]), null);
});

test('selects and preserves the best candidate independently on each axis', () => {
  const xCandidate = { targetId: 'x-target', edge: 'align-left', adjustment: 2, kind: 'alignment' };
  const yCandidate = { targetId: 'y-target', edge: 'align-top', adjustment: -1, kind: 'alignment' };

  assert.deepEqual(selectBestSnapAdjustments([xCandidate], [yCandidate]), {
    x: xCandidate,
    y: yCandidate,
  });
});

test('retains distinct edges to the same frame and avoids duplicate relations', () => {
  const targets = addSnapTarget([], 'neighbor', 'right');
  const withAlignment = addSnapTarget(targets, 'neighbor', 'align-top');

  assert.deepEqual(addSnapTarget(withAlignment, 'neighbor', 'right'), withAlignment);
  assert.deepEqual(withAlignment, [
    { frameId: 'neighbor', edge: 'right' },
    { frameId: 'neighbor', edge: 'align-top' },
  ]);
});

test('removes one relation and all reverse references without touching others', () => {
  const targets = [
    { frameId: 'neighbor', edge: 'right' },
    { frameId: 'neighbor', edge: 'align-top' },
    { frameId: 'legacy', edge: 'unknown' },
    { frameId: 'other', edge: 'left' },
  ];

  assert.deepEqual(removeSnapTarget(targets, 'neighbor', 'right'), [
    { frameId: 'neighbor', edge: 'align-top' },
    { frameId: 'legacy', edge: 'unknown' },
    { frameId: 'other', edge: 'left' },
  ]);
  assert.deepEqual(removeSnapReferencesTo(targets, 'neighbor'), [
    { frameId: 'legacy', edge: 'unknown' },
    { frameId: 'other', edge: 'left' },
  ]);
});

test('assists side-by-side snaps by aligning top edges within the assist range', () => {
  const edgeSnap = { targetId: 'neighbor', edge: 'right', adjustment: 3, kind: 'edge' };
  const bounds = { x: 100, y: 40, width: 200, height: 120 };
  const targetBounds = { x: 303, y: 60, width: 200, height: 120 };

  assert.deepEqual(createAlignmentAssistCandidate(edgeSnap, bounds, targetBounds, 24), {
    targetId: 'neighbor',
    edge: 'align-top',
    adjustment: 20,
    kind: 'alignment-assist',
  });
});

test('assists stacked snaps by aligning left edges and declines large jumps', () => {
  const edgeSnap = { targetId: 'neighbor', edge: 'bottom', adjustment: 2, kind: 'edge' };
  const bounds = { x: 100, y: 200, width: 200, height: 120 };

  assert.equal(createAlignmentAssistCandidate(
    edgeSnap,
    bounds,
    { x: 120, y: 322, width: 200, height: 120 },
    24,
  ).edge, 'align-left');
  assert.equal(createAlignmentAssistCandidate(
    edgeSnap,
    bounds,
    { x: 130, y: 322, width: 200, height: 120 },
    24,
  ), null);
});

test('edge snaps take precedence over unrelated alignment candidates', () => {
  const edgeCandidate = { targetId: 'edge-target', edge: 'right', adjustment: 3, kind: 'edge' };
  const unrelatedAlignment = { targetId: 'other', edge: 'align-bottom', adjustment: 1, kind: 'alignment' };
  const assist = { targetId: 'edge-target', edge: 'align-top', adjustment: 18, kind: 'alignment-assist' };

  assert.deepEqual(selectBestSnapAdjustments([edgeCandidate], [unrelatedAlignment], [], [assist]), {
    x: edgeCandidate,
    y: assist,
  });
});