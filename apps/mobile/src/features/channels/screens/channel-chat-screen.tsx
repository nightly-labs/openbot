import type { RespondToPromptInput } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "@/features/chat/components/chat-view";
import { useLeaveChat } from "@/features/chat/components/use-leave-chat";
import { useMessageDelete } from "@/features/chat/components/use-message-delete";
import { useQuestionPrompt } from "@/features/chat/components/use-question-prompt";
import { projectChannelMessages } from "@/features/chat/model/chat-messages";
import { appendComposerDraft } from "@/features/chat/model/composer-drafts";
import { type TurnStepsSummary, unansweredChannelTurnSummaries } from "@/features/chat/model/turn-thinking";
import { useProgressUpdates } from "@/features/chat/model/use-progress-updates";
import { useChatPullPreference } from "@/features/settings/model/chat-swipe";
import {
  useApprovalRequests,
  useBrowserRequests,
  useThreadWaits,
} from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity, MobileAgentWaitReason } from "@/features/workspace/model/agent-activity";
import { sameAgentsApartFromMessage } from "@/features/workspace/model/directory-agents";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";
import { useChannel } from "../components/use-channels";
import { channelTaskActivities, channelTasksNeedingAction } from "../model/channel-task-actions";
import { firstUnreadChannelMessageId } from "../model/channel-unread";

export function ChannelChatScreen() {
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  return <ChannelChat key={`${serverId}:${channelId}`} channelId={channelId} serverId={serverId} />;
}

