import { AppState, Linking } from "react-native";
import { hasIncomingShare } from "./incoming-share";
import { isIncomingShareLink } from "./share-link";
import { endShareSheetRequest, openShareSheet, releaseShareSheet } from "./share-sheet-opener";

/**
 * Opens the share sheet for each share that Android gives the signed-in app. The share link opens
 * `/incoming-share`, but the sheet does not depend on that route: the stack also looks for a share
 * when it mounts, on the link event, and when the app comes back, as `useIncomingShare` of
 * expo-sharing does. `openShareSheet` opens one sheet for one share.
 *
 * @returns A function that stops the watch.
 */
export function watchAndroidShares(): () => void {
  const openWaitingShare = () => {
    if (hasIncomingShare()) openShareSheet();
  };
  openWaitingShare();
  const link = Linking.addEventListener("url", ({ url }: { url: string }) => {
    if (isIncomingShareLink(url)) openWaitingShare();
  });
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") openWaitingShare();
    // A sheet that did not open, as behind the app lock, does not stop the next share.
    else if (state === "background") {
      endShareSheetRequest();
      releaseShareSheet();
    }
  });
  return () => {
    link.remove();
    appState.remove();
  };
}
