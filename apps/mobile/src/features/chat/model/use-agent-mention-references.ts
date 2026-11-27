import { referenceName } from "@openbot/contracts/chat-tag-references";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentBrowserTabs, browserTabHost, browserTabTitle } from "@/features/browser/model/browser-tabs";
import { selectLiveState } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import type { MentionReference } from "../components/chat-composer";
import { useOpenAgentTasks } from "../components/use-open-agent-tasks";

const NO_REFERENCES: readonly MentionReference[] = [];

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

export function useAgentMentionReferences(
  serverId: string,
  agentId: string,
  currentTaskId: string | null = null,
): readonly MentionReference[] {
  const { t } = useText();
  const untitled = t("mobile.browser.tabs.untitled");
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const selectTabs = useCallback(
    () =>
      JSON.stringify(
        agentBrowserTabs(liveState.get().browserTabs[serverId], agentId).map((tab) => [
          tab.id,
          referenceName(browserTabTitle(tab, untitled)),
          browserTabHost(tab),
          displayUrl(tab.url),
        ]),
      ),
    [liveState, serverId, agentId, untitled],
  );
  const tabsKey = useSyncExternalStore(liveState.subscribe, selectTabs);
  const tasks = useOpenAgentTasks(serverId, agentId);
  return useMemo(() => {
    const tabs: [string, string, string, string][] = JSON.parse(tabsKey);
    const references: MentionReference[] = [
      ...tabs.reverse().map(([id, name, host, url]) => ({ kind: "tab" as const, id, name, detail: host, search: url })),
      ...tasks
        .filter((task) => task.id !== currentTaskId && referenceName(task.title))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((task) => {
          const name = referenceName(task.title);
          return { kind: "thread" as const, id: task.id, name, detail: "", search: "" };
        }),
    ];
    return references.length > 0 ? references : NO_REFERENCES;
  }, [tabsKey, tasks, currentTaskId]);
}
