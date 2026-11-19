import { AppState, Linking } from "react-native";
import { hasIncomingShare } from "./incoming-share";
import { isIncomingShareLink } from "./share-link";
import { endShareSheetRequest, openShareSheet, releaseShareSheet } from "./share-sheet-opener";

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
