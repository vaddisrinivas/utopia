import { defaultHealthConnectPorts } from '../../adapters/health-connect-ports';
import {
  HEALTH_CONNECT_SDK_AVAILABLE,
  HEALTH_CONNECT_SDK_UPDATE_REQUIRED,
  HEALTH_CONNECT_SDK_UNAVAILABLE,
} from '../../adapters/health-connect-ports';

export type HealthPermission = { accessType: 'read' | 'write'; recordType: string };

export interface HealthConnectPlatformPort {
  isAndroid(): boolean;
}

export interface HealthConnectSdkPort {
  getSdkStatus(): Promise<number>;
  getGrantedPermissions(): Promise<HealthPermission[]>;
  initialize(): Promise<boolean>;
  requestPermission(permissions: readonly HealthPermission[]): Promise<unknown>;
  readRecords(
    recordType: 'Nutrition' | 'Hydration' | 'Steps' | 'ActiveCaloriesBurned' | 'Weight',
    options: { timeRangeFilter: { operator: 'between'; startTime: string; endTime: string } },
  ): Promise<{ records?: unknown[] }>;
  insertRecords(records: unknown[]): Promise<string[]>;
  deleteRecordsByUuids(
    recordType: 'Hydration',
    recordIds: string[],
    clientRecordIds: string[],
  ): Promise<void>;
}

export interface HealthConnectNavigationPort {
  openURL(url: string): Promise<void>;
}

export interface HealthConnectHttpPort {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export interface HealthConnectPorts {
  platform: HealthConnectPlatformPort;
  sdk: HealthConnectSdkPort;
  navigation: HealthConnectNavigationPort;
  http: HealthConnectHttpPort;
}

export {
  defaultHealthConnectPorts,
  HEALTH_CONNECT_SDK_AVAILABLE,
  HEALTH_CONNECT_SDK_UPDATE_REQUIRED,
  HEALTH_CONNECT_SDK_UNAVAILABLE,
};
