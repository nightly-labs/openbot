import type {
  ConversationMessageSender,
  QueueSnapshot,
  ReorderQueueInput,
  SteerQueuedMessageInput,
  UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { QueueEditRejectedError, type QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { AgentStore } from "../agent-store";
import { decodeSteerReceipt, isInputRejected } from "../app-server-client";
import type { ChannelAssignment } from "../channel-store";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import type { CustomEndpoints } from "./custom-endpoints";
import { agentNamesById, deliveryPromptInput } from "./delivery-content";
import { type DrainScheduler, REMOVED_ENDPOINT_MESSAGE } from "./drain-scheduler";
import type { MailboxSync } from "./mailbox-sync";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";

export interface QueueControlsHooks {
  /** The channel task that owns a delivery. Read late: the channel service is built after this. */
  channelAssignment(deliveryId: string): ChannelAssignment | null;
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

/**
 * Owns the user's changes to messages that wait in an agent's queue: cancel, edit, update, reorder
 * and steer into the running turn. Channel work is refused here; the channel task controls own it.
 *
 * It never imports the agent service facade.
 */
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
    // The requester may hold the other answers until this request ends.
    if (sender?.kind === "agent") this.#drain.scheduleDrain(sender.agentId);
  }, Effect.uninterruptible);

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
      // The uploads belong to an edit that is over, so they never stay behind.
      if (input.action === "save")
        yield* Effect.forEach(
          input.attachmentDraftIds,
          (id) => this.#mailbox.discardDraft(id).pipe(toQueueOperationFailed),
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
      // Only a retry of the action that finished can report success. A Save that follows a
      // finished Cancel never reached the message, so the client must keep its text.
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
    if (input.action === "begin")
      yield* queueStep(() => this.#mailbox.beginQueueEdit(agentId, input.deliveryId, input.editId));
    else {
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
    // The queue the user reads holds no channel or messaging work, so the order it sends names the
    // normal messages alone, and the mailbox reads the whole queued order. That work stays at the
    // head: it reserved the agent before these messages arrived.
    const executionDeliveryIds = this.#mailbox.queuedExecutionDeliveryIds(input.agentId);
    yield* this.#mailbox
      .reorderQueue(input.agentId, [...executionDeliveryIds, ...input.deliveryIds])
      .pipe(toQueueOperationFailed);
    this.#mailboxSync.emitQueue(input.agentId);
  }, Effect.uninterruptible);

  readonly steer = Effect.fn("QueueControls.steer")(function* (this: QueueControls, input: SteerQueuedMessageInput) {
    const agent = yield* this.#store.existing(input.agentId).pipe(toQueueOperationFailed);
    const { client, session, snapshot, context, turnId } = yield* queueStep(() => {
      const client = this.#providers.requireReadyClientForAgent(agent);
      const session = this.#store.activeProviderSession(agent.id);
      const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
      if (!session || !snapshot.activeTurnId || snapshot.activeTurnId !== input.expectedTurnId)
        throw new Error(sourceText("error.backend.steerTurnChanged"));
      if (this.#hooks.channelAssignment(input.deliveryId))
        throw new Error(sourceText("error.backend.useChannelTaskControls"));
      const context = this.#mailbox.getDelivery(input.deliveryId);
      if (!context || context.delivery.recipientAgentId !== agent.id || context.delivery.status !== "queued")
        throw new Error(sourceText("error.backend.steerQueuedOnly"));
      const turnId = snapshot.activeTurnId;
      // Steering uses the running turn's endpoint even when the saved model has changed.
      if (!this.#endpoints.serves(this.#drain.modelForTurn(agent.id, turnId) ?? agent.model))
        throw new Error(REMOVED_ENDPOINT_MESSAGE);
      return { client, session, snapshot, context, turnId };
    });
    yield* this.#mailbox.markSteering(input.deliveryId, turnId).pipe(
      Effect.tapError(() => queueStep(() => this.#mailbox.restorePersistedState())),
      toQueueOperationFailed,
    );
    this.#mailboxSync.emitQueue(agent.id);
    const pending = this.#mailbox.getDelivery(input.deliveryId)?.delivery;
    if (pending?.status !== "starting" || pending.turnId !== turnId) return;
    yield* client
      .request(
        "turn/steer",
        {
          threadId: session.externalSessionId,
          expectedTurnId: turnId,
          clientUserMessageId: input.deliveryId,
          input: deliveryPromptInput(context, {
            agentNames: agentNamesById(this.#store.list()),
            snapshot,
            routineRun:
              context.delivery.sender.kind === "routine" ? this.#routines.runForDelivery(input.deliveryId) : null,
          }),
        },
        (value) => decodeSteerReceipt(value, turnId),
      )
      .pipe(
        toQueueOperationFailed,
        // The turn may have ended while the request was in flight, and found nothing else to start
        // with this message out of the queue, so the drain is asked again.
        Effect.tapError((failure) =>
          isInputRejected(client.provider, failure.cause, "turn/steer")
            ? this.#mailbox.restoreUnsteered(input.deliveryId, turnId).pipe(
                toQueueOperationFailed,
                Effect.andThen(
                  queueStep(() => {
                    this.#mailboxSync.syncMailboxMessages(snapshot);
                    this.#mailboxSync.emitQueue(agent.id);
                    this.#drain.scheduleDrain(agent.id);
                  }),
                ),
              )
            : queueStep(() => {
                this.#mailboxSync.syncMailboxMessages(snapshot);
                this.#mailboxSync.emitQueue(agent.id);
              }),
        ),
      );
    // This receipt belongs to the captured request. Do not associate it with a replacement
    // client/session. A local write failure retains the reservation and never resends the RPC.
    if (
      this.#providers.clientForAgent(agent) !== client ||
      this.#store.activeProviderSession(agent.id)?.externalSessionId !== session.externalSessionId
    )
      return;
    yield* this.#mailbox.confirmSteered(input.deliveryId, turnId).pipe(
      toQueueOperationFailed,
      Effect.tapError(() =>
        queueStep(() => this.#mailboxSync.retryDeliveryReconciliation(agent.id, turnId, [input.deliveryId], true)),
      ),
    );
    if (this.#mailbox.getDelivery(input.deliveryId)?.delivery.status === "cancelled") return;
    yield* queueStep(() => {
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#mailboxSync.emitQueue(agent.id);
      this.#conversation.emitConversation(snapshot, "queue.message-steered", { deliveryId: input.deliveryId });
      this.#drain.scheduleDrain(agent.id);
    });
  }, Effect.uninterruptible);
}

export class QueueOperationFailed extends Schema.TaggedError<QueueOperationFailed>()("QueueOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: queueStep, rewrap: toQueueOperationFailed } = causeHelpers(QueueOperationFailed);
