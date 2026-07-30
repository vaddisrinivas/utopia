import { Linking, Platform } from 'react-native';
import {
  SdkAvailabilityStatus,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  deleteRecordsByUuids,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';

import type { HealthConnectHttpPort, HealthConnectNavigationPort, HealthConnectPlatformPort, HealthConnectPorts, HealthConnectSdkPort, HealthPermission } from '@/src/health/connect.ports';

export const HEALTH_CONNECT_SDK_AVAILABLE = SdkAvailabilityStatus.SDK_AVAILABLE;
export const HEALTH_CONNECT_SDK_UPDATE_REQUIRED = SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED;
export const HEALTH_CONNECT_SDK_UNAVAILABLE = SdkAvailabilityStatus.SDK_UNAVAILABLE;

export const defaultHealthConnectPorts: HealthConnectPorts = {
  platform: {
    isAndroid() {
      return Platform.OS === 'android';
    },
  },
  sdk: {
    getSdkStatus,
    getGrantedPermissions,
    initialize,
    requestPermission(permissions) {
      return requestPermission([...permissions] as Parameters<typeof requestPermission>[0]);
    },
    readRecords(recordType, options) {
      return readRecords(recordType, options);
    },
    insertRecords(records) {
      return insertRecords(records as Parameters<typeof insertRecords>[0]);
    },
    deleteRecordsByUuids(recordType, recordIds, clientRecordIds) {
      return deleteRecordsByUuids(recordType, recordIds, clientRecordIds);
    },
  },
  navigation: {
    async openURL(url) {
      await Linking.openURL(url);
    },
  },
  http: {
    request(input, init) {
      return fetch(input, init);
    },
  },
};

export type { HealthConnectHttpPort, HealthConnectNavigationPort, HealthConnectPlatformPort, HealthConnectSdkPort, HealthPermission };
export type { HealthConnectPorts };
