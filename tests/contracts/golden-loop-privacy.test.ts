import { describe, expect, it } from 'vitest';

import {
  redactedTelemetryEvent,
  validateTelemetryEvent,
} from '@/packages/shared/contracts/telemetry';

describe('Golden Loop telemetry privacy contract', () => {
  const baseEvent = {
    schemaVersion: 'utopia.telemetry-event.v1',
    event: 'package_opened',
    anonymousInstallationId: 'anon-install-1',
    occurredAt: '2026-07-29T20:00:00.000Z',
  } as const;

  it('allows product metadata fields and redacts payload to metadata-only schema fields', () => {
    const event = validateTelemetryEvent({
      ...baseEvent,
      packageId: 'shared-household-board',
      packageVersion: '1.1.0',
      source: 'custom_gpt',
      rating: 5,
      tags: ['golden-loop', 'product-metadata'],
    });

    expect(redactedTelemetryEvent(event)).toEqual({
      schemaVersion: 'utopia.telemetry-event.v1',
      event: 'package_opened',
      anonymousInstallationId: 'anon-install-1',
      occurredAt: '2026-07-29T20:00:00.000Z',
      packageId: 'shared-household-board',
      packageVersion: '1.1.0',
      source: 'custom_gpt',
      rating: 5,
      tags: ['golden-loop', 'product-metadata'],
    });
  });

  it('rejects telemetry payloads with sensitive user data fields', () => {
    expect(() => validateTelemetryEvent({
      ...baseEvent,
      prompt: 'private app request',
    })).toThrow(/forbidden telemetry field:prompt/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      record: [],
    })).toThrow(/forbidden telemetry field:record/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      records: [],
    })).toThrow(/forbidden telemetry field:record/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      apiKey: 'nope',
    })).toThrow(/forbidden telemetry field:apiKey/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      audio: 'silence',
    })).toThrow(/forbidden telemetry field:audio/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      health: { heartRate: 70 },
    })).toThrow(/forbidden telemetry field:health/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      contacts: [{ name: 'alice@example.com' }],
    })).toThrow(/forbidden telemetry field:contacts/);

    expect(() => validateTelemetryEvent({
      ...baseEvent,
      location: { latitude: 40.7, longitude: -74.0 },
    })).toThrow(/forbidden telemetry field:location/);
  });

  it('rejects package content fields in telemetry events', () => {
    expect(() => validateTelemetryEvent({
      ...baseEvent,
      packageId: 'shared-household-board',
      packageContent: { id: 'shared-household-board', widgets: ['kanbanBoard'] },
    })).toThrow(/field is not allowlisted:packageContent/);
  });
});
