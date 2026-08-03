import { Alert, Linking, Platform } from "react-native";

import {
  requestExternalUrlOpen,
  type ExternalUrlOpenDependencies,
  type ExternalUrlOpenResult,
} from "@/src/domain/external-url-broker";

export type ExternalUrlPlatform = ExternalUrlOpenDependencies;

export function createReactNativeExternalUrlPlatform(): ExternalUrlPlatform {
  return {
    confirm: (url) => {
      if (Platform.OS === "web" && typeof globalThis.confirm === "function") {
        return Promise.resolve(globalThis.confirm(`Open this link?\n${url}`));
      }
      return new Promise((resolve) => {
        Alert.alert("Open link?", url, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Open", onPress: () => resolve(true) },
        ]);
      });
    },
    open: async (url) => {
      if (!(await Linking.canOpenURL(url))) throw new Error("url_not_supported");
      await Linking.openURL(url);
    },
  };
}

export async function openExternalUrl(
  value: unknown,
  platform: ExternalUrlPlatform = createReactNativeExternalUrlPlatform(),
): Promise<ExternalUrlOpenResult> {
  return requestExternalUrlOpen(value, platform);
}
