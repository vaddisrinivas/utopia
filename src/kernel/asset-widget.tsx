import { AccessibilityInfo, Animated, Image, type ImageStyle, type StyleProp, type ViewStyle, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Dimension = number | `${number}%`;
export type ContentMode = 'cover' | 'contain' | 'stretch' | 'center';
export type Motion = { kind: 'pulse' | 'spin' | 'float'; durationMs?: number };
export type AssetImage = {
  type: 'image';
  uri: string;
  alt: string;
  width?: Dimension;
  height?: Dimension;
  aspectRatio?: number;
  contentMode?: ContentMode;
  animation?: Motion;
};

type Color = string;
type Shape = {
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  opacity?: number;
};
export type ScenePrimitive =
  | (Shape & { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number })
  | (Shape & { kind: 'circle'; cx: number; cy: number; r: number })
  | (Shape & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (Shape & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (Shape & { kind: 'polyline' | 'polygon'; points: string })
  | (Shape & { kind: 'path'; d: string })
  | (Shape & { kind: 'text'; x: number; y: number; text: string; fontSize?: number; fontWeight?: 'normal' | 'bold'; anchor?: 'start' | 'middle' | 'end' });
export type AssetScene = {
  type: 'scene';
  alt: string;
  viewBox: [number, number, number, number];
  elements: ScenePrimitive[];
  width?: Dimension;
  height?: Dimension;
  aspectRatio?: number;
  animation?: Motion;
};
export type AssetSource = AssetImage | AssetScene;
export type AssetWidgetProps = { source: unknown; alt?: string; style?: StyleProp<ViewStyle> };

const MAX_DATA_BYTES = 2 * 1024 * 1024;
const number = (value: unknown, max = 4096): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const dimension = (value: unknown): value is Dimension => number(value) || (typeof value === 'string' && /^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?%$/.test(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const color = (value: unknown): value is Color => typeof value === 'string' && /^(?:none|transparent|currentColor|#[\da-f]{3,8}|rgba?\([\d.,% ]+\)|hsla?\([\d.,% ]+\))$/i.test(value);
const points = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 && /^\s*-?\d+(?:\.\d+)?(?:\s*,\s*|\s+)-?\d+(?:\.\d+)?(?:\s+(?:,\s*)?|-?\d)/.test(value) && !/[<>&]/.test(value);
const path = (value: unknown): value is string => typeof value === 'string' && value.length <= 8192 && /^[\sMmLlHhVvCcSsQqTtAaZz0-9.,+\-eE]+$/.test(value);
const motion = (value: unknown): value is Motion => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.kind === 'pulse' || item.kind === 'spin' || item.kind === 'float') && (item.durationMs === undefined || (typeof item.durationMs === 'number' && item.durationMs >= 250 && item.durationMs <= 60000));
};
const contentMode = (value: unknown): value is ContentMode => value === undefined || value === 'cover' || value === 'contain' || value === 'stretch' || value === 'center';
const dimensions = (item: Record<string, unknown>) => (item.width === undefined || dimension(item.width)) && (item.height === undefined || dimension(item.height)) && (item.aspectRatio === undefined || (typeof item.aspectRatio === 'number' && Number.isFinite(item.aspectRatio) && item.aspectRatio > 0 && item.aspectRatio <= 20));
const uri = (value: unknown) => {
  if (!text(value) || value.length > MAX_DATA_BYTES * 2) return false;
  if (/^asset:\/\/[a-z0-9._/-]+$/i.test(value)) return true;
  if (/^https:\/\//i.test(value)) {
    try { const parsed = new URL(value); return !parsed.username && !parsed.password && !!parsed.hostname; } catch { return false; }
  }
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(value) && value.length <= MAX_DATA_BYTES * 1.38;
};

function shape(value: unknown): value is ScenePrimitive {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (!text(item.kind) || (item.fill !== undefined && !color(item.fill)) || (item.stroke !== undefined && !color(item.stroke)) || (item.strokeWidth !== undefined && !number(item.strokeWidth, 128)) || (item.opacity !== undefined && (typeof item.opacity !== 'number' || item.opacity < 0 || item.opacity > 1))) return false;
  if (item.kind === 'rect') return number(item.x) && number(item.y) && number(item.width) && number(item.height) && (item.rx === undefined || number(item.rx));
  if (item.kind === 'circle') return number(item.cx) && number(item.cy) && number(item.r);
  if (item.kind === 'ellipse') return number(item.cx) && number(item.cy) && number(item.rx) && number(item.ry);
  if (item.kind === 'line') return number(item.x1) && number(item.y1) && number(item.x2) && number(item.y2);
  if (item.kind === 'polyline' || item.kind === 'polygon') return points(item.points);
  if (item.kind === 'text') return number(item.x) && number(item.y) && text(item.text) && item.text.length <= 120
    && (item.fontSize === undefined || number(item.fontSize, 256))
    && (item.fontWeight === undefined || item.fontWeight === 'normal' || item.fontWeight === 'bold')
    && (item.anchor === undefined || item.anchor === 'start' || item.anchor === 'middle' || item.anchor === 'end');
  return item.kind === 'path' && path(item.d);
}

export function parseAssetSource(value: unknown, alt?: unknown): AssetSource | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const label = text(item.alt) ? item.alt.trim() : text(alt) ? alt.trim() : '';
  if (!label || !dimensions(item) || (item.animation !== undefined && !motion(item.animation))) return null;
  if (item.type === 'image' && uri(item.uri) && contentMode(item.contentMode)) return { ...item, alt: label } as AssetImage;
  if (item.type === 'scene' && Array.isArray(item.viewBox) && item.viewBox.length === 4 && item.viewBox.every((part) => typeof part === 'number' && Number.isFinite(part)) && Array.isArray(item.elements) && item.elements.length <= 128 && item.elements.every(shape)) return { ...item, alt: label } as AssetScene;
  return null;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function MotionView({ animation, children }: { animation?: Motion; children: ReactNode }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);
    if (!animation || reduced) return;
    const duration = animation.durationMs ?? 1400;
    const cycle = animation.kind === 'spin'
      ? Animated.timing(value, { toValue: 1, duration, useNativeDriver: true })
      : Animated.sequence([Animated.timing(value, { toValue: 1, duration: duration / 2, useNativeDriver: true }), Animated.timing(value, { toValue: 0, duration: duration / 2, useNativeDriver: true })]);
    const loop = Animated.loop(cycle);
    loop.start();
    return () => loop.stop();
  }, [animation, reduced, value]);
  const transform = animation?.kind === 'spin'
    ? [{ rotate: value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
    : animation?.kind === 'float'
      ? [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }]
      : [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }];
  return <Animated.View accessible={false} style={animation && !reduced ? { transform } : undefined}>{children}</Animated.View>;
}

function Scene({ source }: { source: AssetScene }) {
  const props = { width: source.width ?? '100%', height: source.height ?? (source.aspectRatio ? undefined : 180), viewBox: source.viewBox.join(' ') };
  return <Svg {...props} preserveAspectRatio="xMidYMid meet">
    {source.elements.map((item, index) => {
      const paint = { fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth, opacity: item.opacity };
      switch (item.kind) {
        case 'rect': return <Rect key={index} {...paint} x={item.x} y={item.y} width={item.width} height={item.height} rx={item.rx} />;
        case 'circle': return <Circle key={index} {...paint} cx={item.cx} cy={item.cy} r={item.r} />;
        case 'ellipse': return <Ellipse key={index} {...paint} cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} />;
        case 'line': return <Line key={index} {...paint} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} />;
        case 'polyline': return <Polyline key={index} {...paint} points={item.points} fill="none" />;
        case 'polygon': return <Polygon key={index} {...paint} points={item.points} />;
        case 'path': return <Path key={index} {...paint} d={item.d} />;
        case 'text': return <SvgText key={index} {...paint} x={item.x} y={item.y} fontSize={item.fontSize} fontWeight={item.fontWeight} textAnchor={item.anchor}>{item.text}</SvgText>;
      }
    })}
  </Svg>;
}

export function AssetWidget({ source, alt, style }: AssetWidgetProps) {
  const parsed = useMemo(() => parseAssetSource(source, alt), [source, alt]);
  if (!parsed) return null;
  const frame: ImageStyle & ViewStyle = { width: parsed.width ?? '100%', height: parsed.height ?? (parsed.aspectRatio ? undefined : 180), aspectRatio: parsed.aspectRatio };
  return <MotionView animation={parsed.animation}>
    <View accessible accessibilityRole="image" accessibilityLabel={parsed.alt} style={[frame, style]}>
      {parsed.type === 'image' ? <Image source={{ uri: parsed.uri }} accessibilityLabel={parsed.alt} resizeMode={parsed.contentMode ?? 'contain'} style={{ width: '100%', height: '100%' }} /> : <Scene source={parsed} />}
    </View>
  </MotionView>;
}

export const AssetRenderer = AssetWidget;
