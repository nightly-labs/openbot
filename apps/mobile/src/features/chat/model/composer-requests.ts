import { File } from "expo-file-system";
import { create } from "zustand";

type ComposerTarget = { serverId: string; agentId: string } | { serverId: string; channelId: string };

export type ComposerRequest = ComposerTarget & {
  text: string;
  files?: readonly ComposerFile[];
};

export interface ComposerFile {
  uri: string;
  name: string;
}

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

export function deleteComposerFiles(files: readonly ComposerFile[]): void {
  for (const { uri } of files) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {}
  }
}

export function takeComposerRequest(chat: ComposerChat): ComposerRequest | null {
  const { request } = useComposerRequest.getState();
  if (!request || !isFor(request, chat)) return null;
  useComposerRequest.setState({ request: null });
  return request;
}

export function requestComposerFocus(target: ComposerTarget): void {
  useComposerRequest.setState({ focus: target });
}

export function takeComposerFocus(chat: ComposerChat): boolean {
  const { focus } = useComposerRequest.getState();
  if (!focus || !isFor(focus, chat)) return false;
  useComposerRequest.setState({ focus: null });
  return true;
}
