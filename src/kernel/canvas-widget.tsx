import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Image as SvgImage, Line, Path, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { Download, Hand, MousePointer2, Redo2, Undo2 } from 'lucide-react-native';
import { z } from 'zod';

export type CanvasNodeKind = 'rect' | 'circle' | 'ellipse' | 'line' | 'path' | 'polyline' | 'polygon' | 'text' | 'image';
export type CanvasNode = {
  id: string;
  type: CanvasNodeKind;
  x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  cx?: number; cy?: number; r?: number; rx?: number; ry?: number;
  width?: number; height?: number; points?: string; d?: string; text?: string;
  href?: string; imageRef?: string; fill?: string; stroke?: string; strokeWidth?: number;
  opacity?: number; rotation?: number; fontSize?: number; layer?: number;
  visible?: boolean; locked?: boolean;
  fromId?: string; toId?: string;
};
export type CanvasScene = { width: number; height: number; background?: string; images?: Record<string, string>; nodes: CanvasNode[] };
export type CanvasViewport = { x: number; y: number; zoom: number };
export type CanvasHistory = { past: CanvasScene[]; present: CanvasScene; future: CanvasScene[] };
type CanvasSyncOp = 'set' | 'remove' | 'upsert';

export type CanvasCommand =
  | { kind: 'move'; nodeIds: string[]; dx: number; dy: number; grid?: number }
  | { kind: 'resize'; nodeId: string; width?: number; height?: number; dWidth?: number; dHeight?: number }
  | { kind: 'align'; nodeIds: string[]; axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' }
  | { kind: 'distribute'; nodeIds: string[]; axis: 'x' | 'y'; spacing?: number }
  | { kind: 'set-layer'; nodeId: string; layer: number }
  | { kind: 'toggle-lock'; nodeIds: string[] }
  | { kind: 'toggle-visible'; nodeIds: string[] }
  | { kind: 'remove'; nodeIds: string[] }
  | { kind: 'duplicate'; nodeId: string; copyId: string }
  | { kind: 'add-node'; node: Omit<CanvasNode, 'id'> & { id?: string } }
  | { kind: 'connect'; fromId: string; toId: string; color?: string; strokeWidth?: number }
  | { kind: 'remove-edge'; fromId: string; toId: string }
  | { kind: 'style'; nodeIds: string[]; patch: Pick<CanvasNode, 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'locked' | 'visible'> }
  | { kind: 'layout-grid'; nodeIds: string[]; columns?: number; gapX?: number; gapY?: number; originX?: number; originY?: number }
  | { kind: 'layout-diagram'; nodeIds?: string[]; roots?: string[]; gapX?: number; gapY?: number; originX?: number; originY?: number; layerSpacing?: number; nodeSpacing?: number }
  | { kind: 'collab-sync'; actor?: string; at?: number; ops: Array<{ nodeId: string; op: CanvasSyncOp; updates: Partial<CanvasNode> }> };

export type CanvasWidgetProps = {
  scene: unknown;
  width?: number | string;
  height?: number | string;
  selectedId?: string;
  snap?: number;
  minZoom?: number;
  maxZoom?: number;
  controls?: boolean;
  commands?: unknown;
  onChange?(scene: CanvasScene): void;
  onSelectionChange?(id?: string): void;
  onViewportChange?(viewport: CanvasViewport): void;
  onExport?(json: string, scene: CanvasScene): void;
  onCommit?(scene: CanvasScene): void;
};

const pathSafe = /^[MmLlHhVvCcSsQqTtAaZz0-9,\.\-\s]+$/;
const pointsSafe = /^[0-9,\.\-\s]+$/;
const paintSafe = /^(none|transparent|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d.%\s,/-]+\)|[a-z]{3,20})$/i;
const diagramEdge = (value: unknown): value is { id?: string; fromId?: string; toId?: string; x1?: number; y1?: number; x2?: number; y2?: number } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && typeof candidate.fromId === 'string' && typeof candidate.toId === 'string';
};
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const copy = (scene: CanvasScene): CanvasScene => ({ ...scene, nodes: scene.nodes.map((node) => ({ ...node })), images: scene.images ? { ...scene.images } : undefined });

function cleanCanvasPatch(value: unknown): Partial<CanvasNode> {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const sanitize = (next: Record<string, unknown>): Partial<CanvasNode> => {
    const cast = (v: unknown): unknown => typeof v === 'string' ? v.slice(0, 120) : Number.isFinite(Number(v)) ? Number(v) : v;
    const patch: Partial<CanvasNode> = {};
    const copyKeys: (keyof CanvasNode)[] = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'd', 'text', 'href', 'imageRef', 'fromId', 'toId', 'fill', 'stroke', 'strokeWidth', 'opacity', 'rotation', 'fontSize', 'layer', 'visible', 'locked'];
    for (const key of copyKeys) {
      if (input[key] === undefined) continue;
      const value = cast(input[key]);
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') (patch as Record<string, unknown>)[key] = value;
    }
    return patch;
  };
  return sanitize(input);
}

