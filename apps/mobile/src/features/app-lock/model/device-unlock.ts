import Constants, { ExecutionEnvironment } from "expo-constants";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { isIOS } from "@/shared/lib/platform";

/** `cancel`: the user closed the prompt. `unavailable`: the phone has no passcode or biometrics. */
export type DeviceUnlockResult = "success" | "cancel" | "unavailable" | "failed";

/** The name of the unlock that the phone offers: Face ID, Touch ID, or the Android unlock. */
export type DeviceUnlockKind = "faceId" | "touchId" | "phone";

export async function deviceUnlockKind(): Promise<DeviceUnlockKind | null> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return null;
    if (!isIOS) return "phone";
    // Expo Go has no Face ID usage text of its own, so iOS offers only the passcode there.
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

/**
 * Class 2 face unlock on Android uses the camera only, and a photo can pass it, so the prompt asks
 * for class 3 biometrics. Android 9 and 10 (API 28 and 29) do not accept class 3 biometrics with the
 * passcode fallback: `BiometricPrompt` throws on the main thread and the app stops. There the prompt
 * accepts class 2 biometrics, so the passcode fallback stays. iOS ignores this option.
 */
function deviceUnlockBiometricsLevel(): "weak" | "strong" {
  return Platform.OS === "android" && Number(Platform.Version) < 30 ? "weak" : "strong";
}

/** The phone's biometrics, with the phone's passcode as the fallback that the system offers. */
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
