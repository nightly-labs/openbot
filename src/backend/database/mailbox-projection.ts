import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type DatabaseCore, deleteReceiptsOf } from "./database-core";
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

export interface MailboxProjectionChanges {
  messageIds: ReadonlySet<string>;
  deliveryIds: ReadonlySet<string>;
  draftIds: ReadonlySet<string>;
  generatedAttachmentIds: ReadonlySet<string>;
  reactionKeys: ReadonlySet<string>;
  rowLookup?: MailboxRowLookup;
}

export interface MailboxRowLookup {
  message: (id: string) => MailboxProjectionState["messages"][number] | undefined;
  delivery: (id: string) => MailboxProjectionState["deliveries"][number] | undefined;
}

const MAILBOX_METADATA_ROW = "__mailbox__";

export interface MailboxProjectionOptions {
  core: DatabaseCore;
}

export class MailboxProjection {
  readonly #core: DatabaseCore;
  #statements: MailboxStatements | null = null;

  constructor(options: MailboxProjectionOptions) {
    this.#core = options.core;
  }

  replaceMailboxState(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[] = [],
    _rebaseHistory = false,
  ): boolean {
    return this.#write(commandId, state, eventType, fileDeletions, true, (db, statements, sequence) => {
      const attachments = mailboxAttachmentRows(state);
      deleteRowsNotIn(
        db,
        "projection_deliveries",
        ["delivery_id"],
        new Set(state.deliveries.map((delivery) => rowKey([String(delivery.id)]))),
      );
      deleteRowsNotIn(
        db,
        "projection_mailbox_messages",
        ["message_id"],
        new Set(state.messages.map((message) => rowKey([String(message.id)]))),
      );
      deleteRowsNotIn(
        db,
        "projection_reactions",
        ["agent_id", "message_id", "actor_kind", "actor_agent_id"],
        new Set(state.reactions.map((reaction) => rowKey(reactionKey(reaction)))),
      );
      deleteRowsNotIn(
        db,
        "projection_attachments",
        ["attachment_id"],
        new Set(attachments.map((attachment) => rowKey([attachment[0]]))),
        "owner_kind IN ('mailbox-message', 'draft', 'generated')",
      );
      for (const message of state.messages) writeMessage(statements, message, sequence);
      for (const delivery of state.deliveries) writeDelivery(statements, delivery, sequence);
      for (const reaction of state.reactions) writeReaction(statements, reaction, sequence);
      for (const attachment of attachments) statements.attachmentUpsert.run(...attachment, sequence);
    });
  }

  applyMailboxChanges(
    commandId: string,
    state: MailboxProjectionState,
    changes: MailboxProjectionChanges,
    eventType: string,
    fileDeletions: string[] = [],
    writeIdempotency = true,
  ): boolean {
    return this.#write(commandId, state, eventType, fileDeletions, writeIdempotency, (_db, statements, sequence) => {
      const messages = changedRows(
        state.messages,
        changes.messageIds,
        (message) => String(message.id),
        changes.rowLookup?.message,
      );
      const deliveries = changedRows(
        state.deliveries,
        changes.deliveryIds,
        (delivery) => String(delivery.id),
        changes.rowLookup?.delivery,
      );
      const reactions = changedRows(state.reactions, changes.reactionKeys, (reaction) => rowKey(reactionKey(reaction)));
      const drafts = changedRows(state.drafts, changes.draftIds, (draft) => String(draft.id));
      const generated = changedRows(state.generatedAttachments, changes.generatedAttachmentIds, (attachment) =>
        String(attachment.id),
      );

      for (const id of absentKeys(changes.deliveryIds, deliveries)) statements.deliveryDelete.run(id);
      for (const id of changes.messageIds) {
        const kept = messages.get(id);
        const keptIds = new Set(kept?.attachments.map((attachment) => String(attachment.id)));
        for (const attachmentId of storedAttachmentIds(statements, id)) {
          if (!keptIds.has(attachmentId)) statements.attachmentDelete.run(attachmentId, "mailbox-message", id);
        }
        if (!kept) statements.messageDelete.run(id);
      }
      for (const key of absentKeys(changes.reactionKeys, reactions)) {
        statements.reactionDelete.run(...parseReactionRowKey(key));
      }
      for (const id of absentKeys(changes.draftIds, drafts)) statements.attachmentDelete.run(id, "draft", id);
      for (const id of absentKeys(changes.generatedAttachmentIds, generated)) {
        statements.attachmentDelete.run(id, "generated", id);
      }

      for (const message of messages.values()) writeMessage(statements, message, sequence);
      for (const delivery of deliveries.values()) writeDelivery(statements, delivery, sequence);
      for (const reaction of reactions.values()) writeReaction(statements, reaction, sequence);
      const attachments = [
        ...[...messages.values()].flatMap(messageAttachmentRows),
        ...[...drafts.values()].map(draftAttachmentRow),
        ...[...generated.values()].map(generatedAttachmentRow),
      ];
      for (const attachment of attachments) statements.attachmentUpsert.run(...attachment, sequence);
    });
  }

  #write(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[],
    writeIdempotency: boolean,
    writeRows: (db: DatabaseSync, statements: MailboxStatements, sequence: number) => void,
  ): boolean {
    let wrote = false;
    this.#core.dispatch(
      commandId,
      [
        {
          aggregateType: "mailbox",
          aggregateId: "mailbox",
          eventType,
          payload: { messages: state.messages.length, deliveries: state.deliveries.length },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        const statements = this.#statementsFor(db);
        const olderCommandIds = databaseRows(statements.olderEventsDelete.all(sequence)).map((row) =>
          requiredStringColumn(row, "command_id"),
        );
        deleteReceiptsOf(db, olderCommandIds);
        writeRows(db, statements, sequence);
        statements.queueStateDelete.run(JSON.stringify([MAILBOX_METADATA_ROW, ...state.pausedAgentIds]));
        if (writeIdempotency)
          statements.queueUpsert.run(
            MAILBOX_METADATA_ROW,
            0,
            JSON.stringify({ idempotency: state.idempotency }),
            sequence,
          );
        for (const agentId of state.pausedAgentIds) statements.queueUpsert.run(agentId, 1, "{}", sequence);
        for (const path of fileDeletions) {
          statements.outboxInsert.run(randomUUID(), path, eventType, new Date().toISOString());
        }
        wrote = true;
        return null;
      },
    );
    return wrote;
  }

  #statementsFor(db: DatabaseSync): MailboxStatements {
    if (this.#statements?.db !== db) this.#statements = prepareMailboxStatements(db);
    return this.#statements;
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
      db.prepare("SELECT message_json FROM projection_mailbox_messages ORDER BY created_at, rowid").all(),
    ).map((row) => JSON.parse(requiredStringColumn(row, "message_json")));
    const deliveries = databaseRows(
      db.prepare("SELECT delivery_json FROM projection_deliveries ORDER BY created_at, rowid").all(),
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
  return [
    ...state.messages.flatMap(messageAttachmentRows),
    ...state.drafts.map(draftAttachmentRow),
    ...state.generatedAttachments.map(generatedAttachmentRow),
  ];
}

