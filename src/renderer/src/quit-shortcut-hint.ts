import { createSignal } from "solid-js";
import { appPort } from "./app-port";

/**
 * Whether the window shows how to quit after one press of `Cmd + Q` on a Mac. A browser tab is a
 * native view over the page, so the conversations hide it while this is true, as for a toast.
 */
const [quitShortcutHintShown, setQuitShortcutHintShown] = createSignal(false);

/** Follows the hint state from main. Returns the unsubscribe. */
export function watchQuitShortcutHint(): () => void {
  return appPort().onQuitShortcutHint((visible) => setQuitShortcutHintShown(visible));
}

export { quitShortcutHintShown };
