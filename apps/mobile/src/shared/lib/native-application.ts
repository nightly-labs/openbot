import { requireOptionalNativeModule } from "expo";

export const nativeApplication: typeof import("expo-application") | null = requireOptionalNativeModule(
  "ExpoApplication",
)
  ? require("expo-application")
  : null;

export function nativeApplicationVersion(): string | null {
  return nativeApplication?.nativeApplicationVersion ?? null;
}

export function nativeBuildVersion(): string | null {
  return nativeApplication?.nativeBuildVersion ?? null;
}
