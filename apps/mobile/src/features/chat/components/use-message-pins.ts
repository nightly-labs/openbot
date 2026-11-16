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

/** The key of one pin: its chat (the side thread, or the agent's own chat) and its message. */
function pinKey(taskId: string | null, messageId: string): string {
  return `${taskId ?? ""}:${messageId}`;
}

/** True when `serverId` is online and keeps pinned messages (`message-pins-v1`). */
export function useMessagePinsEnabled(serverId: string): boolean {
  return useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canPinMessages(serverId),
  );
}

/**
 * The pinned messages of all chats of one agent, the newest pin first, and Pin or Unpin on one
 * message. The host sends `message-pins-changed` when a pin of the agent changes, also from the agent
 * or another device, and the list reads again. A host without `message-pins-v1` has no pins.
 */
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
  /** Pins or unpins one message. The host answers the new list. A failure rejects and keeps the list. */
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

/** One pin as the list shows it. The names and the time are in the reader's language. */
export interface PinnedMessageRow {
  key: string;
  pin: PinnedMessage;
  author: string;
  time: string;
  text: string;
  /** The chat of the pin when it is not the chat in view: "Main chat", or the title of the side thread. */
  chat: string | null;
  /** Who pinned the message, or null when the reader did. */
  pinnedBy: string | null;
}

/**
 * The pins as rows: the pins of the chat in view (`viewTaskId`, null for the agent's own chat) first,
 * then the others, each part with the newest pin first, as on desktop.
 */
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
    // As in the chat: a message with no sender is the reader's own, and a host with no membership for
    // its own user stamps `local-user:<account>`.
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
