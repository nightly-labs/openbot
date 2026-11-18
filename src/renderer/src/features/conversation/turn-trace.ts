import type { AgentProfile } from "@openbot/ui/data";
import type { AgentStepsTrace } from "@openbot/ui/features/conversation/AgentSteps";
import { useText } from "@openbot/ui/text";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import type { createTurnSteps } from "./turn-steps";

/**
 * The trace that the steps row of an answer opens, the same in an agent chat, a channel and a thread.
 * `agentName` names the agent that answered, when it is not the agent of the chat.
 */
export function useTurnTrace(deps: {
  turnSteps: ReturnType<typeof createTurnSteps>;
  agentName: () => string | undefined;
  agents: () => readonly Pick<AgentProfile, "id" | "name">[];
}): (messageId: string | undefined, agentName?: string) => AgentStepsTrace {
  const { t, format, sourceText } = useText();
  const keyboard = currentDevicePlatform() === "darwin" ? "mac" : "pc";
  const nameOf = (id: string) =>
    deps.agents().find((candidate) => candidate.id === id)?.name ?? t("chat.message.agentFallback");
  return (messageId, agentName) => ({
    spans: () =>
      deps.turnSteps.traceAbove(messageId, {
        agent: agentName ?? deps.agentName() ?? t("chat.message.agentFallback"),
        thinking: t("chat.trace.step.thinking"),
        answer: t("chat.trace.step.answer"),
        progress: sourceText,
        message: (agents) => t("chat.trace.step.message", { agents }),
        subagent: (title) => t("chat.trace.step.subagent", { title }),
        reply: t("chat.trace.step.reply"),
        agentNames: (ids) => format.list(ids.map(nameOf)),
      }),
    keyboard,
  });
}
