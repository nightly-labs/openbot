import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { playableMediaKind } from "@openbot/contracts/attachment-files";
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
  QueueSteerFallback,
} from "@openbot/contracts/ipc";
import {
  AGENT_EXCHANGE_ITEM_TYPE,
  AGENT_RUNTIME_ATTENTION_LIMIT,
  AGENT_RUNTIME_TEXT_LIMIT,
  AGENT_RUNTIME_WORKING_ITEMS_LIMIT,
  isConversationMessageSender,
  isMessageReaction,
  QUEUE_STEER_FALLBACKS,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
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
import { StoredStateFailure, storedIO, storedSync, toStoredStateFailure } from "./stored-state-effects";

export type { ExportedAttachmentFile, GeneratedAttachmentSource } from "./attachment-files";

import { isEmptyStoredFile, parseStoredJson } from "./atomic-json-file";
import { mailboxReactionRowKey } from "./database/mailbox-projection";
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
  /** The person's message that this one replies to, given to the agent as context. */
  replyTo?: { authorName: string; text: string; sentAt: string };
}

interface StoredMessage {
  channelId?: string | undefined;
  messaging?: MessagingOrigin;
  /**
   * A request an agent sent from an external conversation, such as a Slack thread. The teammate's
   * answer to it goes back to that conversation, not to the agent's own chat. Never sent to a client.
   */
  messagingReturn?: MessagingOrigin;
  /**
   * The task this message runs in, a conversation of its recipient beside its own chat. The queue
   * and the public chat do not show it, like channel work. A task message has one recipient.
   */
  taskId?: string;
  /**
   * The side thread an agent sent this message from. An answer to it runs in that thread, and the
   * sender's own chat does not show it. Never sent to a client.
   */
  senderTaskId?: string;
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
  /**
   * What the user said, when a voice turn sent the text. It sits beside `attachments`, not in them,
   * and in its own transfer folder, so the agent's prompt and the transfer manifest never name it.
   */
  voiceRecording?: StoredAttachment;
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

export interface UsageLimitContinuation {
  turnId: string;
  workSteps: string;
  previousTurnIds: string[];
}

/**
 * The turns that OpenBot added to a delivery because its plan still had open steps. `queued` is set
 * from the end of one turn to the start of the next; the queue then shows the delivery as running.
 */
interface PlanContinuationMarker {
  turnIds: string[];
  queued?: true;
}

interface StoredDelivery {
  editId?: string | undefined;
  finishedEditOutcomes?: Record<string, StoredFinishedEdit> | undefined;
  id: string;
  messageId: string;
  recipientAgentId: string;
  queueOrder: number;
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
  createdAt: string;
  /** Time this delivery joined a running turn. The mailbox keeps the original send time. */
  steeredAt?: string;
  /** Sent to steer the running turn, and waiting in the queue instead. Shown only while queued. */
  steerFallback?: QueueSteerFallback;
  /** The interrupted turn whose work continues after a usage-limit switch. Kept out of queue snapshots. */
  resumeAfterUsageLimit?: UsageLimitContinuation;
  /** OpenBot's automatic plan continuations of this delivery. Kept out of queue snapshots. */
  planContinuation?: PlanContinuationMarker;
}

/** A delivery that waits for its automatic plan continuation. It is queued, but not in the queue the user sees. */
function waitsForPlanContinuation(delivery: StoredDelivery): boolean {
  return delivery.status === "queued" && delivery.planContinuation?.queued === true;
}

function isActiveDelivery(delivery: StoredDelivery): boolean {
  return delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running";
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
  taskId?: string;
  senderTaskId?: string;
  sender: StoredMessage["sender"];
  senderMember?: ConversationMessageSender;
  recipientAgentIds: string[];
  text: string;
  replyToMessageId?: string | null;
  /** False marks information the recipient must not answer. Defaults to an expected answer. */
  expectsReply?: boolean | undefined;
  draftIds?: string[];
  /** An audio draft of what the user said. Kept with the message, not sent to the recipient. */
  voiceRecordingDraftId?: string;
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
  resumeAfterUsageLimit?: UsageLimitContinuation;
  planContinuation?: PlanContinuationMarker;
  channelId?: string;
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

/**
 * Files a channel request holds before the channel stores it. Run `accept` once the channel stored
 * the request, or `revert` when it refused it: until then the drafts can still be restored.
 */
export interface CommittedChannelAttachments {
  text: string;
  attachments: AttachmentSummary[];
  accept: Effect.Effect<void>;
  revert: Effect.Effect<void, StoredStateFailure>;
}

/** The most completed messages that one `conversationMessages` read returns. */
export const MAILBOX_CONVERSATION_MESSAGE_LIMIT = 100;

export class MailboxStore {
  readonly #statePath: string;
  readonly #files: AttachmentFiles;
  readonly #database: OpenBotDatabase;
  readonly #queueUpdates = new Set<string>();
  readonly #deliveryGate = new MailboxDeliveryGate();
  readonly #stagedGeneratedAttachments = new Map<string, StoredGeneratedAttachment>();
  #state: StoredState = structuredClone(EMPTY_STATE);
  /** The rows changed, added or removed, since the last committed write. `#persist` writes only these. */
  readonly #changes = {
    messageIds: new Set<string>(),
    deliveryIds: new Set<string>(),
    draftIds: new Set<string>(),
    generatedAttachmentIds: new Set<string>(),
    reactionKeys: new Set<string>(),
  };

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
        // Each read accepts rows in an older form, and a write stores only the rows that changed. So
        // rows that the read had to bring to the current form are all written once, here.
        if (JSON.stringify(this.#state) !== JSON.stringify(stored)) {
          this.#persist("mailbox.normalized", undefined, [], true);
        }
      } else {
        this.#state = normalizeStoredState(yield* this.#readStateEffect());
        yield* this.#database.backupLegacyFile(this.#statePath);
        this.#persist("mailbox.legacy-imported", "legacy-import:mailbox:v1", [], true);
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
        for (const draft of this.#state.drafts) this.#changes.draftIds.add(draft.id);
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
    options: { voiceRecording?: boolean } = {},
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
        .prepareDrafts(paths, data, options)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      this.#state.drafts.push(...prepared);
      for (const draft of prepared) this.#changes.draftIds.add(draft.id);
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
      this.#changes.draftIds.add(draft.id);
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

  /**
   * Forgets the idempotency keys with `prefix` whose message is older than `createdBefore`, or gone.
   * The next persist writes the shorter map, so a key kind that grows with every message stays bounded.
   */
  forgetIdempotencyKeys(prefix: string, createdBefore: Date): void {
    const createdAt = new Map(this.#state.messages.map((message) => [message.id, Date.parse(message.createdAt)]));
    const cutoff = createdBefore.getTime();
    this.#state.idempotency = Object.fromEntries(
      Object.entries(this.#state.idempotency).filter(
        ([key, messageId]) =>
          !key.startsWith(prefix) || (createdAt.get(messageId) ?? Number.NEGATIVE_INFINITY) >= cutoff,
      ),
    );
  }

  /** The receipt of the message an idempotency key already stored, or null. */
  receiptForKey(key: string): QueuedMessageReceipt | null {
    const messageId = this.#state.idempotency[key];
    return messageId ? this.#receipt(messageId) : null;
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
   * The side thread that an agent's answer goes back to: the one the request was sent from, when the
   * answer goes to the agent that sent the request, and to no one else, and its sender received it.
   */
  answerTaskId(senderAgentId: string, replyToMessageId: string, recipientAgentIds: readonly string[]): string | null {
    if (recipientAgentIds.length !== 1) return null;
    const request = this.#state.messages.find((message) => message.id === replyToMessageId);
    if (!request?.senderTaskId || request.sender.kind !== "agent" || request.sender.agentId !== recipientAgentIds[0])
      return null;
    const received = this.#state.deliveries.some(
      (delivery) => delivery.messageId === request.id && delivery.recipientAgentId === senderAgentId,
    );
    return received ? request.senderTaskId : null;
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
    return this.#contexts(
      this.#state.deliveries
        .filter(
          (delivery) =>
            messageIds.has(delivery.messageId) &&
            (delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running"),
        )
        .sort(compareQueueOrder),
    );
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
      if (input.taskId !== undefined && recipients.length !== 1) throw new Error("A task message has one recipient.");
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
      const voiceDraft =
        input.voiceRecordingDraftId === undefined
          ? undefined
          : this.#state.drafts.find((candidate) => candidate.id === input.voiceRecordingDraftId);
      if (input.voiceRecordingDraftId !== undefined) {
        if (
          !voiceDraft ||
          voiceDraft.ownerEditId ||
          input.sender.kind !== "user" ||
          drafts.includes(voiceDraft) ||
          playableMediaKind(voiceDraft.mimeType) !== "audio"
        )
          throw new Error("Invalid voice recording draft.");
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
      const voiceTransferId = voiceRecordingTransferId(messageId);
      const removeTransfers = Effect.all(
        [
          this.#files.remove(this.#files.transferRoot(messageId)),
          this.#files.remove(this.#files.transferRoot(voiceTransferId)),
        ],
        { discard: true },
      ).pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
      const voiceRecording = voiceDraft
        ? yield* this.#files
            .commitMessageTransfer(voiceTransferId, input.sender, recipients, messageId, createdAt, [voiceDraft.path])
            .pipe(
              // The commit types a file by its name, and WebM has no type there; the draft has it.
              Effect.map(([committed]) => committed && { ...committed, mimeType: voiceDraft.mimeType }),
              Effect.mapError(({ cause }) => new StoredStateFailure({ cause })),
              Effect.tapError(() => removeTransfers),
            )
        : undefined;
      try {
        validateRecipients();
      } catch (error) {
        yield* removeTransfers;
        throw error;
      }
      const committedByDraftId = new Map(drafts.map((draft, index) => [draft.id, attachments[index]] as const));
      const messaging = input.messaging ?? this.#answerReturn(input, recipients);
      const message: StoredMessage = {
        ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
        ...(messaging ? { messaging } : {}),
        ...(input.messagingReturn ? { messagingReturn: input.messagingReturn } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.senderTaskId ? { senderTaskId: input.senderTaskId } : {}),
        id: messageId,
        sender: input.sender,
        ...(input.sender.kind === "user" && input.senderMember ? { senderMember: input.senderMember } : {}),
        text: rewriteAttachmentReferences(text, (reference) => {
          const attachment = committedByDraftId.get(reference.attachmentId);
          return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
        }),
        attachments,
        ...(voiceRecording ? { voiceRecording } : {}),
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
      const usedDrafts = voiceDraft ? [...drafts, voiceDraft] : drafts;
      this.#state.drafts = this.#state.drafts.filter((draft) => !usedDrafts.includes(draft));
      this.#changes.messageIds.add(messageId);
      for (const delivery of deliveries) this.#changes.deliveryIds.add(delivery.id);
      for (const draft of usedDrafts) this.#changes.draftIds.add(draft.id);
      try {
        this.#persist();
      } catch (error) {
        const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));
        this.#state.messages = this.#state.messages.filter((candidate) => candidate.id !== messageId);
        this.#state.deliveries = this.#state.deliveries.filter((candidate) => !deliveryIds.has(candidate.id));
        if (input.idempotencyKey && this.#state.idempotency[input.idempotencyKey] === messageId) {
          delete this.#state.idempotency[input.idempotencyKey];
        }
        for (const draft of usedDrafts) {
          if (!this.#state.drafts.some((candidate) => candidate.id === draft.id)) {
            this.#state.drafts.push(draft);
          }
        }
        yield* removeTransfers;
        throw error;
      }
      // The message is saved: failing now would hide a delivery that runs from its caller. A draft
      // folder left behind holds copies only, and a restart clears it with the other drafts.
      yield* this.#files.removeAttachmentDirectories(usedDrafts.map((draft) => draft.path)).pipe(Effect.ignore);
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
      /** Throws when the channel can no longer take the request; runs after the copy. */
      assertOpen?: () => void;
    },
  ): Effect.fn.Return<CommittedChannelAttachments, StoredStateFailure> {
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
      // The channel can be archived or deleted during the copy. Refuse before the drafts are
      // consumed, so the composer can send the same files again.
      let refusal: unknown = null;
      try {
        input.assertOpen?.();
      } catch (error) {
        refusal = error;
      }
      if (refusal !== null) {
        yield* this.#files
          .remove(this.#files.transferRoot(input.messageId))
          .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
        throw refusal;
      }
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
      this.#changes.messageIds.add(message.id);
      for (const id of ids) this.#changes.draftIds.add(id);
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
      // The draft folders stay until the channel accepts the request. A send the channel refuses
      // after this point (archived meanwhile, a reply target gone, a failed write) reverts, and the
      // composer can send the same drafts again.
      const accept = this.#files.removeAttachmentDirectories(drafts.map((draft) => draft.path)).pipe(Effect.ignore);
      const revert = Effect.gen({ self: this }, function* () {
        const before = { messages: this.#state.messages, drafts: this.#state.drafts };
        this.#state.messages = before.messages.filter((candidate) => candidate !== message);
        this.#state.drafts = [
          ...before.drafts,
          ...drafts.filter((draft) => !before.drafts.some((candidate) => candidate.id === draft.id)),
        ];
        this.#changes.messageIds.add(message.id);
        for (const draft of drafts) this.#changes.draftIds.add(draft.id);
        try {
          this.#persist("channel.attachments-reverted", `mailbox:channel-attachments-reverted:${input.messageId}`);
        } catch (cause) {
          // The database still holds the committed request. Memory must say the same, or the drafts
          // would show as restored now and be gone after a restart.
          this.#state.messages = before.messages;
          this.#state.drafts = before.drafts;
          return yield* new StoredStateFailure({ cause });
        }
        yield* this.#files.remove(this.#files.transferRoot(input.messageId)).pipe(Effect.ignore);
      }).pipe(Effect.uninterruptible);
      return { text: message.text, attachments: attachments.map(toAttachmentSummary), accept, revert };
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
    const messages = this.#messagesById();
    return {
      agentId,
      // Queue order, not storage order: a restart reads the deliveries back sorted by their
      // creation time and identity, which would otherwise reorder rows a client already saw.
      deliveries: [...this.#state.deliveries]
        .filter((delivery) => delivery.recipientAgentId === agentId && !executionMessageIds.has(delivery.messageId))
        .sort(compareQueueOrder)
        .map((delivery) =>
          this.#publicDelivery(delivery, positions, this.#requireMessage(delivery.messageId, messages)),
        ),
    };
  }

  /**
   * The queued channel, messaging and task work of this agent, in queue order. `listQueue` hides it, so a
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
          !waitsForPlanContinuation(delivery) &&
          executionMessageIds.has(delivery.messageId),
      )
      .sort(compareQueueOrder)
      .map((delivery) => delivery.id);
  }

  /** Indexed once for a whole read: a queue holds one delivery for each message the agent has. */
  #executionMessageIds(): Set<string> {
    const ids = new Set<string>();
    for (const message of this.#state.messages)
      if (message.channelId || message.messaging || message.taskId) ids.add(message.id);
    return ids;
  }

  /** Indexed once for a whole read, so a read over many deliveries does not scan the messages for each one. */
  #messagesById(): Map<string, StoredMessage> {
    return new Map(this.#state.messages.map((message) => [message.id, message]));
  }

  /** The task a delivery runs in, or null for the agent's own chat. */
  taskIdForDelivery(deliveryId: string): string | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#taskIdOf(delivery) : null;
  }

  #taskIdOf(delivery: StoredDelivery, messages?: ReadonlyMap<string, StoredMessage>): string | null {
    const message = messages
      ? messages.get(delivery.messageId)
      : this.#state.messages.find((candidate) => candidate.id === delivery.messageId);
    return message?.taskId ?? null;
  }

  /**
   * Indexes the positions and messages once, so a list of contexts does not sort or scan for each one.
   * Only a queued delivery has a position, so a list of started deliveries does not sort the queue.
   */
  #contexts(deliveries: StoredDelivery[]): DeliveryContext[] {
    if (deliveries.length === 0) return [];
    const positions = deliveries.some((delivery) => delivery.status === "queued")
      ? this.#queuedPositions()
      : new Map<string, number>();
    const messages = this.#messagesById();
    return deliveries.map((delivery) => this.#context(delivery, positions, messages));
  }

  /** The tasks of this agent that have a queued message, in queue order of their first one. */
  queuedTaskIds(agentId: string): string[] {
    const ids = new Set<string>();
    for (const delivery of this.#queuedFor(agentId)) {
      const taskId = this.#taskIdOf(delivery);
      if (taskId) ids.add(taskId);
    }
    return [...ids];
  }

  /**
   * The messages of one task that wait to start, in queue order, for the task's panel. Without
   * `teammateAnswers`, the answers of other agents are left out.
   */
  queuedTaskMessages(
    agentId: string,
    taskId: string,
    options: { teammateAnswers?: boolean } = {},
  ): Array<{ deliveryId: string; text: string; createdAt: string }> {
    return this.#queuedFor(agentId).flatMap((delivery) => {
      if (waitsForPlanContinuation(delivery)) return [];
      const message = this.#requireMessage(delivery.messageId);
      if (message.taskId !== taskId) return [];
      if (options.teammateAnswers === false && message.sender.kind === "agent" && message.sender.agentId !== agentId)
        return [];
      return [{ deliveryId: delivery.id, text: message.text, createdAt: message.createdAt }];
    });
  }

