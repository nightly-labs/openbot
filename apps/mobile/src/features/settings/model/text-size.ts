import { type AppInterfaceSize, isAppInterfaceSize } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { useTextSize } from "./text-size-store";

export { useTextSize } from "./text-size-store";

const key = "openbot.mobile.text-size.v1";

export async function loadTextSize(): Promise<void> {
  if (useTextSize.getState().ready) return;
  try {
    const stored = Number(await SecureStore.getItemAsync(key));
    // A second startup read must not overwrite a change made in Settings.
    if (isAppInterfaceSize(stored) && !useTextSize.getState().ready) useTextSize.setState({ percent: stored });
  } finally {
    useTextSize.setState({ ready: true });
  }
}

export async function saveTextSize(percent: AppInterfaceSize): Promise<void> {
  if (!useTextSize.getState().ready) return;
  // Apply immediately, including when storage fails.
  useTextSize.setState({ percent });
  await SecureStore.setItemAsync(key, String(percent));
}
