import { createSignal } from "solid-js";

const COMMUNITY_CARD_DISMISSED_STORAGE_KEY = "openbot:community-card-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function createCommunityCardVisibility() {
  const [dismissed, setDismissed] = createSignal(readDismissed());
  return {
    dismissed,
    dismiss: () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY, "true");
      } catch {}
    },
  };
}
