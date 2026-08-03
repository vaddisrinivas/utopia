import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  timerActionAccessibilityLabel,
  timerControlTestId,
  timerStatusAccessibilityLabel,
  timerStatusTestId,
} from '@/src/presentation/widgets/timed-flow-accessibility';

const WIDGET_SOURCE = readFileSync(
  join(process.cwd(), 'src/presentation/widgets/timed-flow-widgets.tsx'),
  'utf8',
);

describe('generic timed-flow accessibility contract', () => {
  it.each([
    ['running', 'Timer status: Running'],
    ['paused', 'Timer status: Paused'],
    ['review_required', 'Timer status: Review Required'],
  ] as const)('exposes a stable status label for %s', (status, expected) => {
    expect(timerStatusAccessibilityLabel(status)).toBe(expected);
  });

  it.each([
    ['Start', 'Start timer'],
    ['Pause', 'Pause timer'],
    ['Resume', 'Resume timer'],
    ['Next', 'Next step'],
    ['Cancel', 'Cancel'],
  ])('exposes a stable action label for %s', (label, expected) => {
    expect(timerActionAccessibilityLabel(label)).toBe(expected);
  });

  it('keeps control identifiers generic and installation-stable', () => {
    expect(timerStatusTestId('install:tracker:current-timer')).toBe('timed-flow-install-tracker-current-timer-status');
    expect(timerControlTestId('current-timer', 'Pause')).toBe('timed-flow-current-timer-pause');
  });

  it('renders status and controls as explicit accessible native controls', () => {
    expect(WIDGET_SOURCE).toContain('accessible');
    expect(WIDGET_SOURCE).toContain('accessibilityRole="button"');
    expect(WIDGET_SOURCE).toContain('accessibilityState={{ disabled }}');
    expect(WIDGET_SOURCE).toContain('accessibilityLiveRegion="polite"');
    expect(WIDGET_SOURCE).toContain('timerStatusAccessibilityLabel(snapshot.status)');
    expect(WIDGET_SOURCE).toContain('timerActionAccessibilityLabel(label)');
    expect(WIDGET_SOURCE).toContain('timerControlTestId(runId, label)');
  });
});

describe('timer app package coverage', () => {
  it.each([
    ['simple-time-tracker', 'durationTimer'],
    ['medication-reminder', 'durationTimer'],
    ['workout-log-v2', 'durationTimer'],
  ] as const)('%s uses the generic timer widget contract', (appId, widget) => {
    const packagePath = join(process.cwd(), 'apps', appId, `${appId}.v1.json`);
    const appPackage = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      id: string;
      presentation: { ui: { screens: Record<string, { components: Array<{ widget?: string }> }> } };
    };
    const widgets = Object.values(appPackage.presentation.ui.screens)
      .flatMap((screen) => screen.components.map((component) => component.widget))
      .filter((value): value is string => Boolean(value));

    expect(widgets).toContain(widget);
    expect(appPackage.id).toBe(appId);
  });
});