function applyCanvasCollabOps(scene: CanvasScene, command: Extract<CanvasCommand, { kind: 'collab-sync' }>): CanvasScene {
  const ops = [...command.ops].sort((a, b) => (a.nodeId.localeCompare(b.nodeId)));
  const nodes = scene.nodes.map((node) => ({ ...node }));
  for (const operation of ops) {
    if (!operation.nodeId) continue;
    const index = nodes.findIndex((node) => node.id === operation.nodeId);
    if (operation.op === 'remove') {
      if (index >= 0) nodes.splice(index, 1);
      continue;
    }
    const update = cleanCanvasPatch(operation.updates);
    if (operation.op === 'upsert' && index < 0) {
      const node = CanvasNodeSchema.safeParse({ ...update, id: operation.nodeId, type: (update as CanvasNode).type ?? 'rect', x: finite(update.x, 0), y: finite(update.y, 0), width: finite(update.width, 64), height: finite(update.height, 64) });
      if (!node.success) continue;
      nodes.push(node.data);
      continue;
    }
    if (index >= 0) nodes[index] = { ...nodes[index], ...update };
  }
  return { ...scene, nodes };
}
const coordinate = z.number().finite().min(-10_000).max(10_000);
const size = z.number().finite().min(0).max(10_000);
const paint = z.string().max(64).regex(paintSafe);
const imageSource = z.string().max(350_000).refine((value) => {
  if (/^asset:\/\/[a-z0-9._/-]+$/i.test(value)) return true;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value.length <= 350_000;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'unsafe image source');
const CanvasNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'text', 'image']),
  x: coordinate.optional(), y: coordinate.optional(), x1: coordinate.optional(), y1: coordinate.optional(), x2: coordinate.optional(), y2: coordinate.optional(),
  cx: coordinate.optional(), cy: coordinate.optional(), r: size.optional(), rx: size.optional(), ry: size.optional(),
  width: size.optional(), height: size.optional(), points: z.string().max(20_000).regex(pointsSafe).optional(),
  d: z.string().max(20_000).regex(pathSafe).optional(), text: z.string().max(2_000).optional(),
  href: imageSource.optional(), imageRef: z.string().min(1).max(100).optional(), fromId: z.string().min(1).max(100).optional(), toId: z.string().min(1).max(100).optional(),
  fill: paint.optional(), stroke: paint.optional(), strokeWidth: z.number().finite().min(0).max(100).optional(),
  opacity: z.number().finite().min(0).max(1).optional(), rotation: z.number().finite().min(-3600).max(3600).optional(),
  fontSize: z.number().finite().min(1).max(512).optional(), layer: z.number().int().min(-10_000).max(10_000).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(),
}).strict().superRefine((node, context) => {
  const require = (keys: string[]) => keys.forEach((key) => {
    if ((node as Record<string, unknown>)[key] == null) context.addIssue({ code: 'custom', path: [key], message: `${node.type} requires ${key}` });
  });
  if (node.type === 'rect' || node.type === 'image') require(['x', 'y', 'width', 'height']);
  if (node.type === 'circle') require(['cx', 'cy', 'r']);
  if (node.type === 'ellipse') require(['cx', 'cy', 'rx', 'ry']);
  if (node.type === 'line') require(['x1', 'y1', 'x2', 'y2']);
  if (node.type === 'path') require(['d', 'x', 'y', 'width', 'height']);
  if (node.type === 'polyline' || node.type === 'polygon') require(['points']);
  if (node.type === 'text') require(['x', 'y', 'text']);
});
export const CanvasSceneSchema = z.object({
  width: z.number().finite().min(1).max(10_000),
  height: z.number().finite().min(1).max(10_000),
  background: paint.optional(),
  images: z.record(z.string().min(1).max(100), imageSource).optional(),
  nodes: z.array(CanvasNodeSchema).max(500),
}).strict().superRefine((scene, context) => {
  const ids = new Set<string>();
  scene.nodes.forEach((node, index) => {
    if (ids.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: `duplicate node ${node.id}` });
    ids.add(node.id);
    if (node.type === 'image' && !node.href && (!node.imageRef || !scene.images?.[node.imageRef])) {
      context.addIssue({ code: 'custom', path: ['nodes', index], message: 'image source missing' });
    }
  });
});

export function parseCanvasScene(value: unknown): CanvasScene { return CanvasSceneSchema.parse(value) as CanvasScene; }
export function exportCanvasScene(scene: CanvasScene): string { return JSON.stringify(scene); }
export function snap(value: number, grid = 0): number { return grid > 0 ? Math.round(value / grid) * grid : value; }

