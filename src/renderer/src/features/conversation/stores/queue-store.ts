import type { QueueDelivery } from "@openbot/contracts/ipc";
import { agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { agentAwaitingReplies } from "../../../awaiting-replies";
import { activeQueueDeliveries, presentQueueDeliveries, queuedDeliveriesInOrder } from "../../../queue-reconciliation";
import type { ConversationProps } from "../conversation-types";
import { currentConversationTarget } from "./composer-store";

export interface QueueStoreDeps {
  props: ConversationProps;
  hiddenAwaitingReplyIds: Accessor<ReadonlySet<string>>;
  /** Messages sent while the agent was idle that the host is about to start. The chat still shows them. */
  startingDeliveryIds: Accessor<ReadonlySet<string>>;
}

export function createQueueStore(deps: QueueStoreDeps) {
  const activeDeliveries = createMemo(() => activeQueueDeliveries(deps.props.queue, deps.props.activeTurnId));
  const orderedQueuedDeliveries = createMemo(() => queuedDeliveriesInOrder(deps.props.queue));
  const presentedQueueDeliveries = createMemo(() => {
    const presented = presentQueueDeliveries({
      snapshot: deps.props.queue,
      activeTurnId: deps.props.activeTurnId,
      renderedMessageIds: new Set(deps.props.messages.map((message) => message.id)),
    });
    // A hold keeps the message waiting, so the panel shows it at once.
    if (deps.props.queue?.hold) return presented;
    const starting = deps.startingDeliveryIds();
    return starting.size ? presented.filter((delivery) => !starting.has(delivery.id)) : presented;
  });
  // The agents this agent asked, and the answers that wait for it. A queue of another agent, which
  // the view holds for a moment while it switches, answers nothing here.
  // The person can close the block when every agent is done. A closed row that works again shows.
  const awaitingReplies = createMemo(() => {
    const hidden = deps.hiddenAwaitingReplyIds();
    return agentAwaitingReplies({
      messages: deps.props.messages,
      queue: deps.props.queue?.agentId === deps.props.agent?.id ? deps.props.queue : undefined,
      agents: deps.props.agents,
      self: deps.props.agent,
      waits: deps.props.agentWaits,
    }).filter((row) => !(hidden.has(row.id) && (row.state === "replied" || row.state === "failed")));
  });
  const [renderedQueueDeliveries, setRenderedQueueDeliveries] = createSignal<QueueDelivery[]>([]);
  const queuePanelVisible = createMemo(() => renderedQueueDeliveries().length > 0);
  let queueExitTimer: number | undefined;
  let renderedOwner: string | undefined;
  createEffect(
    () => {
      const target = currentConversationTarget(deps.props);
      return { deliveries: presentedQueueDeliveries(), owner: target && `${target.serverId}:${target.agentId}` };
    },
    ({ deliveries, owner }) => {
      if (queueExitTimer !== undefined) {
        window.clearTimeout(queueExitTimer);
        queueExitTimer = undefined;
      }
      const switched = owner !== renderedOwner;
      renderedOwner = owner;
      if (deliveries.length > 0) {
        setRenderedQueueDeliveries(deliveries);
        return;
      }
      if (untrack(renderedQueueDeliveries).length === 0) return;
      // The queue of the chat before a switch does not stay open in this one.
      if (switched) {
        setRenderedQueueDeliveries([]);
        return;
      }
      queueExitTimer = window.setTimeout(() => {
        queueExitTimer = undefined;
        if (untrack(presentedQueueDeliveries).length === 0) setRenderedQueueDeliveries([]);
      }, agentActivityExitDuration());
    },
  );
  onCleanup(() => {
    if (queueExitTimer !== undefined) window.clearTimeout(queueExitTimer);
  });

  return {
    activeDeliveries,
    awaitingReplies,
    orderedQueuedDeliveries,
    presentedQueueDeliveries,
    renderedQueueDeliveries,
    setRenderedQueueDeliveries,
    queuePanelVisible,
  };
}
