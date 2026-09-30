import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type DatabaseCore, deleteOrphanReceipts } from "./database-core";
import { databaseRow, databaseRows, requiredStringColumn } from "./database-rows";

interface MailboxProjectionAttachment {
  id: string;
  name: string;
  path: string;
}

interface MailboxProjectionMessage {
  id: string;
  sender: {
    kind: string;
    agentId?: string;
    routineId?: string;
    runId?: string;
    routineName?: string;
    scheduledFor?: string;
  };
  text: string;
  replyToMessageId: string | null;
  createdAt: string;
  attachments: MailboxProjectionAttachment[];
}

interface MailboxProjectionDelivery {
  id: string;
  messageId: string;
  recipientAgentId: string;
  status: string;
  turnId: string | null;
  error: string | null;
  createdAt: string;
}

interface MailboxProjectionDraft extends MailboxProjectionAttachment {
  createdAt: string;
}

interface MailboxProjectionGeneratedAttachment extends MailboxProjectionAttachment {
  size: number;
  kind: string;
  mimeType: string;
  previewKind: string;
  previewUrl: string | null;
  sha256: string;
}

interface MailboxProjectionReaction {
  agentId: string;
  messageId: string;
  emoji: string;
  actor: { kind: "user" } | { kind: "agent"; agentId: string };
  updatedAt: string;
}

export interface MailboxProjectionState {
  messages: MailboxProjectionMessage[];
  deliveries: MailboxProjectionDelivery[];
  drafts: MailboxProjectionDraft[];
  generatedAttachments: MailboxProjectionGeneratedAttachment[];
  pausedAgentIds: string[];
  idempotency: Record<string, string>;
  reactions: MailboxProjectionReaction[];
}

/** The queue-state row that holds the idempotency keys. */
const MAILBOX_METADATA_ROW = "__mailbox__";

export interface MailboxProjectionOptions {
  core: DatabaseCore;
}

/**
 * The mailbox read model: messages, deliveries, drafts, generated attachments, reactions, per-agent
 * queue state, and the outbox of files still to be deleted from disk.
 *
 * Owns `projection_mailbox_messages`, `projection_deliveries`, `projection_queue_state`,
 * `projection_attachments`, `projection_reactions` and `file_deletion_outbox`. Unlike every other
 * projection here, each write receives the whole mailbox state. It deletes the rows that the state
 * no longer has and writes only the rows that are new or changed, because finished deliveries stay
 * as chat history and a full rewrite grew with them. Each write compacts the `mailbox` aggregate down
 * to its newest event, and that event records only counts, not the state.
 * The class never imports the facade.
 */
export class MailboxProjection {
  readonly #core: DatabaseCore;

  constructor(options: MailboxProjectionOptions) {
    this.#core = options.core;
  }

  replaceMailboxState(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[] = [],
    _rebaseHistory = false,
  ): void {
    this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "mailbox",
          aggregateId: "mailbox",
          eventType,
          // The rows hold the state. A copy of all of it here made each write grow with the history.
          payload: { messages: state.messages.length, deliveries: state.deliveries.length },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `DELETE FROM orchestration_events
           WHERE aggregate_type = 'mailbox' AND aggregate_id = 'mailbox' AND sequence < ?`,
        ).run(sequence);
        deleteOrphanReceipts(db);
        const value = state;
        const attachments = mailboxAttachmentRows(value);
        // Deliveries go before their messages, as in the full rewrite this replaced, so no row
        // depends on the cascade of the foreign key.
        deleteRowsNotIn(
          db,
          "projection_deliveries",
          ["delivery_id"],
          new Set(value.deliveries.map((delivery) => rowKey([String(delivery.id)]))),
        );
        deleteRowsNotIn(
          db,
          "projection_mailbox_messages",
          ["message_id"],
          new Set(value.messages.map((message) => rowKey([String(message.id)]))),
        );
        deleteRowsNotIn(
          db,
          "projection_queue_state",
          ["agent_id"],
          new Set([MAILBOX_METADATA_ROW, ...value.pausedAgentIds].map((agentId) => rowKey([agentId]))),
        );
        deleteRowsNotIn(
          db,
          "projection_reactions",
          ["agent_id", "message_id", "actor_kind", "actor_agent_id"],
          new Set(value.reactions.map((reaction) => rowKey(reactionKey(reaction)))),
        );
        deleteRowsNotIn(
          db,
          "projection_attachments",
          ["attachment_id"],
          new Set(attachments.map((attachment) => rowKey([attachment[0]]))),
          "owner_kind IN ('mailbox-message', 'draft', 'generated')",
        );

