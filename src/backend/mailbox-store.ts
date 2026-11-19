import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { playableMediaKind } from "@openbot/contracts/attachment-files";
import { rewriteAttachmentReferences } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentRuntimeWorkItem,
  AgentTaskAwaitedReply,
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
  AGENT_TASK_AWAITED_STATES,
  AGENT_WELCOME_ITEM_TYPE,
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
import { routineNameInLimit } from "./database/legacy-conversation-message";
import { mailboxReactionRowKey } from "./database/mailbox-projection";
import { MailboxDeliveryGate } from "./mailbox-delivery-gate";
import { runIdOrigins } from "./message-run-ids";
import type { OpenBotDatabase } from "./openbot-database";
import { isRecord } from "./protocol";
import { recordRestartActivity } from "./restart-activity";

const MAX_ATTACHMENTS = INPUT_LIMITS.attachments;
const FAILED_REQUEST_REASON_LIMIT = 2_000;
const FAILED_REQUEST_KEY_PREFIX = "failed-request:";
export const AUTO_RESULT_KEY_PREFIX = "auto-result:";
const RESTARTED_RESULT_KEY_PREFIX = "restarted-result:";
const WELCOME_PENDING_STATUSES: ReadonlySet<QueueDeliveryStatus> = new Set(["queued", "starting", "running"]);
export interface MessagingOrigin {
  linkId: string;
  authorId: string;
  authorName: string;
  platformMessageId: string;
  replyTo?: { authorName: string; text: string; sentAt: string };
}

interface StoredMessage {
  channelId?: string | undefined;
  messaging?: MessagingOrigin;
  messagingReturn?: MessagingOrigin;
  taskId?: string;
  senderTaskId?: string;
  id: string;
  sender:
    | { kind: "user" }
    | { kind: "agent"; agentId: string }
    | { kind: "routine"; routineId: string; runId: string; routineName: string; scheduledFor: string };
  senderMember?: ConversationMessageSender;
  text: string;
  attachments: StoredAttachment[];
  voiceRecording?: StoredAttachment;
  replyToMessageId: string | null;
  expectsReply?: false;
  welcome?: true;
  agentSetup?: true;
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
  steeredAt?: string;
  steerFallback?: QueueSteerFallback;
  resumeAfterUsageLimit?: UsageLimitContinuation;
  planContinuation?: PlanContinuationMarker;
}

export interface TaskWork {
  queuedMessages: Array<{ deliveryId: string; text: string; createdAt: string }>;
  queue: QueueDelivery[];
  active: boolean;
}

function waitsForPlanContinuation(delivery: StoredDelivery): boolean {
  return delivery.status === "queued" && delivery.planContinuation?.queued === true;
}

function isActiveDelivery(delivery: StoredDelivery): boolean {
  return delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running";
}

interface ConversationIndexEntry {
  message: StoredMessage;
  active: boolean;
  conversationTime: string;
}

interface KeptIndex<Item, Index> {
  source: readonly Item[];
  length: number;
  index: Index;
}

interface ConversationIndex {
  state: StoredState;
  messages: StoredMessage[];
  deliveries: StoredDelivery[];
  idempotency: StoredState["idempotency"];
  deliveriesByMessage: Map<string, StoredDelivery[]>;
  positions: Map<string, number>;
  turnIds: Map<string, string | undefined>;
  entriesByAgent: Map<string, ConversationIndexEntry[]>;
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
  expectsReply?: boolean | undefined;
  welcome?: boolean;
  agentSetup?: boolean;
  draftIds?: string[];
  voiceRecordingDraftId?: string;
  sourcePaths?: string[];
  idempotencyKey?: string;
}

export interface MailboxStoredFile {
  attachment: AttachmentSummary;
  path: string;
  source: "attachment" | "generated";
  messageId: string | null;
  agentId: string | null;
  createdAt: string | null;
}

export interface DeliveryContext {
  delivery: QueueDelivery;
  managedAttachments: Array<AttachmentSummary & { path: string }>;
  resumeAfterUsageLimit?: UsageLimitContinuation;
  planContinuation?: PlanContinuationMarker;
  channelId?: string;
  senderTaskId?: string;
  restartedResult?: true;
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

export interface CommittedChannelAttachments {
  text: string;
  attachments: AttachmentSummary[];
  accept: Effect.Effect<void>;
  revert: Effect.Effect<void, StoredStateFailure>;
}

export const MAILBOX_CONVERSATION_MESSAGE_LIMIT = 100;

export const QUEUE_EDIT_HOLD_MS = 10 * 60_000;

const CHANNEL_LANE_PREFIX = "\u0001channel:";

export function channelLane(channelId: string): string {
  return `${CHANNEL_LANE_PREFIX}${channelId}`;
}

export function laneChannelId(lane: string | null): string | null {
  return lane?.startsWith(CHANNEL_LANE_PREFIX) ? lane.slice(CHANNEL_LANE_PREFIX.length) : null;
}

export const MESSAGING_LANE = "\u0001messaging";

export class MailboxStore {
  readonly #statePath: string;
  readonly #files: AttachmentFiles;
  readonly #database: OpenBotDatabase;
  readonly #queueUpdates = new Set<string>();
  #usesMessagingLane: (agentId: string, linkId: string) => boolean = () => true;
  readonly #editHolds = new Map<string, { editId: string; startedAt: number }>();
  readonly #deliveryGate = new MailboxDeliveryGate();
  readonly #stagedGeneratedAttachments = new Map<string, StoredGeneratedAttachment>();
  #state: StoredState = structuredClone(EMPTY_STATE);
  #keptConversationIndex: ConversationIndex | undefined;
  #keptMessagesById: KeptIndex<StoredMessage, ReadonlyMap<string, StoredMessage>> | undefined;
  #keptDeliveriesByRecipient: KeptIndex<StoredDelivery, ReadonlyMap<string, StoredDelivery[]>> | undefined;
  #initialized = false;
  readonly #changes = {
    messageIds: new Set<string>(),
    deliveryIds: new Set<string>(),
    draftIds: new Set<string>(),
    generatedAttachmentIds: new Set<string>(),
    reactionKeys: new Set<string>(),
  };

  constructor(userDataPath: string, sharedRoot: string, database: OpenBotDatabase) {
    this.#statePath = join(userDataPath, "mailbox.json");
    this.#files = new AttachmentFiles({ userDataPath, sharedRoot });
    this.#database = database;
  }

