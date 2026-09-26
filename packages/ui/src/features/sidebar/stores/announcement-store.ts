/**
 * The sidebar's one live region. Every reorder, move, pin and failure the user cannot see happen
 * announces here, so the store is the sink the rest of the sidebar writes to and reads nothing back.
 */

import { createSignal } from "solid-js";
import { currentText } from "../../../text";

export function createSidebarAnnouncementStore() {
  const [reorderAnnouncement, setReorderAnnouncement] = createSignal("");

  const announce = (message: string): void => {
    setReorderAnnouncement(message);
  };

  /**
   * A rejected layout mutation is what the user hears instead of the move they asked for, so the
   * cause is unwrapped here rather than at each of the seven call sites that used to spell it out.
   */
  const announceError = (cause: unknown): void => {
    const text = currentText();
    setReorderAnnouncement(text.errorMessage(cause, text.t("sidebar.announce.updateFailed")));
  };

  return { announce, announceError, reorderAnnouncement };
}
