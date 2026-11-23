import Constants, { ExecutionEnvironment } from "expo-constants";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { isIOS } from "@/shared/lib/platform";

export type DeviceUnlockResult = "success" | "cancel" | "unavailable" | "failed";

export type DeviceUnlockKind = "faceId" | "touchId" | "phone";

export async function deviceUnlockKind(): Promise<DeviceUnlockKind | null> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return null;
    if (!isIOS) return "phone";
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return "phone";
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (enrolled && types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "faceId";
    if (enrolled && types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "touchId";
    return "phone";
  } catch {
    return null;
  }
}

function deviceUnlockBiometricsLevel(): "weak" | "strong" {
  return Platform.OS === "android" && Number(Platform.Version) < 30 ? "weak" : "strong";
}

export async function authenticateWithDevice(promptMessage: string, cancelLabel: string): Promise<DeviceUnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
      biometricsSecurityLevel: deviceUnlockBiometricsLevel(),
    });
    if (result.success) return "success";
    switch (result.error) {
      case "user_cancel":
      case "app_cancel":
      case "system_cancel":
        return "cancel";
      case "not_enrolled":
      case "not_available":
      case "passcode_not_set":
        return "unavailable";
      default:
        return "failed";
    }
  } catch {
    return "failed";
  }
}
