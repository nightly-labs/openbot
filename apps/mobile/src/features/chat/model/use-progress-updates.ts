import { type AgentProviderRef, isAgentProviderRef } from "@openbot/contracts/agent-providers";
import { useMemo } from "react";
import { useServerResponseStyle } from "@/features/servers/model/use-server-personality";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { ProgressUpdates } from "./chat-messages";

export function useProgressUpdates(
  serverId: string,
  agents: readonly MobileAgent[],
  ownerId?: string,
): ProgressUpdates | undefined {
  const style = useServerResponseStyle(serverId);
  const providerList = agents
    .map((agent) => `${agent.id}\t${agent.provider ?? agent.foreignProvider ?? ""}`)
    .join("\n");
  return useMemo(() => {
    if (style !== "natural") return undefined;
    const providers = new Map(
      providerList.split("\n").map((line): [string, AgentProviderRef | undefined] => {
        const [id = "", provider = ""] = line.split("\t");
        return [id, isAgentProviderRef(provider) ? provider : undefined];
      }),
    );
    return { provider: (agentId) => providers.get(agentId ?? ownerId ?? "") };
  }, [style, providerList, ownerId]);
}
