import {
  type AudioLoopAssetMaterializer,
  makeAudioLoopRecordingDisplayName,
  type AudioLoopAssetSource,
} from '@/src/presentation/widgets/audio-loop-state';

const DEFAULT_DURABLE_DIRECTORY = 'audio-loop-108/assets';
const RANDOM_TOKEN_LENGTH = 8;

export type AudioLoopFileSystemInfo = {
  readonly exists: boolean;
  readonly isDirectory?: boolean;
  readonly size?: number;
};

export type AudioLoopStorageFileSystem = {
  copyAsync(input: { from: string; to: string }): Promise<void>;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  getInfoAsync(uri: string): Promise<AudioLoopFileSystemInfo>;
  readonly documentDirectory?: string | null;
  readonly cacheDirectory?: string | null;
};

export type AudioLoopStorageMaterializerInput = {
  fileSystem: AudioLoopStorageFileSystem;
  durableDirectory?: string;
  randomToken?: () => string;
};

export type AudioLoopMaterializer = AudioLoopAssetMaterializer;

export type AudioLoopRecorderCommand = {
  outputFile: string;
  isMuted: boolean;
};

export type AudioLoopRecorderDriver = {
  startRecording(input: AudioLoopRecorderCommand): Promise<{ sourceUri: string }>;
  stopRecording(): Promise<void>;
};

export function createAudioLoopStorageMaterializer({
  fileSystem,
  durableDirectory = DEFAULT_DURABLE_DIRECTORY,
  randomToken,
}: AudioLoopStorageMaterializerInput): AudioLoopMaterializer {
  const durableRoot = resolveDurableRoot(fileSystem, durableDirectory);
  const generateToken = randomToken ?? randomHexToken;

  return {
    materialize: async (input) => {
      await ensureDirectory(fileSystem, durableRoot);
      const sourceUri = sanitizeUri(input.sourceUri);
      const fileName = buildDurableAudioLoopFileName({
        source: input.source,
        sourceUri,
        preferredName: input.preferredName,
        recordedAt: input.recordedAt,
      });
      const durableUri = `${durableRoot}/${fileName}`;
      await fileSystem.copyAsync({ from: sourceUri, to: durableUri });
      const info = await fileSystem.getInfoAsync(durableUri);
      return {
        durableUri,
        fileName: input.preferredName,
        displayName: input.preferredName,
        mimeType: null,
        bytes: info.exists && typeof info.size === 'number' ? info.size : null,
        checksum: `${generateToken()}-${input.source}`,
      };
    },
    hasDurableUri: async (durableUri) => {
      const info = await fileSystem.getInfoAsync(durableUri);
      return !!info.exists && !info.isDirectory;
    },
  };
}

export function buildRecorderStartCommand(outputFile: string): AudioLoopRecorderCommand {
  return {
    outputFile,
    isMuted: false,
  };
}

export async function startAudioLoopRecording(
  driver: AudioLoopRecorderDriver,
  outputFile: string,
): Promise<{ sourceUri: string }> {
  return driver.startRecording(buildRecorderStartCommand(outputFile));
}

function resolveDurableRoot(fileSystem: AudioLoopStorageFileSystem, durableDirectory: string): string {
  const root = fileSystem.documentDirectory ?? fileSystem.cacheDirectory;
  if (!root) return durableDirectory;
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  const normalizedLeaf = durableDirectory.startsWith('/') ? durableDirectory.slice(1) : durableDirectory;
  return `${normalizedRoot}/${normalizedLeaf}`;
}

function randomHexToken(): string {
  const raw = Math.random().toString(16).replace('0.', '');
  return raw.padStart(RANDOM_TOKEN_LENGTH, '0').slice(0, RANDOM_TOKEN_LENGTH);
}

function ensureDirectory(fileSystem: AudioLoopStorageFileSystem, durableRoot: string): Promise<void> {
  return fileSystem.makeDirectoryAsync(durableRoot, { intermediates: true });
}

function sanitizeUri(uri: string): string {
  return uri.trim();
}

function fileNameFromUri(uri: string): string {
  const parsed = uri.split('/').filter(Boolean).pop();
  const normalized = parsed ? decodeURIComponent(parsed) : null;
  return normalized ?? uri;
}

function fileStemFromUri(uri: string): string {
  const fileName = fileNameFromUri(uri);
  return fileName.endsWith('.') ? fileName : fileName.replace(/\.[^/.]+$/, '');
}

function fileExtension(uri: string): string {
  const name = fileNameFromUri(uri);
  const lastDot = name.lastIndexOf('.');
  if (lastDot < 0) return '';
  return name.slice(lastDot);
}

function buildDurableAudioLoopFileName(input: {
  source: AudioLoopAssetSource;
  sourceUri: string;
  preferredName: string;
  recordedAt: string;
}): string {
  const sourceName = fileStemFromUri(input.sourceUri);
  const suffix = input.source === 'recorded'
    ? makeAudioLoopRecordingDisplayName(input.recordedAt)
    : sourceName || 'audio-loop';
  const extension = fileExtension(input.sourceUri);
  const safe = sanitizeFileName(input.preferredName || suffix || fileNameFromUri(input.sourceUri));
  return `${safe}${extension}`;
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');
  return trimmed || 'audio-loop-asset';
}
