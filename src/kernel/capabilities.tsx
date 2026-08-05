import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Button, H2, Paragraph, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import { assertCapability, recordConsent } from './policy';
import { useAppStore, type Store } from './store';
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
  return result.assets.map(({ name, uri, size, mimeType }) => ({ name, uri, size, mimeType }));
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
  return { latitude: current.coords.latitude, longitude: current.coords.longitude };
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

  const id = await notifications.scheduleNotificationAsync({
    content: {
      title: widgetLabel(component),
      body: String(props.body ?? ''),
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
  return { id, scheduled: true };
}

async function runContactPicker(appId: string, component: AppComponent) {
  const contacts = await import('expo-contacts');
  const permission = await contacts.requestPermissionsAsync();
  await recordConsent(appId, 'contacts', permission.granted ? 'granted' : 'denied');
  if (!permission.granted) throw new CapabilityStateError('denied', true, 'Permission denied');
  const result = await contacts.presentContactPickerAsync();
  if (!result) throw new CapabilityStateError('cancelled', false, 'Contact picker cancelled');
  return { id: result.id, name: result.name ?? 'Unknown' };
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

type ResultHandler = (value: unknown) => void | Promise<void>;

async function bindResult(runtime: Store, component: AppComponent, value: unknown, onResult?: ResultHandler) {
  await onResult?.(value);
  const field = String(component.props?.resultField ?? 'result');
  const action = component.action;
  if (action && (action.kind === 'create' || action.kind === 'update')) {
    await runtime.dispatch({ ...action, values: { ...action.values, [field]: value } });
  } else if (component.props?.collection) {
    await runtime.dispatch({ kind: 'create', collection: String(component.props.collection), values: { [field]: value } });
  }
}

const resultText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

function CapabilityAction({ appId, component, onResult }: { appId: string; component: AppComponent; onResult: ResultHandler }) {
  const [actionState, setActionState] = useState<CapabilityActionState>(states.idle);
  const [value, setValue] = useState<unknown>();

  const run = async () => {
    setActionState(states.running);
    const result = await executeCapability(async () => {
      await assertCapability(appId, String(component.widget));
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
    if (result.state === 'success') {
      setValue(result.value);
      await onResult(result.value);
    }
    setActionState(stateFromResult(result.state, result.state === 'success' ? resultText(result.value) : result.message, capabilityMessage(result.state)));
  };

  const cancelNotification = async () => {
    const id = (value as { id?: string } | undefined)?.id;
    if (!id) return;
    const notifications = await import('expo-notifications');
    await notifications.cancelScheduledNotificationAsync(id);
    setValue(undefined);
    setActionState(stateFromResult('success', 'Cancelled'));
  };

  return (
    <YStack gap="$3" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
      <H2 size="$6">{widgetLabel(component)}</H2>
      <Button disabled={actionState.state === 'running'} onPress={() => void run()}>
        {String(component.props?.cta || (actionState.state === 'retry' ? 'Retry' : 'Run'))}
      </Button>
      {component.widget === 'notificationScheduler' && (value as { id?: string } | undefined)?.id
        ? <Button size="$3" onPress={() => void cancelNotification()}>Cancel</Button> : null}
      <ActionResult state={actionState} message={actionState.message} onRetry={() => void run()} />
    </YStack>
  );
}

function Scanner({ appId, component, onResult }: { appId: string; component: AppComponent; onResult: ResultHandler }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [readState, setReadState] = useState<CapabilityActionState>(states.idle);
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const camera = useRef<CameraView>(null);
  const captureMode = component.props?.captureMode === 'video' ? 'video' : component.props?.captureMode === 'photo' ? 'photo' : 'scan';

  const request = async () => {
    if (!requestPermission) {
      setReadState(stateFromResult('unavailable', 'Camera permission API unavailable on this platform'));
      return;
    }

    setReadState(states.running);
    const outcome = await executeCapability(async () => {
      await assertCapability(appId, 'cameraScanner');
      const response = await requestPermission();
      if (!response.granted) {
        if (permission?.canAskAgain) {
          throw new CapabilityStateError('denied', true, 'Permission denied');
        }
        throw new CapabilityStateError('unavailable', false, 'Camera permission permanently denied');
      }
      setAuthorized(true);
      return 'Permission granted';
    });
    setReadState(stateFromResult(outcome.state, outcome.message, capabilityMessage(outcome.state)));
  };

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) {
      void assertCapability(appId, 'cameraScanner').then(() => {
        setAuthorized(true);
        setReadState(stateFromResult('success', 'Camera ready', 'Camera ready'));
      }).catch((cause) => setReadState(stateFromResult('denied', cause instanceof Error ? cause.message : 'Denied')));
      return;
    }
    if (!permission.canAskAgain) {
      setReadState(stateFromResult('unavailable', 'Camera permission disabled on this device', 'Unavailable'));
      return;
    }
    setReadState(stateFromResult('idle', capabilityMessage('idle'), 'Ready'));
  }, [appId, permission?.granted, permission?.canAskAgain]);

  if (!permission?.granted || !authorized) {
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
        ref={camera}
        mode={captureMode === 'video' ? 'video' : 'picture'}
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: (barcodeTypes as never) }}
        onBarcodeScanned={status ? undefined : ({ data }: BarcodeScanningResult) => {
          setStatus(data);
          setReadState(stateFromResult('success', `Scanned ${data}`));
          void onResult({ type: 'barcode', value: data });
        }}
      />
      {captureMode === 'photo' ? <Button onPress={async () => {
        const picture = await camera.current?.takePictureAsync();
        if (picture?.uri) { setStatus(picture.uri); await onResult({ type: 'photo', uri: picture.uri }); }
      }}>Take photo</Button> : null}
      {captureMode === 'video' ? <Button onPress={async () => {
        if (recording) { camera.current?.stopRecording(); setRecording(false); return; }
        setRecording(true);
        const video = await camera.current?.recordAsync();
        setRecording(false);
        if (video?.uri) { setStatus(video.uri); await onResult({ type: 'video', uri: video.uri }); }
      }}>{recording ? 'Stop' : 'Record'}</Button> : null}
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

function Sensor({ appId, component, onResult }: { appId: string; component: AppComponent; onResult: ResultHandler }) {
  const [state, setState] = useState<CapabilityActionState>(states.idle);
  const [value, setValue] = useState({ x: 0, y: 0, z: 0 });
  const subscription = useRef<{ remove: () => void } | null>(null);

  useEffect(() => () => {
    subscription.current?.remove();
  }, []);

  const running = Boolean(subscription.current);
  const toggle = async () => {
    if (subscription.current) {
      subscription.current.remove();
      subscription.current = null;
      setState(stateFromResult('success', 'Stopped'));
      await onResult(value);
      return;
    }
    setState(states.running);
    const outcome = await executeCapability(async () => {
      await assertCapability(appId, 'sensorReadout');
      const sensor = component.props?.sensor === 'gyroscope' ? Gyroscope
        : component.props?.sensor === 'magnetometer' ? Magnetometer : Accelerometer;
      if (!(await sensor.isAvailableAsync())) throw new CapabilityStateError('unavailable', false, 'Sensor unavailable');
      sensor.setUpdateInterval(Number(component.props?.intervalMs ?? 200));
      subscription.current = sensor.addListener(setValue);
      return 'Streaming';
    });

    setState(stateFromResult(outcome.state, outcome.message, capabilityMessage(outcome.state)));
  };

  return (
    <YStack gap="$2" style={{ padding: 16, borderRadius: 8, backgroundColor: '#f4f5f4' }}>
      <H2 size="$6">{widgetLabel(component)}</H2>
      <Button onPress={() => void toggle()}>
        {running ? 'Stop' : String(component.props?.cta ?? 'Start')}
      </Button>
      <Paragraph color="$color10">x {value.x.toFixed(2)} · y {value.y.toFixed(2)} · z {value.z.toFixed(2)}</Paragraph>
      <ActionResult state={state} message={state.message} onRetry={() => void toggle()} />
    </YStack>
  );
}

export function NativeCapability({ appId, component, onResult }: { appId: string; component: AppComponent; onResult?: ResultHandler }) {
  const runtime = useAppStore();
  const bind = (value: unknown) => bindResult(runtime, component, value, onResult);
  if (component.widget === 'cameraScanner') return <Scanner appId={appId} component={component} onResult={bind} />;
  if (component.widget === 'sensorReadout') return <Sensor appId={appId} component={component} onResult={bind} />;
  if (actionWidgets.has(component.widget as NativeActionWidget)) {
    return <CapabilityAction appId={appId} component={component} onResult={bind} />;
  }
  throw new CapabilityStateError('unavailable', false, `Unsupported native widget ${String(component.widget)}`);
}

export function supportsNativeWidget(widget?: string): boolean {
  return widget === 'cameraScanner' || widget === 'sensorReadout' || actionWidgets.has(widget as NativeActionWidget);
}
