import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from 'expo-camera';
import * as CameraRuntime from 'expo-camera';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import * as ExpoCalendar from 'expo-calendar';
import * as ExpoContacts from 'expo-contacts';
import * as ExpoLocation from 'expo-location';
import * as ExpoNotifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Platform, Linking } from 'react-native';
import { Button, H2, Paragraph, Text, XStack, YStack } from 'tamagui';

import type { AppComponent, AppPackage } from './schema';
import {
  assertCapability,
  readCapabilityDecision,
  recordConsent,
  resolveCapability,
  resolvePermissionCapabilityForDeclaration,
} from './policy';
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

const DECISION_GRANTED = 'granted' as const;
const DECISION_DENIED = 'denied' as const;
type ConsentState = typeof DECISION_GRANTED | typeof DECISION_DENIED;

type PermissionDeclaration = { id: string; reason?: string; prompt?: string };
export type PermissionRequest = { permission: PermissionDeclaration; capability: string; unsupported: boolean };

type PermissionDescriptor = {
  id: string;
  reason?: string;
  prompt?: string;
  capability: string;
  getStatus: () => Promise<NativePermissionResult>;
  request: () => Promise<NativePermissionResult>;
};

type PermissionRuntime = {
  request: () => Promise<NativePermissionResult>;
  getStatus: () => Promise<NativePermissionResult>;
};

type NativeResultValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'unknown';
export type NativeResultRecord = {
  schema: 'utopia.native.result.v1';
  source: 'native';
  widget: string;
  appId: string;
  capability: string;
  resultField: string;
  valueType: NativeResultValueType;
  timestamp: string;
  value: unknown;
};

const cameraPermissions = CameraRuntime as unknown as {
  requestCameraPermissionsAsync: () => Promise<NativePermissionResult>;
  getCameraPermissionsAsync: () => Promise<NativePermissionResult>;
};

const permissionRuntimeByCapability = {
  cameraScanner: {
    request: () => cameraPermissions.requestCameraPermissionsAsync(),
    getStatus: () => cameraPermissions.getCameraPermissionsAsync(),
  },
  locationMap: {
    request: () => ExpoLocation.requestForegroundPermissionsAsync(),
    getStatus: () => ExpoLocation.getForegroundPermissionsAsync(),
  },
  notificationScheduler: {
    request: () => ExpoNotifications.requestPermissionsAsync(),
    getStatus: () => ExpoNotifications.getPermissionsAsync(),
  },
  contactPicker: {
    request: () => ExpoContacts.requestPermissionsAsync(),
    getStatus: () => ExpoContacts.getPermissionsAsync(),
  },
  calendarEvent: {
    request: () => ExpoCalendar.requestCalendarPermissionsAsync(),
    getStatus: () => ExpoCalendar.getCalendarPermissionsAsync(),
  },
} as const;

function toPermissionId(permission: unknown): string | undefined {
  if (typeof permission === 'string') return permission.trim().toLowerCase();
  if (!permission || typeof permission !== 'object') return undefined;
  if ('id' in permission && typeof (permission as { id?: unknown }).id === 'string') return String((permission as { id?: unknown }).id).trim().toLowerCase();
  if ('permission' in permission && typeof (permission as { permission?: unknown }).permission === 'string') {
    return String((permission as { permission?: unknown }).permission).trim().toLowerCase();
  }
  return undefined;
}

function permissionDeclaration(permission: unknown): PermissionDeclaration | undefined {
  const id = toPermissionId(permission);
  if (!id) return undefined;
  const raw = permission && typeof permission === 'object' ? permission as Record<string, unknown> : {};
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : undefined;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : undefined;
  return { id, reason: reason && reason.length ? reason : undefined, prompt: prompt && prompt.length ? prompt : undefined };
}

function permissionMap(permissionId: string): PermissionRuntime | undefined {
  if (Platform.OS === 'web') return;
  const capability = resolvePermissionCapabilityForDeclaration(permissionId);
  return capability && capability in permissionRuntimeByCapability
    ? permissionRuntimeByCapability[capability as keyof typeof permissionRuntimeByCapability]
    : undefined;
}

