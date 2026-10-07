/**
 * The chat over the routine canvas. A request goes into the open agent's own conversation, where
 * the agent changes routines and flows with its tools; its answer comes back when the turn that
 * read the request ends. The panel shows only the exchange started here: the whole conversation
 * stays on the Agents tab.
 */

import { latestTurnAnswer } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { DiagramChatMessage } from "@openbot/ui/features/diagrams/diagram-model";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, onSettled } from "solid-js";
import type { RoutineFlowsPort } from "./routine-flows-port";

/** A request sent and not answered yet. `deliveryId` names the request in the conversation. */
interface PendingRequest {
  agentId: string;
  deliveryId: string | null;
}

export function createRoutineFlowAssistant(port: () => RoutineFlowsPort, agentId: () => string | null) {
  const { t, errorMessage } = useText();
  const [chat, setChat] = createStore<{ messages: DiagramChatMessage[]; pending: PendingRequest | null }>({
    messages: [],
    pending: null,
  });

  createEffect(agentId, () => {
    setChat((draft) => {
      draft.messages = [];
      draft.pending = null;
    });
  });

  const answer = async (forAgent: string, turnId: string) => {
    const pending = chat.pending;
    if (!pending?.deliveryId || pending.agentId !== forAgent) return;
    const page = await port().agent.readConversationPage({ agentId: forAgent }, "local");
    const asked = page.messages.findIndex((message) => message.id === pending.deliveryId);
    if (asked === -1 || chat.pending !== pending) return;
    const reply = latestTurnAnswer(page.messages.slice(asked + 1), turnId);
    const ended = !["queued", "starting", "running"].includes(page.messages[asked]?.delivery?.status ?? "running");
    if (!reply && !ended) return;
    setChat((draft) => {
      if (reply) draft.messages.push({ id: reply.id, author: "agent", text: reply.text, createdAt: reply.createdAt });
      draft.pending = null;
    });
  };

  onSettled(() =>
    port().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId === "local" && event.type === "turn-completed")
        answer(event.agentId, event.turnId).catch((error) =>
          toast.error(errorMessage(error, t("diagram.chat.failed"))),
        );
    }),
  );

  const send = (text: string) => {
    const id = agentId();
    if (!id || chat.pending) return;
    const clientMessageId = crypto.randomUUID();
    const pending: PendingRequest = { agentId: id, deliveryId: null };
    setChat((draft) => {
      draft.messages.push({ id: clientMessageId, author: "user", text, createdAt: new Date().toISOString() });
      draft.pending = pending;
    });
    port()
      .agent.sendMessage({ agentId: id, text, clientMessageId }, "local")
      .then((receipt) => {
        setChat((draft) => {
          if (draft.pending?.agentId !== id || draft.pending.deliveryId) return;
          const deliveryId = receipt.deliveries.find((delivery) => delivery.recipientAgentId === id)?.id;
          if (deliveryId) draft.pending.deliveryId = deliveryId;
          else draft.pending = null;
        });
      })
      .catch((error) => {
        toast.error(errorMessage(error, t("diagram.chat.failed")));
        setChat((draft) => {
          draft.pending = null;
        });
      });
  };

  return {
    messages: () => chat.messages,
    working: () => chat.pending !== null,
    send,
  };
}
