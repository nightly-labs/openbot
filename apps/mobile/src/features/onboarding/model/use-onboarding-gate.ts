import { useCallback, useLayoutEffect, useState } from "react";

import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { finishOnboarding, useOnboardingProgress } from "@/features/onboarding/model/onboarding-progress";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { devReplayOnboarding } from "@/shared/lib/dev-feature-overrides";

type Decision = "show" | "hide";

/**
 * Whether the home screen shows the first-run flow. It shows once per account on this phone, when
 * the account has no server, or when the selected server is connected and has no agent: the flow
 * creates the first agent there. Other servers of the account do not count, because a server that
 * is asleep or that someone shared must not keep the flow away. Until the selected server reports,
 * it decides nothing and the home screen shows its usual loading state.
 *
 * The decision holds for the life of the screen: an agent that the flow creates must not end the
 * flow, and an agent that a slow server reports later must not start it over a list.
 */
export function useOnboardingGate(): { active: boolean; finish: () => void } {
  const { session } = useMobileSession();
  // Home holds this gate under every screen, so it reads only the values that decide.
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const activeServerId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const serverDirectoryState = useMobileWorkspaceSelector((current) => current.serverDirectoryState);
  const userId = session?.user.id ?? null;
  const progressReady = useOnboardingProgress((state) => state.ready);
  const finished = useOnboardingProgress((state) => userId !== null && state.finished.includes(userId));
  const replay = devReplayOnboarding();
  const [decision, setDecision] = useState<Decision | null>(null);

  let next: Decision | null = null;
  if (decision === null && progressReady && userId !== null) {
    const selected = servers.find((server) => server.id === activeServerId);
    if ((finished && !replay) || serverDirectoryState === "error") next = "hide";
    else if (serverDirectoryState === "ready") {
      if (servers.length === 0) next = "show";
      else if (selected?.state === "online" && !selected.initialConnectionPending) {
        // Hidden agents count: they are agents of the server.
        const empty = !agents.some((agent) => agent.serverId === selected.id);
        next = empty || replay ? "show" : "hide";
      }
    }
  }
  useLayoutEffect(() => {
    if (next !== null) setDecision(next);
  }, [next]);

  const finish = useCallback(() => {
    if (userId !== null) void finishOnboarding(userId).catch(() => undefined);
    // A replay ends with the flow, as a first run does.
    setDecision("hide");
  }, [userId]);

  return { active: decision === "show" && (!finished || replay), finish };
}
