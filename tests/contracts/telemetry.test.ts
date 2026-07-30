import { describe, expect, it } from 'vitest';

import {
  redactedTelemetryEvent,
  validateTelemetryEvent,
} from '@/packages/shared/contracts/telemetry';

describe('telemetry contract', () => {
  it('allows product learning events without user records', () => {
    const event = validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_opened',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      packageId: 'habit-grid',
      packageVersion: '1.0.0',
      source: 'app',
      tags: ['bundled'],
    });

    expect(redactedTelemetryEvent(event)).toEqual({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_opened',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      packageId: 'habit-grid',
      packageVersion: '1.0.0',
      source: 'app',
      tags: ['bundled'],
    });
  });

  it('rejects records, prompts, secrets, files, and sensitive capability data', () => {
    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_created',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      prompt: 'make my private app',
    })).toThrow(/forbidden telemetry field:prompt/);

    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_created',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      healthRecords: [],
    })).toThrow(/forbidden telemetry field:record/);

    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_created',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      apiKey: 'nope',
    })).toThrow(/forbidden telemetry field:apiKey/);
  });

  it('rejects unknown events', () => {
    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'record_created',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
    })).toThrow(/event is not allowlisted/);
  });

  it('rejects non-allowlisted telemetry fields', () => {
    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_opened',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      packageId: 'habit-grid',
      extraneous: true,
    })).toThrow(/field is not allowlisted:extraneous/);
  });

  it('rejects forbidden fields nested in payloads', () => {
    expect(() => validateTelemetryEvent({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_opened',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      packageId: 'habit-grid',
      tags: ['bundled'],
      source: 'app',
      metadata: { apiKey: 'bad' },
    } as { [key: string]: unknown })).toThrow(/forbidden telemetry field:apiKey/);
  });
});