export function parseCanvasCommands(input: unknown): CanvasCommand[] {
  const value = Array.isArray(input) ? input : [];
  const commands: CanvasCommand[] = [];
  for (const command of value) {
    if (!command || typeof command !== 'object') continue;
    const unknownCommand = command as Record<string, unknown>;
    const kind = unknownCommand.kind;
    if (kind === 'move') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      const dx = Number(unknownCommand.dx); const dy = Number(unknownCommand.dy);
      if (!nodeIds.length || Number.isNaN(dx) || Number.isNaN(dy)) continue;
      const grid = Number(unknownCommand.grid);
      commands.push({ kind: 'move', nodeIds, dx, dy, ...(Number.isFinite(grid) ? { grid } : {}) });
      continue;
    }
    if (kind === 'resize') {
      const nodeId = typeof unknownCommand.nodeId === 'string' ? unknownCommand.nodeId : '';
      if (!nodeId) continue;
      const width = unknownCommand.width;
      const height = unknownCommand.height;
      const dWidth = unknownCommand.dWidth;
      const dHeight = unknownCommand.dHeight;
      commands.push({
        kind: 'resize', nodeId,
        ...(typeof width === 'number' ? { width } : {}),
        ...(typeof height === 'number' ? { height } : {}),
        ...(typeof dWidth === 'number' ? { dWidth } : {}),
        ...(typeof dHeight === 'number' ? { dHeight } : {}),
      });
      continue;
    }
    if (kind === 'collab-sync') {
      const actor = typeof unknownCommand.actor === 'string' ? unknownCommand.actor : undefined;
      const at = typeof unknownCommand.at === 'number' ? unknownCommand.at : Date.now();
      const rawOps = Array.isArray(unknownCommand.ops) ? unknownCommand.ops : [];
      const ops: Array<{ nodeId: string; op: CanvasSyncOp; updates: Partial<CanvasNode> }> = [];
      for (const value of rawOps) {
        if (!value || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : '';
        const op: CanvasSyncOp = record.op === 'set' || record.op === 'remove' || record.op === 'upsert' ? record.op : 'set';
        if (!nodeId) continue;
        ops.push({ nodeId, op, updates: typeof record.updates === 'object' && record.updates ? (record.updates as Record<string, unknown>) : {} });
      }
      commands.push({ kind: 'collab-sync', actor, at, ops });
      continue;
    }
    if (kind === 'align') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      const axis = typeof unknownCommand.axis === 'string' ? unknownCommand.axis : '';
      if (!nodeIds.length || !['left', 'centerX', 'right', 'top', 'centerY', 'bottom'].includes(axis)) continue;
      commands.push({ kind: 'align', nodeIds, axis: axis as 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' });
      continue;
    }
    if (kind === 'distribute') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      const axis = typeof unknownCommand.axis === 'string' ? unknownCommand.axis : '';
      if (!nodeIds.length || !['x', 'y'].includes(axis)) continue;
      const spacing = Number(unknownCommand.spacing);
      commands.push({ kind: 'distribute', nodeIds, axis: axis as 'x' | 'y', ...(Number.isFinite(spacing) ? { spacing } : {}) });
      continue;
    }
    if (kind === 'set-layer') {
      const nodeId = typeof unknownCommand.nodeId === 'string' ? unknownCommand.nodeId : '';
      const layer = Number(unknownCommand.layer);
      if (!nodeId || !Number.isFinite(layer)) continue;
      commands.push({ kind: 'set-layer', nodeId, layer: Math.trunc(layer) });
      continue;
    }
    if (kind === 'toggle-lock' || kind === 'toggle-visible' || kind === 'remove') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      if (nodeIds.length) commands.push({ kind, nodeIds } as CanvasCommand);
      continue;
    }
    if (kind === 'duplicate') {
      const nodeId = typeof unknownCommand.nodeId === 'string' ? unknownCommand.nodeId : '';
      const copyId = typeof unknownCommand.copyId === 'string' ? unknownCommand.copyId : `${nodeId}-copy`;
      if (!nodeId) continue;
      commands.push({ kind: 'duplicate', nodeId, copyId });
      continue;
    }
    if (kind === 'add-node') {
      const nodeData = unknownCommand.node;
      if (!nodeData || typeof nodeData !== 'object') continue;
      const node = nodeData as Record<string, unknown>;
      const typed = CanvasNodeSchema.safeParse({ ...node, id: typeof node.id === 'string' ? node.id : 'node-' + Date.now() });
      if (!typed.success) continue;
      commands.push({ kind: 'add-node', node: typed.data });
      continue;
    }
    if (kind === 'connect') {
      const fromId = typeof unknownCommand.fromId === 'string' ? unknownCommand.fromId : '';
      const toId = typeof unknownCommand.toId === 'string' ? unknownCommand.toId : '';
      if (!fromId || !toId || fromId === toId) continue;
      const color = typeof unknownCommand.color === 'string' ? unknownCommand.color : '#3b82f6';
      const strokeWidth = Number(unknownCommand.strokeWidth);
      commands.push({ kind: 'connect', fromId, toId, color, ...(Number.isFinite(strokeWidth) ? { strokeWidth } : {}) });
      continue;
    }
    if (kind === 'remove-edge') {
      const fromId = typeof unknownCommand.fromId === 'string' ? unknownCommand.fromId : '';
      const toId = typeof unknownCommand.toId === 'string' ? unknownCommand.toId : '';
      if (fromId && toId && fromId !== toId) commands.push({ kind: 'remove-edge', fromId, toId });
      continue;
    }
    if (kind === 'style') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      const patchRecord = typeof unknownCommand.patch === 'object' && unknownCommand.patch ? (unknownCommand.patch as Record<string, unknown>) : undefined;
      if (!patchRecord || !nodeIds.length) continue;
      const patch: Pick<CanvasNode, 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'locked' | 'visible'> = {};
      if (typeof patchRecord.fill === 'string') patch.fill = patchRecord.fill;
      if (typeof patchRecord.stroke === 'string') patch.stroke = patchRecord.stroke;
      if (Number.isFinite(Number(patchRecord.strokeWidth))) patch.strokeWidth = Number(patchRecord.strokeWidth);
      if (Number.isFinite(Number(patchRecord.opacity))) patch.opacity = Number(patchRecord.opacity);
      if (typeof patchRecord.locked === 'boolean') patch.locked = patchRecord.locked;
      if (typeof patchRecord.visible === 'boolean') patch.visible = patchRecord.visible;
      commands.push({ kind: 'style', nodeIds, patch });
      continue;
    }
    if (kind === 'layout-grid') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      if (!nodeIds.length) continue;
      const columns = Number(unknownCommand.columns);
      const gapX = Number(unknownCommand.gapX);
      const gapY = Number(unknownCommand.gapY);
      const originX = Number(unknownCommand.originX);
      const originY = Number(unknownCommand.originY);
      commands.push({
        kind: 'layout-grid',
        nodeIds,
        ...(Number.isFinite(columns) ? { columns: Math.max(1, Math.min(20, Math.trunc(columns))) } : {}),
        ...(Number.isFinite(gapX) ? { gapX: Math.max(0, gapX) } : {}),
        ...(Number.isFinite(gapY) ? { gapY: Math.max(0, gapY) } : {}),
        ...(Number.isFinite(originX) ? { originX } : {}),
        ...(Number.isFinite(originY) ? { originY } : {}),
      });
      continue;
    }
    if (kind === 'layout-diagram') {
      const nodeIds = Array.isArray(unknownCommand.nodeIds) ? unknownCommand.nodeIds.filter((item): item is string => typeof item === 'string') : [];
      const roots = Array.isArray(unknownCommand.roots) ? unknownCommand.roots.filter((item): item is string => typeof item === 'string') : [];
      const gapX = Number(unknownCommand.gapX);
      const gapY = Number(unknownCommand.gapY);
      const originX = Number(unknownCommand.originX);
      const originY = Number(unknownCommand.originY);
      const layerSpacing = Number(unknownCommand.layerSpacing);
      const nodeSpacing = Number(unknownCommand.nodeSpacing);
      commands.push({
        kind: 'layout-diagram',
        ...(nodeIds.length ? { nodeIds } : {}),
        ...(roots.length ? { roots } : {}),
        ...(Number.isFinite(gapX) ? { gapX: Math.max(8, gapX) } : {}),
        ...(Number.isFinite(gapY) ? { gapY: Math.max(8, gapY) } : {}),
        ...(Number.isFinite(originX) ? { originX } : {}),
        ...(Number.isFinite(originY) ? { originY } : {}),
        ...(Number.isFinite(layerSpacing) ? { layerSpacing: Math.max(16, layerSpacing) } : {}),
        ...(Number.isFinite(nodeSpacing) ? { nodeSpacing: Math.max(16, nodeSpacing) } : {}),
      });
    }
  }
  return commands;
}

export function orderedNodes(scene: CanvasScene): CanvasNode[] {
  return scene.nodes.map((node, index) => ({ node, index })).sort((a, b) => (a.node.layer ?? a.index) - (b.node.layer ?? b.index) || a.index - b.index).map(({ node }) => node);
}

