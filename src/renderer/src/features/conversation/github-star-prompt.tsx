import { toast } from "@openbot/ui";
import { GitHubStarToast } from "@openbot/ui/features/github-star/GitHubStarToast";
import { createSignal } from "solid-js";
import { appPort } from "../../app-port";

const STORAGE_KEY = "openbot:github-star-prompt";
const PROMPTED = "shown";
const SENDS_BEFORE_PROMPT = 3;
const TOAST_ID = "github-star-prompt";

let shownThisSession = false;

export function githubStarPromptShownThisSession(): boolean {
  return shownThisSession;
}

export function noteAgentMessageSent(): void {
  let sent: number;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === PROMPTED) return;
    sent = (Number.parseInt(saved ?? "0", 10) || 0) + 1;
    window.localStorage.setItem(STORAGE_KEY, sent >= SENDS_BEFORE_PROMPT ? PROMPTED : String(sent));
  } catch {
    return;
  }
  if (sent < SENDS_BEFORE_PROMPT) return;
  shownThisSession = true;

  const [thanked, setThanked] = createSignal(false);
  const close = () => toast.dismiss(TOAST_ID);
  const star = () => {
    setThanked(true);
    void appPort().openExternal("github");
  };
  toast(() => <GitHubStarToast thanked={thanked()} onStar={star} onClose={close} />, {
    id: TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    unstyled: true,
    closeButton: false,
    class: "github-star-toast-host",
  });
}
