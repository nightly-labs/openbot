import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import type { ComposerContextMeter } from "../components/composer-context-ring";
import type { ChatAttachment, ChatAttachments } from "../components/use-chat-attachments";

export interface AttachSheetRequest {
  attachments: ChatAttachments;
  context?: ComposerContextMeter;
  onSendPhoto: (photo: ChatAttachment) => void;
  onUseSkill?: () => void;
}

let current: AttachSheetRequest | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openAttachSheet(request: AttachSheetRequest) {
  current = request;
  for (const listener of listeners) listener();
  router.push("/attach");
}

export function releaseAttachSheet(request: AttachSheetRequest | null) {
  if (current !== request) return;
  current = null;
  for (const listener of listeners) listener();
}

export function useAttachSheetRequest(): AttachSheetRequest | null {
  return useSyncExternalStore(subscribe, () => current);
}
