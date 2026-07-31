import type { AppPackageNativeCapability } from '@/packages/shared/contracts/package';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import type {
  CapabilityDecisionPort,
  CapabilityDecisionInput,
} from '@/packages/shared/contracts/capability-consent-ledger';

export type WidgetCapabilityKind =
  | 'audio-file'
  | 'audio-recorder'
  | 'biometric'
  | 'calendar'
  | 'camera-scanner'
  | 'contacts'
  | 'file-export'
  | 'file-picker'
  | 'location'
  | 'media-picker'
  | 'notification'
  | 'sensor'
  | 'speech'
  | 'video-player';

export type WidgetCapabilityRequest =
  | Readonly<{ kind: 'audio-file'; action: 'choose' }>
  | Readonly<{ kind: 'audio-recorder'; action: 'record' }>
  | Readonly<{ kind: 'biometric'; action: 'authenticate' }>
  | Readonly<{ kind: 'calendar'; action: 'create' }>
  | Readonly<{ kind: 'camera-scanner'; action: 'scan'; barcodeTypes: readonly string[] }>
  | Readonly<{ kind: 'contacts'; action: 'pick' }>
  | Readonly<{ kind: 'file-export'; action: 'export'; fileName: string; mimeType: string }>
  | Readonly<{ kind: 'file-picker'; action: 'choose'; mimeTypes: readonly string[]; multiple: boolean; copyToCacheDirectory: boolean }>
  | Readonly<{ kind: 'location'; action: 'current' }>
  | Readonly<{ kind: 'media-picker'; action: 'camera' | 'library'; media: 'image' | 'video' }>
  | Readonly<{ kind: 'notification'; action: 'schedule' | 'cancel' }>
  | Readonly<{ kind: 'sensor'; action: 'watch'; sensor: 'accelerometer' | 'gyroscope' | 'magnetometer' }>
  | Readonly<{ kind: 'speech'; action: 'speak' | 'stop'; textLength: number }>
  | Readonly<{ kind: 'video-player'; action: 'render' }>;

export type WidgetCapabilityGrant = Readonly<{
  ok: true;
  installationId: string;
  packageId: string;
  kind: WidgetCapabilityKind;
  action: string;
  grantedPackages: readonly string[];
  grantedPermissions: readonly string[];
}>;

export type WidgetCapabilityDeny = Readonly<{
  ok: false;
  error: WidgetCapabilityError;
}>;

export type WidgetCapabilityResult = WidgetCapabilityGrant | WidgetCapabilityDeny;

export type WidgetCapabilityError = Readonly<{
  code:
    | 'package_installation_required'
    | 'package_not_installed'
    | 'package_native_capabilities_missing'
    | 'package_capability_unknown_action'
    | 'package_capability_package_not_granted'
    | 'package_capability_permission_not_granted'
    | 'package_capability_consent_required'
    | 'package_capability_consent_denied'
    | 'package_capability_consent_revoked'
    | 'package_capability_consent_checksum_mismatch';
  kind: WidgetCapabilityKind | 'unknown';
  action: string;
  installationId: string | null;
  packageId: string | null;
  message: string;
  missingPackages: readonly string[];
  missingPermissions: readonly string[];
}>;

export type WidgetCapabilityRuntime = Readonly<{
  installationId: string | null;
  activePackage: {
    id: string;
    version?: string;
    checksum?: string;
    nativeCapabilities?: AppPackageNativeCapability | null;
  } | null;
  capabilityDecisionPort?: CapabilityDecisionPort | null;
}>;

export function requestWidgetCapability(
  runtime: WidgetCapabilityRuntime,
  request: WidgetCapabilityRequest,
): WidgetCapabilityResult {
  const installationId = runtime.installationId?.trim() ?? '';
  if (!installationId) {
    return deny({
      code: 'package_installation_required',
      kind: request.kind,
      action: request.action,
      installationId: null,
      packageId: runtime.activePackage?.id ?? null,
      message: 'Package installation is required before native capabilities can be used.',
      missingPackages: [],
      missingPermissions: [],
    });
  }

  const activePackage = runtime.activePackage;
  if (!activePackage) {
    return deny({
      code: 'package_not_installed',
      kind: request.kind,
      action: request.action,
      installationId,
      packageId: null,
      message: 'No active package is installed for this runtime.',
      missingPackages: [],
      missingPermissions: [],
    });
  }

  const nativeCapabilities = activePackage.nativeCapabilities;
  if (!nativeCapabilities) {
    return deny({
      code: 'package_native_capabilities_missing',
      kind: request.kind,
      action: request.action,
      installationId,
      packageId: activePackage.id,
      message: 'The installed package did not declare native capabilities.',
      missingPackages: [],
      missingPermissions: [],
    });
  }

  const requirements = widgetCapabilityRequirements(request);
  if (!requirements) {
    return deny({
      code: 'package_capability_unknown_action',
      kind: request.kind,
      action: request.action,
      installationId,
      packageId: activePackage.id,
      message: `Unknown capability action:${request.kind}.${request.action}`,
      missingPackages: [],
      missingPermissions: [],
    });
  }

  const packageVersion = activePackage.version?.trim() ?? '';
  const packageChecksum = activePackage.checksum?.trim() || sha256Canonical(activePackage);
  const consentInput: CapabilityDecisionInput = {
    installationId,
    packageId: activePackage.id,
    packageVersion,
    packageChecksum,
    capability: `native.${request.kind}`,
    scope: widgetCapabilityConsentScope(request),
  };
  const consentDecision = packageVersion && packageChecksum && runtime.capabilityDecisionPort
    ? runtime.capabilityDecisionPort.decide(consentInput)
    : 'missing';
  if (consentDecision !== 'allow') {
    const consentError = consentErrorForDecision(consentDecision, request, installationId, activePackage.id);
    return deny(consentError);
  }

  const grantedPackages = new Set(nativeCapabilities.packages.map((value) => value.trim()).filter(Boolean));
  const grantedPermissions = new Set(
    (nativeCapabilities.permissions ?? []).map(normalizePermissionLabel).filter(Boolean),
  );
  const missingPackages = requirements.packages.filter((value) => !grantedPackages.has(value));
  const missingPermissions = requirements.permissions.filter((value) => !grantedPermissions.has(value));

  if (missingPackages.length || missingPermissions.length) {
    return deny({
      code: missingPackages.length ? 'package_capability_package_not_granted' : 'package_capability_permission_not_granted',
      kind: request.kind,
      action: request.action,
      installationId,
      packageId: activePackage.id,
      message: missingPackages.length
        ? `Missing package grant:${missingPackages.join(', ')}`
        : `Missing permission grant:${missingPermissions.join(', ')}`,
      missingPackages,
      missingPermissions,
    });
  }

  return {
    ok: true,
    installationId,
    packageId: activePackage.id,
    kind: request.kind,
    action: request.action,
    grantedPackages: requirements.packages,
    grantedPermissions: requirements.permissions,
  };
}

