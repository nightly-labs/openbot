import type { ConversationMessage } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useCallback, useMemo, useRef } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useChatNavigation } from "@/features/chat/context/chat-navigation-context";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { addStartedTask } from "@/features/workspace/model/task-cache";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { branchPointIds } from "../model/branch-points";

const NO_IDS: ReadonlySet<string> = new Set();

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

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
  const navigation = useChatNavigation();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  const viewOnly = useAgentViewOnly(serverId, agentId);
  const enabled =
    useMobileWorkspaceSelector(
      (current) =>
        current.servers.some((server) => server.id === serverId && server.state === "online") &&
        current.canUseTasks(serverId) &&
        current.canBranchThreads(serverId),
    ) && !viewOnly;
  const stable = useRef(NO_IDS);
  const branchPoints = useMemo(() => {
    const next = enabled && messages && !activeTurnId ? branchPointIds(messages, null) : NO_IDS;
    if (!sameIds(next, stable.current)) stable.current = next;
    return stable.current;
  }, [enabled, messages, activeTurnId]);

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
        addStartedTask(queryClient, queryScope, serverId, task);
        void haptics.notification("success");
        if (sourceTaskId === null)
          navigation.push({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId: task.id } });
        else navigation.setParams<"/task/[taskId]">({ taskId: task.id });
      } catch (cause) {
        void haptics.notification("error");
        const text = currentText();
        const title = text.t("mobile.chat.message.branchFailed");
        showFailureAlert(cause, "team", title, text.errorMessage(cause, title));
      } finally {
        pending.current = false;
      }
    },
    [workspace, navigation, agentId, sourceTaskId, serverId, queryClient, queryScope],
  );

  return { branchPoints, branch: enabled ? branch : undefined };
}
