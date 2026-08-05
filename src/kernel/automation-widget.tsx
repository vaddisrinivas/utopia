import { Check, GitBranch, Play, Plus, Redo2, Trash2, Undo2, Zap } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Button, Input, ScrollView, Text, XStack, YStack } from 'tamagui';
import { z } from 'zod';

import type { AppComponent } from './schema';

const Id = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Label = z.string().trim().min(1).max(96);
const Scalar = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);
const Values = z.record(z.string().max(64), Scalar).refine((value) => Object.keys(value).length <= 32, 'at most 32 values');

const TriggerNodeSchema = z.object({
  id: Id, kind: z.literal('trigger'), label: Label, event: Id,
}).strict();

const ActionNodeSchema = z.object({
  id: Id, kind: z.literal('action'), label: Label,
  operation: z.enum(['create', 'update', 'delete', 'notify', 'navigate', 'set']),
  target: Id.optional(), values: Values.default({}),
}).strict();

const ConditionNodeSchema = z.object({
  id: Id, kind: z.literal('condition'), label: Label,
  field: Id, operator: z.enum(['exists', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte']), value: Scalar.optional(),
}).strict();

const DelayNodeSchema = z.object({
  id: Id, kind: z.literal('delay'), label: Label,
  milliseconds: z.number().int().min(0).max(86_400_000),
}).strict();

export const AutomationNodeSchema = z.discriminatedUnion('kind', [
  TriggerNodeSchema, ActionNodeSchema, ConditionNodeSchema, DelayNodeSchema,
]);

export const AutomationEdgeSchema = z.object({
  id: Id, from: Id, to: Id, when: z.enum(['always', 'true', 'false']).default('always'), label: z.string().trim().max(64).optional(),
}).strict();

export const AutomationConfigSchema = z.object({
  schemaVersion: z.literal('utopia.automation.v3'),
  id: Id, title: Label,
  nodes: z.array(AutomationNodeSchema).min(1).max(100),
  edges: z.array(AutomationEdgeSchema).max(200),
  enabled: z.boolean().default(true),
  maxSteps: z.number().int().min(1).max(500).default(100),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  for (const node of config.nodes) {
    if (ids.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes'], message: `duplicate node ${node.id}` });
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  const edges = new Map<string, typeof config.edges>();
  for (const edge of config.edges) {
    if (edgeIds.has(edge.id)) context.addIssue({ code: 'custom', path: ['edges'], message: `duplicate edge ${edge.id}` });
    edgeIds.add(edge.id);
    if (!ids.has(edge.from)) context.addIssue({ code: 'custom', path: ['edges'], message: `unknown edge source ${edge.from}` });
    if (!ids.has(edge.to)) context.addIssue({ code: 'custom', path: ['edges'], message: `unknown edge target ${edge.to}` });
    if (edge.from === edge.to) context.addIssue({ code: 'custom', path: ['edges'], message: `self edge ${edge.id}` });
    edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge]);
  }
  const triggers = config.nodes.filter((node) => node.kind === 'trigger');
  if (!triggers.length) context.addIssue({ code: 'custom', path: ['nodes'], message: 'at least one trigger is required' });
  for (const node of config.nodes.filter((item) => item.kind === 'condition')) {
    const outgoing = edges.get(node.id) ?? [];
    if (outgoing.length > 1 && outgoing.every((edge) => edge.when === 'always')) {
      context.addIssue({ code: 'custom', path: ['edges'], message: `condition ${node.id} needs true/false edges` });
    }
  }
  const incoming = new Map<string, number>();
  for (const node of config.nodes) incoming.set(node.id, 0);
  for (const edge of config.edges) if (ids.has(edge.from) && ids.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const queue = config.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const edge of edges.get(id) ?? []) {
      const next = (incoming.get(edge.to) ?? 0) - 1;
      incoming.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  if (visited !== config.nodes.length) context.addIssue({ code: 'custom', path: ['edges'], message: 'automation graph must be acyclic' });
});

export type AutomationNode = z.infer<typeof AutomationNodeSchema>;
export type AutomationEdge = z.infer<typeof AutomationEdgeSchema>;
export type AutomationConfig = z.infer<typeof AutomationConfigSchema>;
export type AutomationScalar = z.infer<typeof Scalar>;
export type AutomationInput = { trigger: string; data?: Record<string, AutomationScalar> };
export type AutomationStepStatus = 'pending' | 'completed' | 'skipped' | 'blocked';
export type AutomationStep = { nodeId: string; kind: AutomationNode['kind']; label: string; status: AutomationStepStatus; atMs: number; output?: string };
export type AutomationSimulation = { accepted: boolean; elapsedMs: number; steps: AutomationStep[]; reason?: string };
export type AutomationHistory = { past: AutomationConfig[]; present: AutomationConfig; future: AutomationConfig[] };

function semanticParse(input: unknown): AutomationConfig {
  return AutomationConfigSchema.parse(input);
}

export function parseAutomationConfig(input: unknown): AutomationConfig {
  return semanticParse(input);
}

export function validateAutomationConfig(input: unknown): string[] {
  const result = AutomationConfigSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const copyConfig = (config: AutomationConfig): AutomationConfig => ({
  ...config,
  nodes: config.nodes.map((node) => ({ ...node, ...('values' in node ? { values: { ...node.values } } : {}) } as AutomationNode)),
  edges: config.edges.map((edge) => ({ ...edge })),
});

function checkedConfig(config: AutomationConfig): AutomationConfig {
  return semanticParse(copyConfig(config));
}

export function nextAutomationNodeId(config: AutomationConfig, kind: AutomationNode['kind'] = 'action'): string {
  const prefix = `${kind}-`;
  let index = config.nodes.length + 1;
  while (config.nodes.some((node) => node.id === `${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function addAutomationNode(config: AutomationConfig, node: AutomationNode): AutomationConfig {
  return checkedConfig({ ...config, nodes: [...config.nodes, node] });
}

export function editAutomationNode(config: AutomationConfig, nodeId: string, patch: Partial<AutomationNode>): AutomationConfig {
  const current = config.nodes.find((node) => node.id === nodeId);
  if (!current) throw new Error(`unknown node ${nodeId}`);
  const next = { ...current, ...patch, id: nodeId } as AutomationNode;
  return checkedConfig({ ...config, nodes: config.nodes.map((node) => node.id === nodeId ? next : node) });
}

export function deleteAutomationNode(config: AutomationConfig, nodeId: string): AutomationConfig {
  if (!config.nodes.some((node) => node.id === nodeId)) throw new Error(`unknown node ${nodeId}`);
  return checkedConfig({ ...config, nodes: config.nodes.filter((node) => node.id !== nodeId), edges: config.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId) });
}

export function connectAutomationNodes(config: AutomationConfig, from: string, to: string, when: AutomationEdge['when'] = 'always'): AutomationConfig {
  if (!config.nodes.some((node) => node.id === from) || !config.nodes.some((node) => node.id === to)) throw new Error('edge endpoints must exist');
  const id = `edge-${from}-${to}-${when}`;
  if (config.edges.some((edge) => edge.id === id)) return copyConfig(config);
  return checkedConfig({ ...config, edges: [...config.edges, { id, from, to, when }] });
}

export function createAutomationHistory(config: AutomationConfig): AutomationHistory {
  return { past: [], present: copyConfig(config), future: [] };
}

export function commitAutomation(history: AutomationHistory, next: AutomationConfig): AutomationHistory {
  return { past: [...history.past.slice(-49), history.present], present: copyConfig(next), future: [] };
}

export function undoAutomation(history: AutomationHistory): AutomationHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: copyConfig(previous), future: [history.present, ...history.future].slice(0, 50) } : history;
}

export function redoAutomation(history: AutomationHistory): AutomationHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present].slice(-50), present: copyConfig(next), future: history.future.slice(1) } : history;
}

function compare(actual: unknown, operator: z.infer<typeof ConditionNodeSchema>['operator'], expected: AutomationScalar): boolean {
  if (operator === 'exists') return expected === false ? actual == null : actual != null;
  if (operator === 'eq') return actual === expected;
  if (operator === 'neq') return actual !== expected;
  const left = Number(actual); const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  if (operator === 'lt') return left < right;
  return left <= right;
}

export function simulateAutomation(config: AutomationConfig, input: AutomationInput): AutomationSimulation {
  const steps: AutomationStep[] = config.nodes.map((node) => ({ nodeId: node.id, kind: node.kind, label: node.label, status: 'pending', atMs: 0 }));
  const byId = new Map(config.nodes.map((node) => [node.id, node]));
  const outgoing = (id: string) => config.edges.filter((edge) => edge.from === id).sort((a, b) => a.id.localeCompare(b.id));
  const queue = config.nodes.filter((node) => node.kind === 'trigger' && node.event === input.trigger).map((node) => node.id);
  const visited = new Set<string>();
  const data = input.data ?? {};
  let elapsedMs = 0;
  let executed = 0;
  if (!config.enabled) return { accepted: false, elapsedMs: 0, steps: steps.map((step) => ({ ...step, status: 'blocked', output: 'disabled' })), reason: 'automation disabled' };
  if (!queue.length) return { accepted: false, elapsedMs: 0, steps: steps.map((step) => ({ ...step, status: 'blocked', output: 'waiting for trigger' })), reason: `no trigger for ${input.trigger}` };
  while (queue.length && executed < config.maxSteps) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId); executed += 1;
    const node = byId.get(nodeId)!;
    const step = steps.find((item) => item.nodeId === nodeId)!;
    step.atMs = elapsedMs;
    let branch: AutomationEdge['when'] = 'always';
    if (node.kind === 'condition') {
      const passed = compare(data[node.field], node.operator, node.value ?? null);
      branch = passed ? 'true' : 'false';
      step.output = passed ? 'condition passed' : 'condition skipped';
    } else if (node.kind === 'delay') {
      elapsedMs += node.milliseconds;
      step.output = `waited ${node.milliseconds}ms`;
    } else if (node.kind === 'action') {
      step.output = `local ${node.operation}${node.target ? `:${node.target}` : ''}`;
    } else {
      step.output = `triggered ${node.event}`;
    }
    step.status = 'completed';
    for (const edge of outgoing(nodeId)) if (edge.when === 'always' || edge.when === branch) queue.push(edge.to);
  }
  for (const step of steps) if (step.status === 'pending') step.status = 'skipped';
  if (queue.length) return { accepted: false, elapsedMs, steps, reason: `step limit ${config.maxSteps} reached` };
  return { accepted: true, elapsedMs, steps };
}

function defaultNode(config: AutomationConfig, kind: Exclude<AutomationNode['kind'], 'trigger'>): AutomationNode {
  const id = nextAutomationNodeId(config, kind);
  if (kind === 'condition') return { id, kind, label: 'Check value', field: 'value', operator: 'exists', value: true };
  if (kind === 'delay') return { id, kind, label: 'Wait', milliseconds: 1000 };
  return { id, kind: 'action', label: 'Do action', operation: 'set', values: {} };
}

function statusColor(status: AutomationStepStatus): '$green10' | '$orange10' | '$color10' {
  return status === 'completed' ? '$green10' : status === 'blocked' ? '$orange10' : '$color10';
}

export function AutomationWidget({ component, onChange }: { component: AppComponent; onChange?(config: AutomationConfig): void }) {
  const source = component.props?.config ?? component.props?.automation;
  const parsed = useMemo(() => AutomationConfigSchema.safeParse(source), [source]);
  const [history, setHistory] = useState<AutomationHistory | null>(() => parsed.success ? createAutomationHistory(parsed.data) : null);
  const [selectedId, setSelectedId] = useState('');
  const [label, setLabel] = useState('');
  const [trigger, setTrigger] = useState('manual');
  const [simulation, setSimulation] = useState<AutomationSimulation | null>(null);
  const config = history?.present;
  const commit = (next: AutomationConfig) => {
    setHistory((current) => current ? commitAutomation(current, next) : current);
    onChange?.(next);
  };
  const changeHistory = (next: AutomationHistory) => {
    setHistory(next);
    onChange?.(next.present);
  };
  if (!parsed.success || !config) return <YStack gap="$2" style={{ padding: 12 }}><Text fontWeight="700">Automation config invalid</Text>{(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).slice(0, 8).map((error) => <Text key={error} color="$red10">{error}</Text>)}</YStack>;
  const add = (kind: Exclude<AutomationNode['kind'], 'trigger'>) => {
    const node = defaultNode(config, kind);
    const last = config.nodes.at(-1);
    let next = addAutomationNode(config, node);
    if (last) {
      try { next = connectAutomationNodes(next, last.id, node.id); } catch { /* config remains valid */ }
    }
    commit(next); setSelectedId(node.id);
  };
  const rename = () => { if (selectedId && label.trim()) { commit(editAutomationNode(config, selectedId, { label: label.trim() })); setLabel(''); } };
  const connectNext = () => {
    const index = config.nodes.findIndex((node) => node.id === selectedId);
    const next = config.nodes[index + 1];
    if (next) commit(connectAutomationNodes(config, selectedId, next.id));
  };
  return <YStack gap="$3" style={{ padding: 12, minHeight: 260 }}>
    <XStack gap="$2" style={{ alignItems: 'center' }}><Zap size={18} color="#16834b" /><Text flex={1} fontWeight="800">{config.title}</Text><Button size="$2" icon={Undo2} onPress={() => changeHistory(undoAutomation(history))} aria-label="Undo" disabled={!history.past.length} /><Button size="$2" icon={Redo2} onPress={() => changeHistory(redoAutomation(history))} aria-label="Redo" disabled={!history.future.length} /></XStack>
    <XStack gap="$2" flexWrap="wrap"><Button size="$2" icon={Plus} onPress={() => add('action')}>Action</Button><Button size="$2" onPress={() => add('condition')}>Condition</Button><Button size="$2" onPress={() => add('delay')}>Delay</Button><Button size="$2" icon={GitBranch} onPress={connectNext} disabled={!config.nodes.some((node) => node.id === selectedId)}>Connect</Button><Button size="$2" icon={Trash2} onPress={() => { if (selectedId) { try { commit(deleteAutomationNode(config, selectedId)); setSelectedId(''); } catch { /* keep visible */ } } }} disabled={!selectedId}>Delete</Button></XStack>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}><XStack gap="$2">{config.nodes.map((node) => <Button key={node.id} size="$3" theme={selectedId === node.id ? 'green' : undefined} onPress={() => { setSelectedId(node.id); setLabel(node.label); }}><Text>{node.kind === 'trigger' ? '⚡' : node.kind === 'condition' ? '◇' : node.kind === 'delay' ? '◷' : '●'} {node.label}</Text></Button>)}</XStack></ScrollView>
    {selectedId ? <XStack gap="$2"><Input flex={1} value={label} onChangeText={setLabel} placeholder="Node label" /><Button icon={Check} onPress={rename} aria-label="Rename">Save</Button></XStack> : null}
    <XStack gap="$2"><Input flex={1} value={trigger} onChangeText={setTrigger} placeholder="Trigger" /><Button icon={Play} onPress={() => setSimulation(simulateAutomation(config, { trigger, data: {} }))}>Run</Button></XStack>
    {simulation ? <YStack gap="$1">{simulation.steps.map((step) => <XStack key={step.nodeId} gap="$2" style={{ alignItems: 'center' }}><Text width={86} fontSize="$2" color={statusColor(step.status)}>{step.status}</Text><Text flex={1}>{step.label}</Text><Text fontSize="$2" color="$color10">{step.output ?? ''}</Text></XStack>)}<Text color={simulation.accepted ? '$green10' : '$orange10'}>{simulation.reason ?? `Completed in ${simulation.elapsedMs}ms`}</Text></YStack> : null}
  </YStack>;
}
