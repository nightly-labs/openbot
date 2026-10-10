import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isConversationMessageVisible } from "@openbot/contracts/ipc";
import type { DatabaseCore } from "./database-core";
import { databaseRow, requiredNumberColumn, requiredStringColumn } from "./database-rows";
import { currentConversationMessage } from "./legacy-conversation-message";
import { type MailboxDeliveryRecord, MailboxProjection } from "./mailbox-projection";

/** Trusted evidence exists only during the exact host queue operation that captured it. */
export interface ConversationReveal {
  former: ConversationMessage;
  recipientAgentId: string;
  current: MailboxDeliveryRecord;
}

export type ConversationWriteSource = "live" | "reconcile" | "preserve";

/**
 * Owns local visibility epochs, prepared before the writer serializes event payloads. The caller
 * supplies live provenance; imports preserve durable values only. Reconciliation can record an
 * existing hidden-to-visible transition, but only an explicit live identity can mark a new row.
 * Never imports the database facade or changes transaction ownership in a nested write.
 */
export class ConversationVisibility {
  readonly #core: DatabaseCore;

  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  transaction<T>(write: () => T): T {
    const db = this.#core.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  prepare(
    threadId: string,
    messages: readonly ConversationMessage[],
    source: ConversationWriteSource,
    merge?: (previous: ConversationMessage, incoming: ConversationMessage) => ConversationMessage,
    liveMessageIds: readonly string[] = [],
    reveals: readonly ConversationReveal[] = [],
  ): ConversationMessage[] {
    const db = this.#core.connection;
    if (!db.isTransaction) throw new Error("Conversation visibility preparation requires a transaction.");
    const thread = databaseRow(
      db.prepare("SELECT last_event_sequence FROM projection_threads WHERE thread_id = ?").get(threadId),
    );
    const watermark = (thread ? requiredNumberColumn(thread, "last_event_sequence") : 0) + 1;
    const find = db.prepare(
      "SELECT message_json FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?",
    );
    const liveIds = new Set(liveMessageIds);
    return messages.map((message) => {
      const writeSource = liveIds.has(message.id) ? "live" : source;
      const row = databaseRow(find.get(threadId, message.id));
      const previous = row ? currentConversationMessage(JSON.parse(requiredStringColumn(row, "message_json"))) : null;
      const proof = row ? undefined : reveals.find((candidate) => candidate.former.id === message.id);
      const durable = proof
        ? new MailboxProjection({ core: this.#core }).readDeliveryRecord(message.id, proof.recipientAgentId)
        : null;
      const threadOwner = proof
        ? databaseRow(db.prepare("SELECT agent_id FROM projection_threads WHERE thread_id = ?").get(threadId))
        : null;
      const revealed =
        proof !== undefined &&
        threadOwner !== null &&
        requiredStringColumn(threadOwner, "agent_id") === proof.recipientAgentId &&
        durable?.revision === proof.current.revision &&
        durable.messageJson === proof.current.messageJson &&
        durable.deliveryJson === proof.current.deliveryJson &&
        proof.former.delivery?.id === message.delivery?.id &&
        message.delivery?.status === "starting" &&
        proof.former.author === message.author &&
        proof.former.createdAt === message.createdAt &&
        proof.former.text === message.text &&
        !isConversationMessageVisible(proof.former);
      const prepared = structuredClone(previous && merge ? merge(previous, message) : message);
      // Providers, imported history, and cached callers cannot assign or replace host provenance.
      delete prepared.visibilityEpoch;
      delete prepared.visibilityKind;
      if (previous?.visibilityEpoch !== undefined) {
        prepared.visibilityEpoch = previous.visibilityEpoch;
        if (previous.visibilityKind !== undefined) prepared.visibilityKind = previous.visibilityKind;
      }
      if (
        writeSource === "preserve" &&
        previous &&
        !isConversationMessageVisible(previous) &&
        isConversationMessageVisible(prepared)
      ) {
        delete prepared.visibilityEpoch;
        delete prepared.visibilityKind;
      }
      if (
        writeSource !== "preserve" &&
        isConversationMessageVisible(prepared) &&
        ((!row && (writeSource === "live" || revealed)) ||
          (previous !== null && !isConversationMessageVisible(previous)))
      ) {
        prepared.visibilityEpoch = watermark;
        prepared.visibilityKind = previous || revealed ? "revealed" : "created";
      }
      return prepared;
    });
  }
}