function alignAxis(nodes: CanvasNode[]): { x: number; y: number; width: number; height: number }[] {
  return nodes.map((node) => {
    const b = nodeBounds(node);
    return { ...b, x: snap(b.x), y: snap(b.y), width: snap(b.width), height: snap(b.height) };
  });
}

export function moveLayer(scene: CanvasScene, id: string, direction: -1 | 1): CanvasScene {
  const nodes = orderedNodes(scene);
  const at = nodes.findIndex((node) => node.id === id);
  const next = at < 0 ? nodes : [...nodes.slice(0, at), ...nodes.slice(at + 1)];
  if (at >= 0) next.splice(clamp(at + direction, 0, nodes.length - 1), 0, nodes[at]);
  return { ...scene, nodes: next.map((node, index) => ({ ...node, layer: index })) };
}

function clampGrid(value: number, grid: number) {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}

function shiftPoints(points: string, dx: number, dy: number, grid: number): string {
  const values = points.trim().split(/[ ,]+/).map(Number);
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return points;
  return values.map((value, index) => String(snap(value + (index % 2 ? dy : dx), grid))).join(' ');
}

export function nodeCenter(node: CanvasNode): { x: number; y: number } {
  const bounds = nodeBounds(node);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function moveNode(scene: CanvasScene, id: string, dx: number, dy: number, grid = 0): CanvasScene {
  return { ...scene, nodes: scene.nodes.map((node) => {
    if (node.id !== id || node.locked) return node;
    const next = { ...node };
    if (node.x != null) next.x = clampGrid(node.x + dx, grid);
    if (node.y != null) next.y = clampGrid(node.y + dy, grid);
    if (node.cx != null) next.cx = clampGrid(node.cx + dx, grid);
    if (node.cy != null) next.cy = clampGrid(node.cy + dy, grid);
    if (node.x1 != null) next.x1 = clampGrid(node.x1 + dx, grid);
    if (node.y1 != null) next.y1 = clampGrid(node.y1 + dy, grid);
    if (node.x2 != null) next.x2 = clampGrid(node.x2 + dx, grid);
    if (node.y2 != null) next.y2 = clampGrid(node.y2 + dy, grid);
    if (node.points) next.points = shiftPoints(node.points, dx, dy, grid);
    return next;
  }) };
}

export function nodeBounds(node: CanvasNode): { x: number; y: number; width: number; height: number } {
  if (node.type === 'circle') { const r = Math.abs(finite(node.r, 0)); return { x: finite(node.cx) - r, y: finite(node.cy) - r, width: r * 2, height: r * 2 }; }
  if (node.type === 'ellipse') { const rx = Math.abs(finite(node.rx, 0)); const ry = Math.abs(finite(node.ry, 0)); return { x: finite(node.cx) - rx, y: finite(node.cy) - ry, width: rx * 2, height: ry * 2 }; }
  if (node.type === 'line') {
    const x = Math.min(finite(node.x1), finite(node.x2)); const y = Math.min(finite(node.y1), finite(node.y2));
    return { x, y, width: Math.abs(finite(node.x2) - finite(node.x1)), height: Math.abs(finite(node.y2) - finite(node.y1)) };
  }
  if (node.type === 'polyline' || node.type === 'polygon') {
    const values = (node.points ?? '').trim().split(/[ ,]+/).map(Number).filter(Number.isFinite);
    const xs = values.filter((_, index) => index % 2 === 0); const ys = values.filter((_, index) => index % 2 === 1);
    if (xs.length && ys.length) { const x = Math.min(...xs); const y = Math.min(...ys); return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }; }
  }
  const x = finite(node.x); const y = finite(node.y); return { x, y, width: Math.max(0, finite(node.width, node.type === 'text' ? 80 : 0)), height: Math.max(0, finite(node.height, node.type === 'text' ? finite(node.fontSize, 16) : 0)) };
}

type DiagramLayoutEdge = { from: string; to: string };

function buildDiagramGraph(scene: CanvasScene, nodeIds?: string[]) {
  const selected = nodeIds?.length ? new Set(nodeIds) : undefined;
  const nodes = scene.nodes.filter((node) => node.type !== 'line' && (!selected || selected.has(node.id)));
  const nodeSet = new Set(nodes.map((node) => node.id));
  const edges: DiagramLayoutEdge[] = scene.nodes
    .filter((node) => node.type === 'line' && node.fromId && node.toId && (!selected || (selected.has(node.fromId) && selected.has(node.toId))))
    .map((node) => ({ from: node.fromId!, to: node.toId! }));
  const edgeByFrom = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  nodes.forEach((node) => { edgeByFrom.set(node.id, new Set()); indegree.set(node.id, 0); });
  edges.forEach(({ from, to }) => {
    if (!nodeSet.has(from) || !nodeSet.has(to)) return;
    edgeByFrom.get(from)?.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  });
  return { nodes, nodeSet, edgeByFrom, indegree };
}

function setLineEndpoints(line: CanvasNode, nodes: ReadonlyMap<string, CanvasNode>) {
  if (!line.fromId || !line.toId) return line;
  const from = nodes.get(line.fromId);
  const to = nodes.get(line.toId);
  if (!from || !to) return line;
  const start = nodeCenter(from);
  const end = nodeCenter(to);
  return { ...line, x1: start.x, y1: start.y, x2: end.x, y2: end.y, type: 'line' };
}

export function createHistory(scene: CanvasScene): CanvasHistory { return { past: [], present: copy(scene), future: [] }; }
export function commitHistory(history: CanvasHistory, scene: CanvasScene): CanvasHistory { return { past: [...history.past, history.present].slice(-100), present: copy(scene), future: [] }; }
export function undoHistory(history: CanvasHistory): CanvasHistory { const previous = history.past.at(-1); return previous ? { past: history.past.slice(0, -1), present: copy(previous), future: [history.present, ...history.future] } : history; }
export function redoHistory(history: CanvasHistory): CanvasHistory { const next = history.future[0]; return next ? { past: [...history.past, history.present], present: copy(next), future: history.future.slice(1) } : history; }

function imageUri(scene: CanvasScene, node: CanvasNode): string | undefined {
  const uri = node.imageRef ? scene.images?.[node.imageRef] : node.href;
  return uri && imageSource.safeParse(uri).success ? uri : undefined;
}

