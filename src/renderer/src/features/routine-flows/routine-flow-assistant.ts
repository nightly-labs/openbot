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

  /**
   * Looks at the request in the conversation, around its own message, whenever a turn of the agent
   * ends or its queue moves. A request still in the queue takes no answer: the turn that ended read
   * other work. A request whose delivery failed or was cancelled ends with an error, and one whose
   * turn ended shows that turn's answer, or ends without one.
   */
  const check = async (forAgent: string, endedTurnId: string | null) => {
    const pending = chat.pending;
    if (!pending?.deliveryId || pending.agentId !== forAgent) return;
    const page = await port().agent.readConversationPage(
      { agentId: forAgent, anchor: { type: "around", messageId: pending.deliveryId } },
      "local",
    );
    const index = page.messages.findIndex((message) => message.id === pending.deliveryId);
    const asked = page.messages[index];
    if (!asked || chat.pending !== pending) return;
    const status = asked.delivery?.status ?? (asked.turnId ? "completed" : "queued");
    if (status === "queued") return;
    if (status === "failed" || status === "cancelled" || status === "interrupted") {
      toast.error(t("diagram.chat.failed"));
      setChat((draft) => {
        draft.pending = null;
      });
      return;
    }
    const turnId = asked.turnId ?? endedTurnId;
    let reply = turnId ? latestTurnAnswer(page.messages.slice(index + 1), turnId) : undefined;
    // The answer is the last message of the turn, and a long turn ends past the page around the
    // request, which can hold only an earlier message of it. Once the turn has ended, the newest
    // page holds its end, so its answer there wins.
    if (turnId && status === "completed") {
      const latest = await port().agent.readConversationPage({ agentId: forAgent }, "local");
      if (chat.pending !== pending) return;
      reply = latestTurnAnswer(latest.messages, turnId) ?? reply;
    }
    // Without the turn, a queue change can come before the answer does: only an ended turn ends it.
    if (!reply && (status !== "completed" || !turnId)) return;
    setChat((draft) => {
      if (reply) draft.messages.push({ id: reply.id, author: "agent", text: reply.text, createdAt: reply.createdAt });
      draft.pending = null;
    });
  };

  onSettled(() =>
    port().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId !== "local") return;
      const ended =
        event.type === "turn-completed"
          ? { agentId: event.agentId, turnId: event.turnId }
          : event.type === "queue-changed"
            ? { agentId: event.snapshot.agentId, turnId: null }
            : null;
      if (ended)
        check(ended.agentId, ended.turnId).catch((error) =>
          toast.error(errorMessage(error, t("diagram.chat.failed")), { error }),
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
        toast.error(errorMessage(error, t("diagram.chat.failed")), { error });
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
