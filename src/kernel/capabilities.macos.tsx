import { useState } from 'react';
import { NativeModules } from 'react-native';
import { Button, H2, Paragraph, YStack } from 'tamagui';

import { assertCapability } from './policy';
import type { AppComponent } from './schema';
import { useAppStore } from './store';

const native = new Set(['filePicker', 'fileExport', 'locationMap', 'notificationScheduler', 'contactPicker', 'calendarEvent', 'biometricGate', 'speechTool', 'healthConnect', 'healthKitStatus', 'cameraScanner', 'sensorReadout']);
const bridge = NativeModules.UtopiaMacAudioPlayer as {
  pickFile?(options: unknown): Promise<unknown>;
  exportTextFile?(options: unknown): Promise<unknown>;
} | undefined;

export function NativeCapability({ appId, component }: { appId: string; component: AppComponent }) {
  const { dispatch } = useAppStore();
  const [message, setMessage] = useState('Ready');
  const run = async () => {
    try {
      await assertCapability(appId, String(component.widget));
      const props = component.props ?? {};
      const value = component.widget === 'filePicker' && bridge?.pickFile
        ? await bridge.pickFile({ multiple: Boolean(props.multiple), mimeTypes: props.mimeTypes ?? ['*/*'] })
        : component.widget === 'fileExport' && bridge?.exportTextFile
          ? await bridge.exportTextFile({ content: String(props.content ?? ''), fileName: String(props.fileName ?? `${appId}.txt`), mimeType: String(props.mimeType ?? 'text/plain') })
          : await Promise.reject(new Error(`Unavailable on macOS: ${String(component.widget)}`));
      const field = String(props.resultField ?? 'result');
      if (component.action?.kind === 'create' || component.action?.kind === 'update') {
        await dispatch({ ...component.action, values: { ...component.action.values, [field]: value } });
      } else if (props.collection) {
        await dispatch({ kind: 'create', collection: String(props.collection), values: { [field]: value } });
      }
      setMessage(JSON.stringify(value));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unavailable');
    }
  };
  return <YStack gap="$2" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
    <H2 size="$6">{component.title ?? String(component.props?.title ?? component.widget)}</H2>
    <Button onPress={() => void run()}>Run</Button>
    <Paragraph color="$color10">{message}</Paragraph>
  </YStack>;
}

export const supportsNativeWidget = (widget?: string) => native.has(widget ?? '');