  /** Whether a delivery of this lane is starting or running: the agent's own chat when `taskId` is null. */
  laneActive(agentId: string, taskId: string | null): boolean {
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId &&
        (delivery.status === "starting" || delivery.status === "running") &&
        this.#taskIdOf(delivery) === taskId,
    );
  }

  /** The queued deliveries of one lane, without those that wait for their automatic plan continuation. */
  laneQueuedIds(agentId: string, taskId: string | null): string[] {
    const messages = this.#messagesById();
    return this.#queuedFor(agentId)
      .filter((delivery) => !waitsForPlanContinuation(delivery) && this.#taskIdOf(delivery, messages) === taskId)
      .map((delivery) => delivery.id);
  }

  /** Whether a message of this task is queued, starting or running. */
  taskBusy(agentId: string, taskId: string): boolean {
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId && isActiveDelivery(delivery) && this.#taskIdOf(delivery) === taskId,
    );
  }

  /**
   * Removes the messages of a deleted side thread, with their deliveries, reactions and idempotency keys.
   * Their files leave the Transfers folder through the deletion outbox, as in {@link deleteStoredFile},
   * when no other record uses the same path. The caller cancels the queued messages first; a delivery
   * that is still active stops the removal, and the state stays as it was.
   */
  deleteTaskMessages = Effect.fn("MailboxStore.deleteTaskMessages")(function* (
    this: MailboxStore,
    agentId: string,
    taskId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      // A teammate's answer to the thread is also in the teammate's own chat, so it stays.
      const teammateAnswer = (message: StoredMessage) =>
        message.sender.kind === "agent" && message.sender.agentId !== agentId;
      const found = () => {
        const lane = this.#state.messages.filter((message) => message.taskId === taskId);
        const laneIds = new Set(lane.map((message) => message.id));
        // A task message has one recipient, the thread's agent.
        if (
          this.#state.deliveries.some(
            (delivery) =>
              laneIds.has(delivery.messageId) && (delivery.recipientAgentId !== agentId || isActiveDelivery(delivery)),
          )
        )
          throw new Error(sourceText("error.backend.threadStillRunning"));
        const ids = new Set(lane.filter((message) => !teammateAnswer(message)).map((message) => message.id));
        const deliveries = this.#state.deliveries.filter((delivery) => ids.has(delivery.messageId));
        return { ids, deliveries };
      };
      if (found().ids.size === 0) return;
      // The path checks wait, so they run before the state changes, as in `deleteStoredFile`.
      const managedPaths = new Map<string, string | null>();
      for (const message of this.#state.messages) {
        if (message.taskId !== taskId || teammateAnswer(message)) continue;
        for (const file of messageFiles(message)) {
          if (file.deletedAt || managedPaths.has(file.path)) continue;
          managedPaths.set(file.path, yield* this.#files.managedTransferFile(file.path).pipe(toStoredStateFailure));
        }
      }
      const { ids, deliveries } = found();
      const previous = structuredClone(this.#state);
      const files = this.#state.messages.filter((message) => ids.has(message.id)).flatMap(messageFiles);
      this.#state.messages = this.#state.messages.filter((message) => !ids.has(message.id));
      this.#state.deliveries = this.#state.deliveries.filter((delivery) => !ids.has(delivery.messageId));
      const reactions = this.#state.reactions.filter((reaction) => ids.has(reaction.messageId));
      this.#state.reactions = this.#state.reactions.filter((reaction) => !ids.has(reaction.messageId));
      for (const [key, messageId] of Object.entries(this.#state.idempotency))
        if (ids.has(messageId)) delete this.#state.idempotency[key];
      for (const id of ids) this.#changes.messageIds.add(id);
      for (const delivery of deliveries) this.#changes.deliveryIds.add(delivery.id);
      for (const reaction of reactions)
        this.#changes.reactionKeys.add(mailboxReactionRowKey(reaction.agentId, reaction.messageId, reaction.actor));
      const inUse = new Set(
        this.#fileRecords()
          .filter((record) => !record.deletedAt)
          .map((record) => record.path),
      );
      const deletions: string[] = [];
      for (const path of new Set(files.filter((file) => !file.deletedAt).map((file) => file.path))) {
        const managed = inUse.has(path) ? null : managedPaths.get(path);
        if (managed) deletions.push(managed);
      }
      try {
        this.#persist("mailbox.thread-deleted", `mailbox:thread-deleted:${taskId}:${randomUUID()}`, deletions);
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /** Every queued, starting or running delivery that runs in a task, with the task id. */
  unfinishedTaskDeliveries(): Array<{ agentId: string; deliveryId: string; taskId: string; queued: boolean }> {
    const messages = this.#messagesById();
    return this.#state.deliveries.flatMap((delivery) => {
      const taskId = isActiveDelivery(delivery) ? this.#taskIdOf(delivery, messages) : null;
      return taskId
        ? [
            {
              agentId: delivery.recipientAgentId,
              deliveryId: delivery.id,
              taskId,
              queued: delivery.status === "queued",
            },
          ]
        : [];
    });
  }

  /**
   * Moves a queued message of the person into a task, so it runs beside the agent's own chat. Only a
   * message with one recipient and no channel or external origin can move.
   */
  moveToTask = Effect.fn("MailboxStore.moveToTask")(function* (
    this: MailboxStore,
    agentId: string,
    deliveryId: string,
    taskId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find(
        (candidate) => candidate.id === deliveryId && candidate.recipientAgentId === agentId,
      );
      if (delivery?.status !== "queued" || delivery.editId || this.#queueUpdates.has(deliveryId))
        throw new Error(sourceText("error.backend.queuedMessageUnavailable"));
      const message = this.#requireMessage(delivery.messageId);
      const recipients = this.#state.deliveries.filter((candidate) => candidate.messageId === message.id);
      if (
        message.sender.kind !== "user" ||
        message.channelId ||
        message.messaging ||
        message.taskId ||
        recipients.length !== 1
      )
        throw new Error(sourceText("error.backend.threadMoveRefused"));
      const previous = this.#state.messages;
      this.#state.messages = previous.map((candidate) => (candidate === message ? { ...message, taskId } : candidate));
      this.#changes.messageIds.add(message.id);
      try {
        this.#persist("mailbox.task-assigned", `mailbox:task-assigned:${deliveryId}`);
      } catch (error) {
        this.#state.messages = previous;
        throw error;
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Moves the queued answers of teammates to a side thread into the agent's own chat, so an archive
   * or delete of the thread does not cancel them. Returns how many moved.
   */
  returnTaskAnswers = Effect.fn("MailboxStore.returnTaskAnswers")(function* (
    this: MailboxStore,
    agentId: string,
    taskId: string,
  ): Effect.fn.Return<number, StoredStateFailure> {
    try {
      const ids = new Set(
        this.#queuedFor(agentId).flatMap((delivery) => {
          const message = this.#requireMessage(delivery.messageId);
          return message.taskId === taskId && message.sender.kind === "agent" && message.sender.agentId !== agentId
            ? [message.id]
            : [];
        }),
      );
      if (ids.size === 0) return 0;
      const previous = this.#state.messages;
      this.#state.messages = previous.map((message) => {
        if (!ids.has(message.id)) return message;
        const { taskId: _taskId, ...answer } = message;
        return answer;
      });
      for (const id of ids) this.#changes.messageIds.add(id);
      try {
        this.#persist("mailbox.task-answers-returned", `mailbox:task-answers-returned:${taskId}:${randomUUID()}`);
      } catch (error) {
        this.#state.messages = previous;
        throw error;
      }
      return ids.size;
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

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

  conversationMessages(
    agentId: string,
    options: { fromCreatedAt?: string; limit?: number } = {},
  ): ConversationMessage[] {
    const limit = Math.max(
      1,
      Math.min(options.limit ?? MAILBOX_CONVERSATION_MESSAGE_LIMIT, MAILBOX_CONVERSATION_MESSAGE_LIMIT),
    );
    const deliveriesByMessage = new Map<string, StoredDelivery[]>();
    for (const delivery of this.#state.deliveries) {
      const deliveries = deliveriesByMessage.get(delivery.messageId) ?? [];
      deliveries.push(delivery);
      deliveriesByMessage.set(delivery.messageId, deliveries);
    }
    const selectedStoredMessages: StoredMessage[] = [];
    let completedCount = 0;
    for (let index = this.#state.messages.length - 1; index >= 0; index -= 1) {
      const message = this.#state.messages[index];
      if (!message || message.channelId || message.messaging) continue;
      const ownMessage = message.sender.kind === "agent" && message.sender.agentId === agentId;
      // A task message runs in a side thread of its recipient. A teammate's answer to that thread
      // still shows in the teammate's own chat; the brief of a thread the agent started does not.
      if (
        message.taskId &&
        (!ownMessage || !deliveriesByMessage.get(message.id)?.some((delivery) => delivery.recipientAgentId !== agentId))
      )
        continue;
      // A request the agent sent from a Slack thread or a side thread belongs to that thread, not to
      // its own chat. The teammate it went to still sees it.
      if ((message.messagingReturn || message.senderTaskId) && ownMessage) continue;
      const deliveries = deliveriesByMessage.get(message.id) ?? [];
      let relevant = ownMessage;
      let active = false;
      for (const delivery of deliveries) {
        if (!ownMessage && delivery.recipientAgentId !== agentId) continue;
        relevant = true;
        if (isActiveDelivery(delivery)) active = true;
      }
      if (!relevant) continue;
      const conversationTime = ownMessage
        ? message.createdAt
        : (deliveries.find((delivery) => delivery.recipientAgentId === agentId)?.steeredAt ?? message.createdAt);
      if (!active && options.fromCreatedAt && conversationTime < options.fromCreatedAt) continue;
      if (!active && completedCount >= limit) continue;
      selectedStoredMessages.push(message);
      if (!active) completedCount += 1;
    }
    selectedStoredMessages.reverse();
    const messages: ConversationMessage[] = [];
    const positions = this.#queuedPositions();
    const turnIds = this.#sourceTurnIds();
    for (const message of selectedStoredMessages) {
      const deliveries = deliveriesByMessage.get(message.id) ?? [];
      if (message.sender.kind === "agent" && message.sender.agentId === agentId) {
        messages.push({
          id: `outbox-${message.id}`,
          turnId: turnIds.get(message.id),
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
              const delivery = this.#publicDelivery(item, positions, message);
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
          itemType: AGENT_EXCHANGE_ITEM_TYPE,
        });
      }

      for (const storedDelivery of deliveries) {
        if (storedDelivery.recipientAgentId !== agentId) continue;
        const delivery = this.#publicDelivery(storedDelivery, positions, message);
        messages.push({
          id: delivery.id,
          // A plan continuation keeps the request in its first turn, like `syncDeliveryMessage`.
          turnId: storedDelivery.planContinuation?.turnIds[0] ?? storedDelivery.turnId ?? undefined,
          author: message.sender.kind === "agent" ? "agent" : "user",
          source: message.sender.kind === "agent" ? "agent" : message.sender.kind === "routine" ? "routine" : "user",
          text: message.text,
          senderAgentId: message.sender.kind === "agent" ? message.sender.agentId : undefined,
          ...(message.senderMember ? { senderMember: { ...message.senderMember } } : {}),
          attachments: message.attachments.map(toAttachmentSummary),
          ...(message.voiceRecording && !message.voiceRecording.deletedAt
            ? { voiceRecording: toAttachmentSummary(message.voiceRecording) }
            : {}),
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
                    const publicItem = this.#publicDelivery(item, positions, message);
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
          createdAt: storedDelivery.steeredAt ?? message.createdAt,
          status: delivery.status === "failed" ? "failed" : "completed",
          itemType:
            message.sender.kind === "agent"
              ? AGENT_EXCHANGE_ITEM_TYPE
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
      this.#changes.reactionKeys.add(mailboxReactionRowKey(agentId, messageId, actor));
      this.#persist("reaction.updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * The turn that sent each message, by message id, read once for a whole lookup: agent keys are
   * kept for good, so a scan of every key for each message grows with the square of the history.
   */
  #sourceTurnIds(): Map<string, string | undefined> {
    const turnIds = new Map<string, string | undefined>();
    for (const [key, messageId] of Object.entries(this.#state.idempotency)) {
      if (turnIds.has(messageId)) continue;
      const parts = key.split(":");
      turnIds.set(messageId, parts.length >= 3 ? parts.at(-2) : undefined);
    }
    return turnIds;
  }

  senderAgentIdsForRecipient(agentId: string): string[] {
    const result = new Set<string>();
    const messages = this.#messagesById();
    for (const delivery of this.#state.deliveries) {
      if (delivery.recipientAgentId !== agentId) continue;
      const sender = this.#requireMessage(delivery.messageId, messages).sender;
      if (sender.kind === "agent") result.add(sender.agentId);
    }
    return [...result];
  }

  /**
   * The delivery that starts the next turn in one lane of this agent: its own chat (`taskId` null,
   * with its channel and messaging work), or one task. Each lane runs one turn at a time.
   */
  nextQueued(agentId: string, taskId: string | null = null): DeliveryContext | null {
    if (this.laneActive(agentId, taskId)) return null;
    const messages = this.#messagesById();
    const delivery = this.#queuedFor(agentId).find(
      (candidate) => this.#taskIdOf(candidate, messages) === taskId && !this.#isHeldReply(candidate),
    );
    return delivery && this.#mayStart(delivery) ? this.#context(delivery, undefined, messages) : null;
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
    // One turn runs in one lane: the agent's own chat, or the side thread that sent the request.
    const lane = message.taskId ?? null;
    const messages = this.#messagesById();
    return this.#contexts(
      this.#queuedFor(next.recipientAgentId).filter((candidate) => {
        if (candidate.id === next.id || !this.#mayStart(candidate) || this.#taskIdOf(candidate, messages) !== lane)
          return false;
        if (!requestId) return this.#isHeldReply(candidate);
        const reply = this.#requireMessage(candidate.messageId, messages);
        return isAnswer(reply) && reply.replyToMessageId === requestId;
      }),
    );
  }

  /**
   * The person's messages queued right after this one in its lane, which start in the same turn.
   * Each turn makes the provider read the whole session again, so messages that waited together are
   * read together. The run stops at the first message of another kind or of another person, so the
   * queue order stays.
   */
  userMessagesToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next) return [];
    const messages = this.#messagesById();
    const first = this.#requireMessage(next.messageId, messages);
    if (!isChatMessageFromPerson(first)) return [];
    const lane = first.taskId ?? null;
    const queued = this.#queuedFor(next.recipientAgentId).filter(
      (candidate) => this.#taskIdOf(candidate, messages) === lane && !this.#isHeldReply(candidate),
    );
    const start = queued.findIndex((candidate) => candidate.id === next.id);
    if (start < 0) return [];
    const run: StoredDelivery[] = [];
    for (const candidate of queued.slice(start + 1)) {
      const message = this.#requireMessage(candidate.messageId, messages);
      if (
        !this.#mayStart(candidate) ||
        // The messages of a turn that a usage limit stopped continue together, as they started.
        candidate.resumeAfterUsageLimit?.turnId !== next.resumeAfterUsageLimit?.turnId ||
        !isChatMessageFromPerson(message) ||
        message.senderMember?.id !== first.senderMember?.id
      )
        break;
      run.push(candidate);
    }
    return this.#contexts(run);
  }

  /** The other deliveries of this lane that wait for the same automatic plan continuation. */
  planContinuationsToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next || !waitsForPlanContinuation(next)) return [];
    const messages = this.#messagesById();
    const lane = this.#taskIdOf(next, messages);
    return this.#contexts(
      this.#queuedFor(next.recipientAgentId).filter(
        (candidate) =>
          candidate.id !== next.id &&
          waitsForPlanContinuation(candidate) &&
          this.#taskIdOf(candidate, messages) === lane,
      ),
    );
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

  /**
   * A queued message from another agent that can steer its recipient's running chat turn. Channel,
   * messaging and task work runs outside that turn. The answers to a request that went to several
   * teammates start together in one turn (`#isHeldReply`), so none of them goes into it alone.
   */
  steersChatTurn(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (delivery?.status !== "queued") return false;
    const message = this.#requireMessage(delivery.messageId);
    if (message.channelId || message.messaging || message.taskId) return false;
    return (
      !isAnswer(message) ||
      this.#state.deliveries.filter((candidate) => candidate.messageId === message.replyToMessageId).length < 2
    );
  }

  queuedDeliveryIds(agentId: string): string[] {
    return this.#state.deliveries
      .filter((delivery) => delivery.recipientAgentId === agentId && delivery.status === "queued")
      .sort(compareQueueOrder)
      .map((delivery) => delivery.id);
  }

  /** The file name of an attachment draft, or null when the draft is gone. */
  draftName(draftId: string): string | null {
    return this.#state.drafts.find((draft) => draft.id === draftId)?.name ?? null;
  }

  getDelivery(deliveryId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#context(delivery) : null;
  }

  /** Provider history can name a continuation turn instead of the original delivery. */
  deliveryForProviderMessage(agentId: string, messageId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find(
      (candidate) =>
        candidate.recipientAgentId === agentId &&
        (candidate.id === messageId ||
          (candidate.resumeAfterUsageLimit !== undefined &&
            (candidate.turnId === messageId || candidate.resumeAfterUsageLimit.previousTurnIds.includes(messageId))) ||
          candidate.planContinuation?.turnIds.includes(messageId) === true),
    );
    return delivery ? this.#context(delivery) : null;
  }

  /** The delivery of one message to one recipient. A message reaches each recipient once. */
  deliveryForMessage(messageId: string, recipientAgentId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find(
      (candidate) => candidate.messageId === messageId && candidate.recipientAgentId === recipientAgentId,
    );
    return delivery ? this.#context(delivery) : null;
  }

  findDeliveryByTurn(turnId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.turnId === turnId);
    return delivery ? this.#context(delivery) : null;
  }

  findDeliveriesByTurn(agentId: string, turnId: string): DeliveryContext[] {
    return this.#contexts(
      this.#state.deliveries.filter(
        (delivery) =>
          delivery.recipientAgentId === agentId &&
          delivery.turnId === turnId &&
          (delivery.status === "starting" || delivery.status === "running"),
      ),
    );
  }

  /** Without `taskId`, any lane of the agent; with it, only that lane (null: the agent's own chat). */
  startingDeliveryForAgent(agentId: string, taskId?: string | null): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => this.#startingIn(candidate, agentId, taskId));
    return delivery ? this.#context(delivery) : null;
  }

  /**
   * Every delivery that starts the next turn of this agent: one, or several teammate answers.
   * Without `taskId`, any lane of the agent; with it, only that lane (null: the agent's own chat).
   */
  startingDeliveriesForAgent(agentId: string, taskId?: string | null): DeliveryContext[] {
    return this.#contexts(this.#state.deliveries.filter((candidate) => this.#startingIn(candidate, agentId, taskId)));
  }

  #startingIn(delivery: StoredDelivery, agentId: string, taskId: string | null | undefined): boolean {
    return (
      delivery.recipientAgentId === agentId &&
      delivery.status === "starting" &&
      delivery.turnId === null &&
      (taskId === undefined || this.#taskIdOf(delivery) === taskId)
    );
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
          for (const attachment of messageFiles(message)) {
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
        for (const attachment of messageFiles(message)) {
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
    const turnIds = this.#sourceTurnIds();
    return this.#state.messages.some((message) => {
      if (message.sender.kind !== "agent" || message.sender.agentId !== agentId) return false;
      if (turnIds.get(message.id) !== turnId) return false;
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
      this.#clearSteerFallback(deliveryId);
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
      const stored = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
      const continuation = stored?.resumeAfterUsageLimit;
      const planContinuation = stored?.planContinuation;
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "running",
        turnId,
        error: null,
        ...(continuation
          ? {
              resumeAfterUsageLimit: {
                ...continuation,
                previousTurnIds: [...new Set([...continuation.previousTurnIds, turnId])],
              },
            }
          : {}),
        // Not cleared at `starting`: a start that Codex refuses during a compaction goes back to the
        // queue and must still continue the plan.
        ...(planContinuation
          ? { planContinuation: { turnIds: [...new Set([...planContinuation.turnIds, turnId])] } }
          : {}),
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
    // Inside a transaction this read sees rows that a later ROLLBACK can still undo, so the keys stay.
    if (!this.#database.connection.isTransaction) this.#clearChanges();
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
    this.#changes.deliveryIds.add(delivery.id);
    try {
      this.#persist("delivery.edit-started");
    } catch (error) {
      if (previous === undefined) delete delivery.editId;
      else delivery.editId = previous;
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
    for (const draft of drafts) {
      draft.ownerEditId = editId;
      this.#changes.draftIds.add(draft.id);
    }
    try {
      this.#persist("delivery.edit-attachments-retained");
    } catch (error) {
      drafts.forEach((draft, index) => {
        const ownerEditId = previous[index];
        if (ownerEditId === undefined) delete draft.ownerEditId;
        else draft.ownerEditId = ownerEditId;
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
      this.#changes.draftIds.add(draft.id);
    }
    this.#changes.deliveryIds.add(delivery.id);
    try {
      this.#persist(cancelDelivery ? "delivery.cancelled" : "delivery.edit-finished");
    } catch (error) {
      delivery.status = previousStatus;
      if (editId === undefined) delete delivery.editId;
      else delivery.editId = editId;
      if (previousOutcomes === undefined) delete delivery.finishedEditOutcomes;
      else delivery.finishedEditOutcomes = previousOutcomes;
      released.forEach((draft, index) => {
        // `released` is empty when there is no edit id.
        if (editId !== undefined) draft.ownerEditId = editId;
        const preserveOnRestart = previousRetention[index];
        if (preserveOnRestart === undefined) delete draft.preserveOnRestart;
        else draft.preserveOnRestart = preserveOnRestart;
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
              this.#changes.messageIds.add(message.id);
              this.#changes.deliveryIds.add(delivery.id);
              for (const id of [...draftIds, ...releasedOwned.map((draft) => draft.id)]) this.#changes.draftIds.add(id);
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
      const held = (delivery: StoredDelivery) => Boolean(delivery.editId) || waitsForPlanContinuation(delivery);
      const heldIds = new Set(allQueued.filter(held).map((delivery) => delivery.id));
      const requested = deliveryIds.filter((deliveryId) => !heldIds.has(deliveryId));
      const queued = allQueued.filter((delivery) => !held(delivery));
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
        .map((delivery) => (held(delivery) ? delivery.id : requested[nextVisible++]));
      const orders = new Map(orderedIds.map((deliveryId, index) => [deliveryId, index]));
      for (const delivery of allQueued) {
        delivery.queueOrder = orders.get(delivery.id) ?? delivery.queueOrder;
        this.#changes.deliveryIds.add(delivery.id);
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
      this.#clearSteerFallback(deliveryId);
      yield* this.#updateDeliveryEffect(deliveryId, ["queued"], {
        status: "starting",
        turnId,
        steeredAt: new Date().toISOString(),
        error: null,
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * A steer the provider did not take, back at its place in the queue. The turn it was sent to can
   * end while the request is in flight, and its end stamps every delivery of that turn, this one
   * too, so a terminal state from that turn is undone as well: the agent never read the message.
   */
  restoreUnsteered = Effect.fn("MailboxStore.restoreUnsteered")(function* (
    this: MailboxStore,
    deliveryId: string,
    turnId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
      if (!delivery || delivery.turnId !== turnId || delivery.status === "queued" || delivery.status === "cancelled") {
        return;
      }
      Object.assign(delivery, { status: "queued", turnId: null, error: null });
      delete delivery.steeredAt;
      this.#changes.deliveryIds.add(delivery.id);
      this.#persist("delivery.updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /** Says why a message sent to steer waits in the queue. A message that has left the queue keeps its state. */
  markSteerFallback = Effect.fn("MailboxStore.markSteerFallback")(function* (
    this: MailboxStore,
    deliveryId: string,
    steerFallback: QueueSteerFallback,
  ): Effect.fn.Return<void, StoredStateFailure> {
    yield* this.#updateDeliveryEffect(deliveryId, ["queued"], { steerFallback });
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

  /** A refused delivery, or unfinished work that a backup continues, back at its place in the queue. */

  requeueRefused = Effect.fn("MailboxStore.requeueRefused")(function* (
    this: MailboxStore,
    deliveryId: string,
    resumeAfterUsageLimit?: UsageLimitContinuation,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "queued",
        turnId: null,
        error: null,
        ...(resumeAfterUsageLimit ? { resumeAfterUsageLimit } : {}),
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * A delivery whose turn ended with open plan steps, back in the queue for one more turn. It keeps
   * the turn id until that turn starts, and the queue shows it as running.
   */
  requeueForPlan = Effect.fn("MailboxStore.requeueForPlan")(function* (
    this: MailboxStore,
    deliveryId: string,
    turnId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const turnIds = this.#state.deliveries.find((candidate) => candidate.id === deliveryId)?.planContinuation
        ?.turnIds;
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: "queued",
        turnId: null,
        error: null,
        planContinuation: { turnIds: [...new Set([...(turnIds ?? []), turnId])], queued: true },
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Ends the deliveries of this lane that wait for an automatic plan continuation that will not run:
   * after a restart, a Stop, or a new message. Their last turn completed. Returns their ids.
   */
  settlePlanContinuations = Effect.fn("MailboxStore.settlePlanContinuations")(function* (
    this: MailboxStore,
    agentId: string,
    taskId?: string | null,
  ): Effect.fn.Return<string[], StoredStateFailure> {
    try {
      const messages = this.#messagesById();
      const settled: string[] = [];
      for (const delivery of this.#state.deliveries) {
        if (
          delivery.recipientAgentId !== agentId ||
          !waitsForPlanContinuation(delivery) ||
          (taskId !== undefined && this.#taskIdOf(delivery, messages) !== taskId)
        )
          continue;
        const turnIds = delivery.planContinuation?.turnIds ?? [];
        Object.assign(delivery, {
          status: "completed",
          turnId: turnIds.at(-1) ?? null,
          error: null,
          planContinuation: { turnIds },
        });
        this.#changes.deliveryIds.add(delivery.id);
        settled.push(delivery.id);
      }
      if (settled.length > 0) this.#persist("delivery.updated");
      return settled;
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

  /** As {@link hasUnfinishedDelivery}, without the work of the agent's tasks, which run in their own threads. */
  hasUnfinishedDeliveryOutsideTasks(agentId: string): boolean {
    const messages = this.#messagesById();
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId &&
        isActiveDelivery(delivery) &&
        this.#taskIdOf(delivery, messages) === null,
    );
  }

  /** As {@link hasUnfinishedDelivery}, without the `queued` deliveries that a usage limit holds. */
  hasStartedDelivery(agentId: string): boolean {
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId && (delivery.status === "starting" || delivery.status === "running"),
    );
  }

  unresolvedDeliveries(): DeliveryContext[] {
    return this.#contexts(
      this.#state.deliveries.filter((delivery) => delivery.status === "starting" || delivery.status === "running"),
    );
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
        const attachment = messageFiles(message).find((candidate) => candidate.id === id);
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

  /** Every sent, spoken and generated file that the user has not deleted, from the in-memory state. */
  listStoredFiles(): MailboxStoredFile[] {
    const firstRecipient = new Map<string, string>();
    for (const delivery of this.#state.deliveries)
      if (!firstRecipient.has(delivery.messageId)) firstRecipient.set(delivery.messageId, delivery.recipientAgentId);
    const files: MailboxStoredFile[] = [];
    for (const message of this.#state.messages) {
      const agentId =
        message.sender.kind === "agent" ? message.sender.agentId : (firstRecipient.get(message.id) ?? null);
      for (const attachment of messageFiles(message)) {
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
        managedPaths.set(path, yield* this.#files.managedTransferFile(path).pipe(toStoredStateFailure));
      }
      const records = this.#fileRecords();
      const targets = this.#undeletedFileRecords(fileId);
      const previous = structuredClone(this.#state);
      const deletedAt = new Date().toISOString();
      for (const target of targets) target.deletedAt = deletedAt;
      for (const message of this.#state.messages) {
        if (messageFiles(message).some((attachment) => targets.includes(attachment))) {
          this.#changes.messageIds.add(message.id);
        }
      }
      for (const attachment of this.#state.generatedAttachments) {
        if (targets.includes(attachment)) this.#changes.generatedAttachmentIds.add(attachment.id);
      }
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
    return [...this.#state.messages.flatMap(messageFiles), ...this.#state.generatedAttachments];
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
    const changedMessages = snapshot.messages.filter((message) =>
      message.attachments?.some((attachment) => attachmentIds.includes(attachment.id)),
    );
    for (const attachment of staged) this.#changes.generatedAttachmentIds.add(attachment.id);
    const persisted = this.#database.persistConversationChangesAndMailbox(
      snapshot,
      changedMessages,
      eventType,
      detail,
      nextState,
      this.#changes,
      "attachment.generated-batch",
    );
    this.#state = nextState;
    this.#clearChanges();
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
      this.#changes.generatedAttachmentIds.add(attachment.id);
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

  /**
   * Writes generated bytes as a staged attachment. `persistGeneratedAttachmentsWithConversation`
   * saves it with the message that names it; `discardStagedGeneratedAttachments` removes it.
   */
  stageGeneratedBytes = Effect.fn("MailboxStore.stageGeneratedBytes")(function* (
    this: MailboxStore,
    input: {
      bytes: Uint8Array;
      name: string;
      mimeType: string;
      ownerAgentId?: string;
      ownerThreadId?: string | null;
    },
  ): Effect.fn.Return<AttachmentSummary, StoredStateFailure> {
    const attachment = yield* this.#files
      .storeGenerated(input)
      .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
    this.#stagedGeneratedAttachments.set(attachment.id, attachment);
    return toAttachmentSummary(attachment);
  }, Effect.uninterruptible).bind(this);

  listExportAttachments = Effect.fn("MailboxStore.listExportAttachments")(function* (
    this: MailboxStore,
  ): Effect.fn.Return<ExportedAttachmentFile[], StoredStateFailure> {
    try {
      const files: ExportedAttachmentFile[] = [];
      for (const [index, message] of this.#state.messages.entries()) {
        for (const attachment of messageFiles(message)) {
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

  #context(
    delivery: StoredDelivery,
    positions?: ReadonlyMap<string, number>,
    messages?: ReadonlyMap<string, StoredMessage>,
  ): DeliveryContext {
    const message = this.#requireMessage(delivery.messageId, messages);
    return {
      delivery: this.#publicDelivery(delivery, positions, message),
      ...(delivery.resumeAfterUsageLimit ? { resumeAfterUsageLimit: delivery.resumeAfterUsageLimit } : {}),
      ...(delivery.planContinuation ? { planContinuation: delivery.planContinuation } : {}),
      ...(message.channelId ? { channelId: message.channelId } : {}),
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
    positions?: ReadonlyMap<string, number>,
    message = this.#requireMessage(delivery.messageId),
  ): QueueDelivery {
    const {
      editId: _editId,
      finishedEditOutcomes: _finishedEditOutcomes,
      steeredAt: _steeredAt,
      steerFallback,
      resumeAfterUsageLimit: _resumeAfterUsageLimit,
      planContinuation: _planContinuation,
      ...publicDelivery
    } = delivery;
    // Between two turns of one request, the request still runs for the person who sent it.
    if (waitsForPlanContinuation(delivery)) {
      publicDelivery.status = "running";
      publicDelivery.turnId = delivery.planContinuation?.turnIds.at(-1) ?? null;
    }
    return {
      ...publicDelivery,
      ...(steerFallback && delivery.status === "queued" ? { steerFallback } : {}),
      sender: structuredClone(message.sender),
      text: message.text,
      attachments: message.attachments.map(toAttachmentSummary),
      replyToMessageId: message.replyToMessageId,
      ...(message.expectsReply === false ? { expectsReply: false } : {}),
      position:
        publicDelivery.status === "queued"
          ? positions
            ? (positions.get(delivery.id) ?? null)
            : this.#queuedPosition(delivery)
          : null,
      editing: Boolean(delivery.editId),
    };
  }

  #queuedPositions(): Map<string, number> {
    const counts = new Map<string, number>();
    const positions = new Map<string, number>();
    const queued = [...this.#state.deliveries]
      .filter((delivery) => delivery.status === "queued" && !waitsForPlanContinuation(delivery))
      .sort(compareQueueOrder);
    for (const delivery of queued) {
      const position = (counts.get(delivery.recipientAgentId) ?? 0) + 1;
      counts.set(delivery.recipientAgentId, position);
      positions.set(delivery.id, position);
    }
    return positions;
  }

  /** The queue position of one queued delivery, without sorting the whole mailbox. */
  #queuedPosition(delivery: StoredDelivery): number {
    let position = 1;
    for (const candidate of this.#state.deliveries)
      if (
        candidate.status === "queued" &&
        !waitsForPlanContinuation(candidate) &&
        candidate.recipientAgentId === delivery.recipientAgentId &&
        compareQueueOrder(candidate, delivery) < 0
      )
        position += 1;
    return position;
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
      if (patch.status === "queued") delete delivery.steeredAt;
      this.#changes.deliveryIds.add(delivery.id);
      this.#persist("delivery.updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  /** The reason a steer waits is shown only while queued, so it goes when the delivery leaves the queue. */
  #clearSteerFallback(deliveryId: string): void {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (delivery?.status !== "queued") return;
    delete delivery.steerFallback;
    this.#changes.deliveryIds.add(delivery.id);
  }

  #requireMessage(id: string, messages?: ReadonlyMap<string, StoredMessage>): StoredMessage {
    const message = messages ? messages.get(id) : this.#state.messages.find((candidate) => candidate.id === id);
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
    // A power loss left the file without content: no message in it can be recovered.
    if (isEmptyStoredFile(loaded.success)) return structuredClone(EMPTY_STATE);
    return yield* storedSync(() => {
      const value = parseStoredJson(this.#statePath, loaded.success, toCurrentMailboxState);
      if (!value || !isStoredState(value)) throw new Error(sourceText("error.backend.mailboxStateCorrupt"));
      return value;
    });
  });

  /**
   * Writes the rows in `#changes`, or with `replaceAll` the whole state. The keys are cleared only
   * after a write that committed its own transaction: a caller's transaction can still roll back,
   * and the next write must then write those rows again. A command that was already applied writes
   * no row, so it keeps the keys too.
   */
  #persist(
    eventType = "mailbox.updated",
    commandId = `mailbox:${eventType}:${randomUUID()}`,
    fileDeletions: string[] = [],
    replaceAll = false,
  ): void {
    const ownsTransaction = !this.#database.connection.isTransaction;
    const wrote = replaceAll
      ? this.#database.replaceMailboxState(commandId, this.#state, eventType, fileDeletions, true)
      : this.#database.applyMailboxChanges(commandId, this.#state, this.#changes, eventType, fileDeletions);
    if (wrote && ownsTransaction) this.#clearChanges();
  }

  #clearChanges(): void {
    for (const keys of Object.values(this.#changes)) keys.clear();
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
    // Released builds kept an agent's `replyToMessageId: ""`, which refers to no message, and every
    // conversation that showed the message then failed to read.
    ...(message.replyToMessageId === "" ? { replyToMessageId: null } : {}),
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
    isString(value.platformMessageId) &&
    (value.replyTo === undefined ||
      (isRecord(value.replyTo) &&
        isString(value.replyTo.authorName) &&
        isString(value.replyTo.text) &&
        isString(value.replyTo.sentAt)))
  );
}

/** The transfer folder of a message's voice recording, beside the message's own. */
function voiceRecordingTransferId(messageId: string): string {
  return `voice-${messageId}`;
}

/** The files a message keeps: its attachments and its voice recording. */
function messageFiles(message: StoredMessage): StoredAttachment[] {
  return message.voiceRecording ? [...message.attachments, message.voiceRecording] : message.attachments;
}

function isStoredMessage(value: unknown): value is StoredMessage {
  return (
    isRecord(value) &&
    (value.channelId === undefined || isString(value.channelId)) &&
    (value.messaging === undefined || isMessagingOrigin(value.messaging)) &&
    (value.messagingReturn === undefined || isMessagingOrigin(value.messagingReturn)) &&
    (value.taskId === undefined || isString(value.taskId)) &&
    (value.senderTaskId === undefined || isString(value.senderTaskId)) &&
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
    (value.voiceRecording === undefined || isStoredAttachment(value.voiceRecording)) &&
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
    isString(value.createdAt) &&
    (value.steeredAt === undefined || (isString(value.steeredAt) && Number.isFinite(Date.parse(value.steeredAt)))) &&
    (value.steerFallback === undefined || isOneOf(QUEUE_STEER_FALLBACKS, value.steerFallback)) &&
    (value.resumeAfterUsageLimit === undefined ||
      (isRecord(value.resumeAfterUsageLimit) &&
        isString(value.resumeAfterUsageLimit.turnId) &&
        isString(value.resumeAfterUsageLimit.workSteps) &&
        Array.isArray(value.resumeAfterUsageLimit.previousTurnIds) &&
        value.resumeAfterUsageLimit.previousTurnIds.every(isString))) &&
    (value.planContinuation === undefined ||
      (isRecord(value.planContinuation) &&
        Array.isArray(value.planContinuation.turnIds) &&
        value.planContinuation.turnIds.every(isString) &&
        (value.planContinuation.queued === undefined || value.planContinuation.queued === true)))
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

/** A message the person wrote in the agent's chat or a task, not one of a channel or a messaging app. */
function isChatMessageFromPerson(message: StoredMessage): boolean {
  return (
    message.sender.kind === "user" &&
    message.channelId === undefined &&
    message.messaging === undefined &&
    message.messagingReturn === undefined
  );
}

/** An agent's answer to a request. A linked message that asks for a reply is a new request. */
function isAnswer(
  message: StoredMessage,
): message is StoredMessage & { sender: { kind: "agent"; agentId: string }; replyToMessageId: string } {
  return message.sender.kind === "agent" && message.replyToMessageId !== null && message.expectsReply === false;
}
