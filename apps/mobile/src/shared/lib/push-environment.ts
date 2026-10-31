import * as Application from "expo-application";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

export type PushEnvironment = "production" | "development";

let environment: Promise<PushEnvironment> | null = null;

/**
 * The APNs environment of the push tokens that this app gets. iOS takes it from `aps-environment` in
 * the provisioning profile that signed the app, not from the build configuration: a Release build that
 * Xcode signs for a device gets tokens of the sandbox, and Apple refuses them in production. An App
 * Store or TestFlight build has no profile in the app, and gets production tokens.
 */
function loadPushEnvironment(): Promise<PushEnvironment> {
  environment ??= readPushEnvironment();
  return environment;
}

/** The APNs environment, or `null` while it loads. Android has no APNs, so it has its value at once. */
export function usePushEnvironment(): PushEnvironment | null {
  const [value, setValue] = useState<PushEnvironment | null>(Platform.OS === "ios" ? null : fallback());
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let current = true;
    void loadPushEnvironment().then((loaded) => {
      if (current) setValue(loaded);
    });
    return () => {
      current = false;
    };
  }, []);
  return value;
}

async function readPushEnvironment(): Promise<PushEnvironment> {
  if (Platform.OS !== "ios") return fallback();
  try {
    // `null` when the app has no profile: an App Store or TestFlight build, or the simulator.
    return (await Application.getIosPushNotificationServiceEnvironmentAsync()) ?? fallback();
  } catch {
    return fallback();
  }
}

function fallback(): PushEnvironment {
  return __DEV__ ? "development" : "production";
}