  initialize = Effect.fn("MailboxStore.initialize")(function* (
    this: MailboxStore,
  ): Effect.fn.Return<void, StoredStateFailure> {
    if (this.#initialized) return;
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
        if (JSON.stringify(this.#state) !== JSON.stringify(stored)) {
          this.#persist("mailbox.normalized", undefined, [], true);
        }
      } else {
        this.#state = normalizeStoredState(yield* this.#readStateEffect());
        yield* this.#database.backupLegacyFile(this.#statePath);
        this.#persist("mailbox.legacy-imported", "legacy-import:mailbox:v1", [], true);
      }
      const startedAt = Date.now();
      for (const delivery of this.#state.deliveries)
        if (delivery.status === "queued" && delivery.editId)
          this.#editHolds.set(delivery.id, { editId: delivery.editId, startedAt });
      const activeEdits = new Set([...this.#editHolds.values()].map((hold) => hold.editId));
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
      this.#initialized = true;
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

  keepDraft = Effect.fn("MailboxStore.keepDraft")(function* (
    this: MailboxStore,
    id: string,
    types: ReadonlySet<string>,
  ): Effect.fn.Return<AttachmentSummary | "missing" | "type", StoredStateFailure> {
    const draft = this.#state.drafts.find((candidate) => candidate.id === id);
    if (!draft) return "missing";
    if (!types.has(draft.mimeType)) return "type";
    const source = yield* this.#files
      .resolveDraft(draft)
      .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
    if (!source) return "missing";
    const kept = yield* this.storeGeneratedAttachment({
      sourcePath: source.path,
      name: source.name,
      mimeType: source.mimeType,
    });
    yield* this.discardDraft(id);
    return kept;
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

  forgetIdempotencyKeys(prefix: string, createdBefore: Date): void {
    const createdAt = new Map(this.#state.messages.map((message) => [message.id, Date.parse(message.createdAt)]));
    const cutoff = createdBefore.getTime();
    this.#state.idempotency = Object.fromEntries(
      Object.entries(this.#state.idempotency).filter(
        ([key, messageId]) =>
          !key.startsWith(prefix) || (createdAt.get(messageId) ?? Number.NEGATIVE_INFINITY) >= cutoff,
      ),
    );
    this.#keptConversationIndex = undefined;
  }

  receiptForKey(key: string): QueuedMessageReceipt | null {
    const messageId = this.#state.idempotency[key];
    return messageId ? this.#receipt(messageId) : null;
  }

  forgetIdempotencyKey(key: string): void {
    delete this.#state.idempotency[key];
    this.#keptConversationIndex = undefined;
  }

  taskIdForKey(key: string): string | null {
    const messageId = this.#state.idempotency[key];
    return messageId ? (this.#state.messages.find((message) => message.id === messageId)?.taskId ?? null) : null;
  }

  deliveryForKey(key: string): DeliveryContext | null {
    const messageId = this.#state.idempotency[key];
    const delivery = this.#state.deliveries.find((item) => item.messageId === messageId);
    return delivery ? this.#context(delivery) : null;
  }

  messagingOrigin(deliveryId: string): MessagingOrigin | null {
    const delivery = this.#state.deliveries.find((item) => item.id === deliveryId);
    const message = delivery ? this.#state.messages.find((item) => item.id === delivery.messageId) : undefined;
    return message?.messaging ? structuredClone(message.messaging) : null;
  }

  #answerReturn(input: EnqueueInput, recipients: readonly string[]): MessagingOrigin | undefined {
    if (input.sender.kind !== "agent" || !input.replyToMessageId) return undefined;
    return this.answerReturn([input.replyToMessageId], recipients);
  }

  answerReturn(requestIds: readonly string[], recipients: readonly string[]): MessagingOrigin | undefined {
    if (recipients.length !== 1) return undefined;
    const origins = requestIds.map((requestId) => {
      const request = this.#state.messages.find((message) => message.id === requestId);
      return request?.sender.kind === "agent" && request.sender.agentId === recipients[0]
        ? request.messagingReturn
        : undefined;
    });
    const [origin] = origins;
    if (
      !origin ||
      origins.some(
        (candidate) => candidate?.linkId !== origin.linkId || candidate.platformMessageId !== origin.platformMessageId,
      )
    )
      return undefined;
    return structuredClone(origin);
  }

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

  sideThreadWaitsFor(agentId: string, messageId: string): boolean {
    const message = this.#state.messages.find((candidate) => candidate.id === messageId);
    if (!message?.senderTaskId || message.sender.kind !== "agent") return false;
    const { senderTaskId, sender } = message;
    return this.#state.messages.some(
      (request) =>
        request.senderTaskId === senderTaskId &&
        request.sender.kind === "agent" &&
        request.sender.agentId === sender.agentId &&
        request.expectsReply !== false &&
        this.#state.deliveries.some(
          (delivery) => delivery.messageId === request.id && delivery.recipientAgentId === agentId,
        ) &&
        !this.#state.messages.some(
          (answer) => isAnswer(answer) && answer.sender.agentId === agentId && answer.replyToMessageId === request.id,
        ),
    );
  }

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
        sender: storedSender(input.sender),
        ...(input.sender.kind === "user" && input.senderMember ? { senderMember: input.senderMember } : {}),
        text: rewriteAttachmentReferences(text, (reference) => {
          const attachment = committedByDraftId.get(reference.attachmentId);
          return attachment ? { attachmentId: attachment.id, name: attachment.name } : null;
        }),
        attachments,
        ...(voiceRecording ? { voiceRecording } : {}),
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.expectsReply === false ? { expectsReply: false as const } : {}),
        ...(input.welcome ? { welcome: true as const } : {}),
        ...(input.agentSetup ? { agentSetup: true as const } : {}),
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
      yield* this.#files.removeAttachmentDirectories(usedDrafts.map((draft) => draft.path)).pipe(Effect.ignore);
      return this.#receipt(messageId);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  commitChannelAttachments = Effect.fn("MailboxStore.commitChannelAttachments")(function* (
    this: MailboxStore,
    input: {
      channelId: string;
      messageId: string;
      text: string;
      draftIds: string[];
      sourcePaths?: string[];
      sender?: StoredMessage["sender"];
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
      const sourcePaths = [...drafts.map((draft) => draft.path), ...(input.sourcePaths ?? [])];
      if (sourcePaths.length > MAX_ATTACHMENTS)
        throw new Error(sourceText("error.backend.attachLimit", { limit: MAX_ATTACHMENTS }));
      const sender: StoredMessage["sender"] = input.sender ?? { kind: "user" };
      const createdAt = new Date().toISOString();
      const attachments = yield* this.#files
        .commitMessageTransfer(input.messageId, sender, [], input.messageId, createdAt, sourcePaths)
        .pipe(Effect.mapError(({ cause }) => new StoredStateFailure({ cause })));
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

  listQueue(agentId: string): QueueSnapshot {
    const executionMessageIds = this.#executionMessageIds();
    const positions = this.#queuedPositions();
    const messages = this.#messagesById();
    const welcome = this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId &&
        WELCOME_PENDING_STATUSES.has(delivery.status) &&
        messages.get(delivery.messageId)?.welcome === true,
    );
    return {
      agentId,
      ...(welcome ? { welcome: true as const } : {}),
      deliveries: [...this.#state.deliveries]
        .filter((delivery) => delivery.recipientAgentId === agentId && !executionMessageIds.has(delivery.messageId))
        .sort(compareQueueOrder)
        .map((delivery) =>
          this.#publicDelivery(delivery, positions, this.#requireMessage(delivery.messageId, messages)),
        ),
    };
  }

  listActiveQueues(agentIds: readonly string[], failedTurns: ReadonlyMap<string, string>): QueueSnapshot[] {
    const targets = new Set(agentIds);
    const executionMessageIds = this.#executionMessageIds();
    const messages = this.#messagesById();
    const welcomes = new Set<string>();
    const open = new Map<string, StoredDelivery[]>();
    for (const delivery of this.#state.deliveries) {
      const agentId = delivery.recipientAgentId;
      if (!targets.has(agentId)) continue;
      if (WELCOME_PENDING_STATUSES.has(delivery.status) && messages.get(delivery.messageId)?.welcome === true)
        welcomes.add(agentId);
      if (executionMessageIds.has(delivery.messageId)) continue;
      const failed = delivery.status === "failed" && delivery.turnId === failedTurns.get(agentId);
      if (!isActiveDelivery(delivery) && !failed) continue;
      const list = open.get(agentId);
      if (list) list.push(delivery);
      else open.set(agentId, [delivery]);
    }
    const positions = open.size > 0 ? this.#queuedPositions() : new Map<string, number>();
    return [...targets].map((agentId) => ({
      agentId,
      ...(welcomes.has(agentId) ? { welcome: true as const } : {}),
      deliveries: (open.get(agentId) ?? [])
        .sort(compareQueueOrder)
        .map((delivery) =>
          this.#publicDelivery(delivery, positions, this.#requireMessage(delivery.messageId, messages)),
        ),
    }));
  }

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

  taskRoutineDeliveries(agentId: string): QueueDelivery[] {
    const messages = this.#messagesById();
    const deliveries = this.#state.deliveries.filter((delivery) => {
      const message = messages.get(delivery.messageId);
      return delivery.recipientAgentId === agentId && message?.taskId && message.sender.kind === "routine";
    });
    if (deliveries.length === 0) return [];
    const positions = this.#queuedPositions();
    return deliveries.map((delivery) =>
      this.#publicDelivery(delivery, positions, this.#requireMessage(delivery.messageId, messages)),
    );
  }

  #executionMessageIds(): Set<string> {
    const ids = new Set<string>();
    for (const message of this.#state.messages)
      if (message.channelId || message.messaging || message.taskId || message.welcome) ids.add(message.id);
    return ids;
  }

  awaitedThreadRequests(): Array<
    AgentTaskAwaitedReply & { deliveryId: string; senderAgentId: string; taskId: string }
  > {
    let messages: ReadonlyMap<string, StoredMessage> | undefined;
    let answered: Set<string> | undefined;
    return this.#state.deliveries.flatMap((delivery) => {
      if (!isOneOf(AGENT_TASK_AWAITED_STATES, delivery.status)) return [];
      messages ??= this.#messagesById();
      const message = messages.get(delivery.messageId);
      if (!message?.senderTaskId || message.sender.kind !== "agent" || message.expectsReply === false) return [];
      answered ??= new Set(
        this.#state.messages.flatMap((answer) =>
          isAnswer(answer) ? [`${answer.replyToMessageId}:${answer.sender.agentId}`] : [],
        ),
      );
      if (answered.has(`${message.id}:${delivery.recipientAgentId}`)) return [];
      return [
        {
          deliveryId: delivery.id,
          senderAgentId: message.sender.agentId,
          taskId: message.senderTaskId,
          messageId: message.id,
          recipientAgentId: delivery.recipientAgentId,
          status: delivery.status,
        },
      ];
    });
  }

