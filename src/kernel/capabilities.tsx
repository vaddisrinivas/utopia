import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Button, H2, Paragraph, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import { recordConsent } from './policy';
import {
  CapabilityStateError,
  capabilityMessage,
  type CapabilityActionState,
  type CapabilityExecutionState,
  executeCapability,
} from './capability-state';

type NativeActionWidget =
  | 'filePicker'
  | 'fileExport'
  | 'locationMap'
  | 'notificationScheduler'
  | 'contactPicker'
  | 'calendarEvent'
  | 'biometricGate'
  | 'speechTool'
  | 'healthConnect'
  | 'healthKitStatus';

const actionWidgets = new Set<NativeActionWidget>([
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
]);

function widgetLabel(component: AppComponent) {
  return component.title || String(component.props?.title || component.widget || 'Capability');
}

const states = {
  idle: { state: 'idle' as const, message: capabilityMessage('idle') },
  running: { state: 'running' as const, message: capabilityMessage('running') },
};

function stateFromResult(
  state: CapabilityExecutionState,
  message?: string,
  fallback?: string,
): CapabilityActionState {
  if (state === 'idle' || state === 'running') {
    return { ...states[state], state, message: message || fallback || capabilityMessage(state) };
  }
  return { state, message: message || fallback || capabilityMessage(state) };
}

async function runFilePicker(props: Record<string, unknown>) {
  const picker = await import('expo-document-picker');
  const result = await picker.getDocumentAsync({
    type: Array.isArray(props.mimeTypes) ? props.mimeTypes : '*/*',
    multiple: Boolean(props.multiple),
  });
  if (result.canceled) throw new CapabilityStateError('cancelled', false, 'Selection cancelled');
  if (!result.assets?.length) throw new CapabilityStateError('retry', true, 'No document returned');
  return result.assets.map((asset) => asset.name).join(', ');
}

async function runFileExport(appId: string, component: AppComponent) {
  const props = component.props ?? {};
  const path = String(props.fileName ?? `${appId}-${new Date().toISOString().slice(0, 10)}.txt`);
  const content = String(props.content ?? '');
  const mimeType = String(props.mimeType ?? 'text/plain');

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path;
    anchor.click();
    URL.revokeObjectURL(url);
    return path;
  }

  const { File, Paths } = await import('expo-file-system');
  const file = new File(Paths.cache, path);
  file.create({ overwrite: true });
  file.write(content);

  const sharing = await import('expo-sharing');
  const available = await sharing.isAvailableAsync();
  if (!available) throw new CapabilityStateError('unavailable', false, 'Share unavailable on this platform');
  await sharing.shareAsync(file.uri, { mimeType });
  return file.uri;
}

async function runLocation(appId: string, component: AppComponent) {
  const location = await import('expo-location');
  const permission = await location.requestForegroundPermissionsAsync();
  await recordConsent(appId, 'location', permission.granted ? 'granted' : 'denied');
  if (!permission.granted) throw new CapabilityStateError('denied', true, 'Permission denied');
  const current = await location.getCurrentPositionAsync({});
  return `${current.coords.latitude.toFixed(5)}, ${current.coords.longitude.toFixed(5)}`;
}

