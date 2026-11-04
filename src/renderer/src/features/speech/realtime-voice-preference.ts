import { createSignal } from "solid-js";

const PREFIX = "openbot:chatgpt-voice:";
const [choices, setChoices] = createSignal<Record<string, boolean>>({});

/** An account must opt in on this device. Host availability never supplies consent. */
export function realtimeVoiceOptedIn(accountId: string | null | undefined): boolean {
  if (!accountId) return false;
  const cached = choices()[accountId];
  if (cached !== undefined) return cached;
  try {
    return window.localStorage.getItem(PREFIX + accountId) === "true";
  } catch {
    return false;
  }
}

export function setRealtimeVoiceOptIn(accountId: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFIX + accountId, String(enabled));
  } catch {
    // A blocked store keeps consent only in this window.
  }
  setChoices((current) => ({ ...current, [accountId]: enabled }));
}