export async function collectRuntimePermissions(pkg: AppPackage): Promise<PermissionRequest[]> {
  const requested: PermissionRequest[] = [];
  const seen = new Set<string>();
  for (const raw of pkg.nativeCapabilities?.permissions ?? []) {
    const declaration = permissionDeclaration(raw);
    if (!declaration || seen.has(declaration.id)) continue;
    const descriptor = permissionDescriptor(declaration);
    const capability = resolvePermissionCapabilityForDeclaration(declaration.id) ?? declaration.id;
    requested.push({
      permission: declaration,
      capability: capability ?? declaration.id,
      unsupported: !descriptor,
    });
    seen.add(declaration.id);
  }
  return requested;
}

export async function collectPendingRuntimePermissions(appId: string, pkg: AppPackage): Promise<PermissionRequest[]> {
  const supported: PermissionRequest[] = [];
  const unsupported: PermissionRequest[] = [];
  for (const request of await collectRuntimePermissions(pkg)) {
    if (request.unsupported) {
      unsupported.push(request);
      continue;
    }
    const decision = await readCapabilityDecision(appId, request.capability);
    if (!decision) supported.push(request);
  }
  return [...supported, ...unsupported];
}

export async function requestBootPermission(appId: string, permission: PermissionRequest): Promise<null> {
  const descriptor = permissionDescriptor(permission.permission);
  if (!descriptor) throw new CapabilityStateError('unavailable', false, `Permission unsupported on this platform: ${permission.permission.id}`);
  const status = await descriptor.getStatus();
  if (status.granted) {
    await recordConsent(appId, permission.capability, DECISION_GRANTED);
    return null;
  }
  const response = await descriptor.request();
  const state = response.granted ? DECISION_GRANTED : DECISION_DENIED;
  await recordConsent(appId, permission.capability, state);
  return null;
}

export function unsupportedPermission(permission: PermissionDeclaration): boolean {
  return !permissionDescriptor(permission);
}

export function toBootPermissionLabel(permission: PermissionRequest) {
  return permission.permission.id;
}

function permissionDescriptor(permission: PermissionDeclaration): PermissionDescriptor | undefined {
  const capability = resolvePermissionCapabilityForDeclaration(permission.id);
  const runtime = permissionMap(permission.id);
  if (!runtime) return;
  return { ...runtime, ...permission, capability: capability! };
}

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
  retryable?: boolean,
): CapabilityActionState {
  if (state === 'idle' || state === 'running') {
    return { ...states[state], state, message: message || fallback || capabilityMessage(state) };
  }
  return { state, retryable, message: message || fallback || capabilityMessage(state) };
}

async function withRuntimePermission<T>(
  appId: string,
  widget: string,
  permission: { request: () => Promise<{ granted: boolean; canAskAgain?: boolean }>; getStatus: () => Promise<{ granted: boolean; canAskAgain?: boolean }> },
  run: () => Promise<T>,
): Promise<T> {
  await ensurePermissionGranted(appId, widget, () => permission.request(), () => permission.getStatus());
  return run();
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
  return withRuntimePermission(appId, 'locationMap', {
    request: () => location.requestForegroundPermissionsAsync(),
    getStatus: () => location.getForegroundPermissionsAsync(),
  }, async () => {
    const current = await location.getCurrentPositionAsync({});
    return { latitude: current.coords.latitude, longitude: current.coords.longitude };
  });
}

async function runNotification(appId: string, component: AppComponent) {
  const notifications = await import('expo-notifications');
  return withRuntimePermission(appId, 'notificationScheduler', {
    request: () => notifications.requestPermissionsAsync(),
    getStatus: () => notifications.getPermissionsAsync(),
  }, async () => {
    const props = component.props ?? {};
    const seconds = Number(props.seconds ?? 10);
    if (!Number.isFinite(seconds) || seconds < 1) throw new CapabilityStateError('retry', true, 'Invalid notification timer');
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
  });
}

async function runContactPicker(appId: string, component: AppComponent) {
  const contacts = await import('expo-contacts');
  return withRuntimePermission(appId, 'contactPicker', {
    request: () => contacts.requestPermissionsAsync(),
    getStatus: () => contacts.getPermissionsAsync(),
  }, async () => {
    const result = await contacts.presentContactPickerAsync();
    if (!result) throw new CapabilityStateError('cancelled', false, 'Contact picker cancelled');
    return { id: result.id, name: result.name ?? 'Unknown' };
  });
}

