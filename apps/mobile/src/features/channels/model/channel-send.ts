import type { ChannelCommand, ChannelMember } from "@openbot/contracts/ipc";
import type { ChatAttachment } from "@/features/chat/components/use-chat-attachments";
import type { ChatHistoryReceipt } from "../../chat/model/chat-messages";
import { channelRecipient } from "./channel-draft";
import { ChannelHistoryRefreshError, type MobileChannelStore } from "./channel-store";

type SendCommand = Extract<ChannelCommand, { type: "send" }>;
type UploadControl = {
  cancelled: () => boolean;
  progress: (completed: number) => void;
  fileProgress?: (fraction: number) => void;
};

/** Retain uploads and the operation ID when delivery is uncertain. */
export class ChannelSend {
  private activeSends = 0;
  private disposed = false;
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
    upload?: UploadControl,
  ): Promise<ChatHistoryReceipt | null> {
    this.activeSends++;
    try {
      return await this.performSend(text, files, replyToMessageId, members, upload);
    } finally {
      this.activeSends--;
      if (this.disposed) this.dispose();
    }
  }

  private async performSend(
    text: string,
    files: ChatAttachment[],
    replyToMessageId: string | null,
    members: ChannelMember[],
    upload?: UploadControl,
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
    upload?.progress(0);
    for (const file of files) {
      let id = this.uploaded.get(file.id);
      if (!id) {
        // Finished uploads stay retained, so a send after a cancellation reuses them.
        if (upload?.cancelled()) throw new Error("Attachment upload cancelled.");
        upload?.fileProgress?.(0);
        id = (await this.store.upload(this.serverId, file, upload?.fileProgress)).id;
        this.uploaded.set(file.id, id);
      }
      ids.push(id);
      upload?.progress(ids.length);
    }
    if (upload?.cancelled()) throw new Error("Attachment upload cancelled.");
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
    this.disposed = true;
    if (this.activeSends) return;
    for (const [key, id] of this.uploaded) {
      if (!this.failed?.attachmentDraftIds.includes(id)) {
        this.uploaded.delete(key);
        void this.store.discard(this.serverId, id).catch(() => undefined);
      }
    }
  }
}
