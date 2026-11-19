import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { nativeApplication } from "@/shared/lib/native-application";

export type PushEnvironment = "production" | "development";

let environment: Promise<PushEnvironment> | null = null;

function loadPushEnvironment(): Promise<PushEnvironment> {
  environment ??= readPushEnvironment();
  return environment;
}

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
    return (await nativeApplication?.getIosPushNotificationServiceEnvironmentAsync()) ?? fallback();
  } catch {
    return fallback();
  }
}

function fallback(): PushEnvironment {
  return __DEV__ ? "development" : "production";
}