        // Each upsert below writes a row only when its content changed. An unchanged row keeps the
        // sequence of the write that last changed it.
        const messageUpsert = db.prepare(`
          INSERT INTO projection_mailbox_messages
            (message_id, sender_kind, sender_agent_id, text, reply_to_message_id, created_at, message_json, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            sender_kind = excluded.sender_kind,
            sender_agent_id = excluded.sender_agent_id,
            text = excluded.text,
            reply_to_message_id = excluded.reply_to_message_id,
            created_at = excluded.created_at,
            message_json = excluded.message_json,
            last_event_sequence = excluded.last_event_sequence
          WHERE projection_mailbox_messages.message_json IS NOT excluded.message_json
        `);
        for (const message of value.messages) {
          const sender = message.sender;
          messageUpsert.run(
            String(message.id),
            sender.kind,
            sender.agentId ?? null,
            String(message.text),
            isString(message.replyToMessageId) ? message.replyToMessageId : null,
            String(message.createdAt),
            JSON.stringify(message),
            sequence,
          );
        }
        const deliveryUpsert = db.prepare(`
          INSERT INTO projection_deliveries
            (delivery_id, message_id, recipient_agent_id, status, turn_id, error, created_at, delivery_json, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(delivery_id) DO UPDATE SET
            message_id = excluded.message_id,
            recipient_agent_id = excluded.recipient_agent_id,
            status = excluded.status,
            turn_id = excluded.turn_id,
            error = excluded.error,
            created_at = excluded.created_at,
            delivery_json = excluded.delivery_json,
            last_event_sequence = excluded.last_event_sequence
          WHERE projection_deliveries.delivery_json IS NOT excluded.delivery_json
        `);
        for (const delivery of value.deliveries) {
          deliveryUpsert.run(
            String(delivery.id),
            String(delivery.messageId),
            String(delivery.recipientAgentId),
            String(delivery.status),
            isString(delivery.turnId) ? delivery.turnId : null,
            isString(delivery.error) ? delivery.error : null,
            String(delivery.createdAt),
            JSON.stringify(delivery),
            sequence,
          );
        }
        const queueUpsert = db.prepare(`
          INSERT INTO projection_queue_state
            (agent_id, paused, metadata_json, last_event_sequence) VALUES (?, ?, ?, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            paused = excluded.paused,
            metadata_json = excluded.metadata_json,
            last_event_sequence = excluded.last_event_sequence
          WHERE projection_queue_state.paused IS NOT excluded.paused
            OR projection_queue_state.metadata_json IS NOT excluded.metadata_json
        `);
        queueUpsert.run(MAILBOX_METADATA_ROW, 0, JSON.stringify({ idempotency: value.idempotency }), sequence);
        for (const agentId of value.pausedAgentIds) queueUpsert.run(agentId, 1, "{}", sequence);
        const reactionUpsert = db.prepare(`
          INSERT INTO projection_reactions
            (agent_id, message_id, actor_kind, actor_agent_id, emoji, updated_at, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(agent_id, message_id, actor_kind, actor_agent_id) DO UPDATE SET
            emoji = excluded.emoji,
            updated_at = excluded.updated_at,
            last_event_sequence = excluded.last_event_sequence
          WHERE projection_reactions.emoji IS NOT excluded.emoji
            OR projection_reactions.updated_at IS NOT excluded.updated_at
        `);
        for (const reaction of value.reactions) {
          reactionUpsert.run(...reactionKey(reaction), String(reaction.emoji), String(reaction.updatedAt), sequence);
        }
        // `created_at` is not compared: a generated attachment has no time of its own, so the write
        // that first stores it sets the time.
        const attachmentUpsert = db.prepare(`
          INSERT INTO projection_attachments
            (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(attachment_id) DO UPDATE SET
            owner_kind = excluded.owner_kind,
            owner_id = excluded.owner_id,
            name = excluded.name,
            path = excluded.path,
            metadata_json = excluded.metadata_json,
            created_at = excluded.created_at,
            last_event_sequence = excluded.last_event_sequence
          WHERE projection_attachments.owner_kind IS NOT excluded.owner_kind
            OR projection_attachments.owner_id IS NOT excluded.owner_id
            OR projection_attachments.name IS NOT excluded.name
            OR projection_attachments.path IS NOT excluded.path
            OR projection_attachments.metadata_json IS NOT excluded.metadata_json
        `);
        for (const attachment of attachments) attachmentUpsert.run(...attachment, sequence);
        const outboxInsert = db.prepare(`
          INSERT OR IGNORE INTO file_deletion_outbox
            (id, path, reason, created_at, attempts, last_error)
          VALUES (?, ?, ?, ?, 0, NULL)
        `);
        for (const path of fileDeletions) {
          outboxInsert.run(randomUUID(), path, eventType, new Date().toISOString());
        }
        return null;
      },
    );
  }

  pendingFileDeletions(): Array<{ id: string; path: string }> {
    return databaseRows(
      this.#core.connection.prepare("SELECT id, path FROM file_deletion_outbox ORDER BY created_at").all(),
    ).map((row) => ({
      id: requiredStringColumn(row, "id"),
      path: requiredStringColumn(row, "path"),
    }));
  }

  completeFileDeletion(id: string): void {
    this.#core.connection.prepare("DELETE FROM file_deletion_outbox WHERE id = ?").run(id);
  }

  failFileDeletion(id: string, error: string): void {
    this.#core.connection
      .prepare(
        `UPDATE file_deletion_outbox
         SET attempts = attempts + 1, last_error = ? WHERE id = ?`,
      )
      .run(error.slice(0, 2_000), id);
  }

  readMailboxState(): unknown | null {
    const db = this.#core.connection;
    const marker = databaseRow(
      db.prepare("SELECT metadata_json FROM projection_queue_state WHERE agent_id = ?").get(MAILBOX_METADATA_ROW),
    );
    if (!marker) return null;
    const metadata = parseMailboxMetadata(requiredStringColumn(marker, "metadata_json"));
    const messages = databaseRows(
      db.prepare("SELECT message_json FROM projection_mailbox_messages ORDER BY created_at, message_id").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "message_json")));
    const deliveries = databaseRows(
      db.prepare("SELECT delivery_json FROM projection_deliveries ORDER BY created_at, delivery_id").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "delivery_json")));
    const drafts = databaseRows(
      db.prepare("SELECT metadata_json FROM projection_attachments WHERE owner_kind = 'draft'").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "metadata_json")));
    const generatedAttachments = databaseRows(
      db.prepare("SELECT metadata_json FROM projection_attachments WHERE owner_kind = 'generated'").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "metadata_json")));
    const pausedAgentIds = databaseRows(
      db.prepare("SELECT agent_id FROM projection_queue_state WHERE paused = 1").all(),
    ).map((row) => requiredStringColumn(row, "agent_id"));
    const reactions = databaseRows(
      db
        .prepare("SELECT agent_id, message_id, emoji, actor_kind, actor_agent_id, updated_at FROM projection_reactions")
        .all(),
    ).map((row) => ({
      agentId: requiredStringColumn(row, "agent_id"),
      messageId: requiredStringColumn(row, "message_id"),
      emoji: requiredStringColumn(row, "emoji"),
      actor:
        requiredStringColumn(row, "actor_kind") === "agent"
          ? { kind: "agent" as const, agentId: requiredStringColumn(row, "actor_agent_id") }
          : { kind: "user" as const },
      updatedAt: requiredStringColumn(row, "updated_at"),
    }));
    return {
      version: 3,
      messages,
      deliveries,
      drafts,
      generatedAttachments,
      pausedAgentIds,
      idempotency: metadata.idempotency ?? {},
      reactions,
    };
  }
}

