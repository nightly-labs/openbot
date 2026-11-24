import { agentProviderDescriptor, agentSteersTurns, isKnownAgentProvider } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

interface AgentSteering {
  steers: boolean;
  known: boolean;
}

export function useAgentSteers(agent: Pick<MobileAgent, "provider" | "foreignProvider" | "model" | "serverId">) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const provider = agent.provider ?? agent.foreignProvider;
  const reported =
    provider !== undefined && isKnownAgentProvider(provider) && agentProviderDescriptor(provider).steer === "reported";
  const readable = useMobileWorkspaceSelector((current) => current.canReadModelSteering(agent.serverId));
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, agent.serverId),
    queryFn: () => workspace.loadAgentModels(agent.serverId),
    enabled: reported && readable,
    retry: false,
  });
  if (provider === undefined) return { steers: true, known: false } satisfies AgentSteering;
  if (!reported) return { steers: agentSteersTurns({ provider, model: "" }, []), known: true } satisfies AgentSteering;
  return {
    steers: agentSteersTurns({ provider, model: agent.model ?? "" }, models.data ?? []),
    known: readable && models.isSuccess,
  } satisfies AgentSteering;
}
