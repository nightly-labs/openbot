import * as SecureStore from "expo-secure-store";
import { writesInOrder } from "@/shared/lib/writes-in-order";
import {
  decodeMotionPreferences,
  MOTION_PREFERENCE_NAMES,
  type MotionPreference,
  useMotionPreferences,
} from "./motion";

const key = "openbot.mobile.motion.v1";

function storedValue(): string {
  const state = useMotionPreferences.getState();
  return JSON.stringify(Object.fromEntries(MOTION_PREFERENCE_NAMES.map((name) => [name, state[name]])));
}

export async function loadMotionPreferences(): Promise<void> {
  if (useMotionPreferences.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useMotionPreferences.getState().ready) useMotionPreferences.setState(decodeMotionPreferences(stored));
  } finally {
    useMotionPreferences.setState({ ready: true });
  }
}

const write = writesInOrder(key);

export function saveMotionPreference(name: MotionPreference, enabled: boolean): Promise<void> {
  if (!useMotionPreferences.getState().ready) return Promise.resolve();
  // Apply immediately, including when storage fails. Settings shows the failure.
  useMotionPreferences.setState({ [name]: enabled });
  return write(storedValue);
}
