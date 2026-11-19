import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { writesInOrder } from "@/shared/lib/writes-in-order";

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

const write = writesInOrder(key);
let writes: Promise<void> = Promise.resolve();

export function finishOnboarding(userId: string): Promise<void> {
  const current = useOnboardingProgress.getState().finished;
  if (current.includes(userId)) return writes;
  const finished = [...current, userId].slice(-MAX_ACCOUNTS);
  useOnboardingProgress.setState({ finished });
  writes = write(() => JSON.stringify(finished)).catch(() => undefined);
  return writes;
}