type AttachmentRow = [
  attachmentId: string,
  ownerKind: "mailbox-message" | "draft" | "generated",
  ownerId: string,
  name: string,
  path: string,
  metadataJson: string,
  createdAt: string,
];

function mailboxAttachmentRows(state: MailboxProjectionState): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const message of state.messages) {
    for (const attachment of message.attachments) {
      rows.push([
        String(attachment.id),
        "mailbox-message",
        String(message.id),
        String(attachment.name),
        String(attachment.path),
        JSON.stringify(attachment),
        String(message.createdAt),
      ]);
    }
  }
  for (const draft of state.drafts) {
    rows.push([
      String(draft.id),
      "draft",
      String(draft.id),
      String(draft.name),
      String(draft.path),
      JSON.stringify(draft),
      String(draft.createdAt),
    ]);
  }
  for (const attachment of state.generatedAttachments) {
    rows.push([
      String(attachment.id),
      "generated",
      String(attachment.id),
      String(attachment.name),
      String(attachment.path),
      JSON.stringify(attachment),
      new Date().toISOString(),
    ]);
  }
  return rows;
}

function reactionKey(
  reaction: MailboxProjectionReaction,
): [agentId: string, messageId: string, actorKind: string, actorAgentId: string] {
  return [
    String(reaction.agentId),
    String(reaction.messageId),
    reaction.actor.kind === "agent" ? "agent" : reaction.actor.kind,
    reaction.actor.kind === "agent" ? reaction.actor.agentId : "",
  ];
}

function rowKey(values: readonly string[]): string {
  return JSON.stringify(values);
}

/** Deletes each row whose key is not in `kept`. Reading the keys writes nothing. */
function deleteRowsNotIn(
  db: DatabaseSync,
  table: string,
  keyColumns: readonly string[],
  kept: ReadonlySet<string>,
  where = "1",
): void {
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${keyColumns.map((column) => `${column} = ?`).join(" AND ")}`);
  const rows = databaseRows(db.prepare(`SELECT ${keyColumns.join(", ")} FROM ${table} WHERE ${where}`).all());
  for (const row of rows) {
    const key = keyColumns.map((column) => requiredStringColumn(row, column));
    if (!kept.has(rowKey(key))) remove.run(...key);
  }
}

function parseMailboxMetadata(value: string): { idempotency?: Record<string, string> } {
  const parsed = JSON.parse(value);
  if (!isDynamicRecord(parsed)) throw new Error("Invalid mailbox metadata.");
  const idempotency = parsed.idempotency;
  if (idempotency === undefined) return {};
  if (!isDynamicRecord(idempotency)) throw new Error("Invalid mailbox idempotency metadata.");
  const entries = Object.entries(idempotency);
  const values: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!isString(entry)) throw new Error("Invalid mailbox idempotency entry.");
    values[key] = entry;
  }
  return { idempotency: values };
}
