import { useMemo } from "react";
import { useServerResponseStyle } from "@/features/servers/model/use-server-personality";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { ProgressUpdates } from "./chat-messages";

/**
 * The progress updates of a "natural" server, for the projection of its chats. Undefined while the
 * server is "classic" or its host has not answered: the updates then stay in the steps.
 * `ownerId` is the agent of an agent chat, whose messages do not name their agent.
 */
export function useProgressUpdates(
  serverId: string,
  agents: readonly MobileAgent[],
  ownerId?: string,
): ProgressUpdates | undefined {
  const style = useServerResponseStyle(serverId);
  return useMemo(() => {
    if (style !== "natural") return undefined;
    const providers = new Map(agents.map((agent) => [agent.id, agent.provider ?? agent.foreignProvider]));
    return { provider: (agentId) => providers.get(agentId ?? ownerId ?? "") };
  }, [style, agents, ownerId]);
}
