import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AccessibilityInfo: {}, Animated: {}, Image: {}, View: {} }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Line: 'Line', Path: 'Path', Polygon: 'Polygon', Polyline: 'Polyline', Rect: 'Rect', Text: 'Text' }));

import { parseAssetSource } from '@/src/kernel/asset-widget';

describe('asset widget contract', () => {
  it('accepts safe assets, https, data, and GIF image sources with geometry', () => {
    for (const uri of ['asset://photo.png', 'https://example.com/photo.gif', 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==']) {
      expect(parseAssetSource({ type: 'image', uri, alt: 'Photo', width: '100%', aspectRatio: 1.5, contentMode: 'cover' })).toMatchObject({ type: 'image', uri, alt: 'Photo' });
    }
  });

  it('rejects unsafe, malformed, oversized, or inaccessible image input', () => {
    expect(parseAssetSource({ type: 'image', uri: 'http://example.com/a.png', alt: 'x' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'javascript:alert(1)', alt: 'x' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'file:///private/secret.png', alt: 'x' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'data:image/svg+xml;base64,PHN2Zy8+', alt: 'x' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'https://example.com/a.png', alt: ' ' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'https://example.com/a.png', alt: 'x', width: -1 })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'https://example.com/a.png', alt: 'x', contentMode: 'tile' })).toBeNull();
    expect(parseAssetSource({ type: 'image', uri: 'https://example.com/a.png', alt: 'x', animation: { kind: 'spin', durationMs: 10 } })).toBeNull();
  });

  it('accepts only explicit safe SVG primitives and rejects raw markup or URLs', () => {
    const scene = { type: 'scene', alt: 'Chart', viewBox: [0, 0, 100, 100], elements: [
      { kind: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#fff' },
      { kind: 'circle', cx: 50, cy: 50, r: 20, fill: '#2F7448' },
      { kind: 'path', d: 'M10 10 L90 90', stroke: '#000', strokeWidth: 2 },
      { kind: 'text', x: 50, y: 50, text: 'Safe label', fontSize: 12, anchor: 'middle', fill: '#000' },
    ] } as const;
    expect(parseAssetSource(scene)).toMatchObject({ type: 'scene', alt: 'Chart' });
    expect(parseAssetSource({ ...scene, elements: [{ kind: 'image', href: 'https://evil.test' }] })).toBeNull();
    expect(parseAssetSource({ ...scene, elements: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'url(https://evil.test)' }] })).toBeNull();
    expect(parseAssetSource({ ...scene, elements: [{ kind: 'path', d: '<script>alert(1)</script>' }] })).toBeNull();
    expect(parseAssetSource({ ...scene, elements: [{ kind: 'text', x: 0, y: 0, text: 'x'.repeat(121) }] })).toBeNull();
  });

  it('allows a trusted caller to supply alt text and validates motion metadata', () => {
    expect(parseAssetSource({ type: 'image', uri: 'asset://cover', width: 320, height: 180 }, 'Cover')).toMatchObject({ alt: 'Cover' });
    expect(parseAssetSource({ type: 'image', uri: 'asset://cover', alt: 'Cover', animation: { kind: 'pulse', durationMs: 1200 } })).not.toBeNull();
    expect(parseAssetSource({ type: 'scene', alt: 'Scene', viewBox: [0, 0, 1, 1], elements: [], animation: { kind: 'float' } })).not.toBeNull();
  });
});
