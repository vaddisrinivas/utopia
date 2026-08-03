import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Linking: { canOpenURL: vi.fn(), openURL: vi.fn() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(value: T) => value, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));

import {
  CAPABILITY_LAB_DIAGNOSTIC_IDS,
  resolveCapabilityDiagnosticRows,
} from '@/src/presentation/widgets/capability-diagnostic-widget';
import {
  CAPABILITY_EXERCISER_IDS,
  resolveCapabilityExerciserProbes,
} from '@/src/presentation/widgets/capability-exerciser-widget';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { CAPABILITY_DIAGNOSTIC_RUNTIME_STATES } from '@/packages/shared/contracts/ui-widgets';

describe('Capability Lab diagnostic contract', () => {
  it('enables the read-only diagnostic surface for every frontier capability', () => {
    const compiled = compileAppPackageSourceFolder(path.resolve(process.cwd(), 'apps/capability-lab/source'));
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    const diagnostic = compiled.package.presentation?.ui?.screens?.matrix?.components?.find(
      (component) => component.kind === 'widget' && component.widget === 'permissionCard' && component.props?.diagnostic === true,
    );
    expect(diagnostic?.props).toMatchObject({
      observations: [],
      capabilityIds: CAPABILITY_LAB_DIAGNOSTIC_IDS,
    });
    const exerciser = compiled.package.presentation?.ui?.screens?.matrix?.components?.find(
      (component) => component.kind === 'widget' && component.widget === 'capabilityExerciser',
    );
    expect((exerciser?.props?.probes as Array<Record<string, unknown>>).map((probe) => probe.capabilityId)).toEqual(CAPABILITY_EXERCISER_IDS);
  });

  it('covers every selected native frontier without executing it by default', () => {
    expect(CAPABILITY_LAB_DIAGNOSTIC_IDS).toEqual([
      'camera', 'microphone', 'files', 'notifications', 'background_task', 'location',
      'contacts', 'calendar', 'biometrics', 'health', 'sensors', 'speech',
      'share', 'deep_link', 'file_open', 'shortcut',
    ]);

    const rows = resolveCapabilityDiagnosticRows({ platform: 'android' });
    expect(rows).toHaveLength(CAPABILITY_LAB_DIAGNOSTIC_IDS.length);
    expect(rows.filter((row) => row.support !== 'unsupported')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'camera', state: 'unrequested', observed: false }),
        expect.objectContaining({ id: 'background_task', support: 'planned', state: 'unrequested', observed: false }),
      ]),
    );
  });

  it('only exposes a completed result from an explicit observed record on supported shells', () => {
    const [camera] = resolveCapabilityDiagnosticRows({
      platform: 'android',
      capabilityIds: ['camera'],
      observations: [{ capabilityId: 'camera', state: 'success', observed: true, detail: 'Observed by a shell receipt.' }],
    });
    expect(camera).toMatchObject({ support: 'supported', state: 'success', observed: true, detail: 'Observed by a shell receipt.' });

    const [unverified] = resolveCapabilityDiagnosticRows({
      platform: 'android',
      capabilityIds: ['camera'],
      observations: [{ capabilityId: 'camera', state: 'success', observed: false }],
    });
    expect(unverified).toMatchObject({ support: 'supported', state: 'unrequested', observed: false });
  });

  it('keeps planned and unsupported capability outcomes truthful', () => {
    const rows = resolveCapabilityDiagnosticRows({
      platform: 'web',
      capabilityIds: ['notifications', 'contacts'],
      observations: [
        { capabilityId: 'notifications', state: 'success', observed: true },
        { capabilityId: 'contacts', state: 'success', observed: true },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: 'notifications', support: 'planned', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'contacts', support: 'unsupported', state: 'unavailable', observed: false }),
    ]);
  });

  it('labels executable generic controls separately from NOT_RUN capabilities', () => {
    const rows = resolveCapabilityDiagnosticRows({
      platform: 'android',
      capabilityIds: ['camera', 'microphone', 'background_task', 'file_open'],
      executors: [{
        capabilityId: 'camera',
        controls: ['Camera scanner', 'Video player'],
        detail: 'Use an explicit camera control.',
      }],
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: 'camera', harness: 'executable', controls: ['Camera scanner', 'Video player'] }),
      expect.objectContaining({ id: 'microphone', harness: 'not_run', harnessDetail: expect.stringContaining('NOT_RUN') }),
      expect.objectContaining({ id: 'background_task', harness: 'not_run', harnessDetail: expect.stringContaining('NOT_RUN') }),
      expect.objectContaining({ id: 'file_open', harness: 'not_run', harnessDetail: expect.stringContaining('NOT_RUN') }),
    ]);
  });

  it('registers the six missing exercisers without turning planned capabilities into run proof', () => {
    expect(resolveCapabilityExerciserProbes(undefined).map((probe) => probe.capabilityId)).toEqual(CAPABILITY_EXERCISER_IDS);

    const executors = CAPABILITY_EXERCISER_IDS.map((capabilityId) => ({
      capabilityId,
      controls: [`${capabilityId} exerciser`],
      detail: `Run ${capabilityId}.`,
    }));
    const rows = resolveCapabilityDiagnosticRows({
      platform: 'android',
      capabilityIds: [...CAPABILITY_EXERCISER_IDS],
      executors,
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: 'microphone', harness: 'executable', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'background_task', support: 'planned', harness: 'not_run', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'health', harness: 'executable', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'deep_link', harness: 'executable', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'file_open', support: 'planned', harness: 'not_run', state: 'unrequested', observed: false }),
      expect.objectContaining({ id: 'shortcut', support: 'planned', harness: 'not_run', state: 'unrequested', observed: false }),
    ]);
  });

  it('shows a declared broker block without counting it as executable', () => {
    const [share] = resolveCapabilityDiagnosticRows({
      platform: 'android',
      capabilityIds: ['share'],
      executors: [{
        capabilityId: 'share',
        controls: ['File export'],
        mode: 'blocked',
        detail: 'Missing package declaration.',
      }],
    });
    expect(share).toMatchObject({ harness: 'blocked', controls: ['File export'], harnessDetail: 'Missing package declaration.' });
  });

  it.each(['requested', 'granted', 'denied', 'blocked', 'unavailable', 'success', 'interrupted'] as const)(
    'preserves explicit observed %s states for supported capability records',
    (state) => {
      const [camera] = resolveCapabilityDiagnosticRows({
        platform: 'android',
        capabilityIds: ['camera'],
        observations: [{ capabilityId: 'camera', state, observed: true }],
      });
      expect(camera).toMatchObject({ state, observed: true });
    },
  );

  it('keeps requested in the shared runtime state contract', () => {
    expect(CAPABILITY_DIAGNOSTIC_RUNTIME_STATES).toContain('requested');
  });
});
