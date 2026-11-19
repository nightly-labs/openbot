import { useCallback, useLayoutEffect, useState } from "react";

import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { finishOnboarding, useOnboardingProgress } from "@/features/onboarding/model/onboarding-progress";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { devReplayOnboarding } from "@/shared/lib/dev-feature-overrides";

type Decision = "show" | "hide";

export function useOnboardingGate(): { active: boolean; finish: () => void } {
  const { session } = useMobileSession();
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
    setDecision("hide");
  }, [userId]);

  return { active: decision === "show" && (!finished || replay), finish };
}