function connectNodes(scene: CanvasScene, fromId: string, toId: string, color = '#3b82f6', strokeWidth = 2): CanvasScene {
  const from = scene.nodes.find((node) => node.id === fromId);
  const to = scene.nodes.find((node) => node.id === toId);
  if (!from || !to) return scene;
  const start = nodeCenter(from);
  const end = nodeCenter(to);
  const edgeId = `edge-${fromId}-${toId}`;
  if (scene.nodes.some((node) => node.id === edgeId)) return scene;
  const line: CanvasNode = { id: edgeId, type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: color, strokeWidth };
  return { ...scene, nodes: [...scene.nodes, { ...line, fromId, toId, id: edgeId }] };
}

export function canvasDiagramNeighbors(scene: CanvasScene, nodeId: string): string[] {
  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  for (const node of scene.nodes) {
    if (node.type !== 'line' || !diagramEdge(node)) continue;
    if (node.fromId === nodeId) { if (node.toId) outgoing.add(node.toId); }
    if (node.toId === nodeId) { if (node.fromId) incoming.add(node.fromId); }
  }
  return Array.from(new Set([...outgoing, ...incoming]));
}

export function canvasDiagramPath(scene: CanvasScene, fromId: string, toId: string, maxDepth = 20): string[] | null {
  if (fromId === toId) return [fromId];
  const queue = [{ id: fromId, path: [fromId] }];
  const seen = new Set([fromId]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) return null;
    for (const next of canvasDiagramNeighbors(scene, current.id)) {
      if (seen.has(next)) continue;
      const nextPath = [...current.path, next];
      if (next === toId) return nextPath;
      seen.add(next);
      queue.push({ id: next, path: nextPath });
    }
  }
  return null;
}

export function canvasDiagramRoots(scene: CanvasScene, nodeIds?: string[]): string[] {
  const selected = new Set(nodeIds && nodeIds.length ? nodeIds : scene.nodes.map((node) => node.id));
  const hasIn = new Set<string>();
  for (const node of scene.nodes) {
    if (node.type !== 'line' || !node.fromId || !node.toId) continue;
    if (selected.has(node.fromId) && selected.has(node.toId)) hasIn.add(node.toId);
  }
  return [...selected].filter((id) => !hasIn.has(id) && scene.nodes.some((node) => node.id === id));
}

export function canvasDiagramLayers(scene: CanvasScene, roots?: string[]): string[][] {
  const all = new Set(scene.nodes.map((node) => node.id));
  const selected = roots && roots.length ? new Set(roots) : undefined;
  const start = selected && selected.size ? [...selected].filter((nodeId) => all.has(nodeId)) : canvasDiagramRoots(scene, undefined);
  const outgoing = (from: string) => scene.nodes
    .filter((node) => node.type === 'line' && node.fromId === from && (!selected || !node.toId || selected.has(node.toId)))
    .map((edge) => edge.toId)
    .filter((toId): toId is string => Boolean(toId));

  const layers: string[][] = [];
  const seen = new Set<string>();
  let frontier = [...start];
  frontier.forEach((nodeId) => seen.add(nodeId));
  while (frontier.length) {
    const ordered = [...frontier].sort();
    layers.push(ordered);
    const next = new Set<string>();
    frontier.forEach((nodeId) => outgoing(nodeId).forEach((toId) => {
      if (!seen.has(toId)) { seen.add(toId); next.add(toId); }
    }));
    frontier = [...next].filter((value) => value !== undefined);
  }

  const remaining = [...all].filter((nodeId) => !seen.has(nodeId));
  for (const nodeId of [...remaining].sort()) {
    layers.push([nodeId]);
    seen.add(nodeId);
  }
  return layers;
}

export function canvasDiagramSummary(scene: CanvasScene, nodeIds?: string[]) {
  const selected = nodeIds && nodeIds.length ? new Set(nodeIds) : undefined;
  const nodes = scene.nodes.filter((node) => !selected || selected.has(node.id));
  const roots = canvasDiagramRoots(scene, selected ? [...selected] : undefined);
  const edges = nodes.filter((node) => node.type === 'line' && node.fromId && node.toId && (!selected || (selected.has(node.fromId) && selected.has(node.toId))));
  const hasType = nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] ?? 0) + 1;
    return acc;
  }, {} as Record<CanvasNode['type'], number>);
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    layers: canvasDiagramLayers(scene, roots),
    roots,
    types: hasType,
  };
}

function patchStyle(scene: CanvasScene, nodeIds: string[], patch: Pick<CanvasNode, 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'locked' | 'visible'>): CanvasScene {
  const set = new Set(nodeIds);
  const nextOpacity = Number.isFinite(patch.opacity) ? clamp(finite(patch.opacity, 1), 0, 1) : undefined;
  const nextStrokeWidth = Number.isFinite(patch.strokeWidth) ? clamp(finite(patch.strokeWidth, 1), 0, 100) : undefined;
  return {
    ...scene,
    nodes: scene.nodes.map((node) => set.has(node.id) ? {
      ...node,
      ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
      ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
      ...(nextStrokeWidth !== undefined ? { strokeWidth: nextStrokeWidth } : {}),
      ...(nextOpacity !== undefined ? { opacity: nextOpacity } : {}),
      ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
    } : node),
  };
}

function applyLayoutGrid(scene: CanvasScene, nodeIds: string[], columns = 3, gapX = 24, gapY = 24, originX = 32, originY = 32): CanvasScene {
  const ordered = scene.nodes.filter((node) => nodeIds.includes(node.id));
  const width = finite(ordered.reduce((max, node) => Math.max(max, finite(node.width, 0)), 0), 80) + gapX;
  const map = new Map(scene.nodes.map((node) => [node.id, node] as const));
  ordered.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const current = map.get(node.id);
    if (current) {
      current.x = originX + col * width;
      current.y = originY + row * (finite(current.height, 24) + gapY);
    }
  });
  return { ...scene, nodes: [...map.values()] };
}

type DiagramLayoutOption = Extract<CanvasCommand, { kind: 'layout-diagram' }>;