async function runNotification(appId: string, component: AppComponent) {
  const notifications = await import('expo-notifications');
  const permission = await notifications.requestPermissionsAsync();
  await recordConsent(appId, 'notifications', permission.granted ? 'granted' : 'denied');
  if (!permission.granted) throw new CapabilityStateError('denied', true, 'Permission denied');
  const props = component.props ?? {};
  const seconds = Number(props.seconds ?? 10);
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new CapabilityStateError('retry', true, 'Invalid notification timer');
  }

  await notifications.scheduleNotificationAsync({
    content: {
      title: widgetLabel(component),
      body: String(props.body ?? ''),
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
  return 'Notification scheduled';
}

async function runContactPicker(appId: string, component: AppComponent) {
  const contacts = await import('expo-contacts');
  const permission = await contacts.requestPermissionsAsync();
  await recordConsent(appId, 'contacts', permission.granted ? 'granted' : 'denied');
  if (!permission.granted) throw new CapabilityStateError('denied', true, 'Permission denied');
  const result = await contacts.presentContactPickerAsync();
  if (!result) throw new CapabilityStateError('cancelled', false, 'Contact picker cancelled');
  return result.name ?? 'Unknown';
}

async function runCalendar(appId: string, component: AppComponent) {
  const calendar = await import('expo-calendar');
  const permission = await calendar.requestCalendarPermissionsAsync();
  await recordConsent(appId, 'calendar', permission.granted ? 'granted' : 'denied');
  if (!permission.granted) throw new CapabilityStateError('denied', true, 'Permission denied');

  const startOffsetMinutes = Number((component.props ?? {}).startOffsetMinutes ?? 10);
  const durationMinutes = Number((component.props ?? {}).durationMinutes ?? 30);
  const startDate = new Date(Date.now() + startOffsetMinutes * 60_000);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

  const target = await calendar.getDefaultCalendarAsync();
  if (!target?.id) throw new CapabilityStateError('unavailable', false, 'No default calendar available');

  await calendar.createEventAsync(target.id, {
    title: String((component.props ?? {}).eventTitle ?? widgetLabel(component)),
    startDate,
    endDate,
  });
  return 'Calendar event created';
}

async function runBiometrics(component: AppComponent) {
  const auth = await import('expo-local-authentication');
  const result = await auth.authenticateAsync({
    promptMessage: String((component.props ?? {}).authPrompt ?? 'Authenticate'),
  });
  if (!result.success) {
    throw new CapabilityStateError(result.error === 'user_cancel' ? 'cancelled' : 'denied', true, result.error || 'Biometric failed');
  }
  return 'Unlocked';
}

async function runSpeech(component: AppComponent) {
  const speech = await import('expo-speech');
  speech.speak(String((component.props ?? {}).speechText ?? widgetLabel(component)));
  return 'Speech started';
}

async function runHealthConnect() {
  if (Platform.OS !== 'android') throw new CapabilityStateError('unavailable', false, 'Health Connect requires Android');
  const health = await import('react-native-health-connect');
  const status = await health.getSdkStatus();
  if (typeof status !== 'number' || status <= 0) throw new CapabilityStateError('unavailable', false, 'Health Connect unavailable');
  return `Health Connect status ${status}`;
}

async function runHealthKit() {
  if (Platform.OS !== 'ios') throw new CapabilityStateError('unavailable', false, 'HealthKit requires iOS');
  const healthkit = await import('@kingstinct/react-native-healthkit');
  const available = await healthkit.isHealthDataAvailable();
  if (!available) throw new CapabilityStateError('unavailable', false, 'HealthKit unavailable');
  return 'HealthKit available';
}

function ActionResult({ state, message, onRetry }: { state: CapabilityActionState; message: string; onRetry: () => void }) {
  const showRetry = ['denied', 'unavailable', 'retry', 'cancelled'].includes(state.state);
  const textColor = state.state === 'success' ? '$green10' : state.state === 'running' ? '$blue10' : '$color10';
  return (
    <YStack gap="$2">
      <Paragraph color={textColor}>{message}</Paragraph>
      {showRetry ? <Button size="$3" onPress={() => void onRetry()}>Retry</Button> : null}
    </YStack>
  );
}

function CapabilityAction({ appId, component }: { appId: string; component: AppComponent }) {
  const [actionState, setActionState] = useState<CapabilityActionState>(states.idle);

  const run = async () => {
    setActionState(states.running);
    const result = await executeCapability(async () => {
      switch (component.widget) {
        case 'filePicker': return runFilePicker(component.props ?? {});
        case 'fileExport': return runFileExport(appId, component);
        case 'locationMap': return runLocation(appId, component);
        case 'notificationScheduler': return runNotification(appId, component);
        case 'contactPicker': return runContactPicker(appId, component);
        case 'calendarEvent': return runCalendar(appId, component);
        case 'biometricGate': return runBiometrics(component);
        case 'speechTool': return runSpeech(component);
        case 'healthConnect': return runHealthConnect();
        case 'healthKitStatus': return runHealthKit();
        default: throw new CapabilityStateError('unavailable', false, `Unsupported native widget ${String(component.widget)}`);
      }
    });
    setActionState(stateFromResult(result.state, result.message, capabilityMessage(result.state)));
  };

  return (
    <YStack gap="$3" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
      <H2 size="$6">{widgetLabel(component)}</H2>
      <Button disabled={actionState.state === 'running'} onPress={() => void run()}>
        {String(component.props?.cta || (actionState.state === 'retry' ? 'Retry' : 'Run'))}
      </Button>
      <ActionResult state={actionState} message={actionState.message} onRetry={() => void run()} />
    </YStack>
  );
}

function Scanner({ component }: { component: AppComponent }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [readState, setReadState] = useState<CapabilityActionState>(states.idle);
  const [status, setStatus] = useState('');

  const request = async () => {
    if (!requestPermission) {
      setReadState(stateFromResult('unavailable', 'Camera permission API unavailable on this platform'));
      return;
    }

    setReadState(states.running);
    const outcome = await executeCapability(async () => {
      const response = await requestPermission();
      if (!response.granted) {
        if (permission?.canAskAgain) {
          throw new CapabilityStateError('denied', true, 'Permission denied');
        }
        throw new CapabilityStateError('unavailable', false, 'Camera permission permanently denied');
      }
      return 'Permission granted';
    });
    setReadState(stateFromResult(outcome.state, outcome.message, capabilityMessage(outcome.state)));
  };

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) {
      setReadState(stateFromResult('success', 'Camera ready', 'Camera ready'));
      return;
    }
    if (!permission.canAskAgain) {
      setReadState(stateFromResult('unavailable', 'Camera permission disabled on this device', 'Unavailable'));
      return;
    }
    setReadState(stateFromResult('idle', capabilityMessage('idle'), 'Ready'));
  }, [permission?.granted, permission?.canAskAgain]);

  if (!permission?.granted) {
    return (
      <YStack gap="$3" style={{ padding: 16 }}>
        <H2>{widgetLabel(component)}</H2>
        <Button disabled={readState.state === 'running'} onPress={() => void request()}>
          {permission ? 'Enable camera' : 'Check camera'}
        </Button>
        <ActionResult state={readState} message={readState.message} onRetry={() => void request()} />
      </YStack>
    );
  }

  const barcodeTypes = Array.isArray(component.props?.barcodeTypes)
    ? component.props.barcodeTypes
    : ['qr'];

  return (
    <YStack gap="$2" style={{ height: 360, padding: 16 }}>
      <H2>{widgetLabel(component)}</H2>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: (barcodeTypes as never) }}
        onBarcodeScanned={status ? undefined : ({ data }: BarcodeScanningResult) => {
          setStatus(data);
          setReadState(stateFromResult('success', `Scanned ${data}`));
        }}
      />
      <ActionResult state={readState} message={readState.message} onRetry={() => { setStatus(''); setReadState(states.idle); }} />
      {status ? (
        <XStack>
          <Text flex={1}>{status}</Text>
          <Button onPress={() => { setStatus(''); setReadState(states.idle); }}>Scan again</Button>
        </XStack>
      ) : null}
    </YStack>
  );
}

