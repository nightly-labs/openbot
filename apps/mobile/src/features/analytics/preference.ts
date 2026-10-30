import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { mobileAnalytics } from "./mobile-analytics";

const key = "openbot.mobile.analytics.v1";
/** A choice of this phone that the account has not saved yet: JSON `{ enabled, at }`, `at` in ms. */
const accountPendingKey = "openbot.mobile.analytics.account-pending.v1";
/** "true" or "false". Missing: an app from before the account kept answers saved the choice. */
const keepOffKey = "openbot.mobile.analytics.keep-off.v1";
// The longest wait for the opt-out event before tracking stops. The opt-out must not wait for a slow network.
const OPT_OUT_EVENT_LIMIT_MS = 2_000;
export const useAnalyticsPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));
let loading: Promise<void> | null = null;

export function loadAnalyticsPreference(): Promise<void> {
  loading ??= SecureStore.getItemAsync(key)
    .then((stored) => {
      const enabled = stored === null || stored === "true";
      mobileAnalytics.setEnabled(enabled);
      useAnalyticsPreference.setState({ enabled, ready: true });
    })
    .catch(() => {
      // An unreadable preference must not turn tracking on.
      mobileAnalytics.setEnabled(false);
      useAnalyticsPreference.setState({ enabled: false, ready: true });
    });
  return loading;
}

export async function saveAnalyticsPreference(enabled: boolean): Promise<void> {
  if (!useAnalyticsPreference.getState().ready || useAnalyticsPreference.getState().saving) return;
  const wasEnabled = useAnalyticsPreference.getState().enabled;
  useAnalyticsPreference.setState({ saving: true });
  if (!enabled) {
    useAnalyticsPreference.setState({ enabled: false });
    // The opt-out event goes out before the client stops. Nothing else is sent after the choice.
    if (wasEnabled) {
      await mobileAnalytics.sendLast("analytics_preference_changed", { enabled: false }, OPT_OUT_EVENT_LIMIT_MS);
    }
    mobileAnalytics.setEnabled(false);
  }
  try {
    await savePreference(enabled);
    mobileAnalytics.setEnabled(enabled);
    useAnalyticsPreference.setState({ enabled });
    await SecureStore.setItemAsync(accountPendingKey, JSON.stringify({ enabled, at: Date.now() }));
  } finally {
    useAnalyticsPreference.setState({ saving: false });
  }
}

/**
 * True when this phone keeps an "off" that it saved before the account kept answers. An account
 * answer of "on" does not replace it; only a choice on this phone does.
 */
async function keepsOff(): Promise<boolean> {
  try {
    return (
      (await SecureStore.getItemAsync(key)) === "false" && (await SecureStore.getItemAsync(keepOffKey)) !== "false"
    );
  } catch {
    return false;
  }
}

/** A kept "off" stays kept until this phone turns analytics on. */
async function savePreference(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(keepOffKey, String(!enabled && (await keepsOff())));
  await SecureStore.setItemAsync(key, String(enabled));
}

/** Sends a choice to the account with its age in ms, and returns the account's answer. */
export type SendAnalyticsChoice = (enabled: boolean, ageMs: number) => Promise<boolean | null>;

async function readUnsentChoice(): Promise<{ enabled: boolean; at: number } | null> {
  try {
    const stored = JSON.parse((await SecureStore.getItemAsync(accountPendingKey)) ?? "null");
    return isDynamicRecord(stored) && isBoolean(stored.enabled) && isNumber(stored.at)
      ? { enabled: stored.enabled, at: stored.at }
      : null;
  } catch {
    return null;
  }
}

async function followAnswer(answer: boolean): Promise<void> {
  const state = useAnalyticsPreference.getState();
  if (state.saving || answer === state.enabled || (answer && (await keepsOff()))) return;
  await savePreference(answer);
  mobileAnalytics.setEnabled(answer);
  useAnalyticsPreference.setState({ enabled: answer });
}

let sending = false;

/**
 * Sends the choice that the account does not have yet, also a newer one that the user makes during
 * the send. The account keeps a newer answer from another device, and this phone follows it,
 * except for an "on" over a kept "off". A failed send stays marked; the next profile refresh,
 * start, or choice sends it again.
 */
export async function sendAnalyticsChoice(send: SendAnalyticsChoice): Promise<void> {
  // The send in progress reads the latest choice when it ends.
  if (sending) return;
  sending = true;
  try {
    for (let choice = await readUnsentChoice(); choice; choice = await readUnsentChoice()) {
      const account = await send(choice.enabled, Math.max(0, Date.now() - choice.at));
      if ((await readUnsentChoice())?.at !== choice.at) continue;
      await SecureStore.deleteItemAsync(accountPendingKey);
      if (account !== null) await followAnswer(account);
    }
  } finally {
    sending = false;
  }
}

/**
 * Keeps this phone and the account on the user's latest analytics answer. A choice that the account
 * does not have yet goes to it with `send`; otherwise this phone follows the account's answer.
 */
export async function followAccountAnalytics(
  answer: boolean | null | undefined,
  send: SendAnalyticsChoice,
): Promise<void> {
  await loadAnalyticsPreference();
  if (await readUnsentChoice()) return sendAnalyticsChoice(send);
  if (answer !== null && answer !== undefined) await followAnswer(answer);
}
