import { CHAT_VISUAL_PAGE_LIMIT, chatBackdropChange, chatBackdropRequesters } from "@openbot/contracts/chat-visual";
import type { AttachmentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef } from "react";
import { clearAgentBackdrop, setAgentBackdrop, useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { useMobileWorkspaceActions } from "@/features/workspace/context/workspace-store";
import { largeDownloadOf } from "../model/large-files";
import { HtmlPage } from "./html-page";

const pending = new Set<string>();
const failed = new Set<string>();
const requesters = new Map<string, readonly string[]>();
let queue: Promise<void> = Promise.resolve();

async function base64Text(base64: string): Promise<string> {
  const file = new File(Paths.cache, "chat-backdrop-incoming.html");
  try {
    await file.write(base64, { encoding: "base64" });
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

export function useAgentBackdrops({
  serverId,
  agentId,
  messages,
  memberId,
  accountUserId,
}: {
  serverId: string;
  agentId: string;
  messages: readonly ConversationMessage[] | undefined;
  memberId: string | null;
  accountUserId: string | null;
}): void {
  const { downloadAttachment } = useMobileWorkspaceActions();
  const ready = useChatBackdrop((state) => state.ready);
  const chatOpen = useRef(true);
  useEffect(() => {
    chatOpen.current = true;
    return () => {
      chatOpen.current = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || !messages || !HtmlPage) return;
    const reader = memberId || null;
    const readerAccount = accountUserId ? `local-user:${accountUserId}` : null;
    const isReader = (id: string) => id === reader || id === readerAccount;
    const mark = useChatBackdrop.getState().mark;
    let newest:
      | { message: ConversationMessage; attachment: AttachmentSummary; clear: boolean; time: number }
      | undefined;
    for (const message of messages) {
      const change = chatBackdropChange(message);
      const time = Date.parse(message.createdAt);
      if (!change || !(time > mark) || (newest && newest.time >= time)) continue;
      if (change.attachment.size > CHAT_VISUAL_PAGE_LIMIT) continue;
      if (pending.has(message.id) || failed.has(message.id)) continue;
      if (requesters.get(message.id)?.some(isReader) === false) continue;
      newest = { message, ...change, time };
    }
    if (!newest) return;
    const { message, attachment, clear, time } = newest;
    pending.add(message.id);
    queue = queue.then(async () => {
      try {
        if (useChatBackdrop.getState().mark >= time) return;
        const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment));
        const html = await base64Text(data.base64);
        const askedBy = chatBackdropRequesters(html);
        requesters.set(message.id, askedBy);
        if (!askedBy.some(isReader)) return;
        if (clear) {
          await clearAgentBackdrop({ serverId, agentId, messageId: message.id }, time, { offerUndo: chatOpen.current });
          return;
        }
        await setAgentBackdrop(
          { serverId, agentId, messageId: message.id, name: message.text, bubbles: null },
          html,
          time,
          { offerUndo: chatOpen.current },
        );
      } catch {
        failed.add(message.id);
      } finally {
        pending.delete(message.id);
      }
    });
  }, [ready, messages, memberId, accountUserId, serverId, agentId, downloadAttachment]);
}