function Sensor({ component }: { component: AppComponent }) {
  const [state, setState] = useState<CapabilityActionState>(states.idle);
  const [value, setValue] = useState({ x: 0, y: 0, z: 0 });
  const subscription = useRef<{ remove: () => void } | null>(null);

  useEffect(() => () => {
    subscription.current?.remove();
  }, []);

  const readOnce = async () => {
    setState(states.running);
    const outcome = await executeCapability(async () => {
      const available = await Accelerometer.isAvailableAsync();
      if (!available) throw new CapabilityStateError('unavailable', false, 'Accelerometer unavailable');

      return await new Promise<{ x: number; y: number; z: number }>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          subscription.current?.remove();
          reject(new CapabilityStateError('retry', true, 'No sensor sample'));
        }, 1500);

        Accelerometer.setUpdateInterval(200);
        const listener = Accelerometer.addListener((reading) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          listener.remove();
          resolve(reading);
        });
        subscription.current = listener;
      });
    });

    if (outcome.state === 'success' && outcome.value) {
      setValue(outcome.value);
      setState(stateFromResult('success', `x ${outcome.value.x.toFixed(2)} · y ${outcome.value.y.toFixed(2)} · z ${outcome.value.z.toFixed(2)}`));
      return;
    }
    setState(stateFromResult(outcome.state, outcome.message, capabilityMessage(outcome.state)));
  };

  return (
    <YStack gap="$2" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
      <H2 size="$6">{widgetLabel(component)}</H2>
      <Button onPress={() => void readOnce()} disabled={state.state === 'running'}>
        {String(component.props?.cta ?? 'Read sensor')}
      </Button>
      <Paragraph color="$color10">x {value.x.toFixed(2)} · y {value.y.toFixed(2)} · z {value.z.toFixed(2)}</Paragraph>
      <ActionResult state={state} message={state.message} onRetry={() => void readOnce()} />
    </YStack>
  );
}

export function NativeCapability({ appId, component }: { appId: string; component: AppComponent }) {
  if (component.widget === 'cameraScanner') return <Scanner component={component} />;
  if (component.widget === 'sensorReadout') return <Sensor component={component} />;
  if (actionWidgets.has(component.widget as NativeActionWidget)) {
    return <CapabilityAction appId={appId} component={component} />;
  }
  throw new CapabilityStateError('unavailable', false, `Unsupported native widget ${String(component.widget)}`);
}

export function supportsNativeWidget(widget?: string): boolean {
  return widget === 'cameraScanner' || widget === 'sensorReadout' || actionWidgets.has(widget as NativeActionWidget);
}
