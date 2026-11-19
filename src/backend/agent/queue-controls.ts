import { agentSteersTurns } from "@openbot/contracts/agent-providers";
import type {
  ConversationMessageSender,
  QueueDelivery,
  QueueSnapshot,
  ReorderQueueInput,
  SteerQueuedMessageInput,
  UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { QueueEditRejectedError, type QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ChannelAssignment } from "../channel-store";
import { promptMessage } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import { type MailboxStore, QUEUE_EDIT_HOLD_MS } from "../mailbox-store";
import { decodeRecordResponse } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import type { CustomEndpoints } from "./custom-endpoints";
import { agentNamesById, deliveryPromptInput, type TagReferenceSource } from "./delivery-content";
import { steerNote } from "./developer-instructions";
import { type DrainScheduler, REMOVED_ENDPOINT_MESSAGE } from "./drain-scheduler";
import type { MailboxSync } from "./mailbox-sync";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";
import { providerForAgent } from "./thread-items";

export interface QueueControlsHooks {
  channelAssignment(deliveryId: string): ChannelAssignment | null;
  taskThreadId(deliveryId: string): string | null;
  tagReferences(agentId: string, threadId: string | null): TagReferenceSource;
}

export interface QueueControlsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  endpoints: CustomEndpoints;
  drain: DrainScheduler;
  routines: RoutineScheduler;
  hooks: QueueControlsHooks;
}

