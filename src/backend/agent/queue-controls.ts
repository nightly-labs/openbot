import type {
  QueueSnapshot,
  ReorderQueueInput,
  SteerQueuedMessageInput,
  UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { QueueEditRejectedError, type QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentStore } from "../agent-store";
import type { ChannelAssignment } from "../channel-store";
import type { MailboxStore } from "../mailbox-store";
import { decodeRecordResponse } from "../protocol";
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

  async cancel(agentId: string, deliveryId: string): Promise<void> {
    if (this.#hooks.channelAssignment(deliveryId)) throw new Error(sourceText("error.backend.useChannelTaskControls"));
    await this.#mailbox.cancel(agentId, deliveryId);
    this.#mailboxSync.emitQueue(agentId);
    this.#drain.scheduleDrain(agentId);
  }

  async edit(agentId: string, input: QueueEditRequest): Promise<QueueSnapshot> {
    const finished = this.#mailbox.finishedQueueEditAction(agentId, input.deliveryId, input.editId);
    if (finished) {
      if (input.action === "begin" || input.action === "retain-attachments")
        throw new QueueEditRejectedError(sourceText("error.backend.editFinished"));
      // The uploads belong to an edit that is over, so they never stay behind.
      if (input.action === "save")
        await Promise.all(input.attachmentDraftIds.map((id) => this.#mailbox.discardDraft(id)));
      // Only a retry of the action that finished can report success. A Save that follows a
      // finished Cancel never reached the message, so the client must keep its text.
      if (input.action !== finished)
        throw new QueueEditRejectedError(
          finished === "cancel" ? sourceText("error.backend.editCancelled") : sourceText("error.backend.editSaved"),
        );
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
        throw new QueueEditRejectedError(sourceText("error.backend.editSavedDifferent"));
      this.#drain.scheduleDrain(agentId);
      this.#mailboxSync.emitQueue(agentId);
      return this.#mailboxSync.queueSnapshot(agentId);
    }
    if (this.#hooks.channelAssignment(input.deliveryId))
      throw new Error(sourceText("error.backend.useChannelTaskControls"));
    if (input.action === "begin") this.#mailbox.beginQueueEdit(agentId, input.deliveryId, input.editId);
    else {
      if (input.action === "retain-attachments")
        this.#mailbox.retainQueueEditAttachments(agentId, input.deliveryId, input.editId, input.attachmentDraftIds);
      if (input.action === "save") {
        await this.#mailbox.updateQueuedMessage(
          agentId,
          input.deliveryId,
          input.text,
          input.keepAttachmentIds,
          input.attachmentDraftIds,
          input.editId,
        );
        const snapshot = this.#conversation.snapshot(agentId);
        if (snapshot) {
          this.#mailboxSync.syncMailboxMessages(snapshot);
          this.#conversation.emitConversation(snapshot, "queue.message-updated");
        }
      }
      if (input.action === "cancel") this.#mailbox.finishQueueEdit(agentId, input.deliveryId, input.editId);
      this.#drain.scheduleDrain(agentId);
    }
    this.#mailboxSync.emitQueue(agentId);
    return this.#mailbox.listQueue(agentId);
  }

  async update(input: UpdateQueuedMessageInput): Promise<void> {
    if (this.#hooks.channelAssignment(input.deliveryId))
      throw new Error(sourceText("error.backend.useChannelTaskControls"));
    await this.#mailbox.updateQueuedMessage(
      input.agentId,
      input.deliveryId,
      input.text,
      input.keepAttachmentIds,
      input.attachmentDraftIds,
    );
    const snapshot = this.#conversation.snapshot(input.agentId);
    if (snapshot) this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#mailboxSync.emitQueue(input.agentId);
    if (snapshot) this.#conversation.emitConversation(snapshot, "queue.message-updated");
    this.#drain.scheduleDrain(input.agentId);
  }

  async reorder(input: ReorderQueueInput): Promise<void> {
    if (input.deliveryIds.some((id) => this.#hooks.channelAssignment(id)))
      throw new Error(sourceText("error.backend.useChannelTaskControlsWork"));
    // The queue the user reads holds no channel work, so the order it sends names the normal
    // messages alone, and the mailbox reads the whole queued order. Channel work stays at the head:
    // it reserved the agent before these messages arrived.
    const channelDeliveryIds = this.#mailbox.queuedChannelDeliveryIds(input.agentId);
    await this.#mailbox.reorderQueue(input.agentId, [...channelDeliveryIds, ...input.deliveryIds]);
    this.#mailboxSync.emitQueue(input.agentId);
  }

  async steer(input: SteerQueuedMessageInput): Promise<void> {
    const agent = await this.#store.getOrCreate(input.agentId);
    const client = this.#providers.requireReadyClientForAgent(agent);
    const session = this.#store.activeProviderSession(agent.id);
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    if (!session || !snapshot.activeTurnId || snapshot.activeTurnId !== input.expectedTurnId) {
      throw new Error(sourceText("error.backend.steerTurnChanged"));
    }
    if (this.#hooks.channelAssignment(input.deliveryId))
      throw new Error(sourceText("error.backend.useChannelTaskControls"));
    const context = this.#mailbox.getDelivery(input.deliveryId);
    if (!context || context.delivery.recipientAgentId !== agent.id || context.delivery.status !== "queued") {
      throw new Error(sourceText("error.backend.steerQueuedOnly"));
    }

    const turnId = snapshot.activeTurnId;
    // Steering carries a new message into the turn that is running, on the session the CLI opened,
    // so it reaches the endpoint that turn started on. The agent record may already name another
    // model, because a removal moves it, while the CLI keeps that session until it restarts, and
    // the restart waits for the turn. So the turn's own model is what the exclusion is read for.
    if (!this.#endpoints.serves(this.#drain.modelForTurn(agent.id, turnId) ?? agent.model)) {
      throw new Error(REMOVED_ENDPOINT_MESSAGE);
    }
    await this.#mailbox.markSteering(input.deliveryId, turnId);
    this.#mailboxSync.emitQueue(agent.id);
    try {
      await client.request(
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
        decodeRecordResponse,
      );
      await this.#mailbox.markRunning(input.deliveryId, turnId);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#mailboxSync.emitQueue(agent.id);
      this.#conversation.emitConversation(snapshot, "queue.message-steered", { deliveryId: input.deliveryId });
    } catch (error) {
      await this.#mailbox.restoreQueued(input.deliveryId);
      this.#mailboxSync.emitQueue(agent.id);
      throw error;
    }
  }
}