export function widgetCapabilityConsentScope(request: WidgetCapabilityRequest): readonly string[] {
  const scope: string[] = [request.action];
  if (request.kind === 'media-picker') scope.push(`media:${request.media}`);
  if (request.kind === 'sensor') scope.push(`sensor:${request.sensor}`);
  return scope;
}

function consentErrorForDecision(
  decision: Exclude<ReturnType<NonNullable<WidgetCapabilityRuntime['capabilityDecisionPort']>['decide']>, 'allow'>,
  request: WidgetCapabilityRequest,
  installationId: string,
  packageId: string,
): WidgetCapabilityError {
  const code = decision === 'revoked'
    ? 'package_capability_consent_revoked'
    : decision === 'checksum_mismatch'
      ? 'package_capability_consent_checksum_mismatch'
      : decision === 'deny'
        ? 'package_capability_consent_denied'
        : 'package_capability_consent_required';
  const message = decision === 'revoked'
    ? 'Active capability consent was revoked.'
    : decision === 'checksum_mismatch'
      ? 'Capability consent does not match the active package checksum.'
      : decision === 'deny'
        ? 'Capability consent was denied.'
        : 'Active persisted capability consent is required.';
  return {
    code,
    kind: request.kind,
    action: request.action,
    installationId,
    packageId,
    message,
    missingPackages: [],
    missingPermissions: [],
  };
}

function deny(error: WidgetCapabilityError): WidgetCapabilityDeny {
  return { ok: false, error };
}

function normalizePermissionLabel(value: string | { permission: string }): string {
  return typeof value === 'string' ? value.trim() : value.permission.trim();
}

function widgetCapabilityRequirements(
  request: WidgetCapabilityRequest,
): Readonly<{ packages: readonly string[]; permissions: readonly string[] }> | null {
  switch (request.kind) {
    case 'audio-file':
      return request.action === 'choose'
        ? { packages: ['expo-audio', 'expo-document-picker'], permissions: ['expo-audio', 'expo-document-picker'] }
        : null;
    case 'audio-recorder':
      return request.action === 'record' ? { packages: ['expo-audio'], permissions: ['expo-audio'] } : null;
    case 'biometric':
      return request.action === 'authenticate'
        ? { packages: ['expo-local-authentication'], permissions: ['expo-local-authentication'] }
        : null;
    case 'calendar':
      return request.action === 'create'
        ? { packages: ['expo-calendar'], permissions: ['expo-calendar'] }
        : null;
    case 'camera-scanner':
      return request.action === 'scan'
        ? { packages: ['expo-camera'], permissions: ['expo-camera'] }
        : null;
    case 'contacts':
      return request.action === 'pick'
        ? { packages: ['expo-contacts'], permissions: ['expo-contacts'] }
        : null;
    case 'file-export':
      return request.action === 'export'
        ? { packages: ['expo-file-system', 'expo-sharing'], permissions: ['expo-file-system', 'expo-sharing'] }
        : null;
    case 'file-picker':
      return request.action === 'choose'
        ? { packages: ['expo-document-picker'], permissions: ['expo-document-picker'] }
        : null;
    case 'location':
      return request.action === 'current'
        ? { packages: ['expo-location'], permissions: ['expo-location'] }
        : null;
    case 'media-picker':
      if (request.action === 'camera') {
        return {
          packages: ['expo-file-system', 'expo-image-picker'],
          permissions: ['expo-image-picker:camera'],
        };
      }
      return request.action === 'library'
          ? {
            packages: ['expo-file-system', 'expo-image-picker'],
            permissions: ['expo-image-picker:media-library'],
          }
        : null;
    case 'notification':
      return request.action === 'schedule' || request.action === 'cancel'
        ? { packages: ['expo-notifications'], permissions: ['expo-notifications'] }
        : null;
    case 'sensor':
      return request.action === 'watch'
        && ['accelerometer', 'gyroscope', 'magnetometer'].includes(request.sensor)
        ? { packages: ['expo-sensors'], permissions: ['expo-sensors'] }
        : null;
    case 'speech':
      return request.action === 'speak' || request.action === 'stop'
        ? { packages: ['expo-speech'], permissions: ['expo-speech'] }
        : null;
    case 'video-player':
      return request.action === 'render'
        ? { packages: ['expo-video'], permissions: ['expo-video'] }
        : null;
    default:
      return null;
  }
}
