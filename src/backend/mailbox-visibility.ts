import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isConversationMessageVisible } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { ConversationReveal } from "./database/conversation-visibility";
import type { MailboxDeliveryRecord } from "./database/mailbox-projection";
import type { OpenBotDatabase } from "./openbot-database";

export interface HiddenMailboxDelivery {
  former: ConversationMessage;
  record: MailboxDeliveryRecord;
  recipientAgentId: string;
}

/** Owns operation-scoped durable visibility evidence; no retained map or mutable mailbox source. */
export class MailboxVisibility {
  readonly #database: Pick<OpenBotDatabase, "readMailboxDeliveryRecord">;

  constructor(database: Pick<OpenBotDatabase, "readMailboxDeliveryRecord">) {
    this.#database = database;
  }

  capture(
    deliveryId: string,
    recipientAgentId: string,
    project: (record: MailboxDeliveryRecord) => ConversationMessage | null,
  ): HiddenMailboxDelivery | null {
    const record = this.#database.readMailboxDeliveryRecord(deliveryId, recipientAgentId);
    if (!record) return null;
    const former = project(record);
    return former && !isConversationMessageVisible(former)
      ? { former: structuredClone(former), record, recipientAgentId }
      : null;
  }

  complete(former: HiddenMailboxDelivery, turnId: string | null): ConversationReveal | null {
    const current = this.#database.readMailboxDeliveryRecord(former.former.id, former.recipientAgentId);
    if (!current || current.revision <= former.record.revision || current.messageJson !== former.record.messageJson)
      return null;
    const delivery = JSON.parse(current.deliveryJson);
    const before = JSON.parse(former.record.deliveryJson);
    if (
      !isDynamicRecord(delivery) ||
      !isDynamicRecord(before) ||
      delivery.id !== before.id ||
      delivery.messageId !== before.messageId ||
      delivery.recipientAgentId !== before.recipientAgentId ||
      delivery.status !== "starting" ||
      delivery.turnId !== turnId
    )
      return null;
    return { former: former.former, recipientAgentId: former.recipientAgentId, current: structuredClone(current) };
  }
}
