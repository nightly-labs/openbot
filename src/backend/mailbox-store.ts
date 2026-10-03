import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rewriteAttachmentReferences } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentRuntimeWorkItem,
  AttachmentDataInput,
  AttachmentSummary,
  ConversationMessage,
  ConversationMessageSender,
  ConversationReaction,
  ConversationReactionActor,
  ConversationSnapshot,
  DraftAttachment,
  MessageReaction,
  QueueDelivery,
  QueueDeliveryStatus,
  QueuedMessageReceipt,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import {
  AGENT_RUNTIME_ATTENTION_LIMIT,
  AGENT_RUNTIME_TEXT_LIMIT,
  AGENT_RUNTIME_WORKING_ITEMS_LIMIT,
  isConversationMessageSender,
  isMessageReaction,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Result } from "effect";
import {
  AttachmentFiles,
  type ExportedAttachmentFile,
  type GeneratedAttachmentSource,
  type StoredAttachment,
  type StoredDraft,
  type StoredGeneratedAttachment,
  toAttachmentSummary,
} from "./attachment-files";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";

export type { ExportedAttachmentFile, GeneratedAttachmentSource } from "./attachment-files";

import { MailboxDeliveryGate } from "./mailbox-delivery-gate";
import { OpenBotDatabase } from "./openbot-database";
import { isRecord } from "./protocol";
import { recordRestartActivity } from "./restart-activity";

const MAX_ATTACHMENTS = INPUT_LIMITS.attachments;
/**
 * The external conversation a message came from. Such a message runs in the execution thread of
 * that conversation, so the queue and the public chat do not show it, like channel work.
 */
export interface MessagingOrigin {
  linkId: string;
  authorId: string;
  authorName: string;
  platformMessageId: string;
}

interface StoredMessage {
  channelId?: string;
  messaging?: MessagingOrigin;
  /**
   * A request an agent sent from an external conversation, such as a Slack thread. The teammate's
   * answer to it goes back to that conversation, not to the agent's own chat. Never sent to a client.
   */
  messagingReturn?: MessagingOrigin;
  id: string;
  sender:
    | { kind: "user" }
    | { kind: "agent"; agentId: string }
    | { kind: "routine"; routineId: string; runId: string; routineName: string; scheduledFor: string };
  /**
   * The person who wrote a user message, stamped by the host. It sits beside `sender`, not in it,
   * because `sender` is also the queue's and the transfer manifest's. Absent on older messages.
   */
  senderMember?: ConversationMessageSender;
  text: string;
  attachments: StoredAttachment[];
  replyToMessageId: string | null;
  /**
   * Written only when the sender asked for no answer. Absent means an answer is expected, which is
   * what every message stored before this field existed meant.
   */
  expectsReply?: false;
  createdAt: string;
}

type QueueEditOutcome = "save" | "cancel";

interface StoredFinishedEdit {
  action: QueueEditOutcome;
  saveHash?: string;
}

interface StoredDelivery {
  editId?: string;
  finishedEditOutcomes?: Record<string, StoredFinishedEdit>;
  id: string;
  messageId: string;
  recipientAgentId: string;
  queueOrder: number;
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
  createdAt: string;
}

interface StoredState {
  version: 3;
  messages: StoredMessage[];
  deliveries: StoredDelivery[];
  drafts: StoredDraft[];
  generatedAttachments: StoredGeneratedAttachment[];
  pausedAgentIds: string[];
  idempotency: Record<string, string>;
  reactions: StoredReaction[];
}

interface StoredReaction {
  agentId: string;
  messageId: string;
  emoji: MessageReaction;
  actor: ConversationReactionActor;
  updatedAt: string;
}

interface EnqueueInput {
  channelId?: string;
  messaging?: MessagingOrigin;
  messagingReturn?: MessagingOrigin;
  sender: StoredMessage["sender"];
  senderMember?: ConversationMessageSender;
  recipientAgentIds: string[];
  text: string;
  replyToMessageId?: string | null;
  /** False marks information the recipient must not answer. Defaults to an expected answer. */
  expectsReply?: boolean;
  draftIds?: string[];
  sourcePaths?: string[];
  idempotencyKey?: string;
}

/** A file a chat message carries or an agent made, as the Storage view lists it. */
export interface MailboxStoredFile {
  attachment: AttachmentSummary;
  path: string;
  source: "attachment" | "generated";
  /** The mailbox message that carries an attachment. Null for a generated file. */
  messageId: string | null;
  /** The agent that sent the message or made the file, else the first recipient. */
  agentId: string | null;
  /** Null for a generated file: its record has no time. */
  createdAt: string | null;
}

export interface DeliveryContext {
  delivery: QueueDelivery;
  managedAttachments: Array<AttachmentSummary & { path: string }>;
}

const EMPTY_STATE: StoredState = {
  version: 3,
  messages: [],
  deliveries: [],
  drafts: [],
  generatedAttachments: [],
  pausedAgentIds: [],
  idempotency: {},
  reactions: [],
};

export class MailboxStore {
  readonly #statePath: string;
  readonly #files: AttachmentFiles;
  readonly #database: OpenBotDatabase;
  readonly #queueUpdates = new Set<string>();
  readonly #deliveryGate = new MailboxDeliveryGate();
  readonly #stagedGeneratedAttachments = new Map<string, StoredGeneratedAttachment>();
  #state: StoredState = structuredClone(EMPTY_STATE);

  constructor(userDataPath: string, sharedRoot: string, database = new OpenBotDatabase(userDataPath)) {
    this.#statePath = join(userDataPath, "mailbox.json");
    this.#files = new AttachmentFiles({ userDataPath, sharedRoot });
    this.#database = database;
  }

