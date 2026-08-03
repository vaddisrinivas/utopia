import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  audioLoopNeedsExplicitStartConfirmation,
  buildAudioLoopStartConfirmation,
  checkAudioLoopContractSupport,
} from '@/src/presentation/widgets/audio-loop-contract';
import { normalizeAudioLoopLoopCount } from '@/src/presentation/widgets/audio-loop-state';
import {
  requestWidgetCapability,
  type WidgetCapabilityRuntime,
} from '@/src/presentation/widgets/package-capability-broker';

type AudioLoopCompiledContract = {
  nativeCapabilities?: {
    packages?: readonly string[];
    permissions?: readonly (string | { permission: string })[];
  };
  presentation?: {
    label?: string;
    ui?: {
      screens?: {
        home?: {
          components?: ReadonlyArray<Record<string, unknown>>;
          title?: string;
          subtitle?: string;
        };
      };
    };
    surfaces?: ReadonlyArray<{ id: string }>;
  };
  queries?: Record<string, unknown>;
};

type AudioLoopNativeCapabilities = {
  schemaVersion: string;
  platform: string;
  packages: readonly string[];
  permissions?: readonly (string | { permission: string })[];
};

type AudioLoopWidgetContract = {
  label?: string;
  title?: string;
  subtitle?: string;
  kind?: string;
  widget?: string;
  props?: Record<string, unknown>;
  components?: readonly AudioLoopWidgetContract[];
};

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const audioLoopContract = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/audio-loop-108.v1.json'), 'utf8'),
) as AudioLoopCompiledContract;
const audioLoopHomeSource = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/screens/home.json'), 'utf8'),
) as AudioLoopWidgetContract;
const audioLoopHistorySource = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/screens/history.json'), 'utf8'),
) as AudioLoopWidgetContract;
const audioLoopLibrarySource = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/screens/library.json'), 'utf8'),
) as AudioLoopWidgetContract;
const audioLoopPlaylistSource = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/screens/playlist.json'), 'utf8'),
) as AudioLoopWidgetContract;
const audioLoopRecordSource = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/screens/record.json'), 'utf8'),
) as AudioLoopWidgetContract;
const audioLoopNativeCapabilities = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'apps/audio-loop-108/source/capabilities/native.json'), 'utf8'),
) as AudioLoopNativeCapabilities;
const audioLoopStateSource = readFileSync(
  path.join(fixtureRoot, 'src/presentation/widgets/audio-loop-state.ts'),
  'utf8',
).toLowerCase();
const audioLoopPersistenceSource = readFileSync(
  path.join(fixtureRoot, 'src/presentation/widgets/audio-loop-persistence.ts'),
  'utf8',
).toLowerCase();
const audioLoopRendererSource = readFileSync(
  path.join(fixtureRoot, 'src/presentation/json-render-widgets.tsx'),
  'utf8',
).toLowerCase();

const audioLoopComponents = audioLoopHomeSource.components ?? [];
const audioLoopPlayer = audioLoopComponents.find((component) => (
  component.widget === 'audioLoopPlayer'
)) as AudioLoopWidgetContract | undefined;