async function runCalendar(appId: string, component: AppComponent) {
  const calendar = await import('expo-calendar');
  return withRuntimePermission(appId, 'calendarEvent', {
    request: () => calendar.requestCalendarPermissionsAsync(),
    getStatus: () => calendar.getCalendarPermissionsAsync(),
  }, async () => {
    const props = component.props ?? {};
    const startOffsetMinutes = Number(props.startOffsetMinutes ?? 10);
    const durationMinutes = Number(props.durationMinutes ?? 30);
    const startDate = new Date(Date.now() + startOffsetMinutes * 60_000);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    const target = await calendar.getDefaultCalendarAsync();
    if (!target?.id) throw new CapabilityStateError('unavailable', false, 'No default calendar available');
    await calendar.createEventAsync(target.id, {
      title: String(props.eventTitle ?? widgetLabel(component)),
      startDate,
      endDate,
    });
    return 'Calendar event created';
  });
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
  const canRetry = state.retryable ?? ['retry', 'cancelled'].includes(state.state);
  const isDenied = state.state === 'denied';
  const textColor = state.state === 'success' ? '$green10' : state.state === 'running' ? '$blue10' : '$color10';

  const openSettings = async () => {
    if (Platform.OS === 'web') return;
    try {
      await Linking.openSettings();
    } catch {
      // noop
    }
  };

  return (
    <YStack gap="$2">
      <Paragraph color={textColor}>{message}</Paragraph>
      {canRetry ? <Button size="$3" onPress={() => void onRetry()}>Retry</Button> : null}
      {isDenied && !canRetry ? <Button size="$3" onPress={() => void openSettings()}>Open settings</Button> : null}
    </YStack>
  );
}

type ResultHandler = (value: unknown) => void | Promise<void>;

type NativePermissionResult = { granted: boolean; canAskAgain?: boolean };

async function ensurePermissionGranted(
  appId: string,
  widget: string,
  request: () => Promise<NativePermissionResult>,
  fallback?: () => Promise<NativePermissionResult> | NativePermissionResult,
) {
  const capability = await resolveCapability(appId, widget);
  if (!capability) {
    await assertCapability(appId, widget);
    return;
  }

  const existing = await readCapabilityDecision(appId, capability);
  if (existing?.state === 'granted') {
    const current = await fallback?.();
    if (current?.granted === false) {
      await recordConsent(appId, capability, 'denied');
      throw new CapabilityStateError('denied', false, `Permission denied for ${capability}`);
    }
    return;
  }
  if (existing?.state === 'denied') throw new CapabilityStateError('denied', false, `Permission denied for ${capability}`);

  const current = await fallback?.();
  if (current?.granted) {
    await recordConsent(appId, capability, 'granted');
    return;
  }

  const status = await request();
  const decision = status.granted ? 'granted' : 'denied';
  await recordConsent(appId, capability, decision);
  if (decision === 'denied') {
    throw new CapabilityStateError('denied', false, `Permission denied for ${capability}`);
  }
}

function resultType(value: unknown): NativeResultValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value === true || value === false) return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function bindableNativeResult(
  appId: string,
  component: AppComponent,
  value: unknown,
) {
  const field = String(component.props?.resultField ?? 'result');
  return {
    schema: 'utopia.native.result.v1',
    source: 'native',
    appId,
    capability: String(component.widget),
    widget: String(component.widget),
    resultField: field,
    valueType: resultType(value),
    timestamp: new Date().toISOString(),
    value,
  } satisfies NativeResultRecord;
}

async function bindResult(runtime: Store, appId: string, component: AppComponent, value: unknown, onResult?: ResultHandler) {
  const record = bindableNativeResult(appId, component, value);
  await onResult?.(record);
  const field = String(component.props?.resultField ?? 'result');
  const action = component.action;
  if (action && (action.kind === 'create' || action.kind === 'update')) {
    await runtime.dispatch({ ...action, values: { ...action.values, [field]: record } });
  } else if (component.props?.collection) {
    await runtime.dispatch({ kind: 'create', collection: String(component.props.collection), values: { [field]: record } });
  }
}

const resultText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

