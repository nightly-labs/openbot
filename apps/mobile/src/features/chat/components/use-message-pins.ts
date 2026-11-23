import type { PinnedMessage, PinnedMessagesSnapshot } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { useText } from "@/shared/lib/text";

const NO_PINS: readonly PinnedMessage[] = [];

function pinKey(taskId: string | null, messageId: string): string {
  return `${taskId ?? ""}:${messageId}`;
}

export function useMessagePinsEnabled(serverId: string): boolean {
  return useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canPinMessages(serverId),
  );
}

export function useMessagePins(serverId: string, agentId: string) {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  const enabled = useMessagePinsEnabled(serverId);
  const key = queryKeys.messagePins(queryScope, serverId, agentId);
  const query = useQuery({
    queryKey: key,
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: () => workspace().loadMessagePins(agentId, serverId),
  });
  const pins = enabled ? (query.data?.pins ?? NO_PINS) : NO_PINS;
  const setPinned = useCallback(
    async (taskId: string | null, messageId: string, next: boolean) => {
      const snapshot = await workspace().setMessagePinned(
        { agentId, ...(taskId ? { taskId } : {}), messageId, pinned: next },
        serverId,
      );
      queryClient.setQueryData<PinnedMessagesSnapshot>(queryKeys.messagePins(queryScope, serverId, agentId), snapshot);
    },
    [agentId, serverId, queryScope, queryClient, workspace],
  );
  return {
    enabled,
    pins,
    loading: enabled && query.isPending,
    failed: enabled && query.isError && !query.data,
    refresh: () => void query.refetch(),
    setPinned,
  };
}

export interface PinnedMessageRow {
  key: string;
  pin: PinnedMessage;
  author: string;
  time: string;
  text: string;
  chat: string | null;
  pinnedBy: string | null;
}

export function usePinnedMessageRows(
  serverId: string,
  agentId: string,
  pins: readonly PinnedMessage[],
  viewTaskId: string | null,
): PinnedMessageRow[] {
  const { t, format } = useText();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const memberId = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === serverId)?.membershipId ?? null,
  );
  const accountUserId = useMobileSession().session?.user.id ?? null;
  return useMemo(() => {
    const own = (senderId: string) =>
      senderId === memberId || (accountUserId !== null && senderId === `local-user:${accountUserId}`);
    const personName = (sender: PinnedMessage["sender"]): string | null => {
      if (!sender || own(sender.id)) return null;
      return sender.name.trim() || t("mobile.chat.pins.memberFallback");
    };
    const agentName = (id: string | null) =>
      agents.find((agent) => agent.serverId === serverId && agent.id === (id ?? agentId))?.name ??
      t("mobile.chat.pins.agentFallback");
    const here = (pin: PinnedMessage) => pin.taskId === viewTaskId;
    return [...pins.filter(here), ...pins.filter((pin) => !here(pin))].map((pin) => ({
      key: pinKey(pin.taskId, pin.messageId),
      pin,
      author:
        pin.author === "user" ? (personName(pin.sender) ?? t("mobile.chat.pins.you")) : agentName(pin.senderAgentId),
      time: formatUpdatedAt(pin.createdAt, format),
      text: pin.text.replace(/\s+/g, " ").trim(),
      chat: here(pin)
        ? null
        : pin.taskId === null
          ? t("mobile.chat.pins.mainChat")
          : pin.threadTitle || t("mobile.chat.pins.thread"),
      pinnedBy: pin.pinnedBy.kind === "agent" ? agentName(pin.pinnedBy.agentId) : personName(pin.pinnedBy.sender),
    }));
  }, [pins, viewTaskId, agents, serverId, agentId, memberId, accountUserId, t, format]);
}
