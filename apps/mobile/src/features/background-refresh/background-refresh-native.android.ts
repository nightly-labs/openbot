import { requireOptionalNativeModule } from "expo";
import { expoGoOnAndroid } from "@/shared/lib/expo-go";
import type { BackgroundRefreshNative } from "./background-refresh-native.types";

function load(): BackgroundRefreshNative | null {
  if (expoGoOnAndroid() || !requireOptionalNativeModule("ExpoBackgroundTask")) return null;
  const native: typeof import("./android-background-refresh.android") = require("./android-background-refresh.android");
  return native.androidBackgroundRefresh;
}

export const backgroundRefreshNative: BackgroundRefreshNative | null = load();