function applyLayoutDiagram(scene: CanvasScene, options: DiagramLayoutOption): CanvasScene {
  const selected = options.nodeIds && options.nodeIds.length ? new Set(options.nodeIds) : undefined;
  const roots = options.roots && options.roots.length ? options.roots : undefined;
  const layers = canvasDiagramLayers(scene, roots);
  const nodes = new Map(scene.nodes.map((node) => [node.id, node] as const));
  const nodeSpacing = Math.max(16, options.nodeSpacing ?? 96);
  const layerSpacing = Math.max(20, options.layerSpacing ?? 120);
  const originX = options.originX ?? 32;
  const originY = options.originY ?? 32;
  const gapX = options.gapX ?? nodeSpacing;
  const gapY = options.gapY ?? layerSpacing;

  const spacing = layers.reduce((max, layer, index) => {
    if (!layer.length) return max;
    const widths = layer.map((id) => {
      const node = nodes.get(id);
      return node ? nodeBounds(node).width : 0;
    });
    const widest = Math.max(80, ...widths);
    max[index] = widest + gapX;
    return max;
  }, [] as number[]);

  layers.forEach((layer, index) => layer.forEach((id, offset) => {
    if (selected && !selected.has(id)) return;
    const node = nodes.get(id);
    if (!node || node.locked) return;
    const b = nodeBounds(node);
    const next = { ...node, x: originX + offset * (spacing[index] ?? (b.width + gapX)), y: originY + index * (b.height + gapY) };
    if (node.type === 'line') Object.assign(next, setLineEndpoints(node, nodes));
    nodes.set(id, next);
  }));
  return { ...scene, nodes: [...nodes.values()] };
}

