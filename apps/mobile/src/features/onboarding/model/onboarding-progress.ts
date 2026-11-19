import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.onboarding.v1";
const MAX_ACCOUNTS = 20;

export const useOnboardingProgress = create<{ ready: boolean; finished: readonly string[] }>(() => ({
  ready: false,
  finished: [],
}));

function decodeOnboardingProgress(stored: string | null): string[] {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function loadOnboardingProgress(): Promise<void> {
  if (useOnboardingProgress.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useOnboardingProgress.getState().ready)
      useOnboardingProgress.setState({ finished: decodeOnboardingProgress(stored) });
  } finally {
    useOnboardingProgress.setState({ ready: true });
  }
}

let writes: Promise<void> = Promise.resolve();

export function finishOnboarding(userId: string): Promise<void> {
  const current = useOnboardingProgress.getState().finished;
  if (current.includes(userId)) return writes;
  const finished = [...current, userId].slice(-MAX_ACCOUNTS);
  useOnboardingProgress.setState({ finished });
  const write = writes.then(() => SecureStore.setItemAsync(key, JSON.stringify(finished)));
  writes = write.catch(() => undefined);
  return writes;
}
