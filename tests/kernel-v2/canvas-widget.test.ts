import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', () => {
  const Shape = () => null;
  return { default: Shape, Circle: Shape, Ellipse: Shape, G: Shape, Image: Shape, Line: Shape, Path: Shape, Polygon: Shape, Polyline: Shape, Rect: Shape, Text: Shape };
});
vi.mock('react-native-gesture-handler', () => {
  const gesture = () => ({ runOnJS: () => gesture(), onStart: () => gesture(), onUpdate: () => gesture(), onEnd: () => gesture() });
  return { Gesture: { Pan: gesture, Pinch: gesture, Simultaneous: gesture }, GestureDetector: () => null };
});
vi.mock('react-native-reanimated', () => ({ default: { View: () => null }, runOnJS: (fn: unknown) => fn, useAnimatedStyle: () => ({}), useSharedValue: (value: unknown) => ({ value }) }));
vi.mock('lucide-react-native', () => ({ Download: () => null, Hand: () => null, MousePointer2: () => null, Redo2: () => null, Undo2: () => null }));

import { commitHistory, createHistory, exportCanvasScene, moveLayer, moveNode, nodeBounds, parseCanvasScene, redoHistory, snap, undoHistory } from '@/src/kernel/canvas-widget';
import type { CanvasScene } from '@/src/kernel/canvas-widget';

const scene: CanvasScene = {
  width: 320,
  height: 180,
  images: { cover: 'https://example.test/cover.png' },
  nodes: [
    { id: 'back', type: 'rect', x: 0, y: 0, width: 100, height: 40, layer: 0 },
    { id: 'front', type: 'circle', cx: 20, cy: 20, r: 10, layer: 1 },
  ],
};

describe('canvas scene graph', () => {
  it('snaps positions and preserves JSON-only scene data', () => {
    const next = moveNode(scene, 'front', 7, 6, 8);
    expect(next.nodes[1]).toMatchObject({ cx: 24, cy: 24 });
    expect(exportCanvasScene(next)).toContain('"type":"circle"');
  });

  it('orders layers and moves a node without changing identities', () => {
    const next = moveLayer(scene, 'back', 1);
    expect(next.nodes.map((node) => node.id)).toEqual(['front', 'back']);
    expect(next.nodes.map((node) => node.layer)).toEqual([0, 1]);
  });

  it('computes bounds for selection overlays', () => {
    expect(nodeBounds(scene.nodes[1])).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(nodeBounds({ id: 'line', type: 'line', x1: 50, y1: 8, x2: 10, y2: 28 })).toEqual({ x: 10, y: 8, width: 40, height: 20 });
  });

  it('supports bounded undo and redo history', () => {
    const changed = moveNode(scene, 'front', 8, 0);
    const committed = commitHistory(createHistory(scene), changed);
    expect(undoHistory(committed).present).toEqual(scene);
    expect(redoHistory(undoHistory(committed)).present).toEqual(changed);
    expect(undoHistory(createHistory(scene))).toEqual(createHistory(scene));
  });

  it('handles disabled snapping as an identity operation', () => {
    expect(snap(2.5)).toBe(2.5);
    expect(snap(2.5, 0)).toBe(2.5);
  });

  it('rejects unsafe scenes and image sources', () => {
    expect(() => parseCanvasScene({ ...scene, nodes: [...scene.nodes, { ...scene.nodes[0], id: 'back' }] })).toThrow(/duplicate node/);
    expect(() => parseCanvasScene({ ...scene, images: { cover: 'file:///private/secret.png' } })).toThrow(/unsafe image source/);
    expect(() => parseCanvasScene({ ...scene, images: { cover: 'data:image/svg+xml;base64,PHN2Zz4=' } })).toThrow(/unsafe image source/);
    expect(() => parseCanvasScene({ ...scene, width: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('caps undo history at one hundred scenes', () => {
    let history = createHistory(scene);
    for (let index = 0; index < 130; index += 1) history = commitHistory(history, moveNode(scene, 'front', index, 0));
    expect(history.past).toHaveLength(100);
  });
});