  initialize = Effect.fn("MailboxStore.initialize")(function* (
    this: MailboxStore,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* Effect.all(
        [
          storedIO(() => mkdir(dirname(this.#statePath), { recursive: true, mode: 0o700 })),
          this.#files.initialize().pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause }))),
        ],
        { concurrency: "unbounded" },
      );
      yield* this.#database.initialize();
      const stored = this.#database.readMailboxState();
      if (stored !== null && stored !== undefined) {
        const persisted = toCurrentMailboxState(stored);
        if (!persisted || !isStoredState(persisted)) throw new Error("Stored mailbox projection is invalid.");
        this.#state = normalizeStoredState(persisted);
      } else {
        this.#state = normalizeStoredState(yield* this.#readStateEffect());
        yield* this.#database.backupLegacyFile(this.#statePath);
        this.#persist("mailbox.legacy-imported", "legacy-import:mailbox:v1");
      }
      const activeEdits = new Set(
        this.#state.deliveries
          .filter((delivery) => delivery.status === "queued" && delivery.editId)
          .map((delivery) => delivery.editId),
      );
      const retainedDrafts = this.#state.drafts.filter(
        (draft) => draft.preserveOnRestart || (draft.ownerEditId && activeEdits.has(draft.ownerEditId)),
      );
      if (retainedDrafts.length !== this.#state.drafts.length) {
        this.#state.drafts = retainedDrafts;
        this.#persist("mailbox.drafts-cleared");
      }
      yield* this.#files
        .resetDrafts(retainedDrafts.map((draft) => draft.id))
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  prepareAttachments = Effect.fn("MailboxStore.prepareAttachments")(function* (
    this: MailboxStore,
    paths: string[],
  ): Effect.fn.Return<DraftAttachment[], StoredStateFailure> {
    try {
      return yield* this.prepareImportedAttachments(paths, []);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  prepareImportedAttachments = Effect.fn("MailboxStore.prepareImportedAttachments")(function* (
    this: MailboxStore,
    paths: string[],
    data: AttachmentDataInput[],
  ): Effect.fn.Return<DraftAttachment[], StoredStateFailure> {
    try {
      if (paths.length + data.length === 0) return [];
      if (paths.length + data.length > MAX_ATTACHMENTS) {
        throw new Error(sourceText("error.attachment.tooMany", { limit: MAX_ATTACHMENTS }));
      }
      if (this.#state.drafts.length + paths.length + data.length > INPUT_LIMITS.draftAttachments) {
        throw new Error(sourceText("error.backend.draftAttachmentLimit", { limit: INPUT_LIMITS.draftAttachments }));
      }
      const prepared = yield* this.#files
        .prepareDrafts(paths, data)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      this.#state.drafts.push(...prepared);
      try {
        this.#persist("attachments.prepared");
        return prepared.map(toAttachmentSummary);
      } catch (error) {
        const preparedIds = new Set(prepared.map((draft) => draft.id));
        this.#state.drafts = this.#state.drafts.filter((draft) => !preparedIds.has(draft.id));
        yield* this.#files
          .removeAttachmentDirectories(prepared.map((draft) => draft.path))
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw error;
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  discardDraft = Effect.fn("MailboxStore.discardDraft")(function* (
    this: MailboxStore,
    id: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const index = this.#state.drafts.findIndex((draft) => draft.id === id);
      if (index < 0) return;
      const [draft] = this.#state.drafts.splice(index, 1);
      if (!draft) return;
      try {
        this.#persist("attachment-draft.discarded");
      } catch (error) {
        this.#state.drafts.splice(index, 0, draft);
        throw error;
      }
      yield* this.#files
        .removeAttachmentDirectories([draft.path])
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  blockAgentDeliveries(agentId: string): () => void {
    return this.#deliveryGate.block(agentId);
  }

  prepareDelivery(agentIds: string[]): () => void {
    return this.#deliveryGate.prepare(agentIds);
  }

  deliveryForKey(key: string): DeliveryContext | null {
    const messageId = this.#state.idempotency[key];
    const delivery = this.#state.deliveries.find((item) => item.messageId === messageId);
    return delivery ? this.#context(delivery) : null;
  }

  /** The external conversation this delivery came from, or null for any other delivery. */
  messagingOrigin(deliveryId: string): MessagingOrigin | null {
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId);
    const message = delivery ? this.#state.messages.find((item) => item.id === delivery.messageId) : undefined;
    return message?.messaging ? structuredClone(message.messaging) : null;
  }

  /**
   * The external conversation an agent's answer goes back to: the one the request was sent from,
   * when the answer goes to the agent that sent it and to no one else. Every delivery of a message
   * runs in the conversation of its `messaging` origin, so an answer with a second recipient stays
   * in the chats.
   */
  #answerReturn(input: EnqueueInput, recipients: readonly string[]): MessagingOrigin | undefined {
    if (input.sender.kind !== "agent" || !input.replyToMessageId || recipients.length !== 1) return undefined;
    const request = this.#state.messages.find((message) => message.id === input.replyToMessageId);
    if (!request?.messagingReturn || request.sender.kind !== "agent" || request.sender.agentId !== recipients[0])
      return undefined;
    return structuredClone(request.messagingReturn);
  }

  /**
   * The deliveries of requests that an agent sent from one messaging link, whose answer goes back to
   * it, and that have not ended.
   */
  pendingMessagingReturns(linkId: string): number {
    const messageIds = new Set(
      this.#state.messages.filter((message) => message.messagingReturn?.linkId === linkId).map((message) => message.id),
    );
    return this.#state.deliveries.filter(
      (delivery) =>
        messageIds.has(delivery.messageId) &&
        (delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running"),
    ).length;
  }

  /** The deliveries of one messaging link that have not ended, oldest first. */
  unresolvedMessagingDeliveries(linkId: string): DeliveryContext[] {
    const messageIds = new Set(
      this.#state.messages.filter((message) => message.messaging?.linkId === linkId).map((message) => message.id),
    );
    return this.#state.deliveries
      .filter(
        (delivery) =>
          messageIds.has(delivery.messageId) &&
          (delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running"),
      )
      .sort(compareQueueOrder)
      .map((delivery) => this.#context(delivery));
  }

  enqueue = Effect.fn("MailboxStore.enqueue")(function* (
    this: MailboxStore,
    input: EnqueueInput,
  ): Effect.fn.Return<QueuedMessageReceipt, StoredStateFailure> {
    try {
      if (input.idempotencyKey) {
        const existingMessageId = this.#state.idempotency[input.idempotencyKey];
        if (existingMessageId) return this.#receipt(existingMessageId);
      }

      const recipients = [...new Set(input.recipientAgentIds)];
      const validateRecipients = this.prepareDelivery(recipients);
      if (recipients.length === 0) throw new Error(sourceText("error.backend.recipientRequired"));
      if (recipients.length > INPUT_LIMITS.messageRecipients) {
        throw new Error(sourceText("error.backend.recipientLimit", { limit: INPUT_LIMITS.messageRecipients }));
      }
      if (recipients.some((id) => !id || id.length > INPUT_LIMITS.identifier)) {
        throw new Error("A message recipient is invalid.");
      }
      if (input.idempotencyKey !== undefined && input.idempotencyKey.length > INPUT_LIMITS.identifier) {
        throw new Error("The idempotency key is too long.");
      }

      const text = input.text.trim();
      if (text.length > INPUT_LIMITS.messageText) throw new Error(sourceText("error.agent.messageTooLong"));

      const drafts = (input.draftIds ?? []).map((id) => {
        const draft = this.#state.drafts.find((candidate) => candidate.id === id);
        if (!draft) throw new Error(sourceText("error.backend.attachmentDraftGone", { id }));
        if (draft.ownerEditId) throw new Error(sourceText("error.backend.attachmentInQueueEdit"));
        return draft;
      });
      if (drafts.length !== new Set(input.draftIds ?? []).size) {
        throw new Error("Duplicate attachment draft.");
      }
      const sourcePaths = [...drafts.map((draft) => draft.path), ...(input.sourcePaths ?? [])];
      if (!text && sourcePaths.length === 0) throw new Error(sourceText("error.backend.messageEmpty"));
      if (sourcePaths.length > MAX_ATTACHMENTS) {
        throw new Error(sourceText("error.backend.attachLimit", { limit: MAX_ATTACHMENTS }));
      }

      const createdAt = new Date().toISOString();
      const messageId = randomUUID();
      const attachments = yield* this.#files
        .commitMessageTransfer(messageId, input.sender, recipients, messageId, createdAt, sourcePaths)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      try {
        validateRecipients();
      } catch (error) {
        yield* this.#files
          .remove(this.#files.transferRoot(messageId))
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw error;
      }
      const committedByDraftId = new Map(drafts.map((draft, index) => [draft.id, attachments[index]] as const));
      const messaging = input.messaging ?? this.#answerReturn(input, recipients);
      const message: StoredMessage = {
        channelId: input.channelId,
        ...(messaging ? { messaging } : {}),
        ...(input.messagingReturn ? { messagingReturn: input.messagingReturn } : {}),
        id: messageId,
        sender: input.sender,
        ...(input.sender.kind === "user" && input.senderMember ? { senderMember: input.senderMember } : {}),
        text: rewriteAttachmentReferences(text, (reference) => {
          const attachment = committedByDraftId.get(reference.attachmentId);
          return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
        }),
        attachments,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.expectsReply === false ? { expectsReply: false as const } : {}),
        createdAt,
      };
      const deliveries = recipients.map<StoredDelivery>((recipientAgentId) => ({
        id: randomUUID(),
        messageId,
        recipientAgentId,
        queueOrder: this.#nextQueueOrder(recipientAgentId),
        status: "queued",
        turnId: null,
        error: null,
        createdAt,
      }));

      this.#state.messages.push(message);
      recordRestartActivity();
      this.#state.deliveries.push(...deliveries);
      if (input.idempotencyKey) this.#state.idempotency[input.idempotencyKey] = messageId;
      this.#state.drafts = this.#state.drafts.filter((draft) => !(input.draftIds ?? []).includes(draft.id));
      try {
        this.#persist();
      } catch (error) {
        const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));
        this.#state.messages = this.#state.messages.filter((candidate) => candidate.id !== messageId);
        this.#state.deliveries = this.#state.deliveries.filter((candidate) => !deliveryIds.has(candidate.id));
        if (input.idempotencyKey && this.#state.idempotency[input.idempotencyKey] === messageId) {
          delete this.#state.idempotency[input.idempotencyKey];
        }
        for (const draft of drafts) {
          if (!this.#state.drafts.some((candidate) => candidate.id === draft.id)) {
            this.#state.drafts.push(draft);
          }
        }
        yield* this.#files
          .remove(this.#files.transferRoot(messageId))
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw error;
      }
      yield* this.#files
        .removeAttachmentDirectories(drafts.map((draft) => draft.path))
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      return this.#receipt(messageId);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Commits the uploads of one channel request before any member holds it. A channel dispatches
   * when a member is free, which can be after a restart, and a restart clears every draft and its
   * files. The files therefore become a channel-owned message here, with no delivery: the request
   * keeps durable references, every later dispatch re-sends the stored copies, and the files leave
   * with the channel through `deleteChannelData`.
   */

  commitChannelAttachments = Effect.fn("MailboxStore.commitChannelAttachments")(function* (
    this: MailboxStore,
    input: {
      channelId: string;
      messageId: string;
      text: string;
      draftIds: string[];
    },
  ): Effect.fn.Return<{ text: string; attachments: AttachmentSummary[] }, StoredStateFailure> {
    try {
      const ids = new Set(input.draftIds);
      if (ids.size !== input.draftIds.length) throw new Error("Duplicate attachment drafts.");
      const drafts = input.draftIds.map((id) => {
        const draft = this.#state.drafts.find((candidate) => candidate.id === id);
        if (!draft) throw new Error(sourceText("error.backend.attachmentDraftGone", { id }));
        if (draft.ownerEditId) throw new Error(sourceText("error.backend.attachmentInQueueEdit"));
        return draft;
      });
      if (drafts.length > MAX_ATTACHMENTS)
        throw new Error(sourceText("error.backend.attachLimit", { limit: MAX_ATTACHMENTS }));
      const sender: StoredMessage["sender"] = { kind: "user" };
      const createdAt = new Date().toISOString();
      const attachments = yield* this.#files
        .commitMessageTransfer(
          input.messageId,
          sender,
          [],
          input.messageId,
          createdAt,
          drafts.map((draft) => draft.path),
        )
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      const committedByDraftId = new Map(drafts.map((draft, index) => [draft.id, attachments[index]] as const));
      const message: StoredMessage = {
        channelId: input.channelId,
        id: input.messageId,
        sender,
        text: rewriteAttachmentReferences(input.text, (reference) => {
          const attachment = committedByDraftId.get(reference.attachmentId);
          return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
        }),
        attachments,
        replyToMessageId: null,
        createdAt,
      };
      this.#state.messages.push(message);
      this.#state.drafts = this.#state.drafts.filter((draft) => !ids.has(draft.id));
      try {
        this.#persist("channel.attachments-committed", `mailbox:channel-attachments:${input.messageId}`);
      } catch (error) {
        this.#state.messages = this.#state.messages.filter((candidate) => candidate !== message);
        for (const draft of drafts)
          if (!this.#state.drafts.some((candidate) => candidate.id === draft.id)) this.#state.drafts.push(draft);
        yield* this.#files
          .remove(this.#files.transferRoot(input.messageId))
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw error;
      }
      yield* this.#files
        .removeAttachmentDirectories(drafts.map((draft) => draft.path))
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      return { text: message.text, attachments: attachments.map(toAttachmentSummary) };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * A delivery held for editing stays listed, marked `editing`, and keeps its position. Hiding it
   * removed the row on every other device and renumbered the rest for as long as the edit ran,
   * which reads as lost messages.
   */
  listQueue(agentId: string): QueueSnapshot {
    const executionMessageIds = this.#executionMessageIds();
    const positions = this.#queuedPositions();
    return {
      agentId,
      // Queue order, not storage order: a restart reads the deliveries back sorted by their
      // creation time and identity, which would otherwise reorder rows a client already saw.
      deliveries: [...this.#state.deliveries]
        .filter((delivery) => delivery.recipientAgentId === agentId && !executionMessageIds.has(delivery.messageId))
        .sort(compareQueueOrder)
        .map((delivery) => this.#publicDelivery(delivery, positions)),
    };
  }

  /**
   * The queued channel and messaging work of this agent, in queue order. `listQueue` hides it, so a
   * caller that reorders the queue the user sees has to put these ids back before the mailbox reads
   * the order.
   */
  queuedExecutionDeliveryIds(agentId: string): string[] {
    const executionMessageIds = this.#executionMessageIds();
    return this.#state.deliveries
      .filter(
        (delivery) =>
          delivery.recipientAgentId === agentId &&
          delivery.status === "queued" &&
          executionMessageIds.has(delivery.messageId),
      )
      .sort(compareQueueOrder)
      .map((delivery) => delivery.id);
  }

  /** Indexed once for a whole read: a queue holds one delivery for each message the agent has. */
  #executionMessageIds(): Set<string> {
    const ids = new Set<string>();
    for (const message of this.#state.messages) if (message.channelId || message.messaging) ids.add(message.id);
    return ids;
  }

  listRuntimeWork(agentIds: readonly string[], failedTurns: ReadonlyMap<string, string>): AgentRuntimeWorkItem[] {
    const targetAgentIds = new Set(agentIds);
    const working: StoredDelivery[] = [];
    const failed: StoredDelivery[] = [];
    const workingAgentIds = new Set<string>();
    const failedAgentIds = new Set<string>();
    for (const delivery of this.#state.deliveries) {
      if (!targetAgentIds.has(delivery.recipientAgentId)) continue;
      const isWorking = delivery.status === "starting" || delivery.status === "running";
      const isCurrentFailure =
        delivery.status === "failed" && delivery.turnId === failedTurns.get(delivery.recipientAgentId);
      if (!isWorking && !isCurrentFailure) continue;
      const seenAgentIds = isCurrentFailure ? failedAgentIds : workingAgentIds;
      if (seenAgentIds.has(delivery.recipientAgentId)) continue;
      seenAgentIds.add(delivery.recipientAgentId);
      (isCurrentFailure ? failed : working).push(delivery);
    }
    const selected = [
      ...failed.slice(0, AGENT_RUNTIME_ATTENTION_LIMIT),
      ...working.slice(0, AGENT_RUNTIME_WORKING_ITEMS_LIMIT),
    ];
    const messageIds = new Set(selected.map((delivery) => delivery.messageId));
    const messages = new Map(
      this.#state.messages.filter((message) => messageIds.has(message.id)).map((message) => [message.id, message]),
    );
    return selected.map((delivery) => {
      const message = messages.get(delivery.messageId);
      if (!message) throw new Error(`Mailbox message is missing: ${delivery.messageId}`);
      if (delivery.status !== "starting" && delivery.status !== "running" && delivery.status !== "failed") {
        throw new Error(`Mailbox runtime delivery has an invalid status: ${delivery.status}`);
      }
      return {
        id: delivery.id,
        agentId: delivery.recipientAgentId,
        turnId: delivery.turnId,
        status: delivery.status,
        text: message.text.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
        error: delivery.error?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
      };
    });
  }

  conversationMessages(agentId: string): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    const deliveriesByMessage = new Map<string, StoredDelivery[]>();
    const positions = this.#queuedPositions();
    for (const delivery of this.#state.deliveries) {
      const deliveries = deliveriesByMessage.get(delivery.messageId) ?? [];
      deliveries.push(delivery);
      deliveriesByMessage.set(delivery.messageId, deliveries);
    }
    for (const message of this.#state.messages) {
      if (message.channelId || message.messaging) continue;
      // A request the agent sent from a Slack thread belongs to that thread, not to its own chat.
      // The teammate it went to still sees it.
      if (message.messagingReturn && message.sender.kind === "agent" && message.sender.agentId === agentId) continue;
      const deliveries = deliveriesByMessage.get(message.id) ?? [];
      if (message.sender.kind === "agent" && message.sender.agentId === agentId) {
        messages.push({
          id: `outbox-${message.id}`,
          turnId: this.#sourceTurnId(message.id),
          author: "system",
          source: "system",
          text: message.text,
          attachments: message.attachments.map(toAttachmentSummary),
          replyToMessageId: message.replyToMessageId,
          exchange: {
            direction: "outgoing",
            messageId: message.id,
            senderAgentId: agentId,
            recipientAgentIds: deliveries.map((item) => item.recipientAgentId),
            replyToMessageId: message.replyToMessageId,
            ...(message.expectsReply === false ? { expectsReply: false } : {}),
            deliveries: deliveries.map((item) => {
              const delivery = this.#publicDelivery(item, positions);
              return {
                id: delivery.id,
                recipientAgentId: delivery.recipientAgentId,
                status: delivery.status,
                position: delivery.position,
                error: delivery.error,
              };
            }),
          },
          createdAt: message.createdAt,
          status: "completed",
          itemType: "agent-exchange",
        });
      }

      for (const storedDelivery of deliveries) {
        if (storedDelivery.recipientAgentId !== agentId) continue;
        const delivery = this.#publicDelivery(storedDelivery, positions);
        messages.push({
          id: delivery.id,
          turnId: storedDelivery.turnId ?? undefined,
          author: message.sender.kind === "agent" ? "agent" : "user",
          source: message.sender.kind === "agent" ? "agent" : message.sender.kind === "routine" ? "routine" : "user",
          text: message.text,
          senderAgentId: message.sender.kind === "agent" ? message.sender.agentId : undefined,
          ...(message.senderMember ? { senderMember: { ...message.senderMember } } : {}),
          attachments: message.attachments.map(toAttachmentSummary),
          replyToMessageId: message.replyToMessageId,
          delivery: {
            id: delivery.id,
            status: delivery.status,
            position: delivery.position,
          },
          exchange:
            message.sender.kind === "agent"
              ? {
                  direction: "incoming",
                  messageId: message.id,
                  senderAgentId: message.sender.agentId,
                  recipientAgentIds: deliveries.map((item) => item.recipientAgentId),
                  replyToMessageId: message.replyToMessageId,
                  ...(message.expectsReply === false ? { expectsReply: false } : {}),
                  deliveries: deliveries.map((item) => {
                    const publicItem = this.#publicDelivery(item, positions);
                    return {
                      id: publicItem.id,
                      recipientAgentId: publicItem.recipientAgentId,
                      status: publicItem.status,
                      position: publicItem.position,
                      error: publicItem.error,
                    };
                  }),
                }
              : undefined,
          routine:
            message.sender.kind === "routine"
              ? {
                  routineId: message.sender.routineId,
                  runId: message.sender.runId,
                  name: message.sender.routineName,
                  scheduledFor: message.sender.scheduledFor,
                }
              : undefined,
          createdAt: message.createdAt,
          status: delivery.status === "failed" ? "failed" : "completed",
          itemType:
            message.sender.kind === "agent"
              ? "agent-exchange"
              : message.sender.kind === "routine"
                ? "routine"
                : undefined,
        });
      }
    }
    return messages;
  }

  reactionFor(
    agentId: string,
    messageId: string,
    actor: ConversationReactionActor = { kind: "user" },
  ): MessageReaction | null {
    return (
      this.#state.reactions.find(
        (reaction) =>
          reaction.agentId === agentId &&
          reaction.messageId === messageId &&
          reactionActorsEqual(reaction.actor, actor),
      )?.emoji ?? null
    );
  }

  reactionsFor(agentId: string): Map<string, ConversationReaction[]> {
    const result = new Map<string, ConversationReaction[]>();
    for (const reaction of this.#state.reactions) {
      if (reaction.agentId !== agentId) continue;
      const reactions = result.get(reaction.messageId) ?? [];
      reactions.push({ emoji: reaction.emoji, actor: reaction.actor });
      result.set(reaction.messageId, reactions);
    }
    for (const reactions of result.values()) reactions.sort(compareReactionActors);
    return result;
  }

  setReaction = Effect.fn("MailboxStore.setReaction")(function* (
    this: MailboxStore,
    agentId: string,
    messageId: string,
    actor: ConversationReactionActor,
    emoji: MessageReaction | null,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const index = this.#state.reactions.findIndex(
        (reaction) =>
          reaction.agentId === agentId &&
          reaction.messageId === messageId &&
          reactionActorsEqual(reaction.actor, actor),
      );
      if (emoji === null) {
        if (index < 0) return;
        this.#state.reactions.splice(index, 1);
      } else if (index >= 0) {
        this.#state.reactions[index] = {
          agentId,
          messageId,
          emoji,
          actor,
          updatedAt: new Date().toISOString(),
        };
      } else {
        this.#state.reactions.push({
          agentId,
          messageId,
          emoji,
          actor,
          updatedAt: new Date().toISOString(),
        });
      }
      this.#persist("reaction.updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  #sourceTurnId(messageId: string): string | undefined {
    const key = Object.entries(this.#state.idempotency).find(([, value]) => value === messageId)?.[0];
    if (!key) return undefined;
    const parts = key.split(":");
    return parts.length >= 3 ? parts.at(-2) : undefined;
  }

  senderAgentIdsForRecipient(agentId: string): string[] {
    const result = new Set<string>();
    for (const delivery of this.#state.deliveries) {
      if (delivery.recipientAgentId !== agentId) continue;
      const sender = this.#requireMessage(delivery.messageId).sender;
      if (sender.kind === "agent") result.add(sender.agentId);
    }
    return [...result];
  }

  nextQueued(agentId: string): DeliveryContext | null {
    if (
      this.#state.deliveries.some(
        (delivery) =>
          delivery.recipientAgentId === agentId && (delivery.status === "starting" || delivery.status === "running"),
      )
    ) {
      return null;
    }
    const delivery = this.#queuedFor(agentId).find((candidate) => !this.#isHeldReply(candidate));
    return delivery && this.#mayStart(delivery) ? this.#context(delivery) : null;
  }

  /**
   * The teammate answers that start in the same turn as this delivery. For an answer, these are the
   * other answers to the same request. For a message from the person, these are the answers that
   * wait for a slow teammate: the person writes before all answers are in, so they are read now.
   */
  repliesToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next) return [];
    const message = this.#requireMessage(next.messageId);
    const requestId = isAnswer(message) ? message.replyToMessageId : null;
    if (message.sender.kind !== "user" && !requestId) return [];
    return this.#queuedFor(next.recipientAgentId)
      .filter((candidate) => {
        if (candidate.id === next.id || !this.#mayStart(candidate)) return false;
        if (!requestId) return this.#isHeldReply(candidate);
        const reply = this.#requireMessage(candidate.messageId);
        return isAnswer(reply) && reply.replyToMessageId === requestId;
      })
      .map((delivery) => this.#context(delivery));
  }

  /** The agents that were sent a request and whose delivery ended with no answer. */
  unansweredRecipients(requestId: string): string[] {
    return this.#state.deliveries
      .filter(
        (delivery) =>
          delivery.messageId === requestId &&
          (delivery.status === "failed" || delivery.status === "interrupted" || delivery.status === "cancelled") &&
          // A linked question from this agent is not an answer.
          !this.#state.messages.some(
            (message) =>
              isAnswer(message) &&
              message.sender.agentId === delivery.recipientAgentId &&
              message.replyToMessageId === requestId,
          ),
      )
      .map((delivery) => delivery.recipientAgentId);
  }

  #queuedFor(agentId: string): StoredDelivery[] {
    return this.#state.deliveries
      .filter((candidate) => candidate.recipientAgentId === agentId && candidate.status === "queued")
      .sort(compareQueueOrder);
  }

  #mayStart(delivery: StoredDelivery): boolean {
    return !delivery.editId && !this.#queueUpdates.has(delivery.id);
  }

  /**
   * An answer to a request that its recipient sent to several teammates waits while another of them
   * has the request still queued or running. So the requester reads all the answers in one turn,
   * not one turn for each answer.
   */
  #isHeldReply(delivery: StoredDelivery): boolean {
    const reply = this.#requireMessage(delivery.messageId);
    if (!isAnswer(reply)) return false;
    const request = this.#state.messages.find((message) => message.id === reply.replyToMessageId);
    if (
      request?.sender.kind !== "agent" ||
      request.sender.agentId !== delivery.recipientAgentId ||
      request.expectsReply === false
    )
      return false;
    const answeredBy = reply.sender.agentId;
    return this.#state.deliveries.some(
      (candidate) =>
        candidate.messageId === request.id &&
        candidate.recipientAgentId !== answeredBy &&
        (candidate.status === "queued" || candidate.status === "starting" || candidate.status === "running"),
    );
  }

  queuedDeliveryIds(agentId: string): string[] {
    return this.#state.deliveries
      .filter((delivery) => delivery.recipientAgentId === agentId && delivery.status === "queued")
      .sort(compareQueueOrder)
      .map((delivery) => delivery.id);
  }

  getDelivery(deliveryId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#context(delivery) : null;
  }

  findDeliveryByTurn(turnId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.turnId === turnId);
    return delivery ? this.#context(delivery) : null;
  }

  findDeliveriesByTurn(agentId: string, turnId: string): DeliveryContext[] {
    return this.#state.deliveries
      .filter(
        (delivery) =>
          delivery.recipientAgentId === agentId &&
          delivery.turnId === turnId &&
          (delivery.status === "starting" || delivery.status === "running"),
      )
      .map((delivery) => this.#context(delivery));
  }

  startingDeliveryForAgent(agentId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find(
      (candidate) =>
        candidate.recipientAgentId === agentId && candidate.status === "starting" && candidate.turnId === null,
    );
    return delivery ? this.#context(delivery) : null;
  }

  /** Every delivery that starts the next turn of this agent: one, or several teammate answers. */
  startingDeliveriesForAgent(agentId: string): DeliveryContext[] {
    return this.#state.deliveries
      .filter(
        (candidate) =>
          candidate.recipientAgentId === agentId && candidate.status === "starting" && candidate.turnId === null,
      )
      .map((delivery) => this.#context(delivery));
  }

  /**
   * Removes the mailbox of one agent. What the agent shared in a channel stays: the message a
   * channel shows carries the uploaded files of that message, and a file the agent generated
   * inside a channel thread is part of the shared transcript as well. Both are owned by the
   * channel and leave with it, through `deleteChannelData`. `channelThreadIds` names the threads
   * the channels hold, because a generated file records the thread it was made in.
   */

  deleteAgentData = Effect.fn("MailboxStore.deleteAgentData")(function* (
    this: MailboxStore,
    agentId: string,
    channelThreadIds: readonly string[] = [],
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const previous = structuredClone(this.#state);
      const removedMessageIds = new Set<string>();
      const channelThreads = new Set(channelThreadIds);
      const removedGenerated = this.#state.generatedAttachments.filter(
        (attachment) =>
          attachment.ownerAgentId === agentId &&
          !(attachment.ownerThreadId && channelThreads.has(attachment.ownerThreadId)),
      );
      const removedTransferRoots = new Set<string>();
      this.#state.deliveries = this.#state.deliveries.filter((delivery) => delivery.recipientAgentId !== agentId);
      const remainingMessageIds = new Set(this.#state.deliveries.map((delivery) => delivery.messageId));
      this.#state.messages = this.#state.messages.filter((message) => {
        const keep = remainingMessageIds.has(message.id) || message.channelId !== undefined;
        if (!keep) removedMessageIds.add(message.id);
        if (!keep) {
          for (const attachment of message.attachments) {
            const transferRoot = this.#files.transferRootForPath(attachment.path);
            if (transferRoot) removedTransferRoots.add(transferRoot);
          }
        }
        return keep;
      });
      for (const messageId of removedMessageIds) removedTransferRoots.add(this.#files.transferRoot(messageId));
      this.#state.pausedAgentIds = this.#state.pausedAgentIds.filter((id) => id !== agentId);
      this.#state.reactions = this.#state.reactions.filter(
        (reaction) => reaction.agentId !== agentId && !removedMessageIds.has(reaction.messageId),
      );
      this.#state.idempotency = Object.fromEntries(
        Object.entries(this.#state.idempotency).filter(([, messageId]) => !removedMessageIds.has(messageId)),
      );
      this.#state.generatedAttachments = this.#state.generatedAttachments.filter(
        (attachment) => !removedGenerated.includes(attachment),
      );
      try {
        this.#persist(
          "mailbox.agent-data-deleted",
          `mailbox:hard-delete:${randomUUID()}`,
          [
            ...removedTransferRoots,
            ...removedGenerated
              .map((attachment) => this.#files.generatedRootForPath(attachment.path))
              .filter((path): path is string => path !== null),
          ],
          true,
        );
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /** Removes messages, deliveries, reactions and attachments that belong to a channel. */

  deleteChannelData = Effect.fn("MailboxStore.deleteChannelData")(function* (
    this: MailboxStore,
    channelId: string,
    threadIds: readonly string[] = [],
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const previous = structuredClone(this.#state);
      const removedMessageIds = new Set(
        this.#state.messages.filter((message) => message.channelId === channelId).map((message) => message.id),
      );
      const removedThreadIds = new Set(threadIds);
      const removedTransferRoots = new Set<string>();
      for (const message of this.#state.messages) {
        if (!removedMessageIds.has(message.id)) continue;
        removedTransferRoots.add(this.#files.transferRoot(message.id));
        for (const attachment of message.attachments) {
          const transferRoot = this.#files.transferRootForPath(attachment.path);
          if (transferRoot) removedTransferRoots.add(transferRoot);
        }
      }
      const removedGenerated = this.#state.generatedAttachments.filter(
        (attachment) =>
          attachment.ownerThreadId !== undefined &&
          attachment.ownerThreadId !== null &&
          removedThreadIds.has(attachment.ownerThreadId),
      );
      this.#state.messages = this.#state.messages.filter((message) => message.channelId !== channelId);
      this.#state.deliveries = this.#state.deliveries.filter((delivery) => !removedMessageIds.has(delivery.messageId));
      this.#state.reactions = this.#state.reactions.filter((reaction) => !removedMessageIds.has(reaction.messageId));
      this.#state.idempotency = Object.fromEntries(
        Object.entries(this.#state.idempotency).filter(([, messageId]) => !removedMessageIds.has(messageId)),
      );
      this.#state.generatedAttachments = this.#state.generatedAttachments.filter(
        (attachment) => !removedGenerated.includes(attachment),
      );
      for (const attachment of removedGenerated) {
        const generatedRoot = this.#files.generatedRootForPath(attachment.path);
        if (generatedRoot) removedTransferRoots.add(generatedRoot);
      }
      try {
        this.#persist(
          "mailbox.channel-data-deleted",
          `mailbox:channel-delete:${randomUUID()}`,
          [...removedTransferRoots],
          true,
        );
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  chainOriginAgentId(messageId: string): string | null {
    const visited = new Set<string>();
    let message = this.#state.messages.find((candidate) => candidate.id === messageId);
    while (message && !visited.has(message.id)) {
      visited.add(message.id);
      const parent = message.replyToMessageId
        ? this.#state.messages.find((candidate) => candidate.id === message?.replyToMessageId)
        : undefined;
      if (!parent) return message.sender.kind === "agent" ? message.sender.agentId : null;
      message = parent;
    }
    return null;
  }

  /** Whether the message's sender waits for an answer. Unknown messages count as expecting one. */
  expectsReply(messageId: string): boolean {
    return this.#state.messages.find((message) => message.id === messageId)?.expectsReply !== false;
  }

  hasReplyFrom(agentId: string, messageId: string): boolean {
    return this.#state.messages.some(
      (message) =>
        message.sender.kind === "agent" && message.sender.agentId === agentId && message.replyToMessageId === messageId,
    );
  }

  hasAgentMessageFromTurnTo(agentId: string, turnId: string, recipientAgentId: string): boolean {
    return this.#state.messages.some((message) => {
      if (message.sender.kind !== "agent" || message.sender.agentId !== agentId) return false;
      if (this.#sourceTurnId(message.id) !== turnId) return false;
      return this.#state.deliveries.some(
        (delivery) => delivery.messageId === message.id && delivery.recipientAgentId === recipientAgentId,
      );
    });
  }

  markStarting = Effect.fn("MailboxStore.markStarting")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      this.#assertQueueNotEditing(deliveryId);
      yield* this.#updateDeliveryEffect(deliveryId, ["queued"], { status: "starting", error: null });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  markRunning = Effect.fn("MailboxStore.markRunning")(function* (
    this: MailboxStore,
    deliveryId: string,
    turnId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "running",
        turnId,
        error: null,
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  markTerminal = Effect.fn("MailboxStore.markTerminal")(function* (
    this: MailboxStore,
    deliveryId: string,
    status: Extract<QueueDeliveryStatus, "completed" | "failed" | "interrupted">,
    error: string | null = null,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      // Redacted here, not at the call site: this text is written to the database and read back by
      // the renderer through the queue. A provider CLI quotes what it was given, so a failure against
      // a custom endpoint can carry that endpoint's API key or a header value.
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status,
        error: error === null ? null : redactText(error),
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  cancel = Effect.fn("MailboxStore.cancel")(function* (
    this: MailboxStore,
    agentId: string,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      this.cancelNow(agentId, deliveryId);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  cancelNow(agentId: string, deliveryId: string): void {
    this.#assertQueueNotUpdating(deliveryId);
    const delivery = this.#state.deliveries.find(
      (candidate) => candidate.id === deliveryId && candidate.recipientAgentId === agentId,
    );
    if (!delivery) throw new Error(sourceText("error.backend.queuedMessageNotFound"));
    if (delivery.status !== "queued") throw new Error(sourceText("error.backend.cancelQueuedOnly"));
    this.#finishCancellation(delivery, true);
  }

  restorePersistedState(): void {
    const persisted = toCurrentMailboxState(this.#database.readMailboxState());
    if (!persisted || !isStoredState(persisted)) throw new Error("Stored mailbox projection is invalid.");
    this.#state = normalizeStoredState(persisted);
  }

  #assertQueueNotEditing(deliveryId: string): void {
    this.#assertQueueNotUpdating(deliveryId);
    if (this.#state.deliveries.find((item) => item.id === deliveryId)?.editId)
      throw new Error(sourceText("error.backend.messageBeingEdited"));
  }

  beginQueueEdit(agentId: string, deliveryId: string, editId: string): void {
    this.#assertQueueNotUpdating(deliveryId);
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId && item.recipientAgentId === agentId);
    if (delivery?.status !== "queued")
      throw new QueueEditRejectedError(sourceText("error.backend.queuedMessageUnavailable"));
    if (delivery.editId && delivery.editId !== editId)
      throw new QueueEditRejectedError(sourceText("error.backend.editedOnOtherDevice"));
    const previous = delivery.editId;
    delivery.editId = editId;
    try {
      this.#persist("delivery.edit-started");
    } catch (error) {
      delivery.editId = previous;
      throw error;
    }
  }

  retainQueueEditAttachments(agentId: string, deliveryId: string, editId: string, draftIds: string[]): void {
    this.#assertQueueNotUpdating(deliveryId);
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId && item.recipientAgentId === agentId);
    if (delivery?.status !== "queued" || delivery.editId !== editId)
      throw new QueueEditRejectedError(sourceText("error.backend.editUnavailable"));
    if (draftIds.length > MAX_ATTACHMENTS || new Set(draftIds).size !== draftIds.length)
      throw new Error("Invalid edit attachment count.");
    const drafts = draftIds.map((id) => {
      const draft = this.#state.drafts.find((item) => item.id === id);
      if (!draft) throw new Error(sourceText("error.backend.attachmentDraftGone", { id }));
      return draft;
    });
    if (drafts.some((draft) => draft.ownerEditId && draft.ownerEditId !== editId))
      throw new Error(sourceText("error.backend.attachmentInOtherEdit"));
    const previous = drafts.map((draft) => draft.ownerEditId);
    for (const draft of drafts) draft.ownerEditId = editId;
    try {
      this.#persist("delivery.edit-attachments-retained");
    } catch (error) {
      drafts.forEach((draft, index) => {
        draft.ownerEditId = previous[index];
      });
      throw error;
    }
  }

  /**
   * Reports which action completed an edit, so a retry that lost its response can tell a
   * finished Save from a finished Cancel. A Save that repeats a Cancel must not report
   * success: the host never applied that text.
   */
  finishedQueueEditAction(agentId: string, deliveryId: string, editId: string): QueueEditOutcome | undefined {
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId && item.recipientAgentId === agentId);
    return delivery?.finishedEditOutcomes?.[editId]?.action;
  }

  matchesFinishedQueueSave(
    agentId: string,
    deliveryId: string,
    editId: string,
    text: string,
    keepAttachmentIds: string[],
    attachmentDraftIds: string[],
  ): boolean {
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId && item.recipientAgentId === agentId);
    const outcome = delivery?.finishedEditOutcomes?.[editId];
    return (
      outcome !== undefined &&
      outcome.action === "save" &&
      outcome.saveHash === queueSaveHash(text, keepAttachmentIds, attachmentDraftIds)
    );
  }

  finishQueueEdit(agentId: string, deliveryId: string, editId: string): void {
    this.#assertQueueNotUpdating(deliveryId);
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId && item.recipientAgentId === agentId);
    if (!delivery || delivery.editId !== editId)
      throw new QueueEditRejectedError(sourceText("error.backend.editUnavailable"));
    this.#finishCancellation(delivery, false);
  }

  #finishCancellation(delivery: StoredDelivery, cancelDelivery: boolean): void {
    const editId = delivery.editId;
    const previousStatus = delivery.status;
    const previousOutcomes = delivery.finishedEditOutcomes;
    const released = editId ? this.#state.drafts.filter((draft) => draft.ownerEditId === editId) : [];
    const previousRetention = released.map((draft) => draft.preserveOnRestart);
    if (cancelDelivery) delivery.status = "cancelled";
    if (editId) recordFinishedQueueEdit(delivery, editId, { action: "cancel" });
    delete delivery.editId;
    for (const draft of released) {
      delete draft.ownerEditId;
      // Release the lock, not the bytes: a disconnected editor can still restore its
      // backup, including after a lost cancellation response and host restart.
      draft.preserveOnRestart = true;
    }
    try {
      this.#persist(cancelDelivery ? "delivery.cancelled" : "delivery.edit-finished");
    } catch (error) {
      delivery.status = previousStatus;
      delivery.editId = editId;
      delivery.finishedEditOutcomes = previousOutcomes;
      released.forEach((draft, index) => {
        draft.ownerEditId = editId;
        draft.preserveOnRestart = previousRetention[index];
      });
      throw error;
    }
  }

  #assertQueueNotUpdating(deliveryId: string): void {
    if (this.#queueUpdates.has(deliveryId)) throw new Error(sourceText("error.backend.messageBeingSaved"));
  }

  updateQueuedMessage(
    agentId: string,
    deliveryId: string,
    text: string,
    keepAttachmentIds: string[],
    attachmentDraftIds: string[],
    editId?: string,
    sender?: ConversationMessageSender,
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* storedSync(() => this.#assertQueueNotUpdating(deliveryId));
      this.#queueUpdates.add(deliveryId);
      yield* this.#updateQueuedMessageEffect(
        agentId,
        deliveryId,
        text,
        keepAttachmentIds,
        attachmentDraftIds,
        editId,
        sender,
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#queueUpdates.delete(deliveryId);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  #updateQueuedMessageEffect = Effect.fn("MailboxStore.updateQueuedMessage")(function* (
    this: MailboxStore,
    agentId: string,
    deliveryId: string,
    text: string,
    keepAttachmentIds: string[],
    attachmentDraftIds: string[],
    editId: string | undefined,
    sender: ConversationMessageSender | undefined,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find(
        (candidate) => candidate.id === deliveryId && candidate.recipientAgentId === agentId,
      );
      if (!delivery) throw new Error(sourceText("error.backend.queuedMessageNotFound"));
      if (delivery.status !== "queued") throw new Error(sourceText("error.backend.editQueuedOnly"));
      if (delivery.editId !== editId) throw new Error(sourceText("error.backend.editedOnOtherDevice"));

      const message = this.#requireMessage(delivery.messageId);
      const keepIds = new Set(keepAttachmentIds);
      if (keepIds.size !== keepAttachmentIds.length) throw new Error("Duplicate attachments.");
      if (keepAttachmentIds.some((id) => !message.attachments.some((item) => item.id === id))) {
        throw new Error(sourceText("error.backend.attachmentNotInMessage"));
      }

      const draftIds = new Set(attachmentDraftIds);
      if (draftIds.size !== attachmentDraftIds.length) throw new Error("Duplicate attachment drafts.");
      const drafts = attachmentDraftIds.map((id) => {
        const draft = this.#state.drafts.find((candidate) => candidate.id === id);
        if (!draft) throw new Error(sourceText("error.backend.attachmentDraftGone", { id }));
        if (draft.ownerEditId && draft.ownerEditId !== editId)
          throw new Error(sourceText("error.backend.attachmentInOtherEdit"));
        return draft;
      });
      if (keepAttachmentIds.length + drafts.length > MAX_ATTACHMENTS) {
        throw new Error(sourceText("error.backend.attachLimit", { limit: MAX_ATTACHMENTS }));
      }

      const normalizedText = text.trim();
      if (!normalizedText && keepAttachmentIds.length === 0 && drafts.length === 0) {
        throw new Error(sourceText("error.backend.messageEmpty"));
      }

      const previous = structuredClone(message);
      const previousOutcomes = delivery.finishedEditOutcomes ? { ...delivery.finishedEditOutcomes } : undefined;
      const oldAttachmentPaths = message.attachments
        .filter((attachment) => !keepIds.has(attachment.id))
        .map((attachment) => attachment.path);
      const draftAttachmentPaths = drafts.map((draft) => draft.path);
      let newAttachmentPaths: string[] = [];
      let releasedOwned: StoredDraft[] = [];
      {
        const updated = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              const keptAttachments = keepAttachmentIds.flatMap((id) =>
                message.attachments.filter((attachment) => attachment.id === id),
              );
              const committedDrafts = draftAttachmentPaths.length
                ? yield* this.#files
                    .commitMessageTransfer(
                      `${message.id}-edit-${randomUUID()}`,
                      message.sender,
                      this.#state.deliveries
                        .filter((candidate) => candidate.messageId === message.id)
                        .map((candidate) => candidate.recipientAgentId),
                      message.id,
                      new Date().toISOString(),
                      draftAttachmentPaths,
                    )
                    .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })))
                : [];
              const replacementAttachments = [...keptAttachments, ...committedDrafts];
              const replacementByReferenceId = new Map([
                ...keptAttachments.map((attachment) => [attachment.id, attachment] as const),
                ...drafts.map((draft, index) => [draft.id, committedDrafts[index]] as const),
              ]);
              newAttachmentPaths = replacementAttachments
                .filter((attachment) => !message.attachments.some((item) => item.id === attachment.id))
                .map((attachment) => attachment.path);
              message.text = rewriteAttachmentReferences(normalizedText, (reference) => {
                const attachment = replacementByReferenceId.get(reference.attachmentId);
                return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
              });
              message.attachments = replacementAttachments;
              // The saved text is the editor's, so the editor is its sender. A member can edit another
              // member's queued message, and the first name must not stay on words that person did not write.
              if (message.sender.kind === "user") setSenderMember(message, sender);
              if (editId) {
                delete delivery.editId;
                recordFinishedQueueEdit(delivery, editId, {
                  action: "save",
                  saveHash: queueSaveHash(text, keepAttachmentIds, attachmentDraftIds),
                });
              }
              this.#state.drafts = this.#state.drafts.filter((draft) => !draftIds.has(draft.id));
              if (editId) {
                // A durable composer backup retained for this edit is no longer owned by it:
                // a save discards the backup, a cancel restores it, and in both cases the
                // remaining drafts return to normal lifetime instead of staying edit-owned.
                releasedOwned = this.#state.drafts.filter((draft) => draft.ownerEditId === editId);
                for (const draft of releasedOwned) delete draft.ownerEditId;
              }
              this.#persist(
                "message.updated",
                `mailbox:message-updated:${deliveryId}:${randomUUID()}`,
                oldAttachmentPaths,
              );
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(updated)) {
          const error = updated.failure.cause;
          message.text = previous.text;
          message.attachments = previous.attachments;
          setSenderMember(message, previous.senderMember);
          if (editId) {
            delivery.editId = editId;
            if (previousOutcomes) delivery.finishedEditOutcomes = previousOutcomes;
            else delete delivery.finishedEditOutcomes;
            for (const draft of releasedOwned) draft.ownerEditId = editId;
          }
          for (const draft of drafts) {
            if (!this.#state.drafts.some((candidate) => candidate.id === draft.id)) {
              this.#state.drafts.push(draft);
            }
          }
          yield* this.#files
            .removeAttachmentDirectories(newAttachmentPaths)
            .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
          throw error;
        }
      }
      yield* this.#files
        .removeAttachmentDirectories(drafts.map((draft) => draft.path))
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  /**
   * A held delivery keeps its place. `listQueue` reports it now, so a caller may send its id with
   * the rest; both that list and one without it are accepted, and neither moves the held message.
   */

  reorderQueue = Effect.fn("MailboxStore.reorderQueue")(function* (
    this: MailboxStore,
    agentId: string,
    deliveryIds: string[],
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const allQueued = this.#state.deliveries.filter(
        (delivery) => delivery.recipientAgentId === agentId && delivery.status === "queued",
      );
      const heldIds = new Set(allQueued.filter((delivery) => delivery.editId).map((delivery) => delivery.id));
      const requested = deliveryIds.filter((deliveryId) => !heldIds.has(deliveryId));
      const queued = allQueued.filter((delivery) => !delivery.editId);
      const expected = new Set(queued.map((delivery) => delivery.id));
      if (
        requested.length !== queued.length ||
        new Set(requested).size !== requested.length ||
        requested.some((deliveryId) => !expected.has(deliveryId))
      ) {
        throw new Error(sourceText("error.backend.queueOrderStale"));
      }
      let nextVisible = 0;
      const orderedIds = [...allQueued]
        .sort(compareQueueOrder)
        .map((delivery) => (delivery.editId ? delivery.id : requested[nextVisible++]));
      const orders = new Map(orderedIds.map((deliveryId, index) => [deliveryId, index]));
      for (const delivery of allQueued) {
        delivery.queueOrder = orders.get(delivery.id) ?? delivery.queueOrder;
      }
      this.#persist("queue.reordered");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  markSteering = Effect.fn("MailboxStore.markSteering")(function* (
    this: MailboxStore,
    deliveryId: string,
    turnId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      this.#assertQueueNotEditing(deliveryId);
      yield* this.#updateDeliveryEffect(deliveryId, ["queued"], {
        status: "starting",
        turnId,
        error: null,
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  restoreQueued = Effect.fn("MailboxStore.restoreQueued")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, ["starting"], {
        status: "queued",
        turnId: null,
        error: null,
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /** A delivery whose turn the provider refused before any work, back at its place in the queue. */

  requeueRefused = Effect.fn("MailboxStore.requeueRefused")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "queued",
        turnId: null,
        error: null,
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Both guards that ask this - agent deletion and the provider switch - have to see a channel
   * delivery as well as a normal one, so neither can use {@link listQueue}, which hides channel
   * messages. `queued` counts: one agent runs at most one work turn across all chats, so a normal
   * request can wait behind another agent's channel work for as long as that work runs, and
   * deletion would take its message and files away while it waited.
   */
  hasUnfinishedDelivery(agentId: string): boolean {
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId &&
        (delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running"),
    );
  }

  unresolvedDeliveries(): DeliveryContext[] {
    return this.#state.deliveries
      .filter((delivery) => delivery.status === "starting" || delivery.status === "running")
      .map((delivery) => this.#context(delivery));
  }

  recoverAsInterrupted = Effect.fn("MailboxStore.recoverAsInterrupted")(function* (
    this: MailboxStore,
    deliveryId: string,
    reason: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "interrupted",
        error: redactText(reason),
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  resolveAttachment = Effect.fn("MailboxStore.resolveAttachment")(function* (
    this: MailboxStore,
    id: string,
  ): Effect.fn.Return<{ path: string; mimeType: string; name: string } | null, StoredStateFailure> {
    try {
      const draft = this.#state.drafts.find((candidate) => candidate.id === id);
      if (draft)
        return yield* this.#files
          .resolveDraft(draft)
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      for (const message of this.#state.messages) {
        const attachment = message.attachments.find((candidate) => candidate.id === id);
        if (attachment)
          return attachment.deletedAt
            ? null
            : yield* this.#files
                .resolveTransfer(attachment)
                .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      }
      const generated = this.#state.generatedAttachments.find((candidate) => candidate.id === id);
      if (generated)
        return generated.deletedAt
          ? null
          : yield* this.#files
              .resolveTransfer(generated)
              .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      return null;
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /** Every sent and generated file that the user has not deleted, from the in-memory state. */
  listStoredFiles(): MailboxStoredFile[] {
    const firstRecipient = new Map<string, string>();
    for (const delivery of this.#state.deliveries)
      if (!firstRecipient.has(delivery.messageId)) firstRecipient.set(delivery.messageId, delivery.recipientAgentId);
    const files: MailboxStoredFile[] = [];
    for (const message of this.#state.messages) {
      const agentId =
        message.sender.kind === "agent" ? message.sender.agentId : (firstRecipient.get(message.id) ?? null);
      for (const attachment of message.attachments) {
        if (attachment.deletedAt) continue;
        files.push({
          attachment: toAttachmentSummary(attachment),
          path: attachment.path,
          source: "attachment",
          messageId: message.id,
          agentId,
          createdAt: message.createdAt,
        });
      }
    }
    for (const attachment of this.#state.generatedAttachments) {
      if (attachment.deletedAt) continue;
      files.push({
        attachment: toAttachmentSummary(attachment),
        path: attachment.path,
        source: "generated",
        messageId: null,
        agentId: attachment.ownerAgentId ?? null,
        createdAt: null,
      });
    }
    return files;
  }

  /**
   * Deletes one sent or generated file from the disk and keeps its record with a `deletedAt`
   * marker, so the chat still shows where the file was. A file that is already gone gets only the
   * marker. The file is removed through the deletion outbox, and only when it resolves inside the
   * Transfers folder and no other record that is not deleted uses the same path.
   */

  deleteStoredFile = Effect.fn("MailboxStore.deleteStoredFile")(function* (
    this: MailboxStore,
    fileId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      // The path checks wait, so they run before the state changes. Then no other write can save the
      // markers without their outbox entry, and a failed save restores a copy that has all other changes.
      const managedPaths = new Map<string, string | null>();
      for (const path of new Set(this.#undeletedFileRecords(fileId).map((target) => target.path))) {
        managedPaths.set(
          path,
          yield* this.#files
            .managedTransferFile(path)
            .pipe(Effect.mapError((failure) => new StoredStateFailure({ cause: failure.cause }))),
        );
      }
      const records = this.#fileRecords();
      const targets = this.#undeletedFileRecords(fileId);
      const previous = structuredClone(this.#state);
      const deletedAt = new Date().toISOString();
      for (const target of targets) target.deletedAt = deletedAt;
      const inUse = new Set(records.filter((record) => !record.deletedAt).map((record) => record.path));
      const deletions: string[] = [];
      for (const path of new Set(targets.map((target) => target.path))) {
        const managed = inUse.has(path) ? null : managedPaths.get(path);
        if (managed) deletions.push(managed);
      }
      try {
        this.#persist("mailbox.file-deleted", `mailbox:file-deleted:${randomUUID()}`, deletions);
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  #fileRecords(): StoredAttachment[] {
    return [...this.#state.messages.flatMap((message) => message.attachments), ...this.#state.generatedAttachments];
  }

  #undeletedFileRecords(fileId: string): StoredAttachment[] {
    const targets = this.#fileRecords().filter((record) => record.id === fileId && !record.deletedAt);
    if (targets.length === 0) throw new Error(sourceText("error.backend.fileGone"));
    return targets;
  }

  verifyDeliveryAttachments = Effect.fn("MailboxStore.verifyDeliveryAttachments")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
      if (!delivery) throw new Error(`Unknown delivery: ${deliveryId}`);
      const message = this.#requireMessage(delivery.messageId);
      for (const attachment of message.attachments) {
        const resolved = yield* this.#files
          .resolveTransfer(attachment)
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        if (!resolved) throw new Error(sourceText("error.backend.managedAttachmentChanged", { name: attachment.name }));
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  stageGeneratedAttachments = Effect.fn("MailboxStore.stageGeneratedAttachments")(function* (
    this: MailboxStore,
    input: {
      sources: GeneratedAttachmentSource[];
      ownerAgentId?: string;
      ownerThreadId?: string | null;
    },
  ): Effect.fn.Return<AttachmentSummary[], StoredStateFailure> {
    try {
      const attachments = yield* this.#files
        .stageGenerated(input)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      for (const attachment of attachments) this.#stagedGeneratedAttachments.set(attachment.id, attachment);
      return attachments.map(toAttachmentSummary);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  persistGeneratedAttachmentsWithConversation(
    snapshot: ConversationSnapshot,
    eventType: string,
    detail: unknown,
    attachmentIds: string[],
  ): ConversationSnapshot {
    const staged = attachmentIds.map((id) => {
      const attachment = this.#stagedGeneratedAttachments.get(id);
      if (!attachment) throw new Error(`Staged generated attachment is missing: ${id}`);
      return attachment;
    });
    const nextState: StoredState = {
      ...this.#state,
      generatedAttachments: [...this.#state.generatedAttachments, ...staged],
    };
    const persisted = this.#database.persistConversationAndMailbox(
      snapshot,
      eventType,
      detail,
      nextState,
      "attachment.generated-batch",
    );
    this.#state = nextState;
    for (const id of attachmentIds) this.#stagedGeneratedAttachments.delete(id);
    return persisted;
  }

  discardStagedGeneratedAttachments = Effect.fn("MailboxStore.discardStagedGeneratedAttachments")(function* (
    this: MailboxStore,
    attachmentIds: string[],
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const ids = new Set(attachmentIds);
      const removed = attachmentIds.flatMap((id) => {
        const attachment = this.#stagedGeneratedAttachments.get(id);
        return attachment ? [attachment] : [];
      });
      if (removed.length === 0) return;

      for (const id of ids) this.#stagedGeneratedAttachments.delete(id);
      yield* this.#files
        .discardGenerated(removed)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  storeGeneratedAttachment = Effect.fn("MailboxStore.storeGeneratedAttachment")(function* (
    this: MailboxStore,
    input: {
      sourcePath?: string;
      bytes?: Uint8Array;
      name?: string;
      mimeType?: string;
      ownerAgentId?: string;
      ownerThreadId?: string | null;
    },
  ): Effect.fn.Return<AttachmentSummary, StoredStateFailure> {
    try {
      const attachment = yield* this.#files
        .storeGenerated(input)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      this.#state.generatedAttachments.push(attachment);
      try {
        this.#persist("attachment.generated");
        return toAttachmentSummary(attachment);
      } catch (error) {
        this.#state.generatedAttachments = this.#state.generatedAttachments.filter(
          (candidate) => candidate.id !== attachment.id,
        );
        yield* this.#files
          .removeAttachmentDirectories([attachment.path])
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw error;
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  listExportAttachments = Effect.fn("MailboxStore.listExportAttachments")(function* (
    this: MailboxStore,
  ): Effect.fn.Return<ExportedAttachmentFile[], StoredStateFailure> {
    try {
      const files: ExportedAttachmentFile[] = [];
      for (const [index, message] of this.#state.messages.entries()) {
        for (const attachment of message.attachments) {
          if (attachment.deletedAt) continue;
          const file = yield* this.#files
            .exportAttachment(attachment, { id: message.id, index })
            .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
          if (file) files.push(file);
        }
      }
      for (const attachment of this.#state.generatedAttachments) {
        if (attachment.deletedAt) continue;
        const file = yield* this.#files
          .exportAttachment(attachment)
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        if (file) files.push(file);
      }
      return files;
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  #context(delivery: StoredDelivery): DeliveryContext {
    const message = this.#requireMessage(delivery.messageId);
    return {
      delivery: this.#publicDelivery(delivery),
      managedAttachments: message.attachments.map((attachment) => ({
        ...toAttachmentSummary(attachment),
        path: attachment.path,
      })),
    };
  }

  #nextQueueOrder(agentId: string): number {
    return (
      this.#state.deliveries
        .filter((delivery) => delivery.recipientAgentId === agentId)
        .reduce((max, delivery) => Math.max(max, delivery.queueOrder), -1) + 1
    );
  }

  #publicDelivery(
    delivery: StoredDelivery,
    positions = this.#queuedPositions(),
    message = this.#requireMessage(delivery.messageId),
  ): QueueDelivery {
    const { editId: _editId, finishedEditOutcomes: _finishedEditOutcomes, ...publicDelivery } = delivery;
    return {
      ...publicDelivery,
      sender: structuredClone(message.sender),
      text: message.text,
      attachments: message.attachments.map(toAttachmentSummary),
      replyToMessageId: message.replyToMessageId,
      ...(message.expectsReply === false ? { expectsReply: false } : {}),
      position: delivery.status === "queued" ? (positions.get(delivery.id) ?? null) : null,
      editing: Boolean(delivery.editId),
    };
  }

  #queuedPositions(): Map<string, number> {
    const counts = new Map<string, number>();
    const positions = new Map<string, number>();
    const queued = [...this.#state.deliveries]
      .filter((delivery) => delivery.status === "queued")
      .sort(compareQueueOrder);
    for (const delivery of queued) {
      const position = (counts.get(delivery.recipientAgentId) ?? 0) + 1;
      counts.set(delivery.recipientAgentId, position);
      positions.set(delivery.id, position);
    }
    return positions;
  }

  #receipt(messageId: string): QueuedMessageReceipt {
    const positions = this.#queuedPositions();
    return {
      messageId,
      deliveries: this.#state.deliveries
        .filter((delivery) => delivery.messageId === messageId)
        .map((delivery) => {
          const item = this.#publicDelivery(delivery, positions);
          return {
            id: item.id,
            recipientAgentId: item.recipientAgentId,
            status: item.status,
            position: item.position,
          };
        }),
    };
  }

  #updateDeliveryEffect = Effect.fn("MailboxStore.updateDelivery")(function* (
    this: MailboxStore,
    id: string,
    allowed: QueueDeliveryStatus[],
    patch: Partial<StoredDelivery>,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find((candidate) => candidate.id === id);
      if (!delivery) throw new Error(`Unknown delivery: ${id}`);
      if (!allowed.includes(delivery.status)) return;
      Object.assign(delivery, patch);
      this.#persist("delivery.updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #requireMessage(id: string): StoredMessage {
    const message = this.#state.messages.find((candidate) => candidate.id === id);
    if (!message) throw new Error(`Mailbox message is missing: ${id}`);
    return message;
  }

  #readStateEffect = Effect.fn("MailboxStore.readState")(function* (
    this: MailboxStore,
  ): Effect.fn.Return<StoredState, StoredStateFailure> {
    const loaded = yield* Effect.result(storedIO(() => readFile(this.#statePath, "utf8")));
    if (Result.isFailure(loaded)) {
      const error = loaded.failure.cause;
      if (isRecord(error) && error.code === "ENOENT") return structuredClone(EMPTY_STATE);
      return yield* loaded.failure;
    }
    return yield* storedSync(() => {
      const value = toCurrentMailboxState(JSON.parse(loaded.success));
      if (!value || !isStoredState(value)) throw new Error(sourceText("error.backend.mailboxStateCorrupt"));
      return value;
    });
  });

  #persist(
    eventType = "mailbox.updated",
    commandId = `mailbox:${eventType}:${randomUUID()}`,
    fileDeletions: string[] = [],
    rebaseHistory = false,
  ): void {
    this.#database.replaceMailboxState(commandId, this.#state, eventType, fileDeletions, rebaseHistory);
  }

  #drainFileDeletionOutboxEffect = Effect.fn("MailboxStore.drainFileDeletionOutbox")(function* (this: MailboxStore) {
    const pending = yield* storedSync(() => this.#database.pendingFileDeletions());
    for (const item of pending) {
      const removed = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          yield* this.#files.remove(item.path).pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
          yield* storedSync(() => this.#database.completeFileDeletion(item.id));
        }),
      );
      if (Result.isFailure(removed)) {
        const error = removed.failure.cause;
        yield* storedSync(() =>
          this.#database.failFileDeletion(item.id, error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }, Effect.uninterruptible);
}

function normalizeStoredState(value: StoredState): StoredState {
  const nextOrderByAgent = new Map<string, number>();
  const deliveries = value.deliveries.map((delivery) => {
    const fallback = nextOrderByAgent.get(delivery.recipientAgentId) ?? 0;
    const queueOrder = Number.isFinite(delivery.queueOrder) ? delivery.queueOrder : fallback;
    nextOrderByAgent.set(delivery.recipientAgentId, Math.max(fallback, queueOrder + 1));
    return { ...delivery, queueOrder };
  });
  return {
    ...value,
    version: 3,
    generatedAttachments: value.generatedAttachments ?? [],
    deliveries,
    reactions: value.reactions.map((reaction) => ({
      ...reaction,
      actor: reaction.actor ?? { kind: "user" },
    })),
  };
}

function compareQueueOrder(left: StoredDelivery, right: StoredDelivery): number {
  return (
    left.queueOrder - right.queueOrder ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Mailbox state written before the bot-to-agent rename spells the product agent `bot`. The validators
 * below run *before* normalization and throw "Stored mailbox projection is invalid.", so an old
 * spelling does not degrade -- it blocks startup outright. Migration v13 rewrites the database, but a
 * user who restores `openbot.db` from their own copy of the file never runs it, and `mailbox.json`
 * predates the database entirely. So every read tolerates both spellings and every write emits only
 * the new one. This renames keys and the `sender.kind` / `actor.kind` discriminant, never message text.
 */
function toCurrentMailboxState(value: unknown): DynamicRecord | null {
  if (!isRecord(value)) return null;
  const state = withCurrentAgentKeys(value, { pausedBotIds: "pausedAgentIds" });
  return {
    ...state,
    ...(Array.isArray(state.messages) ? { messages: state.messages.map(toCurrentMailboxMessage) } : {}),
    ...(Array.isArray(state.deliveries) ? { deliveries: state.deliveries.map(toCurrentDelivery) } : {}),
    ...(Array.isArray(state.generatedAttachments)
      ? { generatedAttachments: state.generatedAttachments.map(toCurrentGeneratedAttachment) }
      : {}),
    ...(Array.isArray(state.reactions) ? { reactions: state.reactions.map(toCurrentMailboxReaction) } : {}),
  };
}

const ACTOR_AGENT_KEYS: Readonly<Record<string, string>> = { botId: "agentId" };

function toCurrentDelivery(value: unknown): DynamicRecord | null {
  return isRecord(value) ? withCurrentAgentKeys(value, { recipientBotId: "recipientAgentId" }) : null;
}

function toCurrentGeneratedAttachment(value: unknown): DynamicRecord | null {
  return isRecord(value) ? withCurrentAgentKeys(value, { ownerBotId: "ownerAgentId" }) : null;
}

function setSenderMember(message: StoredMessage, sender: ConversationMessageSender | undefined): void {
  if (sender) message.senderMember = sender;
  else delete message.senderMember;
}

function toCurrentMailboxMessage(value: unknown): DynamicRecord | null {
  if (!isRecord(value)) return null;
  const { senderMember, ...message } = value;
  // A sender that does not decode only loses the name on its message; it must not stop the whole
  // mailbox from loading.
  return {
    ...message,
    sender: toCurrentMailboxActor(value.sender),
    ...(isConversationMessageSender(senderMember) ? { senderMember } : {}),
  };
}

function toCurrentMailboxReaction(value: unknown): DynamicRecord | null {
  if (!isRecord(value)) return null;
  const reaction = withCurrentAgentKeys(value, ACTOR_AGENT_KEYS);
  return reaction.actor === undefined ? reaction : { ...reaction, actor: toCurrentMailboxActor(reaction.actor) };
}

function toCurrentMailboxActor(value: unknown): DynamicRecord | null {
  if (!isRecord(value)) return null;
  const actor = withCurrentAgentKeys(value, ACTOR_AGENT_KEYS);
  return actor.kind === "bot" ? { ...actor, kind: "agent" } : actor;
}

/**
 * Rewrites the legacy keys onto their current names, dropping a legacy key whose current name is
 * already present so a half-migrated record cannot resurrect a stale value.
 */
function withCurrentAgentKeys(value: DynamicRecord, renames: Readonly<Record<string, string>>): DynamicRecord {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const current = renames[key];
      if (current === undefined) return [[key, entry]];
      return value[current] === undefined ? [[current, entry]] : [];
    }),
  );
}

function isStoredState(value: unknown): value is StoredState {
  return (
    isRecord(value) &&
    (value.version === 1 || value.version === 2 || value.version === 3) &&
    Array.isArray(value.messages) &&
    value.messages.every(isStoredMessage) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isStoredDelivery) &&
    Array.isArray(value.drafts) &&
    value.drafts.every(isStoredDraft) &&
    (value.generatedAttachments === undefined ||
      (Array.isArray(value.generatedAttachments) && value.generatedAttachments.every(isStoredGeneratedAttachment))) &&
    Array.isArray(value.pausedAgentIds) &&
    value.pausedAgentIds.every((item) => isString(item)) &&
    isRecord(value.idempotency) &&
    Object.values(value.idempotency).every((item) => isString(item)) &&
    Array.isArray(value.reactions) &&
    value.reactions.every(isStoredReaction)
  );
}

function isStoredAttachment(value: unknown): value is StoredAttachment {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isNumber(value.size) &&
    (value.kind === "image" || value.kind === "file") &&
    isString(value.mimeType) &&
    (value.previewKind === "image" ||
      value.previewKind === "pdf" ||
      value.previewKind === "text" ||
      value.previewKind === "none") &&
    (isString(value.previewUrl) || value.previewUrl === undefined) &&
    isString(value.path) &&
    isString(value.sha256) &&
    (value.deletedAt === undefined || isString(value.deletedAt))
  );
}

function isStoredGeneratedAttachment(value: unknown): value is StoredGeneratedAttachment {
  if (!isRecord(value)) return false;
  if (!isStoredAttachment(value)) return false;
  return (
    (value.ownerAgentId === undefined || isString(value.ownerAgentId)) &&
    (value.ownerThreadId === undefined || value.ownerThreadId === null || isString(value.ownerThreadId))
  );
}

function isStoredDraft(value: unknown): value is StoredDraft {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    (value.ownerEditId === undefined || isString(value.ownerEditId)) &&
    (value.preserveOnRestart === undefined || typeof value.preserveOnRestart === "boolean") &&
    isStoredAttachment(value)
  );
}

function isMessagingOrigin(value: unknown): value is MessagingOrigin {
  return (
    isRecord(value) &&
    isString(value.linkId) &&
    isString(value.authorId) &&
    isString(value.authorName) &&
    isString(value.platformMessageId)
  );
}

function isStoredMessage(value: unknown): value is StoredMessage {
  return (
    isRecord(value) &&
    (value.channelId === undefined || isString(value.channelId)) &&
    (value.messaging === undefined || isMessagingOrigin(value.messaging)) &&
    (value.messagingReturn === undefined || isMessagingOrigin(value.messagingReturn)) &&
    isString(value.id) &&
    isRecord(value.sender) &&
    (value.sender.kind === "user" ||
      (value.sender.kind === "agent" && isString(value.sender.agentId)) ||
      (value.sender.kind === "routine" &&
        isString(value.sender.routineId) &&
        isString(value.sender.runId) &&
        isString(value.sender.routineName) &&
        isString(value.sender.scheduledFor))) &&
    (value.senderMember === undefined || isConversationMessageSender(value.senderMember)) &&
    isString(value.text) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isStoredAttachment) &&
    (isString(value.replyToMessageId) || value.replyToMessageId === null) &&
    (value.expectsReply === undefined || value.expectsReply === false) &&
    isString(value.createdAt)
  );
}

function isStoredDelivery(value: unknown): value is StoredDelivery {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.messageId) &&
    isString(value.recipientAgentId) &&
    (value.editId === undefined || isString(value.editId)) &&
    (value.finishedEditOutcomes === undefined || isFinishedEditOutcomes(value.finishedEditOutcomes)) &&
    (value.queueOrder === undefined || (isNumber(value.queueOrder) && Number.isFinite(value.queueOrder))) &&
    (value.status === "queued" ||
      value.status === "starting" ||
      value.status === "running" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "interrupted" ||
      value.status === "cancelled") &&
    (isString(value.turnId) || value.turnId === null) &&
    (isString(value.error) || value.error === null) &&
    isString(value.createdAt)
  );
}

function isFinishedEditOutcomes(value: unknown): value is Record<string, StoredFinishedEdit> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        isRecord(item) &&
        (item.action === "save" || item.action === "cancel") &&
        (item.saveHash === undefined || isString(item.saveHash)),
    )
  );
}

function isStoredReaction(value: unknown): value is StoredReaction {
  return (
    isRecord(value) &&
    isString(value.agentId) &&
    isString(value.messageId) &&
    isMessageReaction(value.emoji) &&
    (value.actor === undefined || isStoredReactionActor(value.actor)) &&
    isString(value.updatedAt)
  );
}

function isStoredReactionActor(value: unknown): value is ConversationReactionActor {
  return (
    isRecord(value) &&
    (value.kind === "user" || (value.kind === "agent" && isString(value.agentId) && value.agentId.length > 0))
  );
}

function reactionActorsEqual(left: ConversationReactionActor, right: ConversationReactionActor): boolean {
  return (
    left.kind === right.kind && (left.kind === "user" || (right.kind === "agent" && left.agentId === right.agentId))
  );
}

function compareReactionActors(left: ConversationReaction, right: ConversationReaction): number {
  if (left.actor.kind !== right.actor.kind) return left.actor.kind === "user" ? -1 : 1;
  if (left.actor.kind === "user" || right.actor.kind === "user") return 0;
  return left.actor.agentId.localeCompare(right.actor.agentId);
}

function queueSaveHash(text: string, keepAttachmentIds: string[], attachmentDraftIds: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([text, keepAttachmentIds, attachmentDraftIds]))
    .digest("hex");
}

/**
 * Completed edit outcomes live on by edit identity, so a lost Save response stays
 * confirmable after another device edits and saves the same message again. A single
 * latest-only record would forget the first save the moment the second one commits.
 * Entries are kept while the delivery stays queued: both clients retain `pendingSave`
 * without an expiry, so the host cannot assume an older result is unused. Each entry
 * is one edit id plus one action and hash, so the map grows only with human edits of
 * one queued message.
 */
function recordFinishedQueueEdit(delivery: StoredDelivery, editId: string, outcome: StoredFinishedEdit): void {
  delivery.finishedEditOutcomes = { ...(delivery.finishedEditOutcomes ?? {}), [editId]: outcome };
}

/** An agent's answer to a request. A linked message that asks for a reply is a new request. */
function isAnswer(
  message: StoredMessage,
): message is StoredMessage & { sender: { kind: "agent"; agentId: string }; replyToMessageId: string } {
  return message.sender.kind === "agent" && message.replyToMessageId !== null && message.expectsReply === false;
}
