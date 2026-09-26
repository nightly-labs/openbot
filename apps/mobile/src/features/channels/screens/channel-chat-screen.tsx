import * as Crypto from "expo-crypto";
import { useLocalSearchParams, usePreventZoomTransitionDismissal } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "@/features/chat/components/chat-view";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { projectChannelMessages } from "@/features/chat/model/chat-messages";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { useChannels } from "../components/use-channels";
import { ChannelSend } from "../model/channel-send";
import { channelTaskActivities, channelTasksNeedingAction } from "../model/channel-task-actions";

export function ChannelChatScreen() {
  usePreventZoomTransitionDismissal({ unstable_dismissalBoundsRect: { minX: 0, maxX: 24 } });
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  return <ChannelChat key={`${serverId}:${channelId}`} channelId={channelId} serverId={serverId} />;
}

function ChannelChat({ channelId, serverId }: { channelId: string; serverId: string }) {
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
  const [sender] = useState(() => new ChannelSend(state.store, serverId, channelId, Crypto.randomUUID));
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
