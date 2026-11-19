import { latestTurnAnswer } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { DiagramChatMessage } from "@openbot/ui/features/diagrams/diagram-model";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, onSettled } from "solid-js";
import type { RoutineFlowsHost } from "./routine-flows-port";

interface PendingRequest {
  agentId: string;
  deliveryId: string | null;
}

export function createRoutineFlowAssistant(host: () => RoutineFlowsHost, agentId: () => string | null) {
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

  const check = async (forAgent: string, endedTurnId: string | null) => {
    const pending = chat.pending;
    if (!pending?.deliveryId || pending.agentId !== forAgent) return;
    const page = await host().conversation.page(forAgent, pending.deliveryId);
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
    if (turnId && status === "completed") {
      const latest = await host().conversation.page(forAgent);
      if (chat.pending !== pending) return;
      reply = latestTurnAnswer(latest.messages, turnId) ?? reply;
    }
    if (!reply && (status !== "completed" || !turnId)) return;
    setChat((draft) => {
      if (draft.pending?.deliveryId !== pending.deliveryId) return;
      if (reply) draft.messages.push({ id: reply.id, author: "agent", text: reply.text, createdAt: reply.createdAt });
      draft.pending = null;
    });
  };

  onSettled(() =>
    host().onEvent((event) => {
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
    host()
      .conversation.send({ agentId: id, text, clientMessageId })
      .then((deliveryId) => {
        setChat((draft) => {
          if (draft.pending?.agentId !== id || draft.pending.deliveryId) return;
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