function messageAttachmentRows(message: MailboxProjectionMessage): AttachmentRow[] {
  return message.attachments.map((attachment) => [
    String(attachment.id),
    "mailbox-message",
    String(message.id),
    String(attachment.name),
    String(attachment.path),
    JSON.stringify(attachment),
    String(message.createdAt),
  ]);
}

function draftAttachmentRow(draft: MailboxProjectionDraft): AttachmentRow {
  return [
    String(draft.id),
    "draft",
    String(draft.id),
    String(draft.name),
    String(draft.path),
    JSON.stringify(draft),
    String(draft.createdAt),
  ];
}

function generatedAttachmentRow(attachment: MailboxProjectionGeneratedAttachment): AttachmentRow {
  return [
    String(attachment.id),
    "generated",
    String(attachment.id),
    String(attachment.name),
    String(attachment.path),
    JSON.stringify(attachment),
    new Date().toISOString(),
  ];
}

interface MailboxStatements {
  db: DatabaseSync;
  olderEventsDelete: StatementSync;
  messageUpsert: StatementSync;
  messageDelete: StatementSync;
  messageJson: StatementSync;
  deliveryUpsert: StatementSync;
  deliveryDelete: StatementSync;
  queueUpsert: StatementSync;
  queueStateDelete: StatementSync;
  reactionUpsert: StatementSync;
  reactionDelete: StatementSync;
  attachmentUpsert: StatementSync;
  attachmentDelete: StatementSync;
  outboxInsert: StatementSync;
}

