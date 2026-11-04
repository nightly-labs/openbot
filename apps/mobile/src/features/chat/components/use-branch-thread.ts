import type { AgentTasksSnapshot, ConversationMessage } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { branchPointIds } from "../model/branch-points";

const NO_IDS: ReadonlySet<string> = new Set();

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * "Branch from here" in a conversation of an agent, as on desktop: the agent's own chat when
 * `sourceTaskId` is null, else a thread. A branch copies the conversation through the turn of the
 * chosen answer into a new thread, which then opens. No turn starts. The host must serve
 * `agent-thread-branches-v1` and be online. While a turn runs, no message offers a branch: the
 * host refuses a source with a running turn.
 */
export function useBranchThread({
  serverId,
  agentId,
  sourceTaskId,
  messages,
  activeTurnId,
}: {
  serverId: string;
  agentId: string;
  sourceTaskId: string | null;
  messages: readonly ConversationMessage[] | undefined;
  activeTurnId: string | null;
}) {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  // The host branches only for a member who can write to the agent.
  const viewOnly = useAgentViewOnly(serverId, agentId);
  const enabled =
    useMobileWorkspaceSelector(
      (current) =>
        current.servers.some((server) => server.id === serverId && server.state === "online") &&
        current.canUseTasks(serverId) &&
        current.canBranchThreads(serverId),
    ) && !viewOnly;
  // One set while its ids stay, so a streamed chunk does not draw every row of the chat again.
  const stable = useRef(NO_IDS);
  const branchPoints = useMemo(() => {
    const next = enabled && messages && !activeTurnId ? branchPointIds(messages, null) : NO_IDS;
    if (!sameIds(next, stable.current)) stable.current = next;
    return stable.current;
  }, [enabled, messages, activeTurnId]);

  // One branch at a time. A second touch while the first request runs does nothing.
  const pending = useRef(false);
  const branch = useCallback(
    async (messageId: string) => {
      if (pending.current) return;
      pending.current = true;
      void haptics.impact("light");
      try {
        const task = await workspace().branchAgentThread(
          { agentId, taskId: sourceTaskId, messageId, requestId: Crypto.randomUUID() },
          serverId,
        );
        // The thread shows in the menu before its list event arrives.
        queryClient.setQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(queryScope, serverId, agentId), (stored) =>
          stored && !stored.tasks.some((entry) => entry.id === task.id)
            ? { ...stored, tasks: [task, ...stored.tasks] }
            : stored,
        );
        void haptics.notification("success");
        // From a thread, the branch replaces it on the screen, so Back still returns to the agent's chat.
        if (sourceTaskId === null)
          router.push({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId: task.id } });
        else router.setParams<"/task/[taskId]">({ taskId: task.id });
      } catch (cause) {
        void haptics.notification("error");
        const text = currentText();
        const title = text.t("mobile.chat.message.branchFailed");
        showFailureAlert(cause, "team", title, text.errorMessage(cause, title));
      } finally {
        pending.current = false;
      }
    },
    [workspace, agentId, sourceTaskId, serverId, queryClient, queryScope],
  );

  return { branchPoints, branch: enabled ? branch : undefined };
}
