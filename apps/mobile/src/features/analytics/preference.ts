import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { currentAnalyticsInstallId, newAnalyticsInstallId } from "@openbot/telemetry";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { mobileAnalytics } from "./mobile-analytics";

const key = "openbot.mobile.analytics.v1";
const accountPendingKey = "openbot.mobile.analytics.account-pending.v1";
const keepOffKey = "openbot.mobile.analytics.keep-off.v1";
const installIdKey = "openbot.mobile.analytics.install-id.v1";
const OPT_OUT_EVENT_LIMIT_MS = 2_000;
export const useAnalyticsPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));
let loading: Promise<void> | null = null;

async function readInstallId(): Promise<string | null> {
  const now = Date.now();
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(installIdKey);
  } catch {
    return null;
  }
  try {
    const current = currentAnalyticsInstallId(JSON.parse(stored ?? "null"), now);
    if (current) return current.id;
  } catch {}
  const created = newAnalyticsInstallId(randomUUID(), now);
  try {
    await SecureStore.setItemAsync(installIdKey, JSON.stringify(created));
    return created.id;
  } catch {
    return null;
  }
}

export function loadAnalyticsPreference(): Promise<void> {
  loading ??= readInstallId()
    .then((installId) => mobileAnalytics.setInstallId(installId))
    .then(() => SecureStore.getItemAsync(key))
    .then((stored) => {
      const enabled = stored === null || stored === "true";
      mobileAnalytics.setEnabled(enabled);
      useAnalyticsPreference.setState({ enabled, ready: true });
    })
    .catch(() => {
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
    if (wasEnabled) {
      await mobileAnalytics.sendLast("analytics_preference_changed", { enabled: false }, OPT_OUT_EVENT_LIMIT_MS);
    }
    mobileAnalytics.setEnabled(false);
  }
  try {
    await savePreference(enabled, await keepsOff());
    mobileAnalytics.setEnabled(enabled);
    useAnalyticsPreference.setState({ enabled });
    await SecureStore.setItemAsync(accountPendingKey, JSON.stringify({ enabled, at: Date.now() }));
  } finally {
    useAnalyticsPreference.setState({ saving: false });
  }
}

async function keepsOff(): Promise<boolean> {
  try {
    return (
      (await SecureStore.getItemAsync(key)) === "false" && (await SecureStore.getItemAsync(keepOffKey)) !== "false"
    );
  } catch {
    return true;
  }
}

async function savePreference(enabled: boolean, keepOff: boolean): Promise<void> {
  await SecureStore.setItemAsync(key, String(enabled));
  await SecureStore.setItemAsync(keepOffKey, String(!enabled && keepOff));
}

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
  if (state.saving || answer === state.enabled) return;
  const keepOff = await keepsOff();
  if ((answer && keepOff) || useAnalyticsPreference.getState().saving) return;
  await savePreference(answer, keepOff);
  mobileAnalytics.setEnabled(answer);
  useAnalyticsPreference.setState({ enabled: answer });
}

let sending = false;

export async function sendAnalyticsChoice(send: SendAnalyticsChoice): Promise<void> {
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

export async function followAccountAnalytics(
  answer: boolean | null | undefined,
  send: SendAnalyticsChoice,
): Promise<void> {
  await loadAnalyticsPreference();
  if (await readUnsentChoice()) return sendAnalyticsChoice(send);
  if (answer !== null && answer !== undefined) await followAnswer(answer);
}
