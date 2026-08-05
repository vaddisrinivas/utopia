import { useState } from 'react';
import { Button, H2, Paragraph, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import {
  CapabilityStateError,
  capabilityMessage,
  type CapabilityActionState,
  type CapabilityExecutionState,
  executeCapability,
} from './capability-state';

const native = new Set([
  'filePicker',
  'fileExport',
  'locationMap',
  'notificationScheduler',
  'contactPicker',
  'calendarEvent',
  'biometricGate',
  'speechTool',
  'healthConnect',
  'healthKitStatus',
  'cameraScanner',
  'sensorReadout',
]);

function label(component: AppComponent) {
  return component.title ?? String(component.props?.title ?? component.widget ?? 'Capability');
}

function stateFromResult(state: CapabilityExecutionState, message?: string, fallback?: string): CapabilityActionState {
  return { state, message: message || fallback || capabilityMessage(state) };
}

function CapabilityActionUnavailable({ component }: { component: AppComponent }) {
  const [state, setState] = useState<CapabilityActionState>(stateFromResult('unavailable', `Unavailable on macOS`));

  const run = async () => {
    const result = await executeCapability(() =>
      Promise.reject(new CapabilityStateError('unavailable', false, `Unsupported native capability on macOS: ${String(component.widget)}`)),
    );
    setState(stateFromResult(result.state, result.message, capabilityMessage(result.state)));
  };

  return (
    <YStack gap="$2" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
      <H2 size="$6">{label(component)}</H2>
      <Paragraph color="$color10">{state.message}</Paragraph>
      <Button onPress={() => void run()}>Retry</Button>
    </YStack>
  );
}

export function NativeCapability({ appId, component }: { appId: string; component: AppComponent }) {
  if (!native.has(component.widget ?? '')) return <CapabilityActionUnavailable component={component} />;
  return <CapabilityActionUnavailable component={component} />;
}

export const supportsNativeWidget = (widget?: string) => native.has(widget ?? '');
