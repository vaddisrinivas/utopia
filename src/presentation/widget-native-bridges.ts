import { Platform } from 'react-native';

export type NativeAudioPlayer = {
  currentStatus: {
    duration: number;
    currentTime: number;
    playing: boolean;
    didJustFinish?: boolean;
  };
  volume: number;
  loop: boolean;
  pause(): void;
  play(): void;
  remove(): void;
  seekTo(timeSeconds: number): Promise<void>;
};

export type NativeCameraModule = any;

export type NativeVideoModule = any;

export type NativeVideoPlayer = {
  loop: boolean;
  play(): void;
};

export type NativeNotificationTriggerInput = {
  seconds: number;
};

export type AudioLoopRecorderDriver = {
  startRecording(input: { outputFile: string; isMuted: boolean }): Promise<{ sourceUri?: string }>;
  stopRecording(): Promise<{ sourceUri?: string }>;
};

type ExpoAudioRecorder = {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
};

type ExpoAudioModule = {
  readonly AudioModule?: {
    readonly AudioRecorder?: new (options: unknown) => ExpoAudioRecorder;
  };
  readonly RecordingPresets?: {
    readonly HIGH_QUALITY?: Record<string, unknown>;
  };
  requestRecordingPermissionsAsync?: () => Promise<{ granted?: boolean }>;
}

function asExpoAudioModule(input: unknown): ExpoAudioModule | null {
  return input && typeof input === 'object' ? input as ExpoAudioModule : null;
}

function requireRecordingOptions(audio: ExpoAudioModule): Record<string, unknown> {
  const preset = audio.RecordingPresets?.HIGH_QUALITY;
  if (!preset) throw new Error('expo-audio recorder API is unavailable in this build.');

  const platformOptions = Platform.OS === 'ios'
    ? preset.ios
    : Platform.OS === 'android'
      ? preset.android
      : preset.web;
  if (!platformOptions || typeof platformOptions !== 'object') {
    throw new Error('expo-audio recorder API is unavailable in this build.');
  }

  return {
    extension: preset.extension,
    sampleRate: preset.sampleRate,
    numberOfChannels: preset.numberOfChannels,
    bitRate: preset.bitRate,
    isMeteringEnabled: false,
    directory: 'document',
    ...platformOptions,
  };
}

function requireRecorderUri(recorder: ExpoAudioRecorder): string {
  const uri = recorder.uri?.trim();
  if (!uri) throw new Error('expo-audio recorder did not return a recording URI.');
  return uri;
}

export async function loadExpoCamera(): Promise<NativeCameraModule> {
  return import('expo-camera') as Promise<NativeCameraModule>;
}

export async function loadExpoCalendar(): Promise<any> {
  return import('expo-calendar');
}

export async function loadExpoContacts(): Promise<any> {
  return import('expo-contacts');
}

export async function loadExpoAudio(): Promise<any> {
  return import('expo-audio');
}

export async function createAudioLoopRecorderDriver(audioModule?: unknown): Promise<AudioLoopRecorderDriver> {
  const audio = asExpoAudioModule(audioModule ?? await loadExpoAudio());
  if (!audio) {
    throw new Error('Audio loop recorder module is not available.');
  }
  if (typeof audio.AudioModule?.AudioRecorder !== 'function' || typeof audio.requestRecordingPermissionsAsync !== 'function') {
    throw new Error('expo-audio recorder API is unavailable in this build.');
  }

  const recorder = new audio.AudioModule.AudioRecorder(requireRecordingOptions(audio));
  return {
    startRecording: async (command) => {
      if (command.isMuted) throw new Error('Audio loop recording cannot start muted.');
      const permission = await audio.requestRecordingPermissionsAsync?.();
      if (!permission?.granted) throw new Error('Microphone permission was not granted.');
      await recorder.prepareToRecordAsync();
      recorder.record();
      // expo-audio web assigns its blob URI only after stop(); the caller uses this
      // value as a started-session marker and saves only the stopped URI.
      return { sourceUri: recorder.uri?.trim() || command.outputFile };
    },
    stopRecording: async () => {
      await recorder.stop();
      return { sourceUri: requireRecorderUri(recorder) };
    },
  };
}

export async function loadExpoDocumentPicker(): Promise<any> {
  return import('expo-document-picker');
}

export async function loadExpoFileSystem(): Promise<any> {
  return import('expo-file-system/legacy');
}

export async function loadExpoImagePicker(): Promise<any> {
  return import('expo-image-picker');
}

export async function loadExpoLocalAuthentication(): Promise<any> {
  return import('expo-local-authentication');
}

export async function loadExpoLocation(): Promise<any> {
  return import('expo-location');
}

export async function loadExpoNotifications(): Promise<any> {
  return import('expo-notifications');
}

export async function loadExpoSensors(): Promise<any> {
  return import('expo-sensors');
}

export async function loadExpoSpeech(): Promise<any> {
  return import('expo-speech');
}

export async function loadExpoSharing(): Promise<any> {
  return import('expo-sharing');
}

export async function loadExpoVideo(): Promise<NativeVideoModule> {
  return import('expo-video') as Promise<NativeVideoModule>;
}

