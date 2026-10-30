import type { RespondToPromptInput } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ChatView } from "@/features/chat/components/chat-view";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { projectChannelMessages } from "@/features/chat/model/chat-messages";
import { useApprovalRequests, useBrowserRequests } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity, MobileAgentWaitReason } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";
import { useChannels } from "../components/use-channels";
import { channelTaskActivities, channelTasksNeedingAction } from "../model/channel-task-actions";

export function ChannelChatScreen() {
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  return <ChannelChat key={`${serverId}:${channelId}`} channelId={channelId} serverId={serverId} />;
}

function ChannelChat({ channelId, serverId }: { channelId: string; serverId: string }) {
  const { t } = useText();
  const leaveChat = useLeaveChat();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === serverId));
  // A sheet removes focus, but the chat remains mounted behind it. Release history
  // only when this route unmounts; the workspace pauses network reads in the background.
  const state = useChannels(serverId, channelId);
  const page = state.pages.get(channelId);
  const summary = state.channels.find((item) => item.id === channelId);
  const channel = summary ?? page?.channel;
  const online = server?.state === "online";
  const archived = Boolean(channel?.archived);
  const serverAgents = useMemo(() => agents.filter((agent) => agent.serverId === serverId), [agents, serverId]);
  const members = useMemo(
    () => serverAgents.filter((agent) => channel?.members.some((member) => member.agentId === agent.id)),
    [serverAgents, channel?.members],
  );
  const messages = useMemo(
    () => projectChannelMessages(page?.messages ?? [], server?.membershipId ?? null),
    [page?.messages, server?.membershipId],
  );
  // A host with channel-attention-v1 names the thread of each member in this channel. A request on
  // one of them belongs here, and not in the agent's own chat.
  const threadIds = useMemo(
    () => (summary?.threads?.length ? new Set(summary.threads.map((thread) => thread.threadId)) : null),
    [summary?.threads],
  );
  const serverApprovals = useApprovalRequests(serverId);
  const approvals = useMemo(() => {
    if (archived) return [];
    if (threadIds) return serverApprovals.filter((approval) => threadIds.has(approval.threadId));
    // An older host: as on the desktop, a member's approval belongs here while that member runs a task of this channel.
    const workers = new Set(
      (page?.tasks ?? []).flatMap((task) => (task.state === "running" && task.ownerAgentId ? [task.ownerAgentId] : [])),
    );
    return serverApprovals.filter((approval) => workers.has(approval.agentId));
  }, [serverApprovals, archived, threadIds, page?.tasks]);
  const serverBrowserRequests = useBrowserRequests(serverId);
  // A member that asks in this channel waits for the person, and its row says what for.
  const activities = useMemo(() => {
    if (!online || archived) return [];
    const working = channelTaskActivities(page?.tasks ?? [], page?.messages ?? [], channel?.leadAgentId ?? null);
    const waits = new Map<string, MobileAgentWaitReason>();
    for (const approval of approvals) waits.set(approval.agentId, "approval");
    for (const request of serverBrowserRequests)
      if (threadIds?.has(request.threadId)) waits.set(request.agentId, "takeover");
    for (const entry of page?.messages ?? [])
      if (
        entry.author.kind === "agent" &&
        !entry.superseded &&
        entry.message.questionPrompt &&
        !entry.message.questionPrompt.resolution
      )
        waits.set(entry.author.id, "question");
    if (waits.size === 0) return working;
    const waiting = (activity: MobileAgentActivity, reason: MobileAgentWaitReason): MobileAgentActivity => ({
      ...activity,
      phase: "waiting",
      detail: null,
      reason,
    });
    const next = working.map((activity) => {
      const reason = activity.agentId ? waits.get(activity.agentId) : undefined;
      return reason ? waiting(activity, reason) : activity;
    });
    for (const [agentId, reason] of waits)
      if (!next.some((activity) => activity.agentId === agentId))
        next.push(waiting({ agentId, turnId: null, phase: "working", detail: null }, reason));
    return next;
  }, [
    online,
    archived,
    channel?.leadAgentId,
    page?.tasks,
    page?.messages,
    approvals,
    serverBrowserRequests,
    threadIds,
  ]);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const readThrough = useRef(0);
  const throughSequence = page?.throughSequence ?? 0;
  const store = state.store;
  const markRead = useCallback(() => {
    if (throughSequence <= readThrough.current) return;
    readThrough.current = throughSequence;
    void store
      .command(serverId, { type: "read", operationId: Crypto.randomUUID(), channelId, throughSequence })
      .catch(() => {
        readThrough.current = 0;
      });
  }, [store, serverId, channelId, throughSequence]);
  const fetchHistory = useCallback(() => {
    void store.refresh(serverId);
  }, [store, serverId]);
  const loadOlder = useCallback(() => {
    if (olderLoading) return;
    setOlderLoading(true);
    setOlderError(false);
    void store
      .older(serverId, channelId)
      .catch(() => setOlderError(true))
      .finally(() => setOlderLoading(false));
  }, [store, serverId, channelId, olderLoading]);
  // The phone keeps a message while the server is offline and sends it when it is back.
  const canSend = Boolean(channel) && !archived;
  const [selectedPromptId, selectPrompt] = useState<string | null>(null);
  const pendingPrompts = messages.filter((message) => message.kind === "question" && !message.prompt.resolution);
  const activePrompt = pendingPrompts.find((message) => message.id === selectedPromptId) ?? pendingPrompts[0];
  const promptAuthor = page?.messages.find((message) => message.id === activePrompt?.id)?.author;
  const respondToPrompt = useCallback(
    (agentId: string, input: RespondToPromptInput) => store.respondToPrompt(serverId, channelId, agentId, input),
    [store, serverId, channelId],
  );
  const questionForm = useQuestionPrompt(
    promptAuthor?.kind === "agent" ? promptAuthor.id : "",
    activePrompt?.kind === "question" ? activePrompt : undefined,
    showsOnline(server) && canSend,
    respondToPrompt,
  );
  // A voice conversation in the channel shows the leader, then the member that gets the task, and
  // reads the first answer.
  const liveChannel = useMemo(
    () => ({ messages: page?.messages ?? [], tasks: page?.tasks ?? [], leadAgentId: channel?.leadAgentId ?? null }),
    [page?.messages, page?.tasks, channel?.leadAgentId],
  );
  const name = channel?.name ?? t("mobile.channel.chat.fallbackName");
  const target = useMemo(
    () => ({ kind: "channel" as const, id: channelId, serverId, name, members }),
    [channelId, serverId, name, members],
  );
  return (
    <ChatView
      target={target}
      agents={serverAgents}
      mentionAgents={members}
      projectedMessages={messages}
      referenceMessages={messages}
      ready={Boolean(page)}
      historyLoadFailed={Boolean(state.error) || (!state.loading && !channel)}
      canSend={canSend}
      readOnly={archived}
      notice={archived ? t("mobile.channel.chat.deletedNotice") : null}
      activities={activities}
      activeTurnId={null}
      liveChannel={liveChannel}
      questionForm={questionForm}
      onSelectQuestion={selectPrompt}
      approvals={approvals}
      channelThreadIds={threadIds}
      readBoundary={throughSequence ? String(throughSequence) : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={page?.olderCursor != null}
      olderLoading={olderLoading}
      olderError={olderError}
      loadOlder={loadOlder}
      needsAction={channelTasksNeedingAction(page?.tasks ?? []).length > 0}
      channelLeadAgentId={channel?.leadAgentId ?? null}
      onLeave={leaveChat}
    />
  );
}
