import { createMemo } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { useServers } from "../servers/servers-context";
import { useCustomAgents } from "./custom-agents-context";

export function useCustomAgentUsagePolling() {
  const { customAgents, refreshCustomAgentUsage } = useCustomAgents();
  const { activeServer } = useServers();
  const target = createMemo(() => {
    if (activeServer()?.kind !== "local") return null;
    const prompts = customAgents()
      .flatMap((agent) => (agent.usagePrompt ? [`${agent.id}=${agent.usagePrompt}`] : []))
      .join("\n");
    return prompts || null;
  });
  createUsageRefreshPoll({
    target,
    refreshAtStart: true,
    refresh: () => void refreshCustomAgentUsage().catch(() => undefined),
  });
}
