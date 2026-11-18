import { CHAT_VISUAL_PAGE_LIMIT, chatBackdropPage, chatBackdropRequesters } from "@openbot/contracts/chat-visual";
import type { AttachmentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef } from "react";
import { setAgentBackdrop, useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { useMobileWorkspaceActions } from "@/features/workspace/context/workspace-store";
import { largeDownloadOf } from "../model/large-files";
import { HtmlPage } from "./html-page";

/** The message ids that wait or run now. A second update of the chat does not add them again. */
const pending = new Set<string>();
/** The message ids whose page could not be read or kept. This launch does not fetch them again. */
const failed = new Set<string>();
/** The people who asked for each page that this phone read, so a page for another member is read once. */
const requesters = new Map<string, readonly string[]>();
/** One page goes behind the chats at a time, so an older page cannot replace a newer one. */
let queue: Promise<void> = Promise.resolve();

/** The UTF-8 text of Base64 bytes. Hermes has no `TextDecoder`, so the file system decodes it. */
async function base64Text(base64: string): Promise<string> {
  const file = new File(Paths.cache, "chat-backdrop-incoming.html");
  try {
    await file.write(base64, { encoding: "base64" });
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

/**
 * Puts a new page that the agent of the open chat set with `set_backdrop` behind Home and the chats,
 * as the web client does. The host keeps each page as a chat message, so the phone needs no other
 * event. Only a message newer than the mark counts, and only a page that the reader asked for: on a
 * joined server, members share one agent chat (`chatBackdropRequesters`).
 */
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
  // A page can finish its download after the chat closed. The chat that shows Undo is gone then.
  const chatOpen = useRef(true);
  useEffect(() => {
    chatOpen.current = true;
    return () => {
      chatOpen.current = false;
    };
  }, []);
  useEffect(() => {
    // A build with no web view cannot show a page: the backdrop that the user picked stays.
    if (!ready || !messages || !HtmlPage) return;
    const reader = memberId || null;
    const readerAccount = accountUserId ? `local-user:${accountUserId}` : null;
    const isReader = (id: string) => id === reader || id === readerAccount;
    const mark = useChatBackdrop.getState().mark;
    let newest: { message: ConversationMessage; attachment: AttachmentSummary; time: number } | undefined;
    for (const message of messages) {
      const attachment = chatBackdropPage(message);
      const time = Date.parse(message.createdAt);
      if (!attachment || !(time > mark) || (newest && newest.time >= time)) continue;
      if (attachment.size > CHAT_VISUAL_PAGE_LIMIT) continue;
      if (pending.has(message.id) || failed.has(message.id)) continue;
      if (requesters.get(message.id)?.some(isReader) === false) continue;
      newest = { message, attachment, time };
    }
    if (!newest) return;
    const { message, attachment, time } = newest;
    pending.add(message.id);
    queue = queue.then(async () => {
      try {
        // A newer page went behind the chats first.
        if (useChatBackdrop.getState().mark >= time) return;
        const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment));
        const html = await base64Text(data.base64);
        const askedBy = chatBackdropRequesters(html);
        requesters.set(message.id, askedBy);
        // On a joined server, another member asked for this page. It stays in the chat only.
        if (!askedBy.some(isReader)) return;
        await setAgentBackdrop(
          { serverId, agentId, messageId: message.id, name: message.text, bubbles: null },
          html,
          time,
          { offerUndo: chatOpen.current },
        );
      } catch {
        // A page that cannot be read or kept does not change the backdrop.
        failed.add(message.id);
      } finally {
        pending.delete(message.id);
      }
    });
  }, [ready, messages, memberId, accountUserId, serverId, agentId, downloadAttachment]);
}
