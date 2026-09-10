import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyAgentUsageRoute() {
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId?: string }>();
  return (
    <Redirect
      href={{ pathname: "/agent-info/[agentId]/usage", params: { agentId, ...(serverId ? { serverId } : {}) } }}
    />
  );
}
