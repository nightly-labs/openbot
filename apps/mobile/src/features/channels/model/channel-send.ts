import type { ChannelCommand, ChannelMember } from "@openbot/contracts/ipc";
import type { ChatAttachment } from "@/features/chat/components/use-chat-attachments";
import type { ChatHistoryReceipt } from "../../chat/model/chat-messages";
import { channelRecipient } from "./channel-draft";
import { ChannelHistoryRefreshError, type MobileChannelStore } from "./channel-store";

type SendCommand = Extract<ChannelCommand, { type: "send" }>;

/** Retain uploads and the operation ID when delivery is uncertain. */
export class ChannelSend {
  private failed: SendCommand | null = null;
  private uploaded = new Map<string, string>();
  constructor(
    private store: MobileChannelStore,
    private serverId: string,
    private channelId: string,
    private operationId: () => string,
  ) {}

  async send(
    text: string,
    files: ChatAttachment[],
    replyToMessageId: string | null,
    members: ChannelMember[],
  ): Promise<ChatHistoryReceipt | null> {
    const recipientAgentId = channelRecipient(text, members);
    const previous = this.failed;
    const sameOperation =
      previous &&
      previous.text === text &&
      previous.replyToMessageId === replyToMessageId &&
      previous.recipientAgentId === recipientAgentId &&
      previous.attachmentDraftIds.length === files.length &&
      files.every((file, index) => this.uploaded.get(file.id) === previous.attachmentDraftIds[index]);
    if (previous && !sameOperation) {
      // The host may have consumed these drafts before the old response was lost.
      for (const [key, id] of this.uploaded) {
        if (previous.attachmentDraftIds.includes(id)) this.uploaded.delete(key);
      }
      this.failed = null;
    }
    const ids: string[] = [];
    for (const file of files) {
      let id = this.uploaded.get(file.id);
      if (!id) {
        id = (await this.store.upload(this.serverId, file)).id;
        this.uploaded.set(file.id, id);
      }
      ids.push(id);
    }
    const command: SendCommand = {
      type: "send",
      channelId: this.channelId,
      operationId: sameOperation ? previous.operationId : this.operationId(),
      text,
      recipientAgentId,
      replyToMessageId,
      attachmentDraftIds: ids,
    };
    this.failed = command;
    let historyPending = false;
    try {
      await this.store.command(this.serverId, command, { waitForRefresh: true });
    } catch (error) {
      if (!(error instanceof ChannelHistoryRefreshError)) throw error;
      historyPending = true;
    }
    this.failed = null;
    for (const [key, id] of this.uploaded) {
      this.uploaded.delete(key);
      if (!ids.includes(id)) void this.store.discard(this.serverId, id).catch(() => undefined);
    }
    return historyPending ? { refreshHistory: () => this.store.refreshHistory(this.serverId, this.channelId) } : null;
  }

  dispose() {
    for (const id of this.uploaded.values()) {
      if (!this.failed?.attachmentDraftIds.includes(id))
        void this.store.discard(this.serverId, id).catch(() => undefined);
    }
  }
}
