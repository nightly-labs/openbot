import * as Crypto from "expo-crypto";
import { useLocalSearchParams, usePreventZoomTransitionDismissal } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ChatView } from "@/features/chat/components/chat-view";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { projectChannelMessages } from "@/features/chat/model/chat-messages";
import {
  readQueueAttachment,
  removeQueueAttachment,
  writeQueueAttachment,
} from "@/features/chat/model/queue-edit-attachment-files";
import { useApprovalRequests } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { useChannels } from "../components/use-channels";
import { NativeChannelAudience } from "../model/channel-audience-send";
import { ChannelSend } from "../model/channel-send";
import { channelTaskActivities, channelTasksNeedingAction } from "../model/channel-task-actions";

export function ChannelChatScreen() {
  usePreventZoomTransitionDismissal({ unstable_dismissalBoundsRect: { minX: 0, maxX: 24 } });
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  const { session, sessionScope } = useMobileSession();
  const scope = JSON.stringify([session?.apiUrl, session?.user.id, serverId]);
  return (
    <ChannelChat
      key={`${scope}:${sessionScope}:${channelId}`}
      scope={scope}
      channelId={channelId}
      serverId={serverId}
    />
  );
}

function ChannelChat({ channelId, serverId, scope }: { channelId: string; serverId: string; scope: string }) {
  const { t } = useText();
  const { agents, servers } = useMobileWorkspace();
  // A sheet removes focus, but the chat remains mounted behind it. Release history
  // only when this route unmounts; the workspace pauses network reads in the background.
  const state = useChannels(serverId, channelId);
  const page = state.pages.get(channelId);
  const channel = state.channels.find((item) => item.id === channelId) ?? page?.channel;
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const members = useMemo(
    () =>
      agents.filter(
        (agent) => agent.serverId === serverId && channel?.members.some((member) => member.agentId === agent.id),
      ),
    [agents, serverId, channel?.members],
  );
  const messages = useMemo(
    () => projectChannelMessages(page?.messages ?? [], server?.membershipId ?? null),
    [page?.messages, server?.membershipId],
  );
  const activities = useMemo(
    () =>
      online && !channel?.archived
        ? channelTaskActivities(page?.tasks ?? [], page?.messages ?? [], channel?.leadAgentId ?? null)
        : [],
    [online, channel?.archived, channel?.leadAgentId, page?.tasks, page?.messages],
  );
  const serverApprovals = useApprovalRequests(serverId);
  // As on the desktop: a member's approval belongs here while that member runs a task of this channel.
  const approvals = useMemo(() => {
    if (channel?.archived) return [];
    const workers = new Set(
      (page?.tasks ?? []).flatMap((task) => (task.state === "running" && task.ownerAgentId ? [task.ownerAgentId] : [])),
    );
    return serverApprovals.filter((approval) => workers.has(approval.agentId));
  }, [serverApprovals, channel?.archived, page?.tasks]);
  const [audience] = useState(
    () =>
      new NativeChannelAudience(
        state.store,
        scope,
        serverId,
        channelId,
        Crypto.randomUUID,
        {
          get: SecureStore.getItem,
          set: (key, value) =>
            SecureStore.setItem(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        },
        { write: writeQueueAttachment, read: readQueueAttachment, remove: removeQueueAttachment },
      ),
  );
  const audienceState = useSyncExternalStore(audience.subscribe, audience.get);
  useEffect(() => () => audience.dispose(), [audience]);
  const [sender] = useState(() => new ChannelSend(state.store, serverId, channelId, Crypto.randomUUID, audience));
  useEffect(() => () => sender.dispose(), [sender]);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const readThrough = useRef(0);
  const throughSequence = page?.throughSequence ?? 0;
  const markRead = useCallback(() => {
    if (throughSequence <= readThrough.current) return;
    readThrough.current = throughSequence;
    void state.store
      .command(serverId, { type: "read", operationId: Crypto.randomUUID(), channelId, throughSequence })
      .catch(() => {
        readThrough.current = 0;
      });
  }, [state.store, serverId, channelId, throughSequence]);
  const canSend = online && Boolean(channel) && !channel?.archived;
  const [selectedPromptId, selectPrompt] = useState<string | null>(null);
  const pendingPrompts = messages.filter((message) => message.kind === "question" && !message.prompt.resolution);
  const activePrompt = pendingPrompts.find((message) => message.id === selectedPromptId) ?? pendingPrompts[0];
  const promptAuthor = page?.messages.find((message) => message.id === activePrompt?.id)?.author;
  const questionForm = useQuestionPrompt(
    promptAuthor?.kind === "agent" ? promptAuthor.id : "",
    activePrompt?.kind === "question" ? activePrompt : undefined,
    canSend,
    (agentId, input) => state.store.respondToPrompt(serverId, channelId, agentId, input),
  );
  return (
    <ChatView
      target={{
        kind: "channel",
        id: channelId,
        serverId,
        name: channel?.name ?? t("mobile.channel.chat.fallbackName"),
        members,
      }}
      channelAudience={{
        state: audienceState,
        check: audience.check,
        retry: audience.retry,
        close: audience.close,
        cancelPreparation: audience.cancelPreparation,
        stop: audience.stop,
      }}
      channelTasks={page?.tasks ?? []}
      agents={members}
      mentionAgents={members}
      projectedMessages={messages}
      referenceMessages={messages}
      ready={Boolean(page)}
      historyLoadFailed={Boolean(state.error) || (!state.loading && !channel)}
      canSend={canSend}
      readOnly={Boolean(channel?.archived)}
      activities={activities}
      activeTurnId={null}
      questionForm={questionForm}
      onSelectQuestion={selectPrompt}
      approvals={approvals}
      readBoundary={throughSequence ? String(throughSequence) : null}
      markRead={markRead}
      fetchHistory={() => {
        void state.store.refresh(serverId);
      }}
      hasOlder={page?.olderCursor != null}
      olderLoading={olderLoading}
      olderError={olderError}
      loadOlder={() => {
        if (olderLoading) return;
        setOlderLoading(true);
        setOlderError(false);
        void state.store
          .older(serverId, channelId)
          .catch(() => setOlderError(true))
          .finally(() => setOlderLoading(false));
      }}
      send={(body, files, replyToMessageId, upload) =>
        sender.send(body, files, replyToMessageId, channel?.members ?? [], upload)
      }
      notice={channel?.archived ? t("mobile.channel.chat.deletedNotice") : undefined}
      needsAction={channelTasksNeedingAction(page?.tasks ?? []).length > 0 && !channel?.archived}
    />
  );
}
