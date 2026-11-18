import type { AgentStepsTrace } from "@openbot/ui/features/conversation/AgentSteps";
import { useText } from "@openbot/ui/text";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import type { createTurnSteps } from "./turn-steps";

/**
 * The trace that the steps row of an answer opens, for the chat and its threads. Call it in a component:
 * it reads the interface text. `agentName` names the turn; `agents` names the recipients of its messages.
 */
export function createStepsTrace(
  turnSteps: Pick<ReturnType<typeof createTurnSteps>, "traceAbove">,
  agents: () => readonly { id: string; name: string }[],
): (messageId: string | undefined, agentName: string) => AgentStepsTrace {
  const { t, format, sourceText } = useText();
  const keyboard = currentDevicePlatform() === "darwin" ? "mac" : "pc";
  return (messageId, agentName) => ({
    spans: () =>
      turnSteps.traceAbove(messageId, {
        agent: agentName,
        thinking: t("chat.trace.step.thinking"),
        answer: t("chat.trace.step.answer"),
        progress: sourceText,
        message: (names) => t("chat.trace.step.message", { agents: names }),
        subagent: (title) => t("chat.trace.step.subagent", { title }),
        reply: t("chat.trace.step.reply"),
        agentNames: (ids) =>
          format.list(
            ids.map((id) => agents().find((candidate) => candidate.id === id)?.name ?? t("chat.message.agentFallback")),
          ),
      }),
    keyboard,
  });
}
