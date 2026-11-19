import { requireOptionalNativeModule } from "expo";

/**
 * `expo-application`, or null when this app build has no `ExpoApplication` native module. Expo Go on
 * Android has none, and `expo-application` requires the module when it loads, so import it only here.
 */
export const nativeApplication: typeof import("expo-application") | null = requireOptionalNativeModule(
  "ExpoApplication",
)
  ? require("expo-application")
  : null;

/** The native version of the app, or null when the build has no `ExpoApplication` module. */
export function nativeApplicationVersion(): string | null {
  return nativeApplication?.nativeApplicationVersion ?? null;
}

/** The native build number of the app, or null when the build has no `ExpoApplication` module. */
export function nativeBuildVersion(): string | null {
  return nativeApplication?.nativeBuildVersion ?? null;
}
