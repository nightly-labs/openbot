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
import { toolCallIdempotencyKey } from "./tool-call-idempotency";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";
import { unknownAgentMessage } from "./unknown-agent";

export const interruptAgentToolSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(INPUT_LIMITS.identifier),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

export interface AgentInterruptHooks {
  listAgents(): AgentSummary[];
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
    requesterIds: readonly string[],
  ) {
    const { agentId, reason } = yield* toolStep(() => interruptAgentToolSchema.parse(params.arguments));
    if (agentId === callerAgentId) return openBotToolFailure(sourceText("error.backend.interruptSelf"));
    const agents = this.#hooks.listAgents();
    if (!agents.some((agent) => agent.id === agentId)) {
      const candidates = agents.filter((agent) => agent.id !== callerAgentId);
      return yield* new ToolOperationFailed({ cause: new Error(unknownAgentMessage(agentId, candidates)) });
    }

    if (this.#mailbox.startingDeliveryForAgent(agentId, null)) {
      const task = this.#drain.taskFor(agentId);
      if (task) yield* task.pipe(toToolOperationFailed);
    }
    if (this.#mailbox.startingDeliveryForAgent(agentId, null)) {
      return openBotToolFailure(sourceText("error.backend.interruptStarting"));
    }

    const cancelledMessages = yield* toolStep(() => this.#cancelQueuedFrom(agentId, callerAgentId));
    const refuse = (message: string) =>
      openBotToolFailure(message, cancelledMessages > 0 ? { cancelledMessages } : undefined);

    const turnId = this.#activeTurnId(agentId);
    let deliveries: DeliveryContext[] = [];
    if (turnId) {
      deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
      const snapshot = this.#conversation.workingSnapshot(agentId);
      if (
        (snapshot?.activeTurnId === turnId && this.#conversation.isExecutionThread(snapshot.threadId)) ||
        deliveries.some((context) => this.#channels.store.assignmentForDelivery(context.delivery.id))
      ) {
        return refuse(sourceText("error.backend.useChannelTaskControlsWork"));
      }
      if (!ownedBy(deliveries, callerAgentId)) {
        return refuse(
          deliveries.some((context) => sentBy(context, callerAgentId))
            ? sourceText("error.backend.interruptSharedWork")
            : sourceText("error.backend.interruptOtherWork"),
        );
      }
      if (!this.#store.activeProviderSession(agentId) && !this.#conversation.hasRoutineSession(agentId)) {
        return refuse(sourceText("error.backend.interruptNoSession"));
      }
    }

    if (!turnId) {
      const runningTasks = this.#conversation.workingTaskSnapshots(agentId).length;
      if (this.#conversation.workingChannelSnapshots(agentId).length > 0) {
        return openBotToolResult({
          interruptedTurnId: null,
          cancelledMessages,
          ...(runningTasks > 0 ? { runningTasks } : {}),
          runningChannelTask: true,
          note: "This agent still works on a channel task. This tool cannot stop it. Use the task controls in the channel.",
        });
      }
      if (runningTasks === 0) return openBotToolResult({ interruptedTurnId: null, cancelledMessages });
      return openBotToolResult({
        interruptedTurnId: null,
        cancelledMessages,
        runningTasks,
        note: "This agent still runs tasks. This tool cannot stop them. The user can stop a task with Stop in its tab in the agent's chat header.",
      });
    }

    const mayStop = () => ownedBy(this.#mailbox.findDeliveriesByTurn(agentId, turnId), callerAgentId);
    if (!(yield* this.#hooks.interrupt(agentId, turnId, mayStop).pipe(toToolOperationFailed))) {
      return openBotToolResult({ interruptedTurnId: null, cancelledMessages });
    }
    yield* this.#notifyEffect(
      params,
      callerAgentId,
      requesterIds,
      agentId,
      deliveries[0]?.delivery.messageId ?? null,
      reason,
    );
    return openBotToolResult({ interruptedTurnId: turnId, cancelledMessages });
  }, Effect.uninterruptible);

  #activeTurnId(agentId: string): string | null {
    const snapshotTurnId = this.#conversation.workingSnapshot(agentId)?.activeTurnId;
    if (snapshotTurnId) return snapshotTurnId;
    return (
      this.#mailbox
        .unresolvedDeliveries()
        .find(
          ({ delivery }) =>
            delivery.recipientAgentId === agentId &&
            delivery.turnId &&
            this.#mailbox.laneIdForDelivery(delivery.id) === null,
        )?.delivery.turnId ?? null
    );
  }

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

  readonly #notifyEffect = Effect.fn("AgentInterruptTool.notify")(function* (
    this: AgentInterruptTool,
    params: DynamicToolCallParams,
    callerAgentId: string,
    requesterIds: readonly string[],
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
        requesterIds,
        recipientAgentIds: [agentId],
        text,
        replyToMessageId: null,
        expectsReply: false,
        idempotencyKey: toolCallIdempotencyKey(params),
      })
      .pipe(toToolOperationFailed);
    this.#mailboxSync.emitQueue(agentId);
    this.#drain.scheduleDrain(agentId);
  });
}

function ownedBy(deliveries: readonly DeliveryContext[], callerAgentId: string): boolean {
  return deliveries.length > 0 && deliveries.every((context) => sentBy(context, callerAgentId));
}

function sentBy({ delivery }: DeliveryContext, agentId: string): boolean {
  return delivery.sender.kind === "agent" && delivery.sender.agentId === agentId;
}
