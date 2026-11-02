import { toast } from "@openbot/ui";
import { GitHubStarToast } from "@openbot/ui/features/github-star/GitHubStarToast";
import { createSignal } from "solid-js";
import { appPort } from "../../app-port";

const STORAGE_KEY = "openbot:github-star-prompt";
const PROMPTED = "shown";
const SENDS_BEFORE_PROMPT = 3;
const TOAST_ID = "github-star-prompt";

/**
 * Count one message that the user sent to an agent on this device. The third one asks for a star on
 * GitHub, one time only. The toast has no timer: it stays until the user answers or closes it.
 * Blocked storage counts nothing, so a user never gets the question on each start.
 */
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

  // Sonner renders the content more than once, so the answer lives here and not in the toast.
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