export function canvasDiagramTopology(scene: CanvasScene, options: { nodeIds?: string[]; includeDisconnected?: boolean } = {}) {
  const { nodes, nodeSet, edgeByFrom, indegree } = buildDiagramGraph(scene, options.nodeIds);
  const remaining = new Map(indegree);
  const queue = [...nodeSet].filter((nodeId) => (remaining.get(nodeId) ?? 0) === 0);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    seen.add(id);
    for (const next of edgeByFrom.get(id) ?? []) {
      const nextDegree = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  const cycles = seen.size !== nodeSet.size;

  const nodeIds = options.nodeIds;
  const roots = canvasDiagramRoots(scene, nodeIds ? [...nodeIds] : undefined);
  const disconnected = options.includeDisconnected ? nodes.filter((node) => {
    const incoming = [...edgeByFrom.values()].some((targets) => targets.has(node.id));
    const outgoing = (edgeByFrom.get(node.id)?.size ?? 0) > 0;
    return !incoming && !outgoing;
  }).map((node) => node.id) : [];

  return {
    nodeCount: nodes.length,
    edgeCount: [...edgeByFrom.values()].reduce((sum, next) => sum + next.size, 0),
    roots,
    cycles,
    disconnected,
  };
}

function resizeNode(scene: CanvasScene, nodeId: string, delta: { width?: number; height?: number; dWidth?: number; dHeight?: number }): CanvasScene {
  return { ...scene, nodes: scene.nodes.map((node) => {
    if (node.id !== nodeId || node.locked) return node;
    const width = finite(node.width, 0);
    const height = finite(node.height, 0);
    const next = { ...node };
    if (delta.width != null) next.width = clamp(delta.width, 1, 10_000);
    if (delta.height != null) next.height = clamp(delta.height, 1, 10_000);
    if (delta.dWidth != null) next.width = clamp(width + delta.dWidth, 1, 10_000);
    if (delta.dHeight != null) next.height = clamp(height + delta.dHeight, 1, 10_000);
    return next;
  }) };
}

function alignNodes(scene: CanvasScene, nodeIds: string[], axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'): CanvasScene {
  const targets = scene.nodes.filter((node) => nodeIds.includes(node.id));
  if (targets.length < 2) return scene;
  const bounds = alignAxis(targets);
  const first = bounds[0];
  const reference = {
    left: Math.min(...bounds.map((item) => item.x)),
    right: Math.max(...bounds.map((item) => item.x + item.width)),
    top: Math.min(...bounds.map((item) => item.y)),
    bottom: Math.max(...bounds.map((item) => item.y + item.height)),
  };
  const centerX = bounds.reduce((sum, item) => sum + item.x + item.width / 2, 0) / bounds.length;
  const centerY = bounds.reduce((sum, item) => sum + item.y + item.height / 2, 0) / bounds.length;
  return { ...scene, nodes: scene.nodes.map((node) => {
    const index = targets.findIndex((target) => target.id === node.id);
    if (index < 0 || node.locked) return node;
    const b = bounds[index];
    const next = { ...node };
    if (axis === 'left') next.x = reference.left;
    if (axis === 'right') next.x = reference.right - finite(next.width, b.width);
    if (axis === 'top') next.y = reference.top;
    if (axis === 'bottom') next.y = reference.bottom - finite(next.height, b.height);
    if (axis === 'centerX') {
      const targetX = centerX - finite(next.width, b.width) / 2;
      next.x = targetX;
    }
    if (axis === 'centerY') {
      const targetY = centerY - finite(next.height, b.height) / 2;
      next.y = targetY;
    }
    return next;
  }) };
}

function distributeNodes(scene: CanvasScene, nodeIds: string[], axis: 'x' | 'y', spacing = 16): CanvasScene {
  const indexes = scene.nodes.map((node, index) => ({ node, index })).filter((entry) => nodeIds.includes(entry.node.id));
  if (indexes.length < 3) return scene;
  const ordered = indexes.sort((a, b) => axis === 'x' ? a.node.x! - b.node.x! : a.node.y! - b.node.y!);
  const first = ordered[0].node;
  const last = ordered.at(-1)!.node;
  const firstBounds = nodeBounds(first);
  const lastBounds = nodeBounds(last);
  const firstPos = axis === 'x' ? firstBounds.x + firstBounds.width / 2 : firstBounds.y + firstBounds.height / 2;
  const lastPos = axis === 'x' ? lastBounds.x + lastBounds.width / 2 : lastBounds.y + lastBounds.height / 2;
  const span = lastPos - firstPos;
  if (!span) return scene;
  const step = span / (ordered.length - 1);
  const withDistributed = [...ordered].map((entry, index) => ({ ...entry, offset: index * step }));
  return {
    ...scene,
    nodes: scene.nodes.map((node, index) => {
      const located = withDistributed.find((item) => item.node.id === node.id);
      if (!located || node.locked) return node;
      const next = { ...node };
      const b = nodeBounds(located.node);
      if (axis === 'x') {
        const base = firstPos + located.offset;
        const target = base + (0.5 * finite(next.width, b.width)) - finite(next.width, b.width) / 2;
        next.x = target + index * clamp(spacing, 0, 5_000);
      } else {
        const target = firstPos + located.offset + (0.5 * finite(next.height, b.height)) - finite(next.height, b.height) / 2;
        next.y = target + index * clamp(spacing, 0, 5_000);
      }
      next.x = snap(next.x ?? 0, spacing);
      next.y = snap(next.y ?? 0, spacing);
      return next;
    }),
  };
}

export function applyCanvasCommand(scene: CanvasScene, command: CanvasCommand): CanvasScene {
  if (command.kind === 'collab-sync') return applyCanvasCollabOps(scene, command);
  if (command.kind === 'move') return command.nodeIds.reduce((current, id) => moveNode(current, id, command.dx, command.dy, command.grid ?? 0), scene);
  if (command.kind === 'resize') return resizeNode(scene, command.nodeId, command);
  if (command.kind === 'align') return alignNodes(scene, command.nodeIds, command.axis);
  if (command.kind === 'distribute') return distributeNodes(scene, command.nodeIds, command.axis, Number.isFinite(command.spacing ?? NaN) ? Number(command.spacing) : 16);
  if (command.kind === 'set-layer') {
    const ordered = orderedNodes(scene);
    const source = ordered.findIndex((node) => node.id === command.nodeId);
    if (source < 0) return scene;
    const target = clamp(Math.trunc(command.layer), 0, Math.max(ordered.length - 1, 0));
    if (source === target) return scene;
    const direction = target > source ? 1 : -1;
    let next = scene;
    for (let index = 0; index < Math.abs(target - source); index += 1) {
      next = moveLayer(next, command.nodeId, direction);
    }
    return next;
  }
  if (command.kind === 'toggle-lock') {
    const set = new Set(command.nodeIds);
    return { ...scene, nodes: scene.nodes.map((node) => (set.has(node.id) ? { ...node, locked: !node.locked } : node)) };
  }
  if (command.kind === 'toggle-visible') {
    const set = new Set(command.nodeIds);
    return { ...scene, nodes: scene.nodes.map((node) => (set.has(node.id) ? { ...node, visible: node.visible === false ? true : false } : node)) };
  }
  if (command.kind === 'remove') {
    const set = new Set(command.nodeIds);
    return { ...scene, nodes: scene.nodes.filter((node) => !set.has(node.id)) };
  }
  if (command.kind === 'remove-edge') {
    return { ...scene, nodes: scene.nodes.filter((node) => !(node.type === 'line' && node.fromId === command.fromId && node.toId === command.toId) && !(node.type === 'line' && node.fromId === command.toId && node.toId === command.fromId)) };
  }
  if (command.kind === 'style') return patchStyle(scene, command.nodeIds, command.patch);
  if (command.kind === 'layout-grid') return applyLayoutGrid(scene, command.nodeIds, command.columns ?? 3, command.gapX ?? 24, command.gapY ?? 24, command.originX ?? 32, command.originY ?? 32);
  if (command.kind === 'layout-diagram') return applyLayoutDiagram(scene, command);
  if (command.kind === 'duplicate') {
    const source = scene.nodes.find((node) => node.id === command.nodeId);
    if (!source || source.locked) return scene;
    const copyNode = { ...source, id: command.copyId || `${source.id}-copy`, x: finite(source.x, 0) + 12, y: finite(source.y, 0) + 12, cx: source.cx == null ? undefined : source.cx + 12, cy: source.cy == null ? undefined : source.cy + 12 };
    if (scene.nodes.some((item) => item.id === copyNode.id)) return scene;
    return { ...scene, nodes: [...scene.nodes, copyNode] };
  }
  if (command.kind === 'add-node') return { ...scene, nodes: [...scene.nodes, { ...command.node, id: command.node.id ?? `node-${scene.nodes.length}` }] };
  return connectNodes(scene, command.fromId, command.toId, command.color ?? '#3b82f6', command.strokeWidth);
}

export function applyCanvasCommands(scene: CanvasScene, commands: unknown[]): CanvasScene {
  return parseCanvasCommands(commands).reduce((next, command) => applyCanvasCommand(next, command), scene);
}

function Shape({ node, scene, selected, onSelect }: { node: CanvasNode; scene: CanvasScene; selected: boolean; onSelect(): void }) {
  if (node.visible === false) return null;
  const b = nodeBounds(node); const rotation = node.rotation ? `rotate(${node.rotation} ${b.x + b.width / 2} ${b.y + b.height / 2})` : undefined;
  const common = { opacity: node.opacity ?? 1, stroke: node.stroke, strokeWidth: node.strokeWidth, onPress: onSelect };
  let shape: React.ReactNode = null;
  switch (node.type) {
    case 'rect': shape = <Rect {...common} x={node.x} y={node.y} width={node.width} height={node.height} rx={finite(node.rx)} fill={node.fill ?? '#F0B35A'} transform={rotation} />; break;
    case 'circle': shape = <Circle {...common} cx={node.cx} cy={node.cy} r={node.r} fill={node.fill ?? '#59B8A9'} />; break;
    case 'ellipse': shape = <Ellipse {...common} cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} fill={node.fill ?? '#D985A4'} />; break;
    case 'line': shape = <Line {...common} x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} stroke={node.stroke ?? '#1D2A33'} />; break;
    case 'path': shape = node.d && pathSafe.test(node.d) ? <Path {...common} d={node.d} fill={node.fill ?? 'none'} transform={`translate(${finite(node.x)} ${finite(node.y)})`} /> : null; break;
    case 'polyline': shape = node.points && pointsSafe.test(node.points) ? <Polyline {...common} points={node.points} fill={node.fill ?? 'none'} /> : null; break;
    case 'polygon': shape = node.points && pointsSafe.test(node.points) ? <Polygon {...common} points={node.points} fill={node.fill ?? '#7F9BE8'} /> : null; break;
    case 'text': shape = <SvgText {...common} x={node.x} y={node.y} fill={node.fill ?? '#182019'} fontSize={node.fontSize ?? 16}>{node.text ?? ''}</SvgText>; break;
    case 'image': { const href = imageUri(scene, node); shape = href ? <SvgImage {...common} x={node.x} y={node.y} width={node.width} height={node.height} href={href} preserveAspectRatio="xMidYMid slice" /> : null; break; }
  }
  return <G>{shape}{selected ? <Rect x={b.x - 4} y={b.y - 4} width={Math.max(8, b.width + 8)} height={Math.max(8, b.height + 8)} fill="none" stroke="#1C8B71" strokeWidth={2} strokeDasharray="5 4" /> : null}</G>;
}

