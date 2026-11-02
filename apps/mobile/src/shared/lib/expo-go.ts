import { isRunningInExpoGo } from "expo";
import { isAndroid } from "@/shared/lib/platform";

/**
 * Expo Go on Android. `isRunningInExpoGo` looks for the native Expo Go module. The execution
 * environment cannot tell Expo Go from a development build: both are `storeClient`. With SDK 58 that
 * check also let `expo-notifications` load in Expo Go on Android, where it throws.
 */
export function expoGoOnAndroid(): boolean {
  return isAndroid && isRunningInExpoGo();
}
