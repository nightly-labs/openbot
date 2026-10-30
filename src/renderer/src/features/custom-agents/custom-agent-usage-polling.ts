import { createMemo } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { useServers } from "../servers/servers-context";
import { useCustomAgents } from "./custom-agents-context";

/**
 * Asks each custom agent that has a usage prompt for its plan usage, for the rail. The agents run on
 * this computer, so only the local server shows them. A changed prompt reads again at once.
 */
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