const runByWidget = {
  filePicker: (appId, component) => runFilePicker(component.props ?? {}),
  fileExport: (appId, component) => runFileExport(appId, component),
  locationMap: (appId, component) => runLocation(appId, component),
  notificationScheduler: (appId, component) => runNotification(appId, component),
  contactPicker: (appId, component) => runContactPicker(appId, component),
  calendarEvent: (appId, component) => runCalendar(appId, component),
  biometricGate: (appId, component) => runBiometrics(component),
  speechTool: (appId, component) => runSpeech(component),
  healthConnect: (appId) => runHealthConnect(),
  healthKitStatus: (appId) => runHealthKit(),
} satisfies Record<string, (appId: string, component: AppComponent) => Promise<unknown>>;

function CapabilityAction({ appId, component, onResult }: { appId: string; component: AppComponent; onResult: ResultHandler }) {
  const [actionState, setActionState] = useState<CapabilityActionState>(states.idle);
  const [value, setValue] = useState<unknown>();

  const run = async () => {
    setActionState(states.running);
    const result = await executeCapability(async () => {
      await assertCapability(appId, String(component.widget));
      const runner = runByWidget[component.widget as keyof typeof runByWidget];
      if (!runner) throw new CapabilityStateError('unavailable', false, `Unsupported native widget ${String(component.widget)}`);
      return runner(appId, component);
    });
    if (result.state === 'success') {
      setValue(result.value);
      await onResult(result.value);
    }
    setActionState(stateFromResult(
      result.state,
      result.state === 'success' ? resultText(result.value) : result.message,
      capabilityMessage(result.state),
      result.retryable,
    ));
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
      await ensurePermissionGranted(appId, 'cameraScanner', async () => {
        const response = await requestPermission();
        return { granted: response.granted, canAskAgain: response.canAskAgain };
      }, () => {
        if (!permission) return { granted: false, canAskAgain: true };
        return { granted: permission.granted, canAskAgain: permission.canAskAgain };
      });
      setAuthorized(true);
      return 'Permission granted';
    });
    setReadState(stateFromResult(outcome.state, outcome.message, capabilityMessage(outcome.state)));
  };

  useEffect(() => {
    if (!permission) return;
    void (async () => {
      try {
        if (!permission.granted) {
          const capability = await resolveCapability(appId, 'cameraScanner');
          if (!capability) {
            await assertCapability(appId, 'cameraScanner');
            return;
          }
          const decision = await readCapabilityDecision(appId, capability);
          if (decision?.state === 'denied') {
            setAuthorized(false);
            setReadState(stateFromResult('denied', `Permission denied for ${capability}`, undefined, false));
            return;
          }
          setAuthorized(false);
          setReadState(stateFromResult('idle', capabilityMessage('idle'), 'Ready'));
          return;
        }

        const capability = await resolveCapability(appId, 'cameraScanner');
        if (!capability) {
          await assertCapability(appId, 'cameraScanner');
          return;
        }

        await recordConsent(appId, capability, 'granted');
        setAuthorized(true);
        setReadState(stateFromResult('success', 'Camera ready', 'Camera ready'));
      } catch (cause) {
        setAuthorized(false);
        setReadState(stateFromResult('denied', cause instanceof Error ? cause.message : 'Permission denied', 'Denied', false));
      }
    })();
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
          void onResult(bindableNativeResult(appId, component, { type: 'barcode', value: data }));
        }}
      />
      {captureMode === 'photo' ? <Button onPress={async () => {
        const picture = await camera.current?.takePictureAsync();
        if (picture?.uri) {
          const value = { type: 'photo', uri: picture.uri };
          setStatus(picture.uri);
          await onResult(bindableNativeResult(appId, component, value));
        }
      }}>Take photo</Button> : null}
      {captureMode === 'video' ? <Button onPress={async () => {
        if (recording) { camera.current?.stopRecording(); setRecording(false); return; }
        setRecording(true);
        const video = await camera.current?.recordAsync();
        setRecording(false);
        if (video?.uri) {
          const value = { type: 'video', uri: video.uri };
          setStatus(video.uri);
          await onResult(bindableNativeResult(appId, component, value));
        }
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
      await onResult(bindableNativeResult(appId, component, value));
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
  const bind = (value: unknown) => bindResult(runtime, appId, component, value, onResult);
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
