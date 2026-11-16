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

/**
 * An update the app can offer. `ready` is an over-the-air bundle that `expo-updates` has already
 * downloaded, or a downloaded instruction to go back to the bundle of the binary: a restart installs
 * it without the store. `store` is a newer native version, which only
 * the store can install.
 */
export type AppUpdate = { kind: "ready"; id: string } | { kind: "store"; id: string; version: string };

// The store pages of the app. The web pages are the fallback when the store app does not open.
const IOS_STORE_URL = "itms-apps://apps.apple.com/app/id6807024266";
const IOS_STORE_WEB_URL = "https://apps.apple.com/app/id6807024266";
const ANDROID_STORE_URL = "market://details?id=run.openbot.mobile";
// A phone with no Google Play has the app from the APK. The download page has the APK and the
// Google Play link, so it is the fallback for each of the two.
const ANDROID_STORE_WEB_URL = "https://openbot.run/download/android";

/** The public changelog, for when the notes cannot load. */
export const MOBILE_CHANGELOG_URL = "https://openbot.run/changelog?platform=mobile";
const NOTES_TIMEOUT_MS = 10_000;
// The notes of a version do not change after the store has it.
const NOTES_STALE_MS = 10 * 60_000;

const key = "openbot.mobile.appUpdate.dismissed.v1";

// `expo-updates` asks the update server only at a cold start, and a phone can keep the app in memory
// for days. So the app asks again when it comes back to the foreground, at most this often. The
// cold start counts as a check, so a return to the app in the first 15 minutes asks nothing.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;
// The cold start of this process asked already.
let lastUpdateCheck = Date.now();
let updateCheckRuns = false;

/**
 * Asks the update server for a newer bundle, or for the instruction to go back to the bundle of the
 * binary, and downloads it. `Updates.useUpdates` reports the download, and the home header then
 * offers the restart. A development build and Expo Go have no update server.
 */
async function checkForDownloadableUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || updateCheckRuns) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  updateCheckRuns = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable || result.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
  } catch (error) {
    // The phone is offline, or the server did not answer. The next return to the app tries again.
    supportLog.add("warn", "app", `The update check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updateCheckRuns = false;
  }
}

/** The update that the user put off with Later. A newer update shows again. */
const useDismissedAppUpdate = create<{ dismissed: string | null; ready: boolean }>(() => ({
  dismissed: null,
  ready: false,
}));

async function loadDismissedAppUpdate(): Promise<void> {
  if (useDismissedAppUpdate.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a Later from this session.
    if (!useDismissedAppUpdate.getState().ready) useDismissedAppUpdate.setState({ dismissed: stored });
  } finally {
    useDismissedAppUpdate.setState({ ready: true });
  }
}

/** Hides `update` until a newer one comes. The header hides at once, also when storage fails. */
export async function dismissAppUpdate(update: AppUpdate): Promise<void> {
  useDismissedAppUpdate.setState({ dismissed: update.id, ready: true });
  await SecureStore.setItemAsync(key, update.id);
}

let rollbackFetched = false;

/**
 * Marks a rollback that the cold start found as ready. At a cold start, `expo-updates` takes the
 * instruction to go back to the bundle of the binary and uses it at the next start, but on Android
 * it reports no pending update, so the header did not show. Only a fetch that the app starts reports
 * the rollback as pending, on both platforms. It runs one time in each process.
 */
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

/**
 * The ID of a downloaded bundle. A rollback has no bundle of its own: it sends the app back to the
 * bundle of its binary, and the restart installs that in the same way.
 */
function downloadedUpdateId(update: Updates.UpdateInfo): string {
  return update.type === Updates.UpdateInfoType.NEW
    ? `ota:${update.updateId}`
    : `ota:rollback:${update.createdAt.toISOString()}`;
}

/**
 * The update to offer on home, or null. A downloaded bundle comes first, because it installs in
 * place. The account server names the newest store version; it reads again when the app comes back
 * to the foreground, at most once a minute.
 */
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

  // Until the stored Later is read, nothing shows, so a dismissed header does not flash.
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

/**
 * Installs `update`. A downloaded bundle restarts the app in place, behind a reload screen in the
 * color of the splash. A store version opens the store page; Apple does not let an app install a
 * new native version itself.
 */
export async function installAppUpdate(update: AppUpdate, reloadColor: string): Promise<void> {
  if (update.kind === "ready") {
    await Updates.reloadAsync({
      reloadScreenOptions: { backgroundColor: reloadColor, fade: true, spinner: { enabled: false } },
    });
    return;
  }
  const [url, webUrl] = isIOS ? [IOS_STORE_URL, IOS_STORE_WEB_URL] : [ANDROID_STORE_URL, ANDROID_STORE_WEB_URL];
  await Linking.openURL(url).catch(() => Linking.openURL(webUrl));
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

/**
 * The release notes of the store versions after the running one, newest first. They load when the
 * user opens What's new, from the account server, which reads the mobile changelog.
 */
export function useAppUpdateNotes(enabled: boolean) {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  // With the development override there is no newer version, so a development build reads every
  // released version instead.
  const after = devLatestAppVersion() ? null : currentAppVersion();
  return useQuery<MobileReleaseNotes[]>({
    queryKey: ["app-update-notes", apiUrl, after],
    enabled: enabled && apiUrl !== null,
    retry: false,
    staleTime: NOTES_STALE_MS,
    queryFn: ({ signal }) => fetchReleaseNotes(apiUrl ?? "", after, signal),
  });
}
