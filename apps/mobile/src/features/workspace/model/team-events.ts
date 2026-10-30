import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { type PlanLimits, withSignInUsage } from "@openbot/team-client/plan-limits";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import { type QueryClient, replaceEqualDeep } from "@tanstack/react-query";
import { decodeMobileBrowserTabs } from "@/features/browser/model/browser-tabs";
import type { LiveWorkspaceStore } from "./live-workspace-store";
import { AGENT_SETTINGS_PARTS, type QueryScope, queryKeys } from "./query-keys";
import { applyMobileQueueEvent } from "./queue-cache";
import { applyTaskEvent } from "./task-cache";

export type WorkspaceTeamEvent = AgentEvent | TeamRealtimeEvent;

/** The browser takeover requests and the browser tabs of a server that one host event changes. */
export function applyBrowserEvent(liveState: LiveWorkspaceStore, serverId: string, event: WorkspaceTeamEvent): void {
  if (event.type === "runtime-snapshot") {
    liveState.update("browserRequests", (current) => {
      const next = replaceEqualDeep(
        current[serverId],
        reconcilePendingRequests(
          current[serverId] ?? [],
          event.snapshot.pendingBrowserTakeovers,
          event.snapshot.attentionComplete,
        ),
      );
      return next === current[serverId] ? current : { ...current, [serverId]: next };
    });
  } else if (event.type === "browser-takeover-requested") {
    liveState.update("browserRequests", (current) => ({
      ...current,
      [serverId]: [
        ...(current[serverId] ?? []).filter((item) => item.requestId !== event.request.requestId),
        event.request,
      ],
    }));
  } else if (event.type === "browser-takeover-resolved") {
    liveState.update("browserRequests", (current) => ({
      ...current,
      [serverId]: (current[serverId] ?? []).filter((item) => item.requestId !== event.requestId),
    }));
  } else if (event.type === "browser-changed") {
    const tabs = decodeMobileBrowserTabs(event.tabs);
    liveState.update("browserTabs", (current) => ({
      ...current,
      [serverId]: { tabs, activeTabId: event.activeTabId },
    }));
  }
}

/** Updates or invalidates the cached reads that one host event makes old. */
export function syncEventQueries(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: WorkspaceTeamEvent,
): void {
  if (event.type === "queue-changed" || event.type === "queue-invalidated") {
    void applyMobileQueueEvent(queryClient, serverId, event);
  }
  applyTaskEvent(queryClient, scope, serverId, event);
  if (event.type === "usage-changed") {
    queryClient.setQueryData<PlanLimits>(queryKeys.planLimits(scope, serverId), (current) =>
      current ? { ...current, usage: withSignInUsage(current.usage, event.usage) } : current,
    );
    return;
  }
  if (
    event.type === "routines-changed" ||
    event.type === "channel-routines-changed" ||
    event.type === "agents-changed" ||
    // A routine run ends as a turn: its slot changes from planned to its outcome.
    (event.type === "turn-completed" && event.origin === "routine")
  ) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverRoutines(scope, serverId) });
    // Webhook history: a host also sends a routine change when it ignores a request.
    void queryClient.invalidateQueries({ queryKey: queryKeys.routineWebhooks(serverId) });
  }
  if (
    event.type === "channels-changed" ||
    event.type === "channel-memories-changed" ||
    event.type === "channel-routines-changed"
  ) {
    const part =
      event.type === "channel-memories-changed"
        ? "memories"
        : event.type === "channel-routines-changed"
          ? "routines"
          : null;
    void queryClient.invalidateQueries({
      queryKey: part
        ? queryKeys.channelInfo(scope, serverId, event.channelId, part)
        : queryKeys.channelInfo(scope, serverId, event.channelId),
      // Message streaming also sends channels-changed. Only settings events need an immediate settings read.
      refetchType: event.type === "channels-changed" ? "none" : "active",
    });
    return;
  }
  if (
    event.type === "memories-changed" ||
    event.type === "routines-changed" ||
    event.type === "skills-changed" ||
    event.type === "turn-completed"
  ) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agentInfo(scope, serverId, event.agentId) });
  }
  if (event.type === "agent-session-settings-changed") {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.agentInfo(scope, serverId, event.agentId),
      predicate: (query) => query.queryKey.at(-1) === "session-settings",
    });
  }
  if (event.type === "workflows-changed") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflowList(scope, serverId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(scope, serverId, event.workflowId) });
  }
  if (event.type === "agents-changed") {
    // The access of this member to the agents of a workflow can change, so it can see other workflows.
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverWorkflows(scope, serverId) });
    // The host also sends this event when the roles change, and this client does not get `agent-access-changed`.
    void queryClient.invalidateQueries({ queryKey: queryKeys.serverRoles(scope, serverId) });
    // The admin and host settings and the provider account of an agent are not in the agent summary.
    // The host sends this event when one of them changes, so an open settings page reads them again.
    void queryClient.invalidateQueries({
      queryKey: queryKeys.agentInfo(scope, serverId),
      predicate: (query) => AGENT_SETTINGS_PARTS.includes(String(query.queryKey.at(-1))),
    });
  }
}
