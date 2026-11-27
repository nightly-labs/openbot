import type { AgentContextState } from "@openbot/contracts/ipc";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useChatNavigation } from "@/features/chat/context/chat-navigation-context";
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

export interface ContextChat {
  serverId: string;
  agentId: string;
  task?: { taskId: string; threadId: string | null };
}

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

export function useComposerContextMeter(chat: ContextChat): ComposerContextMeter | undefined {
  const { t, format } = useText();
  const navigation = useChatNavigation();
  const usage = useContextUsage(chat);
  const { serverId, agentId } = chat;
  const taskId = chat.task?.taskId;
  const threadId = chat.task?.threadId;
  const onPress = useCallback(() => {
    navigation.push({
      pathname: "/context-usage/[agentId]",
      params: { agentId, serverId, ...(taskId && threadId ? { taskId, threadId } : {}) },
    });
  }, [navigation, agentId, serverId, taskId, threadId]);
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