  #messagesById(): ReadonlyMap<string, StoredMessage> {
    const messages = this.#state.messages;
    const kept = this.#keptMessagesById;
    if (kept?.source === messages && kept.length === messages.length) return kept.index;
    const index = new Map(messages.map((message) => [message.id, message]));
    this.#keptMessagesById = { source: messages, length: messages.length, index };
    return index;
  }

  taskIdForDelivery(deliveryId: string): string | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#taskIdOf(delivery) : null;
  }

  isWelcomeDelivery(deliveryId: string): boolean {
    return this.#messageOfDelivery(deliveryId)?.welcome === true;
  }

  isAgentSetupDelivery(deliveryId: string): boolean {
    return this.#messageOfDelivery(deliveryId)?.agentSetup === true;
  }

  #messageOfDelivery(deliveryId: string): StoredMessage | undefined {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#state.messages.find((message) => message.id === delivery.messageId) : undefined;
  }

  #taskIdOf(delivery: StoredDelivery, messages?: ReadonlyMap<string, StoredMessage>): string | null {
    const message = messages
      ? messages.get(delivery.messageId)
      : this.#state.messages.find((candidate) => candidate.id === delivery.messageId);
    return message?.taskId ?? null;
  }

  #laneOf(delivery: StoredDelivery, messages?: ReadonlyMap<string, StoredMessage>): string | null {
    const message = messages
      ? messages.get(delivery.messageId)
      : this.#state.messages.find((candidate) => candidate.id === delivery.messageId);
    if (message?.taskId) return message.taskId;
    if (message?.channelId) return channelLane(message.channelId);
    return message?.messaging && this.#usesMessagingLane(delivery.recipientAgentId, message.messaging.linkId)
      ? MESSAGING_LANE
      : null;
  }

  useMessagingLane(uses: (agentId: string, linkId: string) => boolean): void {
    this.#usesMessagingLane = uses;
  }

  inMessagingLane(agentId: string, linkId: string): boolean {
    return this.#usesMessagingLane(agentId, linkId);
  }

  laneIdForDelivery(deliveryId: string): string | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#laneOf(delivery) : null;
  }

  channelLanes(agentId: string, queuedOnly = false): string[] {
    return this.#lanesWithWork(agentId, queuedOnly).filter((lane) => laneChannelId(lane) !== null);
  }

  sideLanes(agentId: string, queuedOnly = false): string[] {
    return this.#lanesWithWork(agentId, queuedOnly).filter(
      (lane) => lane === MESSAGING_LANE || laneChannelId(lane) !== null,
    );
  }

  #lanesWithWork(agentId: string, queuedOnly: boolean): string[] {
    const deliveries = queuedOnly ? this.#queuedFor(agentId) : this.#deliveriesFor(agentId).filter(isActiveDelivery);
    if (deliveries.length === 0) return [];
    const messages = this.#messagesById();
    const lanes = new Set<string>();
    for (const delivery of deliveries) {
      const lane = this.#laneOf(delivery, messages);
      if (lane !== null) lanes.add(lane);
    }
    return [...lanes];
  }

  #contexts(deliveries: StoredDelivery[]): DeliveryContext[] {
    if (deliveries.length === 0) return [];
    const positions = deliveries.some((delivery) => delivery.status === "queued")
      ? this.#queuedPositions()
      : new Map<string, number>();
    const messages = this.#messagesById();
    return deliveries.map((delivery) => this.#context(delivery, positions, messages));
  }

  queuedTaskIds(agentId: string): string[] {
    const ids = new Set<string>();
    const messages = this.#messagesById();
    for (const delivery of this.#queuedFor(agentId)) {
      const taskId = this.#taskIdOf(delivery, messages);
      if (taskId) ids.add(taskId);
    }
    return [...ids];
  }

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

  taskWork(agentId: string): Map<string, TaskWork> {
    const works = new Map<string, TaskWork>();
    const workOf = (taskId: string): TaskWork => {
      const existing = works.get(taskId);
      if (existing) return existing;
      const work: TaskWork = { queuedMessages: [], queue: [], active: false };
      works.set(taskId, work);
      return work;
    };
    const queued: StoredDelivery[] = [];
    const active: StoredDelivery[] = [];
    for (const delivery of this.#state.deliveries) {
      if (delivery.recipientAgentId !== agentId) continue;
      if (delivery.status === "queued") {
        if (!waitsForPlanContinuation(delivery)) queued.push(delivery);
      } else if (delivery.status === "starting" || delivery.status === "running") active.push(delivery);
    }
    if (queued.length === 0 && active.length === 0) return works;
    const messages = this.#messagesById();
    for (const delivery of active) {
      const taskId = this.#taskIdOf(delivery, messages);
      if (taskId) workOf(taskId).active = true;
    }
    const queuedByTask = new Map<string, Array<{ delivery: StoredDelivery; message: StoredMessage }>>();
    for (const delivery of queued.sort(compareQueueOrder)) {
      const message = messages.get(delivery.messageId);
      if (!message?.taskId) continue;
      const items = queuedByTask.get(message.taskId) ?? [];
      items.push({ delivery, message });
      queuedByTask.set(message.taskId, items);
    }
    for (const [taskId, items] of queuedByTask) {
      const work = workOf(taskId);
      const positions = new Map(items.map(({ delivery }, index) => [delivery.id, index + 1]));
      for (const { delivery, message } of items) {
        work.queuedMessages.push({ deliveryId: delivery.id, text: message.text, createdAt: message.createdAt });
        work.queue.push(this.#publicDelivery(delivery, positions, message));
      }
    }
    return works;
  }

  laneActive(agentId: string, taskId: string | null): boolean {
    const messages = this.#messagesById();
    return this.#deliveriesFor(agentId).some(
      (delivery) =>
        (delivery.status === "starting" || delivery.status === "running") &&
        this.#laneOf(delivery, messages) === taskId,
    );
  }

  laneQueuedIds(agentId: string, taskId: string | null): string[] {
    const messages = this.#messagesById();
    return this.#queuedFor(agentId)
      .filter((delivery) => !waitsForPlanContinuation(delivery) && this.#laneOf(delivery, messages) === taskId)
      .map((delivery) => delivery.id);
  }

  taskBusy(agentId: string, taskId: string): boolean {
    const messages = this.#messagesById();
    return this.#deliveriesFor(agentId).some(
      (delivery) => isActiveDelivery(delivery) && this.#taskIdOf(delivery, messages) === taskId,
    );
  }

  deleteTaskMessages = Effect.fn("MailboxStore.deleteTaskMessages")(function* (
    this: MailboxStore,
    agentId: string,
    taskId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const teammateAnswer = (message: StoredMessage) =>
        message.sender.kind === "agent" && message.sender.agentId !== agentId;
      const found = () => {
        const lane = this.#state.messages.filter((message) => message.taskId === taskId);
        const laneIds = new Set(lane.map((message) => message.id));
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

  deleteShownMessage(agentId: string, shownMessageId: string): Effect.Effect<"busy" | "deleted", StoredStateFailure> {
    return this.deleteShownMessages(agentId, [shownMessageId], `mailbox:message-deleted:${agentId}:${shownMessageId}`);
  }

  deleteShownMessages = Effect.fn("MailboxStore.deleteShownMessages")(function* (
    this: MailboxStore,
    agentId: string,
    shownMessageIds: readonly string[],
    commandPrefix = `mailbox:history-deleted:${agentId}`,
  ): Effect.fn.Return<"busy" | "deleted", StoredStateFailure> {
    try {
      const shown = new Set(shownMessageIds);
      const found = () => {
        const deliveries = this.#state.deliveries.filter(
          (candidate) => shown.has(candidate.id) && candidate.recipientAgentId === agentId,
        );
        const messages = this.#messagesById();
        const personal = deliveries.flatMap((delivery) => {
          const message = messages.get(delivery.messageId);
          return message?.sender.kind === "user" ? [{ delivery, message }] : [];
        });
        const removedDeliveryIds = new Set(personal.map(({ delivery }) => delivery.id));
        const keptMessageIds = new Set(
          this.#state.deliveries
            .filter((candidate) => !removedDeliveryIds.has(candidate.id))
            .map((candidate) => candidate.messageId),
        );
        const lastOf = personal.filter(({ message }) => !keptMessageIds.has(message.id)).map(({ message }) => message);
        return { deliveries, personal, lastOf: [...new Set(lastOf)] };
      };
      const before = found();
      if (before.deliveries.some(isActiveDelivery)) return "busy";
      const managedPaths = new Map<string, string | null>();
      for (const message of before.lastOf) {
        for (const file of messageFiles(message)) {
          if (file.deletedAt || managedPaths.has(file.path)) continue;
          managedPaths.set(file.path, yield* this.#files.managedTransferFile(file.path).pipe(toStoredStateFailure));
        }
      }
      const { deliveries, personal, lastOf } = found();
      if (deliveries.some(isActiveDelivery)) return "busy";
      const removedMessageIds = new Set(lastOf.map((message) => message.id));
      const reactions = this.#state.reactions.filter(
        (reaction) =>
          (reaction.agentId === agentId && shown.has(reaction.messageId)) || removedMessageIds.has(reaction.messageId),
      );
      if (personal.length === 0 && reactions.length === 0) return "deleted";
      const previous = structuredClone(this.#state);
      const deletions: string[] = [];
      const removedDeliveryIds = new Set(personal.map(({ delivery }) => delivery.id));
      this.#state.deliveries = this.#state.deliveries.filter((candidate) => !removedDeliveryIds.has(candidate.id));
      for (const id of removedDeliveryIds) this.#changes.deliveryIds.add(id);
      if (removedMessageIds.size > 0) {
        this.#state.messages = this.#state.messages.filter((candidate) => !removedMessageIds.has(candidate.id));
        for (const id of removedMessageIds) this.#changes.messageIds.add(id);
        for (const [key, keyMessageId] of Object.entries(this.#state.idempotency))
          if (removedMessageIds.has(keyMessageId)) delete this.#state.idempotency[key];
        const inUse = new Set(
          this.#fileRecords()
            .filter((record) => !record.deletedAt)
            .map((record) => record.path),
        );
        for (const path of new Set(
          lastOf.flatMap(messageFiles).flatMap((file) => (file.deletedAt ? [] : [file.path])),
        )) {
          const managed = inUse.has(path) ? null : managedPaths.get(path);
          if (managed) deletions.push(managed);
        }
      }
      const removedReactions = new Set(reactions);
      this.#state.reactions = this.#state.reactions.filter((reaction) => !removedReactions.has(reaction));
      for (const reaction of reactions)
        this.#changes.reactionKeys.add(mailboxReactionRowKey(reaction.agentId, reaction.messageId, reaction.actor));
      try {
        this.#persist("mailbox.message-deleted", `${commandPrefix}:${randomUUID()}`, deletions);
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
      return "deleted";
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  deleteChannelMessageCopy(channelId: string, messageId: string): Effect.Effect<void, StoredStateFailure> {
    return this.deleteChannelMessageCopies(
      channelId,
      [messageId],
      `mailbox:channel-message-deleted:${channelId}:${messageId}`,
    );
  }

  deleteChannelMessageCopies = Effect.fn("MailboxStore.deleteChannelMessageCopies")(function* (
    this: MailboxStore,
    channelId: string,
    messageIds: readonly string[] | "all",
    commandPrefix = `mailbox:channel-history-deleted:${channelId}`,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const named = messageIds === "all" ? null : new Set(messageIds);
      const find = () => {
        const delivered = new Set(this.#state.deliveries.map((delivery) => delivery.messageId));
        return this.#state.messages.filter(
          (candidate) =>
            candidate.channelId === channelId &&
            (named === null || named.has(candidate.id)) &&
            !delivered.has(candidate.id),
        );
      };
      const before = find();
      if (before.length === 0) return;
      const managedPaths = new Map<string, string | null>();
      for (const file of before.flatMap(messageFiles)) {
        if (file.deletedAt || managedPaths.has(file.path)) continue;
        managedPaths.set(file.path, yield* this.#files.managedTransferFile(file.path).pipe(toStoredStateFailure));
      }
      const messages = find();
      if (messages.length === 0) return;
      const removed = new Set(messages);
      const removedIds = new Set(messages.map((message) => message.id));
      const previous = structuredClone(this.#state);
      this.#state.messages = this.#state.messages.filter((candidate) => !removed.has(candidate));
      for (const id of removedIds) this.#changes.messageIds.add(id);
      const reactions = this.#state.reactions.filter((reaction) => removedIds.has(reaction.messageId));
      const removedReactions = new Set(reactions);
      this.#state.reactions = this.#state.reactions.filter((reaction) => !removedReactions.has(reaction));
      for (const reaction of reactions)
        this.#changes.reactionKeys.add(mailboxReactionRowKey(reaction.agentId, reaction.messageId, reaction.actor));
      for (const [key, keyMessageId] of Object.entries(this.#state.idempotency))
        if (removedIds.has(keyMessageId)) delete this.#state.idempotency[key];
      const inUse = new Set(
        this.#fileRecords()
          .filter((record) => !record.deletedAt)
          .map((record) => record.path),
      );
      const deletions: string[] = [];
      for (const path of new Set(
        messages.flatMap(messageFiles).flatMap((file) => (file.deletedAt ? [] : [file.path])),
      )) {
        const managed = inUse.has(path) ? null : managedPaths.get(path);
        if (managed) deletions.push(managed);
      }
      try {
        this.#persist("mailbox.channel-message-deleted", `${commandPrefix}:${randomUUID()}`, deletions);
      } catch (error) {
        this.#state = previous;
        throw error;
      }
      yield* this.#drainFileDeletionOutboxEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

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
    const candidates: { delivery: StoredDelivery; isCurrentFailure: boolean }[] = [];
    for (const delivery of this.#state.deliveries) {
      if (!targetAgentIds.has(delivery.recipientAgentId)) continue;
      const isWorking = delivery.status === "starting" || delivery.status === "running";
      const isCurrentFailure =
        delivery.status === "failed" && delivery.turnId === failedTurns.get(delivery.recipientAgentId);
      if (isWorking || isCurrentFailure) candidates.push({ delivery, isCurrentFailure });
    }
    if (candidates.length === 0) return [];
    const candidateMessageIds = new Set(candidates.map(({ delivery }) => delivery.messageId));
    const messages = new Map<string, StoredMessage>();
    for (const message of this.#state.messages) {
      if (candidateMessageIds.has(message.id)) messages.set(message.id, message);
    }
    const working: StoredDelivery[] = [];
    const failed: StoredDelivery[] = [];
    const workingAgentIds = new Set<string>();
    const failedAgentIds = new Set<string>();
    for (const { delivery, isCurrentFailure } of candidates) {
      if (messages.get(delivery.messageId)?.welcome) continue;
      const seenAgentIds = isCurrentFailure ? failedAgentIds : workingAgentIds;
      if (seenAgentIds.has(delivery.recipientAgentId)) continue;
      seenAgentIds.add(delivery.recipientAgentId);
      (isCurrentFailure ? failed : working).push(delivery);
    }
    const selected = [
      ...failed.slice(0, AGENT_RUNTIME_ATTENTION_LIMIT),
      ...working.slice(0, AGENT_RUNTIME_WORKING_ITEMS_LIMIT),
    ];
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
    const index = this.#conversationIndex();
    const { deliveriesByMessage, positions, turnIds } = index;
    const selectedStoredMessages: StoredMessage[] = [];
    let completedCount = 0;
    for (const { message, active, conversationTime } of this.#conversationEntries(index, agentId)) {
      if (!active && options.fromCreatedAt && conversationTime < options.fromCreatedAt) continue;
      if (!active && completedCount >= limit) continue;
      selectedStoredMessages.push(message);
      if (!active) completedCount += 1;
    }
    selectedStoredMessages.reverse();
    const messages: ConversationMessage[] = [];
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
          turnId:
            storedDelivery.planContinuation?.turnIds[0] ??
            storedDelivery.resumeAfterUsageLimit?.previousTurnIds[0] ??
            storedDelivery.turnId ??
            undefined,
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
                  ...(message.senderTaskId ? { senderTaskId: message.senderTaskId } : {}),
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
          ...(storedDelivery.steeredAt === undefined ? {} : { steered: true as const }),
          status: delivery.status === "failed" ? "failed" : "completed",
          itemType:
            message.sender.kind === "agent"
              ? AGENT_EXCHANGE_ITEM_TYPE
              : message.sender.kind === "routine"
                ? "routine"
                : message.welcome
                  ? AGENT_WELCOME_ITEM_TYPE
                  : undefined,
        });
      }
    }
    return messages;
  }

  #conversationIndex(): ConversationIndex {
    const state = this.#state;
    const unsaved = Object.values(this.#changes).some((keys) => keys.size > 0);
    const kept = this.#keptConversationIndex;
    if (
      !unsaved &&
      kept?.state === state &&
      kept.messages === state.messages &&
      kept.deliveries === state.deliveries &&
      kept.idempotency === state.idempotency
    )
      return kept;
    const deliveriesByMessage = new Map<string, StoredDelivery[]>();
    for (const delivery of state.deliveries) {
      const deliveries = deliveriesByMessage.get(delivery.messageId) ?? [];
      deliveries.push(delivery);
      deliveriesByMessage.set(delivery.messageId, deliveries);
    }
    const index: ConversationIndex = {
      state,
      messages: state.messages,
      deliveries: state.deliveries,
      idempotency: state.idempotency,
      deliveriesByMessage,
      positions: this.#queuedPositions(),
      turnIds: this.#sourceTurnIds(),
      entriesByAgent: new Map(),
    };
    this.#keptConversationIndex = unsaved ? undefined : index;
    return index;
  }

  #conversationEntries(index: ConversationIndex, agentId: string): ConversationIndexEntry[] {
    const known = index.entriesByAgent.get(agentId);
    if (known) return known;
    const entries: ConversationIndexEntry[] = [];
    for (let position = index.messages.length - 1; position >= 0; position -= 1) {
      const message = index.messages[position];
      if (!message || message.channelId || message.messaging) continue;
      const ownMessage = message.sender.kind === "agent" && message.sender.agentId === agentId;
      const deliveries = index.deliveriesByMessage.get(message.id) ?? [];
      if (message.taskId && (!ownMessage || !deliveries.some((delivery) => delivery.recipientAgentId !== agentId)))
        continue;
      if ((message.messagingReturn || message.senderTaskId) && ownMessage) continue;
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
      entries.push({ message, active, conversationTime });
    }
    index.entriesByAgent.set(agentId, entries);
    return entries;
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

  nextQueued(agentId: string, taskId: string | null = null): DeliveryContext | null {
    if (this.laneActive(agentId, taskId)) return null;
    const messages = this.#messagesById();
    const delivery = this.#queuedFor(agentId).find(
      (candidate) => this.#laneOf(candidate, messages) === taskId && !this.#isHeldReply(candidate, messages),
    );
    return delivery && this.#mayStart(delivery) ? this.#context(delivery, undefined, messages) : null;
  }

  repliesToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next) return [];
    const message = this.#requireMessage(next.messageId);
    const requestId = isAnswer(message) ? message.replyToMessageId : null;
    if (!requestId) return [];
    const messages = this.#messagesById();
    const lane = this.#laneOf(next, messages);
    return this.#contexts(
      this.#queuedFor(next.recipientAgentId).filter((candidate) => {
        if (candidate.id === next.id || !this.#mayStart(candidate) || this.#laneOf(candidate, messages) !== lane)
          return false;
        const reply = this.#requireMessage(candidate.messageId, messages);
        return isAnswer(reply) && reply.replyToMessageId === requestId;
      }),
    );
  }

  userMessagesToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next) return [];
    const messages = this.#messagesById();
    const first = this.#requireMessage(next.messageId, messages);
    if (!isChatMessageFromPerson(first)) return [];
    const lane = this.#laneOf(next, messages);
    const queued = this.#queuedFor(next.recipientAgentId).filter(
      (candidate) => this.#laneOf(candidate, messages) === lane && !this.#isHeldReply(candidate, messages),
    );
    const start = queued.findIndex((candidate) => candidate.id === next.id);
    if (start < 0) return [];
    const run: StoredDelivery[] = [];
    for (const candidate of queued.slice(start + 1)) {
      const message = this.#requireMessage(candidate.messageId, messages);
      if (
        !this.#mayStart(candidate) ||
        candidate.resumeAfterUsageLimit?.turnId !== next.resumeAfterUsageLimit?.turnId ||
        !isChatMessageFromPerson(message) ||
        message.senderMember?.id !== first.senderMember?.id
      )
        break;
      run.push(candidate);
    }
    return this.#contexts(run);
  }

  planContinuationsToStartWith(deliveryId: string): DeliveryContext[] {
    const next = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!next || !waitsForPlanContinuation(next)) return [];
    const messages = this.#messagesById();
    const lane = this.#laneOf(next, messages);
    return this.#contexts(
      this.#queuedFor(next.recipientAgentId).filter(
        (candidate) =>
          candidate.id !== next.id && waitsForPlanContinuation(candidate) && this.#laneOf(candidate, messages) === lane,
      ),
    );
  }

  unansweredRecipients(requestId: string): string[] {
    return this.#state.deliveries
      .filter(
        (delivery) =>
          delivery.messageId === requestId &&
          (delivery.status === "failed" || delivery.status === "interrupted" || delivery.status === "cancelled") &&
          !this.#hasAnswered(requestId, delivery.recipientAgentId),
      )
      .map((delivery) => delivery.recipientAgentId);
  }

  #hasAnswered(requestId: string, agentId: string): boolean {
    return this.#state.messages.some(
      (message) => isAnswer(message) && message.sender.agentId === agentId && message.replyToMessageId === requestId,
    );
  }

  #queuedFor(agentId: string): StoredDelivery[] {
    return this.#deliveriesFor(agentId)
      .filter((candidate) => candidate.status === "queued")
      .sort(compareQueueOrder);
  }

  #deliveriesFor(agentId: string): readonly StoredDelivery[] {
    const deliveries = this.#state.deliveries;
    const kept = this.#keptDeliveriesByRecipient;
    if (kept?.source === deliveries && kept.length === deliveries.length) return kept.index.get(agentId) ?? [];
    const index = new Map<string, StoredDelivery[]>();
    for (const delivery of deliveries) {
      const recipientDeliveries = index.get(delivery.recipientAgentId);
      if (recipientDeliveries) recipientDeliveries.push(delivery);
      else index.set(delivery.recipientAgentId, [delivery]);
    }
    this.#keptDeliveriesByRecipient = { source: deliveries, length: deliveries.length, index };
    return index.get(agentId) ?? [];
  }

  #mayStart(delivery: StoredDelivery): boolean {
    return !this.#isHeldByEdit(delivery) && !this.#queueUpdates.has(delivery.id);
  }

  agentsWithEditHolds(): string[] {
    return [
      ...new Set(
        this.#state.deliveries
          .filter((delivery) => delivery.status === "queued" && this.#isHeldByEdit(delivery))
          .map((delivery) => delivery.recipientAgentId),
      ),
    ];
  }

  #isHeldByEdit(delivery: StoredDelivery): boolean {
    const hold = delivery.editId ? this.#editHolds.get(delivery.id) : undefined;
    return hold !== undefined && hold.editId === delivery.editId && Date.now() - hold.startedAt < QUEUE_EDIT_HOLD_MS;
  }

  #isHeldReply(delivery: StoredDelivery, messages?: ReadonlyMap<string, StoredMessage>): boolean {
    const reply = this.#requireMessage(delivery.messageId, messages);
    if (!isAnswer(reply)) return false;
    const request = this.#answeredRequestOf(delivery.recipientAgentId, reply);
    if (!request) return false;
    const answeredBy = reply.sender.agentId;
    return (
      this.#state.deliveries.some(
        (candidate) =>
          candidate.messageId === request.id &&
          candidate.recipientAgentId !== answeredBy &&
          isActiveDelivery(candidate),
      ) && !this.#turnAfterRequestEnded(delivery, request, messages)
    );
  }

  #turnAfterRequestEnded(
    held: StoredDelivery,
    request: StoredMessage,
    messages?: ReadonlyMap<string, StoredMessage>,
  ): boolean {
    const lane = this.#laneOf(held, messages);
    return this.#state.deliveries.some(
      (candidate) =>
        candidate.recipientAgentId === held.recipientAgentId &&
        candidate.turnId !== null &&
        candidate.steeredAt === undefined &&
        !isActiveDelivery(candidate) &&
        candidate.createdAt > request.createdAt &&
        this.#laneOf(candidate, messages) === lane,
    );
  }

  stillWorkingRecipients(agentId: string, requestId: string): string[] {
    if (!this.#answeredRequestOf(agentId, { replyToMessageId: requestId })) return [];
    return this.#state.deliveries
      .filter(
        (delivery) =>
          delivery.messageId === requestId &&
          isActiveDelivery(delivery) &&
          !this.#hasAnswered(requestId, delivery.recipientAgentId),
      )
      .map((delivery) => delivery.recipientAgentId);
  }

  joinsChatTurn(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (delivery?.status !== "queued") return false;
    const message = this.#requireMessage(delivery.messageId);
    if (message.channelId || message.messaging || message.taskId) return false;
    if (message.replyToMessageId !== null && message.expectsReply !== false) return false;
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

  draftName(draftId: string): string | null {
    return this.#state.drafts.find((draft) => draft.id === draftId)?.name ?? null;
  }

  getDelivery(deliveryId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? this.#context(delivery) : null;
  }

  deliveryForProviderMessage(agentId: string, messageId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find(
      (candidate) =>
        candidate.recipientAgentId === agentId &&
        (candidate.id === messageId ||
          (candidate.resumeAfterUsageLimit !== undefined &&
            (candidate.turnId === messageId || candidate.resumeAfterUsageLimit.previousTurnIds.includes(messageId))) ||
          candidate.planContinuation?.turnIds.includes(messageId) === true),
    );
    if (delivery) return this.#context(delivery);
    for (const origin of runIdOrigins(messageId).slice(1)) {
      const run = this.#state.deliveries.find(
        (candidate) => candidate.recipientAgentId === agentId && candidate.id === origin,
      );
      if (run) return this.#context(run);
    }
    return null;
  }

  deliveryForMessage(messageId: string, recipientAgentId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find(
      (candidate) => candidate.messageId === messageId && candidate.recipientAgentId === recipientAgentId,
    );
    return delivery ? this.#context(delivery) : null;
  }

  steeredIntoOtherWork(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery?.steeredAt !== undefined && delivery.turnId !== delivery.id;
  }

  findDeliveryByTurn(turnId: string): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => candidate.turnId === turnId);
    return delivery ? this.#context(delivery) : null;
  }

  answersMessagingRequest(agentId: string, turnId: string): boolean {
    return this.messagingRequestOrigin(agentId, turnId) !== null;
  }

  messagingRequestOrigin(agentId: string, turnId: string): MessagingOrigin | null {
    for (const delivery of this.#state.deliveries) {
      if (
        delivery.recipientAgentId !== agentId ||
        delivery.turnId !== turnId ||
        delivery.steeredAt !== undefined ||
        (delivery.status !== "starting" && delivery.status !== "running")
      )
        continue;
      const origin = this.#state.messages.find((message) => message.id === delivery.messageId)?.messagingReturn;
      if (origin) return structuredClone(origin);
    }
    return null;
  }

  turnServesExternalChat(agentId: string, turnId: string): boolean {
    const sourceTurnIds = this.#sourceTurnIds();
    const messages = this.#messagesById();
    const seen = new Set<string>();
    const serves = (agent: string, turn: string, activeOnly: boolean): boolean => {
      const key = `${agent}:${turn}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return this.#state.deliveries.some((delivery) => {
        if (delivery.recipientAgentId !== agent) return false;
        if (activeOnly) {
          if (delivery.turnId !== turn || (delivery.status !== "starting" && delivery.status !== "running"))
            return false;
        } else if (
          delivery.turnId !== turn &&
          delivery.resumeAfterUsageLimit?.previousTurnIds.includes(turn) !== true &&
          delivery.planContinuation?.turnIds.includes(turn) !== true
        )
          return false;
        const message = messages.get(delivery.messageId);
        if (!message) return false;
        if (message.messaging || message.messagingReturn) return true;
        const sourceTurn = sourceTurnIds.get(message.id);
        return (
          message.sender.kind === "agent" &&
          sourceTurn !== undefined &&
          serves(message.sender.agentId, sourceTurn, false)
        );
      });
    };
    return serves(agentId, turnId, true);
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

  completedDeliveriesOfTurn(agentId: string, turnId: string): DeliveryContext[] {
    return this.#contexts(
      this.#state.deliveries.filter(
        (delivery) =>
          delivery.recipientAgentId === agentId && delivery.turnId === turnId && delivery.status === "completed",
      ),
    );
  }

  startingDeliveryForAgent(agentId: string, taskId?: string | null): DeliveryContext | null {
    const delivery = this.#state.deliveries.find((candidate) => this.#startingIn(candidate, agentId, taskId));
    return delivery ? this.#context(delivery) : null;
  }

  startingDeliveriesForAgent(agentId: string, taskId?: string | null): DeliveryContext[] {
    return this.#contexts(this.#state.deliveries.filter((candidate) => this.#startingIn(candidate, agentId, taskId)));
  }

  #startingIn(delivery: StoredDelivery, agentId: string, taskId: string | null | undefined): boolean {
    return (
      delivery.recipientAgentId === agentId &&
      delivery.status === "starting" &&
      delivery.turnId === null &&
      (taskId === undefined || this.#laneOf(delivery) === taskId)
    );
  }

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

  replyReferenceMessageId(id: string): string | null {
    if (this.#state.messages.some((message) => message.id === id)) return id;
    return this.#state.deliveries.find((delivery) => delivery.id === id)?.messageId ?? null;
  }

  #answeredRequestOf(agentId: string, reply: { replyToMessageId: string }): StoredMessage | undefined {
    const request = this.#state.messages.find((message) => message.id === reply.replyToMessageId);
    return request?.sender.kind === "agent" && request.sender.agentId === agentId && request.expectsReply !== false
      ? request
      : undefined;
  }

  answersRequestOf(agentId: string, messageId: string): boolean {
    const reply = this.#state.messages.find((message) => message.id === messageId);
    return reply !== undefined && isAnswer(reply) && this.#answeredRequestOf(agentId, reply) !== undefined;
  }

  expectsReply(messageId: string): boolean {
    return this.#state.messages.find((message) => message.id === messageId)?.expectsReply !== false;
  }

  senderMember(messageId: string): ConversationMessageSender | undefined {
    return this.#state.messages.find((message) => message.id === messageId)?.senderMember;
  }

  hasReplyFrom(agentId: string, messageId: string): boolean {
    return this.#state.messages.some(
      (message) =>
        message.sender.kind === "agent" && message.sender.agentId === agentId && message.replyToMessageId === messageId,
    );
  }

  hasOwnReplyFrom(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!delivery?.turnId) return false;
    const replies = new Set(
      this.#state.messages
        .filter(
          (message) =>
            message.sender.kind === "agent" &&
            message.sender.agentId === delivery.recipientAgentId &&
            message.replyToMessageId === delivery.messageId,
        )
        .map((message) => message.id),
    );
    if (replies.size === 0) return false;
    const turnIds = new Set([delivery.turnId, ...(delivery.resumeAfterUsageLimit?.previousTurnIds ?? [])]);
    return Object.entries(this.#state.idempotency).some(
      ([key, messageId]) =>
        replies.has(messageId) &&
        !key.startsWith(AUTO_RESULT_KEY_PREFIX) &&
        !key.startsWith(FAILED_REQUEST_KEY_PREFIX) &&
        turnIds.has(key.split(":").at(-2) ?? ""),
    );
  }

  hasSentResultFor(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!delivery?.turnId) return false;
    return [delivery.turnId, ...(delivery.resumeAfterUsageLimit?.previousTurnIds ?? [])].some(
      (turnId) => this.#state.idempotency[`${AUTO_RESULT_KEY_PREFIX}${turnId}:${delivery.messageId}`] !== undefined,
    );
  }

  answerFailedRequest = Effect.fn("MailboxStore.answerFailedRequest")(function* (
    this: MailboxStore,
    deliveryId: string,
    taskOpen: (taskId: string) => boolean,
    agentExists: (agentId: string) => boolean,
    recovered = false,
    temporary = false,
  ): Effect.fn.Return<string | null, StoredStateFailure> {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    const request = delivery && this.#state.messages.find((message) => message.id === delivery.messageId);
    const steered = delivery?.status === "interrupted" && this.steeredIntoOtherWork(deliveryId);
    const outcome =
      delivery?.status === "failed" || (delivery?.status === "interrupted" && (steered || recovered))
        ? delivery.status
        : null;
    if (!delivery || !outcome || request?.sender.kind !== "agent" || request.channelId) return null;
    const teammateId = delivery.recipientAgentId;
    const requesterId = request.sender.agentId;
    const originAgentId = this.chainOriginAgentId(request.id);
    if (
      requesterId === teammateId ||
      !agentExists(requesterId) ||
      !originAgentId ||
      originAgentId === teammateId ||
      request.expectsReply === false ||
      this.hasReplyFrom(teammateId, request.id)
    )
      return null;
    const answerTaskId = this.answerTaskId(teammateId, request.id, [requesterId]);
    const taskId = answerTaskId && taskOpen(answerTaskId) ? answerTaskId : undefined;
    yield* this.enqueue({
      sender: { kind: "agent", agentId: teammateId },
      recipientAgentIds: [requesterId],
      text: [
        "Status: blocked",
        outcome === "failed"
          ? `Result: OpenBot note, not written by this teammate: the request failed before the teammate answered. ${(delivery.error ?? "The provider gave no reason.").slice(0, FAILED_REQUEST_REASON_LIMIT)}`
          : steered
            ? "Result: OpenBot note, not written by this teammate: the request went into a running turn of the teammate, and that turn ended before the teammate answered."
            : "Result: OpenBot note, not written by this teammate: the teammate's turn stopped when OpenBot or its provider restarted, before the teammate answered. Part of the work can be done.",
        "Evidence: none",
        outcome === "failed" && temporary
          ? "Unblock: The failure can be temporary. Send the request again one time if you still need the result. If it fails again, tell the user."
          : outcome === "failed"
            ? "Unblock: The user must fix the cause, then ask for the request again."
            : steered
              ? "Unblock: Send the request again if you still need the result."
              : "Unblock: Check what the teammate already did, then send the request again if you still need the result.",
      ].join("\n"),
      replyToMessageId: request.id,
      ...(taskId ? { taskId } : {}),
      expectsReply: false,
      idempotencyKey: `${FAILED_REQUEST_KEY_PREFIX}${deliveryId}`,
    });
    return requesterId;
  }, Effect.uninterruptible).bind(this);

  hasAgentMessageFromTurnTo(
    agentId: string,
    turnId: string,
    recipientAgentId: string,
    turnRequestIds: ReadonlySet<string>,
  ): boolean {
    const turnIds = this.#sourceTurnIds();
    return this.#state.messages.some((message) => {
      if (message.sender.kind !== "agent" || message.sender.agentId !== agentId) return false;
      if (turnIds.get(message.id) !== turnId) return false;
      if (message.replyToMessageId !== null && turnRequestIds.has(message.replyToMessageId)) return false;
      return this.#state.deliveries.some(
        (delivery) => delivery.messageId === message.id && delivery.recipientAgentId === recipientAgentId,
      );
    });
  }

  hasRequestFromTurn(agentId: string, turnId: string): boolean {
    const turnIds = this.#sourceTurnIds();
    return this.#state.messages.some(
      (message) =>
        message.sender.kind === "agent" &&
        message.sender.agentId === agentId &&
        message.expectsReply !== false &&
        turnIds.get(message.id) === turnId,
    );
  }

  routineDeliveryOfRequest(agentId: string, requestMessageId: string): DeliveryContext | null {
    const request = this.#state.messages.find((message) => message.id === requestMessageId);
    if (request?.sender.kind !== "agent" || request.sender.agentId !== agentId) return null;
    const turnId = this.#sourceTurnIds().get(request.id);
    if (!turnId) return null;
    const delivery = this.#state.deliveries.find(
      (candidate) =>
        candidate.recipientAgentId === agentId &&
        (candidate.turnId === turnId || candidate.resumeAfterUsageLimit?.previousTurnIds.includes(turnId) === true) &&
        this.#state.messages.find((message) => message.id === candidate.messageId)?.sender.kind === "routine",
    );
    return delivery ? this.#context(delivery) : null;
  }

  routineRunTurns(deliveryId: string): { turnIds: string[]; waiting: boolean } | null {
    const start = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!start?.turnId) return null;
    const agentId = start.recipientAgentId;
    const sourceTurnIds = this.#sourceTurnIds();
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    const deliveriesOf = new Map<string, StoredDelivery[]>();
    for (const delivery of this.#state.deliveries) add(deliveriesOf, delivery.messageId, delivery);
    const answersTo = new Map<string, StoredMessage[]>();
    const updatesFrom = new Map<string, StoredMessage[]>();
    for (const message of this.#state.messages) {
      if (isAnswer(message)) add(answersTo, message.replyToMessageId, message);
      const turnId = sourceTurnIds.get(message.id);
      if (message.sender.kind === "agent" && message.expectsReply === false && turnId)
        add(updatesFrom, `${message.sender.agentId}:${turnId}`, message);
    }
    const read: { turnId: string; createdAt: string }[] = [];
    const turns = new Set([start.turnId, ...(start.resumeAfterUsageLimit?.previousTurnIds ?? [])]);
    const checked = new Set<string>();
    let waiting = false;
    let found = true;
    while (found) {
      found = false;
      for (const request of this.#state.messages) {
        if (checked.has(request.id) || request.sender.kind !== "agent" || request.sender.agentId !== agentId) continue;
        if (request.expectsReply === false || !turns.has(sourceTurnIds.get(request.id) ?? "")) continue;
        checked.add(request.id);
        found = true;
        for (const sent of deliveriesOf.get(request.id) ?? []) {
          if (sent.recipientAgentId === agentId) continue;
          const teammate = sent.recipientAgentId;
          const teammateTurns = sent.turnId
            ? [sent.turnId, ...(sent.resumeAfterUsageLimit?.previousTurnIds ?? [])]
            : [];
          const answers = new Set([
            ...(answersTo.get(request.id) ?? []).filter(
              (answer) => answer.sender.kind === "agent" && answer.sender.agentId === teammate,
            ),
            ...teammateTurns
              .flatMap((turnId) => updatesFrom.get(`${teammate}:${turnId}`) ?? [])
              .filter((update) => deliveriesOf.get(update.id)?.some((read) => read.recipientAgentId === agentId)),
          ]);
          if (answers.size === 0 && (isActiveDelivery(sent) || sent.status === "completed")) waiting = true;
          for (const answer of answers)
            for (const delivery of deliveriesOf.get(answer.id) ?? []) {
              if (delivery.recipientAgentId !== agentId) continue;
              if (isActiveDelivery(delivery)) waiting = true;
              if (delivery.status !== "completed" || !delivery.turnId || turns.has(delivery.turnId)) continue;
              if (delivery.steeredAt !== undefined) continue;
              turns.add(delivery.turnId);
              for (const turnId of delivery.resumeAfterUsageLimit?.previousTurnIds ?? []) turns.add(turnId);
              read.push({ turnId: delivery.turnId, createdAt: delivery.createdAt });
            }
        }
      }
    }
    read.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    return { turnIds: [...read.map((entry) => entry.turnId), start.turnId], waiting };
  }

  markStarting = Effect.fn("MailboxStore.markStarting")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
      if (delivery?.status === "queued" && delivery.editId && !this.#isHeldByEdit(delivery))
        this.#finishCancellation(delivery, false);
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
      const answered = status !== "completed" && this.#answeredRequest(deliveryId);
      yield* this.#updateDeliveryEffect(deliveryId, ["starting", "running"], {
        status: answered ? "completed" : status,
        error: answered || error === null ? null : redactText(error),
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  #answeredRequest(deliveryId: string): boolean {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!delivery) return false;
    const request = this.#state.messages.find((message) => message.id === delivery.messageId);
    if (request?.sender.kind !== "agent" || request.channelId) return false;
    return this.#state.messages.some(
      (message) =>
        isAnswer(message) &&
        message.sender.agentId === delivery.recipientAgentId &&
        message.replyToMessageId === request.id,
    );
  }

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
    this.#keptConversationIndex = undefined;
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
    this.#editHolds.set(delivery.id, { editId, startedAt: Date.now() });
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
        if (editId !== undefined) draft.ownerEditId = editId;
        const preserveOnRestart = previousRetention[index];
        if (preserveOnRestart === undefined) delete draft.preserveOnRestart;
        else draft.preserveOnRestart = preserveOnRestart;
      });
      throw error;
    }
    this.#editHolds.delete(delivery.id);
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

  moveSteerToTurn = Effect.fn("MailboxStore.moveSteerToTurn")(function* (
    this: MailboxStore,
    agentId: string,
    turnId: string,
  ): Effect.fn.Return<boolean, StoredStateFailure> {
    try {
      const delivery = this.#state.deliveries.find((candidate) => candidate.id === turnId);
      if (
        !delivery ||
        delivery.recipientAgentId !== agentId ||
        delivery.steeredAt === undefined ||
        delivery.turnId === null ||
        delivery.turnId === turnId ||
        delivery.status === "queued" ||
        delivery.status === "cancelled"
      )
        return false;
      delivery.turnId = turnId;
      this.#changes.deliveryIds.add(delivery.id);
      this.#persist("delivery.updated");
      return true;
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

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

  requeueRefused = Effect.fn("MailboxStore.requeueRefused")(function* (
    this: MailboxStore,
    deliveryId: string,
    resumeAfterUsageLimit?: UsageLimitContinuation,
    finished = false,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* this.#updateDeliveryEffect(deliveryId, finished ? ["completed"] : ["starting", "running"], {
        status: "queued",
        turnId: null,
        error: null,
        ...(resumeAfterUsageLimit ? { resumeAfterUsageLimit } : {}),
      });
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  requeueResultAfterRestart = Effect.fn("MailboxStore.requeueResultAfterRestart")(function* (
    this: MailboxStore,
    deliveryId: string,
  ): Effect.fn.Return<boolean, StoredStateFailure> {
    const delivery = this.#state.deliveries.find((candidate) => candidate.id === deliveryId);
    const message = delivery && this.#state.messages.find((candidate) => candidate.id === delivery.messageId);
    const key = `${RESTARTED_RESULT_KEY_PREFIX}${deliveryId}`;
    if (
      !delivery ||
      !message ||
      (delivery.status !== "starting" && delivery.status !== "running") ||
      message.sender.kind !== "agent" ||
      message.sender.agentId === delivery.recipientAgentId ||
      message.replyToMessageId === null ||
      message.expectsReply !== false ||
      message.channelId ||
      this.#state.idempotency[key] !== undefined
    )
      return false;
    this.#state.idempotency[key] = message.id;
    yield* this.requeueRefused(deliveryId);
    return true;
  }, Effect.uninterruptible).bind(this);

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
          (taskId !== undefined && this.#laneOf(delivery, messages) !== taskId)
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

  hasUnfinishedDelivery(agentId: string): boolean {
    return this.#state.deliveries.some(
      (delivery) =>
        delivery.recipientAgentId === agentId &&
        (delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running"),
    );
  }

  hasUnfinishedDeliveryOutsideTasks(
    agentId: string,
    includeChannels: boolean,
    exceptQueued: readonly string[] = [],
    includeMessaging = true,
  ): boolean {
    const messages = this.#messagesById();
    return this.#state.deliveries.some((delivery) => {
      if (delivery.recipientAgentId !== agentId || !isActiveDelivery(delivery)) return false;
      if (delivery.status === "queued" && exceptQueued.includes(delivery.id)) return false;
      const lane = this.#laneOf(delivery, messages);
      return (
        lane === null ||
        (includeMessaging && lane === MESSAGING_LANE) ||
        (includeChannels && laneChannelId(lane) !== null)
      );
    });
  }

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

  deleteStoredFile = Effect.fn("MailboxStore.deleteStoredFile")(function* (
    this: MailboxStore,
    fileId: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
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

  persistGeneratedAttachmentsWith<T>(attachmentIds: readonly string[], eventType: string, write: () => T): T {
    if (attachmentIds.length === 0) return write();
    const staged = attachmentIds.map((id) => {
      const attachment = this.#stagedGeneratedAttachments.get(id);
      if (!attachment) throw new Error(`Staged generated attachment is missing: ${id}`);
      return attachment;
    });
    const nextState: StoredState = {
      ...this.#state,
      generatedAttachments: [...this.#state.generatedAttachments, ...staged],
    };
    for (const attachment of staged) this.#changes.generatedAttachmentIds.add(attachment.id);
    let result: T;
    try {
      result = this.#database.persistMailboxChangesWith(nextState, this.#changes, eventType, write);
    } catch (error) {
      for (const attachment of staged) this.#changes.generatedAttachmentIds.delete(attachment.id);
      throw error;
    }
    this.#state = nextState;
    this.#clearChanges();
    for (const id of attachmentIds) this.#stagedGeneratedAttachments.delete(id);
    return result;
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

  attachmentSha256(attachmentId: string): string | null {
    const staged = this.#stagedGeneratedAttachments.get(attachmentId);
    if (staged) return staged.sha256;
    return this.#fileRecords().find((record) => record.id === attachmentId && !record.deletedAt)?.sha256 ?? null;
  }

  storeGeneratedAttachment = Effect.fn("MailboxStore.storeGeneratedAttachment")(function* (
    this: MailboxStore,
    input: {
      sourcePath?: string;
      bytes?: Uint8Array;
      kind?: "image" | "video";
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

  stageGeneratedCopy = Effect.fn("MailboxStore.stageGeneratedCopy")(function* (
    this: MailboxStore,
    input: {
      sourcePath: string;
      name: string;
      mimeType: string;
      ownerAgentId: string;
      ownerThreadId: string;
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
      ...(message.senderTaskId ? { senderTaskId: message.senderTaskId } : {}),
      ...(this.#state.idempotency[`${RESTARTED_RESULT_KEY_PREFIX}${delivery.id}`] !== undefined &&
      !delivery.resumeAfterUsageLimit &&
      !delivery.planContinuation
        ? { restartedResult: true as const }
        : {}),
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

  queuedPositions(): Map<string, number> {
    return this.#queuedPositions();
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
    if (isEmptyStoredFile(loaded.success)) return structuredClone(EMPTY_STATE);
    return yield* storedSync(() => {
      const value = parseStoredJson(this.#statePath, loaded.success, toCurrentMailboxState);
      if (!value || !isStoredState(value)) throw new Error(sourceText("error.backend.mailboxStateCorrupt"));
      return value;
    });
  });

  #persist(
    eventType = "mailbox.updated",
    commandId = `mailbox:${eventType}:${randomUUID()}`,
    fileDeletions: string[] = [],
    replaceAll = false,
  ): void {
    this.#keptConversationIndex = undefined;
    const ownsTransaction = !this.#database.connection.isTransaction;
    const wrote = replaceAll
      ? this.#database.replaceMailboxState(commandId, this.#state, eventType, fileDeletions, true)
      : this.#database.applyMailboxChanges(commandId, this.#state, this.#changes, eventType, fileDeletions);
    if (wrote && ownsTransaction) this.#clearChanges();
  }

  #clearChanges(): void {
    for (const keys of Object.values(this.#changes)) keys.clear();
    this.#keptConversationIndex = undefined;
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
  return {
    ...message,
    sender: withRoutineNameInLimit(toCurrentMailboxActor(value.sender)),
    ...(isConversationMessageSender(senderMember) ? { senderMember } : {}),
    ...(message.replyToMessageId === "" ? { replyToMessageId: null } : {}),
  };
}

function storedSender(sender: StoredMessage["sender"]): StoredMessage["sender"] {
  return sender.kind === "routine" ? { ...sender, routineName: routineNameInLimit(sender.routineName) } : sender;
}

function withRoutineNameInLimit(sender: DynamicRecord | null): DynamicRecord | null {
  return sender?.kind === "routine" && isString(sender.routineName)
    ? { ...sender, routineName: routineNameInLimit(sender.routineName) }
    : sender;
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

function voiceRecordingTransferId(messageId: string): string {
  return `voice-${messageId}`;
}

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
    (value.welcome === undefined || value.welcome === true) &&
    (value.agentSetup === undefined || value.agentSetup === true) &&
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

function recordFinishedQueueEdit(delivery: StoredDelivery, editId: string, outcome: StoredFinishedEdit): void {
  delivery.finishedEditOutcomes = { ...(delivery.finishedEditOutcomes ?? {}), [editId]: outcome };
}

function isChatMessageFromPerson(message: StoredMessage): boolean {
  return (
    message.sender.kind === "user" &&
    message.welcome !== true &&
    message.channelId === undefined &&
    message.messaging === undefined &&
    message.messagingReturn === undefined
  );
}

function isAnswer(
  message: StoredMessage,
): message is StoredMessage & { sender: { kind: "agent"; agentId: string }; replyToMessageId: string } {
  return message.sender.kind === "agent" && message.replyToMessageId !== null && message.expectsReply === false;
}
