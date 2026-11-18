import { profileStats } from "@openbot/team-client/profile-stats";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { lastUsageDays } from "@/features/agents/components/usage-range-picker";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** The past year, the range of the desktop Profile tab. */
const PROFILE_DAYS = 365;

/**
 * The host report that the desktop Profile tab shows: the past year of the paired desktop
 * (`kind: "local"`). Without a paired desktop there is no report, as on a host without analytics.
 */
export function useProfileActivity() {
  const queryScope = useQueryScope();
  const { servers, agents, loadHostAnalytics } = useMobileWorkspace();
  const server = servers.find((item) => item.kind === "local" && item.publicKey);
  const online = server?.state === "online";
  const [range] = useState(() => lastUsageDays(PROFILE_DAYS));
  const report = useQuery({
    queryKey: queryKeys.profileActivity(queryScope, server?.id ?? "", range),
    queryFn: () => (server ? loadHostAnalytics(range, server.id) : null),
    enabled: online,
    // The report on screen stays while a later load runs, so the tiles do not empty and fill again.
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
  const serverAgents = useMemo(() => agents.filter((agent) => agent.serverId === server?.id), [agents, server?.id]);
  const stats = useMemo(
    () => (report.data ? profileStats(report.data, serverAgents) : null),
    [report.data, serverAgents],
  );
  return { server, online, report, stats, range };
}

export type ProfileActivity = ReturnType<typeof useProfileActivity>;