function prepareMailboxStatements(db: DatabaseSync): MailboxStatements {
  return {
    db,
    olderEventsDelete: db.prepare(
      `DELETE FROM orchestration_events
       WHERE aggregate_type = 'mailbox' AND aggregate_id = 'mailbox' AND sequence < ?
       RETURNING command_id`,
    ),
    messageUpsert: db.prepare(`
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
    `),
    messageDelete: db.prepare("DELETE FROM projection_mailbox_messages WHERE message_id = ?"),
    messageJson: db.prepare("SELECT message_json FROM projection_mailbox_messages WHERE message_id = ?"),
    deliveryUpsert: db.prepare(`
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
    `),
    deliveryDelete: db.prepare("DELETE FROM projection_deliveries WHERE delivery_id = ?"),
    queueUpsert: db.prepare(`
      INSERT INTO projection_queue_state
        (agent_id, paused, metadata_json, last_event_sequence) VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        paused = excluded.paused,
        metadata_json = excluded.metadata_json,
        last_event_sequence = excluded.last_event_sequence
      WHERE projection_queue_state.paused IS NOT excluded.paused
        OR projection_queue_state.metadata_json IS NOT excluded.metadata_json
    `),
    queueStateDelete: db.prepare(
      "DELETE FROM projection_queue_state WHERE agent_id NOT IN (SELECT value FROM json_each(?))",
    ),
    reactionUpsert: db.prepare(`
      INSERT INTO projection_reactions
        (agent_id, message_id, actor_kind, actor_agent_id, emoji, updated_at, last_event_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, message_id, actor_kind, actor_agent_id) DO UPDATE SET
        emoji = excluded.emoji,
        updated_at = excluded.updated_at,
        last_event_sequence = excluded.last_event_sequence
      WHERE projection_reactions.emoji IS NOT excluded.emoji
        OR projection_reactions.updated_at IS NOT excluded.updated_at
    `),
    reactionDelete: db.prepare(
      `DELETE FROM projection_reactions
       WHERE agent_id = ? AND message_id = ? AND actor_kind = ? AND actor_agent_id = ?`,
    ),
    attachmentUpsert: db.prepare(`
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
    `),
    attachmentDelete: db.prepare(
      "DELETE FROM projection_attachments WHERE attachment_id = ? AND owner_kind = ? AND owner_id = ?",
    ),
    outboxInsert: db.prepare(`
      INSERT OR IGNORE INTO file_deletion_outbox
        (id, path, reason, created_at, attempts, last_error)
      VALUES (?, ?, ?, ?, 0, NULL)
    `),
  };
}

function writeMessage(statements: MailboxStatements, message: MailboxProjectionMessage, sequence: number): void {
  const sender = message.sender;
  statements.messageUpsert.run(
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

function writeDelivery(statements: MailboxStatements, delivery: MailboxProjectionDelivery, sequence: number): void {
  statements.deliveryUpsert.run(
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

function writeReaction(statements: MailboxStatements, reaction: MailboxProjectionReaction, sequence: number): void {
  statements.reactionUpsert.run(...reactionKey(reaction), String(reaction.emoji), String(reaction.updatedAt), sequence);
}

function storedAttachmentIds(statements: MailboxStatements, messageId: string): string[] {
  const row = databaseRow(statements.messageJson.get(messageId));
  if (!row) return [];
  const message = JSON.parse(requiredStringColumn(row, "message_json"));
  const attachments = isDynamicRecord(message) ? message.attachments : undefined;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) =>
    isDynamicRecord(attachment) && isString(attachment.id) ? [attachment.id] : [],
  );
}

function changedRows<T>(
  rows: readonly T[],
  keys: ReadonlySet<string>,
  keyOf: (row: T) => string,
  lookup?: (key: string) => T | undefined,
): Map<string, T> {
  const changed = new Map<string, T>();
  if (keys.size === 0) return changed;
  if (lookup) {
    for (const key of keys) {
      const row = lookup(key);
      if (row !== undefined) changed.set(key, row);
    }
    return changed;
  }
  for (const row of rows) {
    const key = keyOf(row);
    if (keys.has(key)) changed.set(key, row);
  }
  return changed;
}

function absentKeys(keys: ReadonlySet<string>, present: ReadonlyMap<string, unknown>): string[] {
  return [...keys].filter((key) => !present.has(key));
}

export function mailboxReactionRowKey(
  agentId: string,
  messageId: string,
  actor: MailboxProjectionReaction["actor"],
): string {
  return rowKey(reactionKey({ agentId, messageId, actor }));
}

function parseReactionRowKey(
  key: string,
): [agentId: string, messageId: string, actorKind: string, actorAgentId: string] {
  const parts = JSON.parse(key);
  const [agentId, messageId, actorKind, actorAgentId] = Array.isArray(parts) ? parts : [];
  if (!isString(agentId) || !isString(messageId) || !isString(actorKind) || !isString(actorAgentId)) {
    throw new Error("Invalid mailbox reaction key.");
  }
  return [agentId, messageId, actorKind, actorAgentId];
}

function reactionKey(
  reaction: Pick<MailboxProjectionReaction, "agentId" | "messageId" | "actor">,
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