export class QueueControls {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #endpoints: CustomEndpoints;
  readonly #drain: DrainScheduler;
  readonly #routines: RoutineScheduler;
  readonly #hooks: QueueControlsHooks;
  readonly #holdWakes = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: QueueControlsOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#endpoints = options.endpoints;
    this.#drain = options.drain;
    this.#routines = options.routines;
    this.#hooks = options.hooks;
  }

  readonly cancel = Effect.fn("QueueControls.cancel")(function* (
    this: QueueControls,
    agentId: string,
    deliveryId: string,
  ): Effect.fn.Return<void, QueueOperationFailed> {
    if (this.#hooks.channelAssignment(deliveryId))
      return yield* new QueueOperationFailed({ cause: new Error(sourceText("error.backend.useChannelTaskControls")) });
    const sender = this.#mailbox.getDelivery(deliveryId)?.delivery.sender;
    yield* this.#mailbox.cancel(agentId, deliveryId).pipe(toQueueOperationFailed);
    this.#mailboxSync.emitQueue(agentId);
    this.#drain.scheduleDrain(agentId);
    if (sender?.kind === "agent") this.#drain.scheduleDrain(sender.agentId);
  }, Effect.uninterruptible);

  wakeAfterEditHold(agentId: string): void {
    const timer = setTimeout(() => {
      this.#holdWakes.delete(timer);
      this.#drain.scheduleDrain(agentId);
    }, QUEUE_EDIT_HOLD_MS + 1_000);
    timer.unref();
    this.#holdWakes.add(timer);
  }

  dispose(): void {
    for (const timer of this.#holdWakes) clearTimeout(timer);
    this.#holdWakes.clear();
  }

  readonly edit = Effect.fn("QueueControls.edit")(function* (
    this: QueueControls,
    agentId: string,
    input: QueueEditRequest,
    sender?: ConversationMessageSender,
  ): Effect.fn.Return<QueueSnapshot, QueueOperationFailed> {
    const finished = yield* queueStep(() =>
      this.#mailbox.finishedQueueEditAction(agentId, input.deliveryId, input.editId),
    );
    if (finished) {
      if (input.action === "begin" || input.action === "retain-attachments")
        return yield* new QueueOperationFailed({
          cause: new QueueEditRejectedError(sourceText("error.backend.editFinished")),
        });
      if (input.action === "save")
        yield* Effect.forEach(
          input.attachmentDraftIds,
          (id) => this.#mailbox.discardDraft(id).pipe(toQueueOperationFailed),
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
      if (input.action !== finished)
        return yield* new QueueOperationFailed({
          cause: new QueueEditRejectedError(
            finished === "cancel" ? sourceText("error.backend.editCancelled") : sourceText("error.backend.editSaved"),
          ),
        });
      if (
        input.action === "save" &&
        !this.#mailbox.matchesFinishedQueueSave(
          agentId,
          input.deliveryId,
          input.editId,
          input.text,
          input.keepAttachmentIds,
          input.attachmentDraftIds,
        )
      )
        return yield* new QueueOperationFailed({
          cause: new QueueEditRejectedError(sourceText("error.backend.editSavedDifferent")),
        });
      this.#drain.scheduleDrain(agentId);
      this.#mailboxSync.emitQueue(agentId);
      return this.#mailboxSync.queueSnapshot(agentId);
    }
    if (this.#hooks.channelAssignment(input.deliveryId))
      return yield* new QueueOperationFailed({ cause: new Error(sourceText("error.backend.useChannelTaskControls")) });
    if (input.action === "begin") {
      yield* queueStep(() => this.#mailbox.beginQueueEdit(agentId, input.deliveryId, input.editId));
      this.wakeAfterEditHold(agentId);
    } else {
      if (input.action === "retain-attachments")
        yield* queueStep(() =>
          this.#mailbox.retainQueueEditAttachments(agentId, input.deliveryId, input.editId, input.attachmentDraftIds),
        );
      if (input.action === "save") {
        yield* this.#mailbox
          .updateQueuedMessage(
            agentId,
            input.deliveryId,
            input.text,
            input.keepAttachmentIds,
            input.attachmentDraftIds,
            input.editId,
            sender,
          )
          .pipe(toQueueOperationFailed);
        const snapshot = this.#conversation.snapshotToUpdate(agentId);
        if (snapshot) {
          this.#mailboxSync.syncMailboxMessages(snapshot);
          this.#conversation.emitConversation(snapshot, "queue.message-updated");
        }
      }
      if (input.action === "cancel")
        yield* queueStep(() => this.#mailbox.finishQueueEdit(agentId, input.deliveryId, input.editId));
      this.#drain.scheduleDrain(agentId);
    }
    this.#mailboxSync.emitQueue(agentId);
    return this.#mailbox.listQueue(agentId);
  }, Effect.uninterruptible);

  readonly update = Effect.fn("QueueControls.update")(function* (
    this: QueueControls,
    input: UpdateQueuedMessageInput,
    sender?: ConversationMessageSender,
  ): Effect.fn.Return<void, QueueOperationFailed> {
    if (this.#hooks.channelAssignment(input.deliveryId))
      return yield* new QueueOperationFailed({ cause: new Error(sourceText("error.backend.useChannelTaskControls")) });
    yield* this.#mailbox
      .updateQueuedMessage(
        input.agentId,
        input.deliveryId,
        input.text,
        input.keepAttachmentIds,
        input.attachmentDraftIds,
        undefined,
        sender,
      )
      .pipe(toQueueOperationFailed);
    const snapshot = this.#conversation.snapshotToUpdate(input.agentId);
    if (snapshot) this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#mailboxSync.emitQueue(input.agentId);
    if (snapshot) this.#conversation.emitConversation(snapshot, "queue.message-updated");
    this.#drain.scheduleDrain(input.agentId);
  }, Effect.uninterruptible);

  readonly reorder = Effect.fn("QueueControls.reorder")(function* (
    this: QueueControls,
    input: ReorderQueueInput,
  ): Effect.fn.Return<void, QueueOperationFailed> {
    if (input.deliveryIds.some((id) => this.#hooks.channelAssignment(id)))
      return yield* new QueueOperationFailed({
        cause: new Error(sourceText("error.backend.useChannelTaskControlsWork")),
      });
    const { taskId } = input;
    if (taskId !== undefined) {
      const thread = new Set(this.#mailbox.laneQueuedIds(input.agentId, taskId));
      const moved = new Set(input.deliveryIds);
      const left = [...thread].filter((id) => !moved.has(id));
      if (
        input.deliveryIds.some((id) => !thread.has(id)) ||
        left.some((id) => !this.#mailbox.getDelivery(id)?.delivery.editing)
      )
        return yield* new QueueOperationFailed({ cause: new Error(sourceText("error.backend.queueOrderStale")) });
      let next = 0;
      const order = this.#mailbox
        .queuedDeliveryIds(input.agentId)
        .map((id) => (moved.has(id) ? (input.deliveryIds[next++] ?? id) : id));
      yield* this.#mailbox.reorderQueue(input.agentId, order).pipe(toQueueOperationFailed);
      this.#mailboxSync.emitQueue(input.agentId);
      return;
    }
    const executionDeliveryIds = this.#mailbox.queuedExecutionDeliveryIds(input.agentId);
    yield* this.#mailbox
      .reorderQueue(input.agentId, [...executionDeliveryIds, ...input.deliveryIds])
      .pipe(toQueueOperationFailed);
    this.#mailboxSync.emitQueue(input.agentId);
  }, Effect.uninterruptible);

  readonly steer = Effect.fn("QueueControls.steer")(function* (this: QueueControls, input: SteerQueuedMessageInput) {
    const agent = yield* this.#store.existing(input.agentId).pipe(toQueueOperationFailed);
    const { client, session, snapshot, context, turnId, routineSession, publicThreadId, turnModel } = yield* queueStep(
      () => {
        const client = this.#providers.requireReadyClientForAgent(agent);
        const taskThreadId = this.#hooks.taskThreadId(input.deliveryId);
        const publicThreadId = taskThreadId ?? agent.threadId;
        const routineSession = publicThreadId ? this.#conversation.routineSession(agent.id, publicThreadId) : undefined;
        const session =
          routineSession ??
          (taskThreadId
            ? this.#store.database.activeProviderSession(taskThreadId, agent.provider)?.externalSessionId
            : this.#store.activeProviderSession(agent.id)?.externalSessionId);
        const snapshot = this.#conversation.ensureSnapshot(agent.id, taskThreadId ?? agent.threadId);
        if (!session || !snapshot.activeTurnId || snapshot.activeTurnId !== input.expectedTurnId)
          throw new Error(sourceText("error.backend.steerTurnChanged"));
        if (this.#hooks.channelAssignment(input.deliveryId))
          throw new Error(sourceText("error.backend.useChannelTaskControls"));
        const context = this.#mailbox.getDelivery(input.deliveryId);
        if (!context || context.delivery.recipientAgentId !== agent.id || context.delivery.status !== "queued")
          throw new Error(sourceText("error.backend.steerQueuedOnly"));
        const turnId = snapshot.activeTurnId;
        const turnModel = this.#drain.modelForTurn(agent.id, turnId) ?? agent.model;
        if (!this.#endpoints.serves(turnModel, client.provider)) throw new Error(REMOVED_ENDPOINT_MESSAGE);
        return { client, session, snapshot, context, turnId, routineSession, publicThreadId, turnModel };
      },
    );
    if (routineSession) {
      yield* this.#mailbox.markSteerFallback(input.deliveryId, "steer-failed").pipe(toQueueOperationFailed);
      this.#mailboxSync.emitQueue(agent.id);
      return yield* new QueueOperationFailed({
        cause: new SteerUnsupportedError(sourceText("error.backend.steerRoutineRun")),
      });
    }
    if (!agentSteersTurns({ provider: providerForAgent(agent), model: turnModel }, this.#endpoints.available())) {
      yield* this.#mailbox.markSteerFallback(input.deliveryId, "provider-unsupported").pipe(toQueueOperationFailed);
      this.#mailboxSync.emitQueue(agent.id);
      return yield* new QueueOperationFailed({ cause: new SteerUnsupportedError() });
    }
    yield* this.#mailbox.markSteering(input.deliveryId, turnId).pipe(toQueueOperationFailed);
    this.#mailboxSync.emitQueue(agent.id);
    const note = steerNoteFor(providerForAgent(agent), context.delivery.sender, context.delivery.text);
    yield* client
      .request(
        "turn/steer",
        {
          threadId: session,
          expectedTurnId: turnId,
          clientUserMessageId: input.deliveryId,
          input: [
            ...(note ? [{ type: "text" as const, text: note }] : []),
            ...deliveryPromptInput(context, {
              agentNames: agentNamesById(this.#store.list()),
              snapshot,
              routineRun:
                context.delivery.sender.kind === "routine" ? this.#routines.runForDelivery(input.deliveryId) : null,
              workflowRunSource:
                context.delivery.sender.kind === "routine" ? this.#routines.workflowRunSource(input.deliveryId) : null,
              wokenWaits: context.delivery.sender.kind === "routine" ? this.#routines.wokenWaits(input.deliveryId) : [],
              routineTimezone:
                context.delivery.sender.kind === "routine"
                  ? this.#routines.timezoneForDelivery(input.deliveryId)
                  : undefined,
              answeredRoutine: this.#drain.answeredRoutine(context.delivery),
              tags: this.#hooks.tagReferences(agent.id, publicThreadId),
              steerFramedAsUser: providerForAgent(agent) === "claude",
            }),
          ],
        },
        decodeRecordResponse,
      )
      .pipe(
        toQueueOperationFailed,
        Effect.tapError(() =>
          this.#mailbox.restoreUnsteered(input.deliveryId, turnId).pipe(
            toQueueOperationFailed,
            Effect.andThen(
              queueStep(() => {
                this.#mailboxSync.syncMailboxMessages(snapshot);
                this.#mailboxSync.emitQueue(agent.id);
                this.#drain.scheduleDrain(agent.id);
              }),
            ),
          ),
        ),
      );
    yield* this.#mailbox.markRunning(input.deliveryId, turnId).pipe(toQueueOperationFailed);
    yield* queueStep(() => {
      if (
        this.#conversation.isExecutionThread(snapshot.threadId) &&
        !snapshot.messages.some((message) => message.id === input.deliveryId)
      ) {
        snapshot.messages.push({ ...promptMessage(context, { ...context.delivery, turnId }), steered: true });
        this.#mailboxSync.syncDeliveryMessage(snapshot, input.deliveryId);
      }
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#mailboxSync.emitQueue(agent.id);
      this.#conversation.emitConversation(snapshot, "queue.message-steered", { deliveryId: input.deliveryId });
    });
  }, Effect.uninterruptible);
}

const PROVIDERS_THAT_FRAME_STEERS: ReadonlySet<AgentProvider> = new Set(["claude", "grok"]);

export function steerNoteFor(provider: AgentProvider, sender: QueueDelivery["sender"], text: string): string | null {
  if (PROVIDERS_THAT_FRAME_STEERS.has(provider)) return null;
  if (sender.kind === "user") return text.startsWith("/") ? null : steerNote("user");
  return sender.kind === "agent" ? steerNote("teammate") : null;
}

export class SteerUnsupportedError extends Error {
  constructor(message = sourceText("error.backend.steerUnsupported")) {
    super(message);
  }
}

export class QueueOperationFailed extends Schema.TaggedError<QueueOperationFailed>()("QueueOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: queueStep, rewrap: toQueueOperationFailed } = causeHelpers(QueueOperationFailed);