export const DocumentPicker: any = {
  async getDocumentAsync(options: any) {
    return (await loadExpoDocumentPicker()).getDocumentAsync(options);
  },
};

export const FileSystem: any = {
  get documentDirectory() {
    return null;
  },
  get cacheDirectory() {
    return null;
  },
  EncodingType: { UTF8: 'utf8' },
  async getInfoAsync(...args: any[]) {
    return (await loadExpoFileSystem()).getInfoAsync(...args);
  },
  async makeDirectoryAsync(...args: any[]) {
    return (await loadExpoFileSystem()).makeDirectoryAsync(...args);
  },
  async copyAsync(...args: any[]) {
    return (await loadExpoFileSystem()).copyAsync(...args);
  },
  async writeAsStringAsync(...args: any[]) {
    return (await loadExpoFileSystem()).writeAsStringAsync(...args);
  },
};

export const ImagePicker: any = {
  async requestCameraPermissionsAsync(...args: any[]) {
    return (await loadExpoImagePicker()).requestCameraPermissionsAsync(...args);
  },
  async launchCameraAsync(...args: any[]) {
    return (await loadExpoImagePicker()).launchCameraAsync(...args);
  },
  async launchImageLibraryAsync(...args: any[]) {
    return (await loadExpoImagePicker()).launchImageLibraryAsync(...args);
  },
};

export const LocalAuthentication: any = {
  async hasHardwareAsync(...args: any[]) {
    return (await loadExpoLocalAuthentication()).hasHardwareAsync(...args);
  },
  async isEnrolledAsync(...args: any[]) {
    return (await loadExpoLocalAuthentication()).isEnrolledAsync(...args);
  },
  async authenticateAsync(...args: any[]) {
    return (await loadExpoLocalAuthentication()).authenticateAsync(...args);
  },
};

export const Location: any = {
  async requestForegroundPermissionsAsync(...args: any[]) {
    return (await loadExpoLocation()).requestForegroundPermissionsAsync(...args);
  },
  async getCurrentPositionAsync(...args: any[]) {
    return (await loadExpoLocation()).getCurrentPositionAsync(...args);
  },
};

export const Notifications: any = {
  NotificationTriggerInput: {},
  async requestPermissionsAsync(...args: any[]) {
    return (await loadExpoNotifications()).requestPermissionsAsync(...args);
  },
  async scheduleNotificationAsync(...args: any[]) {
    return (await loadExpoNotifications()).scheduleNotificationAsync(...args);
  },
  async cancelScheduledNotificationAsync(...args: any[]) {
    return (await loadExpoNotifications()).cancelScheduledNotificationAsync(...args);
  },
};

export const Sensors: any = {
  async load() {
    return loadExpoSensors();
  },
};

function createSensorProxy(sensorName: 'Accelerometer' | 'Gyroscope' | 'Magnetometer') {
  return {
    async isAvailableAsync(...args: any[]) {
      return (await loadExpoSensors())[sensorName].isAvailableAsync(...args);
    },
    setUpdateInterval(...args: any[]) {
      return loadExpoSensors().then((module) => module[sensorName].setUpdateInterval(...args));
    },
    addListener(...args: any[]) {
      return loadExpoSensors().then((module) => module[sensorName].addListener(...args));
    },
  };
}

export const Accelerometer: any = createSensorProxy('Accelerometer');
export const Gyroscope: any = createSensorProxy('Gyroscope');
export const Magnetometer: any = createSensorProxy('Magnetometer');

export const Speech: any = {
  speak(...args: any[]) {
    void loadExpoSpeech().then((module) => module.speak(...args));
  },
  stop(...args: any[]) {
    return loadExpoSpeech().then((module) => module.stop(...args));
  },
};

export const Sharing: any = {
  async isAvailableAsync(...args: any[]) {
    return (await loadExpoSharing()).isAvailableAsync(...args);
  },
  async shareAsync(...args: any[]) {
    return (await loadExpoSharing()).shareAsync(...args);
  },
};

export const Calendar: any = {
  EntityTypes: { EVENT: 'event' },
  async isAvailableAsync(...args: any[]) {
    return (await loadExpoCalendar()).isAvailableAsync(...args);
  },
  async requestPermissionsAsync(...args: any[]) {
    return (await loadExpoCalendar()).requestPermissionsAsync(...args);
  },
  async getCalendarsAsync(...args: any[]) {
    return (await loadExpoCalendar()).getCalendarsAsync(...args);
  },
  async createEventAsync(...args: any[]) {
    return (await loadExpoCalendar()).createEventAsync(...args);
  },
};

export const Contacts: any = {
  async isAvailableAsync(...args: any[]) {
    return (await loadExpoContacts()).isAvailableAsync(...args);
  },
  async requestPermissionsAsync(...args: any[]) {
    return (await loadExpoContacts()).requestPermissionsAsync(...args);
  },
  async presentContactPickerAsync(...args: any[]) {
    return (await loadExpoContacts()).presentContactPickerAsync(...args);
  },
};

export async function createAudioPlayer(...args: any[]): Promise<NativeAudioPlayer> {
  return (await loadExpoAudio()).createAudioPlayer(...args);
}

export async function setAudioModeAsync(...args: any[]): Promise<void> {
  return (await loadExpoAudio()).setAudioModeAsync(...args);
}