export function CanvasWidget({ scene, width = '100%', height = 320, selectedId: controlledSelected, snap: grid = 0, minZoom = .5, maxZoom = 4, controls = true, commands, onChange, onSelectionChange, onViewportChange, onExport, onCommit }: CanvasWidgetProps) {
  const parsed = useMemo(() => parseCanvasScene(scene), [scene]);
  const [current, setCurrent] = useState(parsed); const [selectedId, setSelectedId] = useState(controlledSelected); const [mode, setMode] = useState<'select' | 'pan'>('select'); const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const history = useRef(createHistory(parsed)); const lastScene = useRef(exportCanvasScene(parsed)); const drag = useRef<{ id: string; before: CanvasScene; last?: CanvasScene } | null>(null); const panStart = useRef({ x: 0, y: 0 }); const pinchStart = useRef(1);
  const commandsRef = useRef(''); const panX = useSharedValue(0); const panY = useSharedValue(0); const zoom = useSharedValue(1);
  useEffect(() => { const serialized = exportCanvasScene(parsed); if (serialized !== lastScene.current && serialized !== exportCanvasScene(current)) { setCurrent(parsed); history.current = createHistory(parsed); lastScene.current = serialized; } }, [parsed, current]);
  useEffect(() => { if (controlledSelected !== undefined) { setSelectedId(controlledSelected); } }, [controlledSelected]);

  useEffect(() => {
    const nextCommands = Array.isArray(commands) ? JSON.stringify(commands) : '';
    if (!nextCommands || nextCommands === commandsRef.current) return;
    commandsRef.current = nextCommands;
    setCurrent((currentScene) => {
      const next = applyCanvasCommands(currentScene, commands as unknown[]);
      if (exportCanvasScene(next) === exportCanvasScene(currentScene)) return currentScene;
      history.current = commitHistory(history.current, next);
      onChange?.(next);
      onCommit?.(next);
      return next;
    });
  }, [commands, onChange, onCommit]);

  const update = useCallback((next: CanvasScene, record = true) => { setCurrent(next); lastScene.current = exportCanvasScene(next); if (record) history.current = commitHistory(history.current, next); onChange?.(next); }, [onChange]);
  const select = useCallback((id?: string) => { setSelectedId(id); onSelectionChange?.(id); }, [onSelectionChange]);
  const pan = useMemo(() => Gesture.Pan().runOnJS(true).onStart(() => { panStart.current = { x: panX.value, y: panY.value }; if (mode === 'select' && selectedId) drag.current = { id: selectedId, before: current }; }).onUpdate((event) => { if (drag.current) { const next = moveNode(drag.current.before, drag.current.id, event.translationX / zoom.value, event.translationY / zoom.value, grid); drag.current.last = next; update(next, false); } else { panX.value = panStart.current.x + event.translationX; panY.value = panStart.current.y + event.translationY; } }).onEnd(() => { const active = drag.current; if (active) { const committed = active.last ?? active.before; history.current = commitHistory(history.current, committed); onCommit?.(committed); drag.current = null; } else { const next = { x: panX.value, y: panY.value, zoom: zoom.value }; setViewport(next); onViewportChange?.(next); } }), [current, grid, mode, onCommit, onViewportChange, selectedId, update, zoom, panX, panY]);
  const pinch = useMemo(() => Gesture.Pinch().runOnJS(true).onStart(() => { pinchStart.current = zoom.value; }).onUpdate((event) => { zoom.value = clamp(pinchStart.current * event.scale, minZoom, maxZoom); }).onEnd(() => { const next = { x: panX.value, y: panY.value, zoom: zoom.value }; setViewport(next); onViewportChange?.(next); }), [maxZoom, minZoom, onViewportChange, panX, panY, zoom]);
  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: zoom.value }] }));
  const undo = () => { const next = undoHistory(history.current); if (next !== history.current) { history.current = next; update(next.present, false); onCommit?.(next.present); } };
  const redo = () => { const next = redoHistory(history.current); if (next !== history.current) { history.current = next; update(next.present, false); onCommit?.(next.present); } };
  const exportJson = () => { const json = exportCanvasScene(current); onExport?.(json, current); };
  return <View style={[{ width, height, overflow: 'hidden', backgroundColor: parsed.background ?? '#F7FAF4' } as ViewStyle]}>
    {controls ? <View style={{ flexDirection: 'row', gap: 8, padding: 8 }}>
      <Pressable accessibilityLabel="Select objects" accessibilityState={{ selected: mode === 'select' }} onPress={() => setMode('select')}><MousePointer2 color={mode === 'select' ? '#176B5B' : '#66736B'} /></Pressable>
      <Pressable accessibilityLabel="Pan canvas" accessibilityState={{ selected: mode === 'pan' }} onPress={() => setMode('pan')}><Hand color={mode === 'pan' ? '#176B5B' : '#66736B'} /></Pressable>
      <Pressable accessibilityLabel="Undo" onPress={undo}><Undo2 color="#182019" /></Pressable>
      <Pressable accessibilityLabel="Redo" onPress={redo}><Redo2 color="#182019" /></Pressable>
      <Pressable accessibilityLabel="Export canvas" onPress={exportJson}><Download color="#182019" /></Pressable>
      <Text style={{ marginLeft: 'auto', color: '#66736B' }}>{Math.round(viewport.zoom * 100)}%</Text>
    </View> : null}
    <GestureDetector gesture={gesture}><Animated.View style={[{ flex: 1 } as ViewStyle, animatedStyle]}><Svg width="100%" height="100%" viewBox={`0 0 ${parsed.width} ${parsed.height}`} accessibilityLabel="Canvas">
      {orderedNodes(current).map((node) => <Shape key={node.id} node={node} scene={current} selected={node.id === selectedId} onSelect={() => select(node.id)} />)}
    </Svg></Animated.View></GestureDetector>
  </View>;
}