function ChannelChat({ channelId, serverId }: { channelId: string; serverId: string }) {
  const { t, sourceText } = useText();
  const leaveChat = useLeaveChat();
  const agents = useMobileWorkspaceSelector((current) => current.agents, sameAgentsApartFromMessage);
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === serverId));
  const state = useChannel(serverId, channelId);
  const page = state.page;
  const summary = state.summary;
  const channel = summary ?? page?.channel;
  const online = server?.state === "online";
  const archived = Boolean(channel?.archived);
  const serverAgents = useMemo(() => agents.filter((agent) => agent.serverId === serverId), [agents, serverId]);
  const members = useMemo(
    () => serverAgents.filter((agent) => channel?.members.some((member) => member.agentId === agent.id)),
    [serverAgents, channel?.members],
  );
  const progressUpdates = useProgressUpdates(serverId, serverAgents);
  const messages = useMemo(
    () =>
      projectChannelMessages(
        page?.messages ?? [],
        page?.tasks ?? [],
        server?.membershipId ?? null,
        sourceText,
        progressUpdates,
      ),
    [page?.messages, page?.tasks, server?.membershipId, sourceText, progressUpdates],
  );
  const threadIds = useMemo(
    () => (summary?.threads?.length ? new Set(summary.threads.map((thread) => thread.threadId)) : null),
    [summary?.threads],
  );
  const threadWaits = useThreadWaits(serverId);
  const liveQuestions = useMemo(() => {
    if (!online || archived || !threadIds || !page) return [];
    const key = (agentId: string, turnId: string | undefined, requestId: string | number) =>
      `${agentId}\n${turnId ?? ""}\n${String(requestId)}`;
    const saved = new Set(
      page.messages.flatMap((entry) =>
        entry.message.questionPrompt
          ? [key(entry.author.id, entry.message.turnId, entry.message.questionPrompt.requestId)]
          : [],
      ),
    );
    return threadWaits.flatMap(({ reason, questions, agentId, requestId, threadId, turnId }) =>
      reason === "question" && questions && threadIds.has(threadId) && !saved.has(key(agentId, turnId, requestId))
        ? [
            {
              agentId,
              message: {
                id: `question-prompt:${turnId}:${String(requestId)}`,
                kind: "question" as const,
                turnId,
                prompt: { requestId, questions, resolution: null },
              },
            },
          ]
        : [],
    );
  }, [online, archived, threadIds, page, threadWaits]);
  const shownMessages = useMemo(
    () => (liveQuestions.length > 0 ? [...messages, ...liveQuestions.map((question) => question.message)] : messages),
    [messages, liveQuestions],
  );
  const serverApprovals = useApprovalRequests(serverId);
  const approvals = useMemo(() => {
    if (archived) return [];
    if (threadIds) return serverApprovals.filter((approval) => threadIds.has(approval.threadId));
    const workers = new Set(
      (page?.tasks ?? []).flatMap((task) => (task.state === "running" && task.ownerAgentId ? [task.ownerAgentId] : [])),
    );
    return serverApprovals.filter((approval) => workers.has(approval.agentId));
  }, [serverApprovals, archived, threadIds, page?.tasks]);
  const serverBrowserRequests = useBrowserRequests(serverId);
  const memberWork = useMemo(() => {
    if (archived) return [];
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
    for (const question of liveQuestions) waits.set(question.agentId, "question");
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
    archived,
    channel?.leadAgentId,
    page?.tasks,
    page?.messages,
    approvals,
    serverBrowserRequests,
    threadIds,
    liveQuestions,
  ]);
  const activities = useMemo(() => (online ? memberWork : []), [online, memberWork]);
  const statusNotes = useMemo(() => {
    if (archived || !online) return [];
    const notes = (page?.waits ?? []).flatMap((wait) => {
      const name = serverAgents.find((agent) => agent.id === wait.agentId)?.name;
      if (!name) return [];
      return wait.reason === "agent-busy"
        ? [t("mobile.channel.chat.waitBusy", { name, channel: wait.channelName })]
        : [t("mobile.channel.chat.waitFull", { name })];
    });
    return [...new Set(notes)];
  }, [archived, online, page?.waits, serverAgents, t]);
  const lastTurnSummaries = useRef<ReadonlyMap<string, TurnStepsSummary> | undefined>(undefined);
  const turnSummaries = useMemo(() => {
    const entries = page?.messages ?? [];
    const latestTurns = new Map<string, string>();
    for (const entry of entries)
      if (entry.author.kind === "agent" && entry.message.turnId) latestTurns.set(entry.author.id, entry.message.turnId);
    lastTurnSummaries.current = unansweredChannelTurnSummaries(
      entries,
      (turnId, agentId) =>
        memberWork.some(
          (activity) => activity.agentId === agentId && (activity.turnId ?? latestTurns.get(agentId)) === turnId,
        ),
      lastTurnSummaries.current,
    );
    return lastTurnSummaries.current;
  }, [page?.messages, memberWork]);
  const [unreadLine, setUnreadLine] = useState<{ messageId: string | null } | null>(null);
  const [freshPage, setFreshPage] = useState<"waiting" | "loaded" | "failed">("waiting");
  const hasUnread = (summary?.unreadCount ?? 0) > 0;
  const store = state.store;
  const readsPage = online && hasUnread && unreadLine === null;
  useEffect(() => {
    if (!readsPage) return;
    let active = true;
    void store.refreshHistory(serverId, channelId).then(
      () => active && setFreshPage("loaded"),
      () => active && setFreshPage("failed"),
    );
    return () => {
      active = false;
    };
  }, [readsPage, store, serverId, channelId]);
  if (
    unreadLine === null &&
    (state.listed || state.error) &&
    page &&
    summary &&
    (!hasUnread || freshPage !== "waiting")
  )
    setUnreadLine({
      messageId:
        freshPage === "failed"
          ? null
          : firstUnreadChannelMessageId(page.messages, summary.unreadCount, server?.membershipId ?? null),
    });
  const unreadLineMessageId = unreadLine?.messageId ?? null;
  const unreadLineMessageIds = useMemo(() => {
    const entries = page?.messages ?? [];
    const start = unreadLineMessageId ? entries.findIndex((entry) => entry.id === unreadLineMessageId) : -1;
    return start < 0 ? null : new Set(entries.slice(start).map((entry) => entry.id));
  }, [unreadLineMessageId, page?.messages]);
  const [unreadOpening, setUnreadOpening] = useState<"pending" | "done">("pending");
  const placeUnreadLine = useCallback(() => setUnreadOpening("done"), []);
  const opensAtUnread = unreadOpening === "pending" && online && (readsPage || unreadLineMessageIds !== null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const readThrough = useRef(0);
  const throughSequence = page?.throughSequence ?? 0;
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
  const canSend = Boolean(channel) && !archived;
  const messageDelete = useMessageDelete(serverId, { kind: "channel", channelId });
  const [selectedPromptId, selectPrompt] = useState<string | null>(null);
  const pendingPrompts = shownMessages.filter((message) => message.kind === "question" && !message.prompt.resolution);
  const activePrompt = pendingPrompts.find((message) => message.id === selectedPromptId) ?? pendingPrompts[0];
  const savedAuthor = page?.messages.find((message) => message.id === activePrompt?.id)?.author;
  const promptAgentId = savedAuthor
    ? savedAuthor.kind === "agent"
      ? savedAuthor.id
      : ""
    : (liveQuestions.find((question) => question.message.id === activePrompt?.id)?.agentId ?? "");
  const respondToPrompt = useCallback(
    (agentId: string, input: RespondToPromptInput) => store.respondToPrompt(serverId, channelId, agentId, input),
    [store, serverId, channelId],
  );
  const returnUnsentPreview = useCallback(
    (text: string) => appendComposerDraft({ kind: "channel", serverId, id: channelId }, text),
    [serverId, channelId],
  );
  const questionForm = useQuestionPrompt(
    promptAgentId,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    showsOnline(server) && canSend,
    respondToPrompt,
    returnUnsentPreview,
  );
  const liveChannel = useMemo(
    () => ({ messages: page?.messages ?? [], tasks: page?.tasks ?? [], leadAgentId: channel?.leadAgentId ?? null }),
    [page?.messages, page?.tasks, channel?.leadAgentId],
  );
  const name = channel?.name ?? t("mobile.channel.chat.fallbackName");
  const target = useMemo(
    () => ({
      kind: "channel" as const,
      id: channelId,
      serverId,
      name,
      members,
      icon: channel?.icon,
      imageUrl: channel?.imageUrl,
    }),
    [channelId, serverId, name, members, channel?.icon, channel?.imageUrl],
  );
  const pullOn = useChatPullPreference((state) => state.enabled);
  const openInfo = useCallback(
    () => router.push({ pathname: "/channel-info/[channelId]", params: { channelId, serverId } }),
    [channelId, serverId],
  );
  return (
    <ChatView
      target={target}
      agents={serverAgents}
      mentionAgents={members}
      projectedMessages={shownMessages}
      referenceMessages={messages}
      ready={Boolean(page)}
      historyLoadFailed={Boolean(state.error) || (!state.loading && !channel)}
      canSend={canSend}
      readOnly={archived}
      deleteMessage={messageDelete.deleteMessage}
      deletesAnyMessage={messageDelete.deletesAny}
      notice={archived ? t("mobile.channel.chat.deletedNotice") : null}
      statusNotes={statusNotes}
      activities={activities}
      activeTurnId={null}
      liveChannel={liveChannel}
      questionForm={questionForm}
      onSelectQuestion={selectPrompt}
      approvals={approvals}
      channelThreadIds={threadIds}
      unreadLineMessageIds={unreadLineMessageIds}
      focusMessageId={opensAtUnread && unreadLineMessageIds ? unreadLineMessageId : null}
      focusUnread
      holdOpening={opensAtUnread}
      onFocusPlaced={placeUnreadLine}
      readBoundary={throughSequence ? String(throughSequence) : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={page?.olderCursor != null}
      olderLoading={olderLoading}
      olderError={olderError}
      loadOlder={loadOlder}
      needsAction={channelTasksNeedingAction(page?.tasks ?? []).length > 0}
      channelLeadAgentId={channel?.leadAgentId ?? null}
      channelTurnSummaries={turnSummaries}
      onLeave={leaveChat}
      onPullPastEnd={pullOn ? openInfo : null}
    />
  );
}
