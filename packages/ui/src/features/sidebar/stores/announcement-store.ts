import { createSignal } from "solid-js";
import { currentText } from "../../../text";

export function createSidebarAnnouncementStore() {
  const [reorderAnnouncement, setReorderAnnouncement] = createSignal("");

  const announce = (message: string): void => {
    setReorderAnnouncement(message);
  };

  const announceError = (cause: unknown): void => {
    const text = currentText();
    setReorderAnnouncement(text.errorMessage(cause, text.t("sidebar.announce.updateFailed")));
  };

  return { announce, announceError, reorderAnnouncement };
}
