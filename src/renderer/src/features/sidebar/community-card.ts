import { createSignal } from "solid-js";

/** Dismissing the community card is a choice of this computer or browser, like the mobile app card. */
const COMMUNITY_CARD_DISMISSED_STORAGE_KEY = "openbot:community-card-dismissed";

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Whether the sidebar shows the community card, for the desktop sidebar and the web client. */
export function createCommunityCardVisibility() {
  const [dismissed, setDismissed] = createSignal(readDismissed());
  return {
    dismissed,
    dismiss: () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY, "true");
      } catch {
        // The card stays closed for this tab when browser storage is unavailable.
      }
    },
  };
}
