import { useEffect, useRef } from "react";
import { Keyboard } from "react-native";
import { type AttachSheetRequest, openAttachSheet } from "../model/attach-sheet";
import type { ChatAttachments } from "./use-chat-attachments";

export function useAttachSheet(
  attachments: ChatAttachments,
  request: Omit<AttachSheetRequest, "attachments">,
  enabled: boolean,
) {
  const latest = useRef(request);
  latest.current = request;
  const requested = attachments.menuAnchor !== null;
  useEffect(() => {
    if (!requested) return;
    attachments.closeMenu();
    if (!enabled) return;
    Keyboard.dismiss();
    openAttachSheet({ attachments, ...latest.current });
  }, [requested, attachments, enabled]);
}
