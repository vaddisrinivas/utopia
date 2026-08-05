import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react-native', () => ({ Check: 'Check', GitBranch: 'GitBranch', Play: 'Play', Plus: 'Plus', Redo2: 'Redo2', Trash2: 'Trash2', Undo2: 'Undo2', Zap: 'Zap' }));
vi.mock('tamagui', () => ({ Button: 'Button', Input: 'Input', ScrollView: 'ScrollView', Text: 'Text', XStack: 'XStack', YStack: 'YStack' }));

import {
  AutomationConfigSchema,
  addAutomationNode,
  connectAutomationNodes,
  createAutomationHistory,
  deleteAutomationNode,
  editAutomationNode,
  redoAutomation,
  simulateAutomation,
  undoAutomation,
  validateAutomationConfig,
  type AutomationConfig,
} from '@/src/kernel/automation-widget';

const config = (): AutomationConfig => AutomationConfigSchema.parse({
  schemaVersion: 'utopia.automation.v3', id: 'demo', title: 'Demo flow', enabled: true,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', event: 'manual' },
    { id: 'check', kind: 'condition', label: 'Has value', field: 'value', operator: 'gt', value: 2 },
    { id: 'wait', kind: 'delay', label: 'Wait', milliseconds: 250 },
    { id: 'save', kind: 'action', label: 'Save', operation: 'set', target: 'local', values: { done: true } },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'check', when: 'always' },
    { id: 'e2', from: 'check', to: 'wait', when: 'true' },
    { id: 'e3', from: 'wait', to: 'save', when: 'always' },
  ],
});

describe('automation widget V3 contract', () => {
  it('requires strict bounded JSON config and validates graph semantics', () => {
    expect(validateAutomationConfig({ ...config(), extra: true })).toContain('Unrecognized key: "extra"');
    expect(validateAutomationConfig({ ...config(), edges: [...config().edges, { id: 'bad', from: 'save', to: 'start', when: 'always' }] })).toContain('automation graph must be acyclic');
    expect(validateAutomationConfig({ ...config(), nodes: config().nodes.map((node) => node.kind === 'trigger' ? { ...node, label: 'x'.repeat(97) } : node) })).toContain('Too big: expected string to have <=96 characters');
  });

  it('adds, edits, connects, and deletes without dangling edges', () => {
    const base = config();
    const added = addAutomationNode(base, { id: 'notify', kind: 'action', label: 'Notify', operation: 'notify', values: {} });
    const connected = connectAutomationNodes(added, 'save', 'notify');
    const edited = editAutomationNode(connected, 'notify', { label: 'Alert' });
    const deleted = deleteAutomationNode(edited, 'notify');
    expect(deleted.nodes.map((node) => node.id)).not.toContain('notify');
    expect(deleted.edges.some((edge) => edge.from === 'notify' || edge.to === 'notify')).toBe(false);
    expect(edited.nodes.find((node) => node.id === 'notify')?.label).toBe('Alert');
  });

  it('simulates deterministically with condition branches and logical delay', () => {
    const result = simulateAutomation(config(), { trigger: 'manual', data: { value: 3 } });
    expect(result.accepted).toBe(true);
    expect(result.elapsedMs).toBe(250);
    expect(result.steps.map((step) => [step.nodeId, step.status, step.atMs])).toEqual([
      ['start', 'completed', 0], ['check', 'completed', 0], ['wait', 'completed', 0], ['save', 'completed', 250],
    ]);
    expect(simulateAutomation(config(), { trigger: 'other', data: { value: 3 } }).reason).toBe('no trigger for other');
  });

  it('marks a false branch skipped and keeps simulation provider-free', () => {
    const result = simulateAutomation(config(), { trigger: 'manual', data: { value: 1 } });
    expect(result.accepted).toBe(true);
    expect(result.steps.find((step) => step.nodeId === 'check')?.output).toBe('condition skipped');
    expect(result.steps.filter((step) => step.status === 'skipped').map((step) => step.nodeId)).toEqual(['wait', 'save']);
    expect(result.steps.find((step) => step.nodeId === 'save')?.output).toBeUndefined();
  });

  it('supports bounded undo and redo', () => {
    const base = config();
    const next = addAutomationNode(base, { id: 'extra', kind: 'action', label: 'Extra', operation: 'set', values: {} });
    const history = createAutomationHistory(base);
    const committed = { ...history, past: [base], present: next, future: [] };
    expect(undoAutomation(committed).present.nodes).toHaveLength(4);
    expect(redoAutomation(undoAutomation(committed)).present.nodes).toHaveLength(5);
  });
});
