import { File } from "expo-file-system";
import { create } from "zustand";

/** The chat whose composer a request is for: an agent chat, or a channel. */
type ComposerTarget = { serverId: string; agentId: string } | { serverId: string; channelId: string };

/**
 * Text and files that another screen puts into one chat's composer, such as the skill-creation
 * request from Agent info > Skills, a share from another app, or Send to channel on a message. The
 * chat takes it once, when it is mounted and matches.
 */
export type ComposerRequest = ComposerTarget & {
  text: string;
  /** Copies made for this request. The chat reads them as attachments, then deletes them. */
  files?: readonly ComposerFile[];
};

export interface ComposerFile {
  uri: string;
  name: string;
}

/** The chat that asks: an agent chat or a channel, by its id. */
interface ComposerChat {
  kind: "agent" | "channel";
  serverId: string;
  id: string;
}

function isFor(target: ComposerTarget, chat: ComposerChat): boolean {
  if (target.serverId !== chat.serverId) return false;
  return chat.kind === "agent"
    ? "agentId" in target && target.agentId === chat.id
    : "channelId" in target && target.channelId === chat.id;
}

export const useComposerRequest = create<{ request: ComposerRequest | null; focus: ComposerTarget | null }>(() => ({
  request: null,
  focus: null,
}));

export function requestComposerText(request: ComposerRequest): void {
  useComposerRequest.setState({ request });
}

/** Deletes the copies of a request's files after the chat has read them. */
export function deleteComposerFiles(files: readonly ComposerFile[]): void {
  for (const { uri } of files) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // The cache is the system's to clear.
    }
  }
}

/** Removes and returns the request for this chat, or null when it is for another chat. */
export function takeComposerRequest(chat: ComposerChat): ComposerRequest | null {
  const { request } = useComposerRequest.getState();
  if (!request || !isFor(request, chat)) return null;
  useComposerRequest.setState({ request: null });
  return request;
}

/**
 * Asks that chat to focus its composer and show the keyboard. Send it after the screen that
 * sent the text has gone: iOS gives first responder back to the view it came from when a sheet
 * finishes closing, so a focus during the dismissal is lost.
 */
export function requestComposerFocus(target: ComposerTarget): void {
  useComposerRequest.setState({ focus: target });
}

/** Removes a focus request for this chat and tells whether there was one. */
export function takeComposerFocus(chat: ComposerChat): boolean {
  const { focus } = useComposerRequest.getState();
  if (!focus || !isFor(focus, chat)) return false;
  useComposerRequest.setState({ focus: null });
  return true;
}
