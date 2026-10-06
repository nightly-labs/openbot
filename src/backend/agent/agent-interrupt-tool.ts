import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import type { DynamicToolCallParams } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import type { DrainScheduler } from "./drain-scheduler";
import type { MailboxSync } from "./mailbox-sync";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";

export const interruptAgentToolSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(INPUT_LIMITS.identifier),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

export interface AgentInterruptHooks {
  listAgents(): AgentSummary[];
  /**
   * `mayStop` is asked again right before the stop is sent. `false` when the turn no longer runs or
   * `mayStop` refuses, so no stop was sent.
   */
  interrupt(agentId: string, turnId: string, mayStop: () => boolean): Effect.Effect<boolean, ToolOperationFailed>;
}

export interface AgentInterruptToolOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  channels: ChannelService;
  drain: DrainScheduler;
  hooks: AgentInterruptHooks;
}

/**
 * `openbot.interrupt_agent`: one agent stops work that it delegated to another agent.
 *
 * Agents have no ownership of each other, so the only proof that the caller may stop a turn is that
 * every delivery the turn runs came from the caller. A turn that the user, a routine, a channel or
 * another agent started is refused, and so is a caller that names itself.
 *
 * It never imports the agent service facade.
 */
export class AgentInterruptTool {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #channels: ChannelService;
  readonly #drain: DrainScheduler;
  readonly #hooks: AgentInterruptHooks;

  constructor(options: AgentInterruptToolOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#channels = options.channels;
    this.#drain = options.drain;
    this.#hooks = options.hooks;
  }

  readonly handle = Effect.fn("AgentInterruptTool.handle")(function* (
    this: AgentInterruptTool,
    params: DynamicToolCallParams,
    callerAgentId: string,
  ) {
    const { agentId, reason } = yield* toolStep(() => interruptAgentToolSchema.parse(params.arguments));
    if (agentId === callerAgentId) return openBotToolFailure(sourceText("error.backend.interruptSelf"));
    if (!this.#hooks.listAgents().some((agent) => agent.id === agentId)) {
      return yield* new ToolOperationFailed({ cause: new Error(`Unknown OpenBot agent: ${agentId}`) });
    }

    // A delivery on its way to a turn has no turn id yet. Wait for the drain that starts it, as
    // routine deletion does, so the turn it starts can be checked and stopped.
    if (this.#mailbox.startingDeliveryForAgent(agentId)) {
      const task = this.#drain.taskFor(agentId);
      if (task) yield* task.pipe(toToolOperationFailed);
    }
    if (this.#mailbox.startingDeliveryForAgent(agentId)) {
      return openBotToolFailure(sourceText("error.backend.interruptStarting"));
    }

    const turnId = this.#activeTurnId(agentId);
    let deliveries: DeliveryContext[] = [];
    if (turnId) {
      deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
      const snapshot = this.#conversation.workingSnapshot(agentId);
      if (
        (snapshot?.activeTurnId === turnId && this.#conversation.isExecutionThread(snapshot.threadId)) ||
        deliveries.some((context) => this.#channels.store.assignmentForDelivery(context.delivery.id))
      ) {
        return openBotToolFailure(sourceText("error.backend.useChannelTaskControlsWork"));
      }
      if (!ownedBy(deliveries, callerAgentId)) {
        return openBotToolFailure(sourceText("error.backend.interruptOtherWork"));
      }
      if (!this.#store.activeProviderSession(agentId)) {
        return openBotToolFailure(sourceText("error.backend.interruptNoSession"));
      }
    }

    // Before the interrupt: the interrupted turn schedules the next drain as it completes, and that
    // drain would start the next of these messages.
    const cancelledMessages = yield* toolStep(() => this.#cancelQueuedFrom(agentId, callerAgentId));
    if (!turnId) return openBotToolResult({ interruptedTurnId: null, cancelledMessages });

    // The turn can end, or the user can steer a message into it, while the stop is on its way. The
    // check then runs again on the deliveries the turn has at that moment. No stop, no notice.
    const mayStop = () => ownedBy(this.#mailbox.findDeliveriesByTurn(agentId, turnId), callerAgentId);
    if (!(yield* this.#hooks.interrupt(agentId, turnId, mayStop).pipe(toToolOperationFailed))) {
      return openBotToolResult({ interruptedTurnId: null, cancelledMessages });
    }
    yield* this.#notifyEffect(params, callerAgentId, agentId, deliveries[0]?.delivery.messageId ?? null, reason);
    return openBotToolResult({ interruptedTurnId: turnId, cancelledMessages });
  }, Effect.uninterruptible);

  #activeTurnId(agentId: string): string | null {
    const snapshotTurnId = this.#conversation.workingSnapshot(agentId)?.activeTurnId;
    if (snapshotTurnId) return snapshotTurnId;
    return (
      this.#mailbox
        .unresolvedDeliveries()
        .find(({ delivery }) => delivery.recipientAgentId === agentId && delivery.turnId)?.delivery.turnId ?? null
    );
  }

  /**
   * `listQueue` leaves channel work out, and channel work is not the caller's to cancel. An answer
   * (linked, and expecting no reply) is not work that the caller gave, and the target may hold it
   * until its other teammates answer. A linked follow-up request is work, so it is cancelled.
   */
  #cancelQueuedFrom(agentId: string, callerAgentId: string): number {
    const deliveryIds = this.#mailbox
      .listQueue(agentId)
      .deliveries.filter(
        (delivery) =>
          delivery.status === "queued" &&
          delivery.sender.kind === "agent" &&
          delivery.sender.agentId === callerAgentId &&
          !(delivery.replyToMessageId && delivery.expectsReply === false),
      )
      .map((delivery) => delivery.id);
    try {
      for (const deliveryId of deliveryIds) this.#mailbox.cancelNow(agentId, deliveryId);
    } finally {
      if (deliveryIds.length > 0) this.#mailboxSync.emitQueue(agentId);
    }
    return deliveryIds.length;
  }

  /**
   * Tells the interrupted agent why its turn stopped. The notice is a normal message that expects no
   * reply, so it starts one short turn when the agent has nothing else queued: the provider thread
   * then records the stop, and a later turn does not pick the abandoned work up again. It queues
   * after work that others sent, as every message does.
   */
  readonly #notifyEffect = Effect.fn("AgentInterruptTool.notify")(function* (
    this: AgentInterruptTool,
    params: DynamicToolCallParams,
    callerAgentId: string,
    agentId: string,
    messageId: string | null,
    reason: string | undefined,
  ) {
    const text = [
      messageId
        ? `I interrupted your turn for my message ${messageId}.`
        : "I interrupted the turn that you ran for my message.",
      reason ? `Reason: ${reason}` : null,
      "Do not resume that work unless I send you a new request. I do not need a result for it, and I do not need a reply to this notice.",
    ]
      .filter(Boolean)
      .join("\n");
    yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: callerAgentId },
        recipientAgentIds: [agentId],
        text,
        replyToMessageId: null,
        expectsReply: false,
        idempotencyKey: `${params.threadId}:${params.turnId}:${params.callId}`,
      })
      .pipe(toToolOperationFailed);
    this.#mailboxSync.emitQueue(agentId);
    this.#drain.scheduleDrain(agentId);
  });
}

/** Every delivery the turn runs came from the caller, and it runs at least one. */
function ownedBy(deliveries: readonly DeliveryContext[], callerAgentId: string): boolean {
  return (
    deliveries.length > 0 &&
    deliveries.every(({ delivery }) => delivery.sender.kind === "agent" && delivery.sender.agentId === callerAgentId)
  );
}
