import type { AgentContextState } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  type ContextUsageView,
  contextMeterLevel,
  contextUsageView,
  usedShare,
} from "@/features/chat/model/context-usage";
import { selectLiveState } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";
import type { ComposerContextMeter } from "./composer-context-ring";

/** The chat whose context a meter shows: the agent's own chat, or one of its side threads. */
export interface ContextChat {
  serverId: string;
  agentId: string;
  /** For a side thread, the task and the provider thread that the host keys its state by. */
  task?: { taskId: string; threadId: string | null };
}

/** How full the chat's context is, while its server is online and reports it. */
export function useContextUsage(chat: ContextChat): ContextUsageView | undefined {
  const { serverId, agentId } = chat;
  const threadId = chat.task ? chat.task.threadId : undefined;
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) =>
    showsOnline(workspace.servers.find((server) => server.id === serverId)),
  );
  const select = useCallback((): AgentContextState | undefined => {
    if (!online || threadId === null) return undefined;
    const states = liveState.get().contextByServer[serverId];
    return threadId === undefined ? states?.agents[agentId] : states?.threads[threadId];
  }, [liveState, online, serverId, agentId, threadId]);
  const state = useSyncExternalStore(liveState.subscribe, select);
  return useMemo(() => contextUsageView(state), [state]);
}

/** The composer's ring for the chat, which opens the context sheet. Undefined while there is no usage. */
export function useComposerContextMeter(chat: ContextChat): ComposerContextMeter | undefined {
  const { t, format } = useText();
  const usage = useContextUsage(chat);
  const { serverId, agentId } = chat;
  const taskId = chat.task?.taskId;
  const threadId = chat.task?.threadId;
  const onPress = useCallback(() => {
    router.push({
      pathname: "/context-usage/[agentId]",
      params: { agentId, serverId, ...(taskId && threadId ? { taskId, threadId } : {}) },
    });
  }, [agentId, serverId, taskId, threadId]);
  return useMemo(() => {
    if (!usage) return undefined;
    const share = usedShare(usage);
    const percent = format.percent(share, { maximumFractionDigits: 0 });
    return {
      share,
      level: contextMeterLevel(usage),
      compacting: usage.compacting,
      label: usage.compacting
        ? t("mobile.chat.context.labelCompacting")
        : t(usage.estimated ? "mobile.chat.context.labelEstimated" : "mobile.chat.context.label", { percent }),
      onPress,
    };
  }, [usage, t, format, onPress]);
}
