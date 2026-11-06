import { useMemo } from "react";
import { browserTabHost, browserTabTitle } from "@/features/browser/model/browser-tabs";
import { useAgentBrowserTabs } from "@/features/workspace/components/use-live-workspace";
import { useText } from "@/shared/lib/text";
import type { MentionReference } from "../components/chat-composer";
import { useOpenAgentTasks } from "../components/use-open-agent-tasks";

const NO_REFERENCES: readonly MentionReference[] = [];

/**
 * What `@` in one agent's chat can tag beside the agents, as the desktop composer: the agent's own
 * browser tabs, newest first, then its open side threads, newest first. The host shares only a tab
 * that has the agent as its owner, so a tab that only a thread owns is left out. `currentTaskId` is
 * the side thread on the screen, which does not tag itself. Empty on a host that lists no tabs to
 * the member and has no `agent-tasks-v1`.
 */
export function useAgentMentionReferences(
  serverId: string,
  agentId: string,
  currentTaskId: string | null = null,
): readonly MentionReference[] {
  const { t } = useText();
  const tabs = useAgentBrowserTabs(serverId, agentId);
  const tasks = useOpenAgentTasks(serverId, agentId);
  const untitled = t("mobile.browser.tabs.untitled");
  return useMemo(() => {
    const references: MentionReference[] = [
      ...[...tabs].reverse().map((tab) => ({
        kind: "tab" as const,
        id: tab.id,
        name: browserTabTitle(tab, untitled),
        detail: browserTabHost(tab),
      })),
      ...tasks
        .filter((task) => task.id !== currentTaskId)
        // Hermes has no `toSorted`. `filter` already made a new array, so `sort` changes no shared list.
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((task) => ({ kind: "thread" as const, id: task.id, name: task.title, detail: "" })),
    ];
    return references.length > 0 ? references : NO_REFERENCES;
  }, [tabs, tasks, currentTaskId, untitled]);
}
