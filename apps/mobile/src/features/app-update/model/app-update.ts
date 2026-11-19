import {
  isNewerMobileVersion,
  MOBILE_CHANGELOG_PATH,
  type MobileReleaseNotes,
  parseMobileReleaseNotes,
} from "@openbot/contracts/mobile-features";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Linking } from "react-native";
import { create } from "zustand";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { supportLog } from "@/features/support/model/support-log";
import { devLatestAppVersion } from "@/shared/lib/dev-feature-overrides";
import { currentAppVersion, refreshMobileFeatures, useLatestAppVersion } from "@/shared/lib/mobile-features";
import { isIOS } from "@/shared/lib/platform";

export type AppUpdate = { kind: "ready"; id: string } | { kind: "store"; id: string; version: string };

const IOS_STORE_URL = "itms-apps://apps.apple.com/app/id6807024266";
const IOS_STORE_WEB_URL = "https://apps.apple.com/app/id6807024266";
const ANDROID_STORE_URL = "market://details?id=run.openbot.mobile";
const ANDROID_STORE_WEB_URL = "https://openbot.run/download/android";

export const MOBILE_CHANGELOG_URL = "https://openbot.run/changelog?platform=mobile";
const NOTES_TIMEOUT_MS = 10_000;
const NOTES_STALE_MS = 10 * 60_000;

const key = "openbot.mobile.appUpdate.dismissed.v1";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;
let lastUpdateCheck = Date.now();
let updateCheckRuns = false;

async function checkForDownloadableUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || updateCheckRuns) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  updateCheckRuns = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable || result.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
  } catch (error) {
    supportLog.add("warn", "app", `The update check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updateCheckRuns = false;
  }
}

const useDismissedAppUpdate = create<{ dismissed: string | null; ready: boolean }>(() => ({
  dismissed: null,
  ready: false,
}));

async function loadDismissedAppUpdate(): Promise<void> {
  if (useDismissedAppUpdate.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useDismissedAppUpdate.getState().ready) useDismissedAppUpdate.setState({ dismissed: stored });
  } finally {
    useDismissedAppUpdate.setState({ ready: true });
  }
}

export async function dismissAppUpdate(update: AppUpdate): Promise<void> {
  useDismissedAppUpdate.setState({ dismissed: update.id, ready: true });
  await SecureStore.setItemAsync(key, update.id);
}

let rollbackFetched = false;

async function fetchRollback(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || Updates.isEmbeddedLaunch || rollbackFetched) return;
  rollbackFetched = true;
  try {
    await Updates.fetchUpdateAsync();
  } catch (error) {
    supportLog.add(
      "warn",
      "app",
      `The rollback fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function downloadedUpdateId(update: Updates.UpdateInfo): string {
  return update.type === Updates.UpdateInfoType.NEW
    ? `ota:${update.updateId}`
    : `ota:rollback:${update.createdAt.toISOString()}`;
}

export function useAppUpdate(): AppUpdate | null {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const latest = useLatestAppVersion(apiUrl ?? "");
  const { isUpdatePending, downloadedUpdate, availableUpdate } = Updates.useUpdates();
  const rollbackWaits = availableUpdate?.type === Updates.UpdateInfoType.ROLLBACK && !isUpdatePending;
  const dismissed = useDismissedAppUpdate((state) => (state.ready ? state.dismissed : undefined));

  useEffect(() => {
    void loadDismissedAppUpdate();
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkForDownloadableUpdate();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (rollbackWaits) void fetchRollback();
  }, [rollbackWaits]);
  useEffect(() => {
    if (!apiUrl) return;
    void refreshMobileFeatures(apiUrl);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMobileFeatures(apiUrl);
    });
    return () => subscription.remove();
  }, [apiUrl]);

  if (dismissed === undefined) return null;
  const current = currentAppVersion();
  const update: AppUpdate | null =
    isUpdatePending && downloadedUpdate
      ? { kind: "ready", id: downloadedUpdateId(downloadedUpdate) }
      : latest && current && isNewerMobileVersion(latest, current)
        ? { kind: "store", id: `store:${latest}`, version: latest }
        : null;
  return update && update.id !== dismissed ? update : null;
}

export async function installAppUpdate(update: AppUpdate, reloadColor: string): Promise<void> {
  if (update.kind === "ready") {
    await Updates.reloadAsync({
      reloadScreenOptions: { backgroundColor: reloadColor, fade: true, spinner: { enabled: false } },
    });
    return;
  }
  await openStorePage();
}

export async function openStorePage({ review = false }: { review?: boolean } = {}): Promise<void> {
  const query = review && isIOS ? "?action=write-review" : "";
  const [url, webUrl] = isIOS ? [IOS_STORE_URL, IOS_STORE_WEB_URL] : [ANDROID_STORE_URL, ANDROID_STORE_WEB_URL];
  await Linking.openURL(`${url}${query}`).catch(() => Linking.openURL(`${webUrl}${query}`));
}

async function fetchReleaseNotes(apiUrl: string, after: string | null, signal: AbortSignal) {
  const url = new URL(MOBILE_CHANGELOG_PATH, apiUrl);
  url.searchParams.set("platform", isIOS ? "ios" : "android");
  if (after) url.searchParams.set("after", after);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  const timeout = setTimeout(abort, NOTES_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`The release notes answered ${response.status}.`);
    const notes = parseMobileReleaseNotes(await response.json());
    if (!notes) throw new Error("The release notes could not be read.");
    return notes;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function useAppUpdateNotes(enabled: boolean) {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const after = devLatestAppVersion() ? null : currentAppVersion();
  return useQuery<MobileReleaseNotes[]>({
    queryKey: ["app-update-notes", apiUrl, after],
    enabled: enabled && apiUrl !== null,
    retry: false,
    staleTime: NOTES_STALE_MS,
    queryFn: ({ signal }) => fetchReleaseNotes(apiUrl ?? "", after, signal),
  });
}