describe('audio loop contract helpers', () => {
  it('keeps shared and numeric inputs at accessible touch-target height', () => {
    expect(audioLoopRendererSource).toMatch(/forminput:\s*\{[\s\S]*?minheight:\s*48/);
    expect(audioLoopRendererSource).toMatch(/audioloopnumberinput:\s*\{[\s\S]*?minheight:\s*44/);
  });

  it('supports Android-only native package and required entry intents', () => {
    const contract = checkAudioLoopContractSupport({
      id: 'audio-loop-108',
      nativeCapabilities: {
        platform: 'android',
        packages: ['expo-audio', 'expo-document-picker'],
        intents: [
          { id: 'open-audio-loop', platform: 'android', kind: 'deep_link', reason: 'Open entry' },
          { id: 'start-audio-loop-voice', platform: 'android', kind: 'voice', reason: 'Voice entry', required: false },
        ],
      },
    }, 'android');

    expect(contract.supported).toBe(true);
    expect(contract.supportsEntryPath).toBe(true);
  });

  it('rejects non-Android runtime platform early', () => {
    const contract = checkAudioLoopContractSupport({ id: 'audio-loop-108' }, 'ios');
    expect(contract.supported).toBe(false);
    expect(contract.reason).toBe('Audio Loop contract is Android-only.');
  });

  it('rejects contract mismatches and missing runtime requirements', () => {
    expect(checkAudioLoopContractSupport({
      id: 'audio-loop-107',
      nativeCapabilities: { platform: 'android', packages: ['expo-audio', 'expo-document-picker'], intents: [] },
    }, 'android').supported).toBe(false);

    expect(checkAudioLoopContractSupport({
      id: 'audio-loop-108',
      nativeCapabilities: { platform: 'android', packages: ['expo-audio'], intents: [{ id: 'open-audio-loop', platform: 'android', kind: 'deep_link', reason: 'Open entry' }] },
    }, 'android').reason).toContain('expo-document-picker');
  });

  it('requires explicit start confirmation when source is recorded or when caller requires it', () => {
    expect(audioLoopNeedsExplicitStartConfirmation({ requireStartConfirmation: false, source: 'recorded' })).toBe(true);
    expect(audioLoopNeedsExplicitStartConfirmation({ requireStartConfirmation: true, source: 'imported' })).toBe(true);
    expect(audioLoopNeedsExplicitStartConfirmation({ requireStartConfirmation: false, source: 'imported' })).toBe(false);
  });

  it('builds user-visible confirmation for start action', () => {
    const prompt = buildAudioLoopStartConfirmation('Focus Loop', 'recorded');
    expect(prompt.title).toBe('Start playback?');
    expect(prompt.confirmLabel).toBe('Start loop');
    expect(prompt.message).toContain('Focus Loop');
  });

  it('binds Audio Loop contract name and source screens to source-declared runtime promises', () => {
    expect(audioLoopContract.presentation?.label).toBe('Audio Loop');
    expect(audioLoopContract.presentation?.surfaces?.map((surface) => surface.id)).toEqual(
      expect.arrayContaining(['home', 'history', 'library', 'playlist', 'record']),
    );
    expect(audioLoopHomeSource.label).toBe('Play');
    expect(audioLoopLibrarySource.label).toBe('Library');
    expect(audioLoopPlaylistSource.label).toBe('Queue');
    expect(audioLoopRecordSource.label).toBe('Capture');
    expect(audioLoopHomeSource.subtitle).toContain('infinite');
    expect(audioLoopHomeSource.subtitle).toContain('mode');
  });

  it('enforces runtime widget contract without tutorial-only UI cards', () => {
    expect(audioLoopComponents.map((component) => component.kind)).toEqual(
      expect.arrayContaining(['widget', 'widget', 'recordList']),
    );
    expect(audioLoopComponents.map((component) => component.kind)).not.toContain('card');
    const contractText = JSON.stringify(audioLoopHomeSource).toLowerCase();
    expect(contractText).not.toContain('tutorial');
    expect(contractText).not.toContain('explanation');
    expect(contractText).not.toContain('walkthrough');
    const allSourceText = [
      audioLoopHomeSource,
      audioLoopHistorySource,
      audioLoopLibrarySource,
      audioLoopPlaylistSource,
      audioLoopRecordSource,
    ].map((screen) => JSON.stringify(screen).toLowerCase()).join('\n');
    expect(allSourceText).not.toContain('tutorial');
    expect(allSourceText).not.toContain('explanation');
    expect(allSourceText).not.toContain('walkthrough');
    expect(audioLoopComponents).toEqual(expect.arrayContaining([expect.objectContaining({
      widget: 'audioLoopPlayer',
      kind: 'widget',
      title: 'Loop deck',
    } as AudioLoopWidgetContract)]));
  });

  it('does not enforce a hard loop-count cap in source contract and supports explicit infinite mode', () => {
    expect(normalizeAudioLoopLoopCount(1_000_000)).toMatchObject({ kind: 'count', value: 1_000_000 });
    expect(normalizeAudioLoopLoopCount('infinite')).toEqual({ kind: 'infinite' });
    expect(audioLoopPlayer?.props).toBeDefined();
    expect(audioLoopPlayer?.props).not.toHaveProperty('maxPlays');
    expect(audioLoopPlayer?.props).not.toHaveProperty('maxLoopCount');
    expect(audioLoopPlayer?.props?.delayOptions).toEqual(expect.arrayContaining([108]));
    expect(audioLoopPlayer?.props?.presets).toEqual(expect.arrayContaining([expect.objectContaining({ plays: 108 })]));
  });

  it('includes library/history/playlist/recorder surfaces and simple a11y-facing controls', () => {
    const contractText = JSON.stringify(audioLoopHomeSource).toLowerCase();
    const runtimeText = `${contractText}\n${audioLoopStateSource}\n${audioLoopRendererSource}`;
    expect(contractText).toContain('audio loop');
    expect(contractText).toContain('choose');
    expect(runtimeText).toContain('start');
    expect(runtimeText).toContain('pause');
    expect(runtimeText).toContain('resume');
    expect(runtimeText).toContain('skip');
    expect(runtimeText).toContain('stop');
    expect(contractText).toContain('recent sessions');
    expect(runtimeText).toContain('record');
    expect(runtimeText).toContain('playlist');
    expect(audioLoopHomeSource.components?.some((component) => component.kind === 'recordList')).toBe(true);
    expect(audioLoopContract.presentation?.surfaces?.map((surface) => surface.id)).toEqual(
      expect.arrayContaining(['home', 'history', 'library', 'playlist', 'record']),
    );
    expect(audioLoopHistorySource.label).toBe('Sessions');
  });

  it('binds an early, reachable finite/infinite radio control to the reusable player', () => {
    const controlSource = readFileSync(
      path.join(fixtureRoot, 'src/presentation/widgets/audio-loop-player-controls.tsx'),
      'utf8',
    );
    expect(controlSource).toContain('AudioLoopLoopModeControl');
    expect(controlSource).toContain('accessibilityRole="radiogroup"');
    expect(controlSource).toContain('accessibilityRole="radio"');
    expect(controlSource).toContain('accessibilityLabel="Finite loop"');
    expect(controlSource).toContain('accessibilityLabel="Infinite loop"');
    expect(controlSource).toContain('selected: mode === \'finite\'');
    expect(controlSource).toContain('selected: mode === \'infinite\'');
    expect(audioLoopRendererSource).toContain('audiolooploopmodecontrol');
    expect(audioLoopRendererSource.indexOf('audiolooploopmodecontrol')).toBeLessThan(
      audioLoopRendererSource.indexOf('current asset'),
    );
  });

  it('requires audio-recorder bridge grants for recording path', () => {
    const runtime: WidgetCapabilityRuntime = {
      installationId: 'audio-loop-install',
      activePackage: {
        id: 'audio-loop-108',
        version: '1.0.0',
        publisherId: 'utopia.audio-loop',
        declaredPurpose: 'record local audio for Audio Loop',
        nativeCapabilities: audioLoopNativeCapabilities as never,
      },
      capabilityDecisionPort: { decide: () => 'allow' },
    };
    const missingPackageRuntime: WidgetCapabilityRuntime = {
      installationId: 'audio-loop-install',
      activePackage: {
        id: 'audio-loop-108',
        publisherId: 'utopia.audio-loop',
        declaredPurpose: 'record local audio for Audio Loop',
        nativeCapabilities: {
          ...audioLoopNativeCapabilities,
          packages: ['expo-document-picker'],
        } as never,
      },
    };

    expect(requestWidgetCapability(runtime, {
      kind: 'audio-recorder',
      action: 'record',
      declaredPurpose: 'record local audio for Audio Loop',
    }).ok).toBe(true);
    expect(audioLoopNativeCapabilities?.packages).toContain('expo-audio');
    expect(audioLoopNativeCapabilities?.permissions?.map((value) => (
      typeof value === 'string' ? value : value.permission
    ))).toContain('expo-audio');
    expect(requestWidgetCapability(missingPackageRuntime, {
      kind: 'audio-recorder',
      action: 'record',
      declaredPurpose: 'record local audio for Audio Loop',
    }).ok).toBe(false);
  });

  it('retains history/playlist/restore contract vocabulary in runtime/source', () => {
    expect(audioLoopContract.queries).toBeTruthy();
    const historyView = audioLoopContract.presentation?.ui?.screens?.home?.components?.find((component) => component.kind === 'recordList');
    expect(JSON.stringify(historyView).toLowerCase()).toContain('recent sessions');
    expect(audioLoopStateSource).toContain('wonder.audio-loop-playlist.v1');
    expect(audioLoopStateSource).toContain('wonder.audio-loop-history-entry.v1');
    expect(audioLoopPersistenceSource).toContain('audio loop restore');
  });
});
