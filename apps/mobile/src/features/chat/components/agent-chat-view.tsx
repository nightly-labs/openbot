import { itemTypeCountsAsUnread } from "@openbot/contracts/conversation-read";
import type { RespondToPromptInput } from "@openbot/contracts/ipc";
import { router, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAgentSteers } from "@/features/agents/model/use-agent-steers";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { ChatChannelWorkRow } from "@/features/channels/components/chat-channel-work-row";
import { useChannelList } from "@/features/channels/components/use-channels";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import { useChatPullPreference, useChatSwipePreference } from "@/features/settings/model/chat-swipe";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import {
  useAgentFirstUnreadMessageId,
  useApprovalRequests,
  useThreadWaits,
} from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { openTurnActivity } from "@/features/workspace/model/agent-activity";
import { sameAgentsApartFromMessage } from "@/features/workspace/model/directory-agents";
import { showsOnline } from "@/features/workspace/model/server-status";
import { hostAwaitsQuestion } from "@/features/workspace/model/thread-waits";
import { currentText, useText } from "@/shared/lib/text";
import {
  chatRowIndex,
  keptIdSet,
  latestReadBoundaryMessage,
  projectChatMessages,
  withFailureReasons,
  withQuestionContext,
} from "../model/chat-messages";
import { requestComposerFocus, requestComposerText } from "../model/composer-requests";
import { messageActionsOpen } from "../model/message-actions-sheet";
import { useAgentMentionReferences } from "../model/use-agent-mention-references";
import { useAgentMentionSkills } from "../model/use-agent-mention-skills";
import { useProgressUpdates } from "../model/use-progress-updates";
import { ChatProviderSignInRow, useProviderSignInNeeded } from "./chat-provider-sign-in-row";
import { MAIN_THREAD_ID, useChatThreadMenu } from "./chat-thread-menu";
import { ChatView } from "./chat-view";
import { useAgentBackdrops } from "./use-agent-backdrops";
import { useBranchThread } from "./use-branch-thread";
import { useChatQueue } from "./use-chat-queue";
import { useComposerContextMeter } from "./use-context-usage";
import { useCoveredByScreen } from "./use-covered-by-screen";
import { useMessageDelete } from "./use-message-delete";
import { useMessagePins } from "./use-message-pins";
import { useOpenAgentTasks } from "./use-open-agent-tasks";
import { useQuestionPrompt } from "./use-question-prompt";

const NO_MESSAGE_IDS: ReadonlySet<string> = new Set();

export function MobileChatView({
  agent,
  focusMessageId,
  onLeave,
}: {
  agent: MobileAgent;
  focusMessageId?: string;
  onLeave: () => void;
}) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const agents = useMobileWorkspaceSelector((current) => current.agents, sameAgentsApartFromMessage);
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === agent.serverId));
  const loadConversation = useMobileWorkspaceSelector((current) => current.loadConversation);
  const loadConversationAround = useMobileWorkspaceSelector((current) => current.loadConversationAround);
  const loadLatestMessages = useMobileWorkspaceSelector((current) => current.loadLatestMessages);
  const loadOlderMessages = useMobileWorkspaceSelector((current) => current.loadOlderMessages);
  const markAgentRead = useMobileWorkspaceSelector((current) => current.markAgentRead);
  const markAgentUnreadFrom = useMobileWorkspaceSelector((current) => current.markAgentUnreadFrom);
  const canMarkUnreadFrom = useMobileWorkspaceSelector((current) => {
    const item = current.servers.find((candidate) => candidate.id === agent.serverId);
    return showsOnline(item) && current.canMarkUnreadFrom(agent.serverId);
  });
  const isFocused = useIsFocused();
  const firstUnreadMessageId = useAgentFirstUnreadMessageId(agent.id);
  const respondToPrompt = useCallback(
    (agentId: string, input: RespondToPromptInput) => workspace().respondToPrompt(agentId, input),
    [workspace],
  );
  const covered = useCoveredByScreen();
  const shownConversation = useRef<ReturnType<typeof conversationStore.get>>(undefined);
  const subscribe = useCallback(
    (notify: () => void) =>
      conversationStore.subscribe(agent.id, () => {
        if (!covered.current) notify();
      }),
    [agent.id, conversationStore, covered],
  );
  const snapshot = useCallback(() => {
    if (!covered.current || !shownConversation.current) shownConversation.current = conversationStore.get(agent.id);
    return shownConversation.current;
  }, [agent.id, conversationStore, covered]);
  const stopTurn = useCallback(
    (turnId: string) => workspace().interruptTurn(agent.id, turnId, agent.serverId),
    [agent.id, agent.serverId, workspace],
  );
  const conversation = useSyncExternalStore(subscribe, snapshot);
  const serverAgents = useMemo(
    () => agents.filter((item) => item.serverId === agent.serverId),
    [agents, agent.serverId],
  );
  const mentionAgents = useMemo(() => serverAgents.filter((item) => item.id !== agent.id), [serverAgents, agent.id]);
  const memberId = server?.membershipId ?? null;
  const accountUserId = useMobileSession().session?.user.id ?? null;
  const progressUpdates = useProgressUpdates(agent.serverId, serverAgents, agent.id);
  useAgentBackdrops({
    serverId: agent.serverId,
    agentId: agent.id,
    messages: conversation?.messages,
    memberId,
    accountUserId,
  });
  const projected = useMemo(
    () =>
      withQuestionContext(
        projectChatMessages(conversation?.messages ?? [], memberId, accountUserId, progressUpdates),
        conversation?.activeTurnId,
      ),
    [conversation?.messages, conversation?.activeTurnId, memberId, accountUserId, progressUpdates],
  );
  const references = useMemo(
    () => projectChatMessages(Object.values(conversation?.references ?? {}), memberId, accountUserId),
    [conversation?.references, memberId, accountUserId],
  );
  const tasks = useOpenAgentTasks(agent.serverId, agent.id);
  const threadMenu = useChatThreadMenu(agent, MAIN_THREAD_ID);
  const contextMeter = useComposerContextMeter({ serverId: agent.serverId, agentId: agent.id });
  const pins = useMessagePins(agent.serverId, agent.id);
  const pinnedMessageIds = useMemo(
    () => new Set(pins.pins.filter((pin) => pin.taskId === null).map((pin) => pin.messageId)),
    [pins.pins],
  );
  const setPinned = pins.setPinned;
  const togglePin = useCallback(
    (messageId: string, pinned: boolean) => setPinned(null, messageId, pinned),
    [setPinned],
  );
  const liveActivity = openTurnActivity(useAgentActivity(agent.id), conversation);
  const threadId = conversation?.threadId ?? null;
  const otherThread = Boolean(liveActivity?.threadId && threadId && liveActivity.threadId !== threadId);
  const channels = useChannelList(agent.serverId);
  const workChannel = otherThread
    ? channels.find(
        (channel) => !channel.archived && channel.threads?.some((thread) => thread.threadId === liveActivity?.threadId),
      )
    : undefined;
  const activity =
    otherThread || (liveActivity?.turnId && tasks.some((task) => task.activeTurnId === liveActivity.turnId))
      ? undefined
      : liveActivity;
  const serverApprovals = useApprovalRequests(agent.serverId);
  const threadWaits = useThreadWaits(agent.serverId);
  const approvals = useMemo(
    () =>
      serverApprovals.filter(
        (approval) => approval.agentId === agent.id && (threadId === null || approval.threadId === threadId),
      ),
    [serverApprovals, agent.id, threadId],
  );
  const online = server?.state === "online";
  const { steers } = useAgentSteers(agent);
  const queue = useChatQueue(
    agent.id,
    agent.serverId,
    online,
    conversation?.activeTurnId ?? null,
    steers,
    conversation?.messages,
  );
  const messages = useMemo(() => withFailureReasons(projected, queue.deliveries), [projected, queue.deliveries]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  const [focus, setFocus] = useState<{ messageId: string; loaded: boolean; unread: boolean } | null>(() =>
    focusMessageId
      ? { messageId: focusMessageId, loaded: false, unread: false }
      : firstUnreadMessageId
        ? { messageId: firstUnreadMessageId, loaded: false, unread: true }
        : null,
  );
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusEnded = useRef(false);
  const clearFocus = useCallback(() => {
    focusEnded.current = true;
    setFocus(null);
  }, []);
  const request = useRef(0);
  const fetchHistory = useCallback(() => {
    if (!online) return;
    const id = ++request.current;
    setHistoryLoadFailed(false);
    const pending = focusRef.current?.loaded === false ? focusRef.current : null;
    const messageId = pending?.messageId ?? null;
    const stored = () =>
      Boolean(messageId && conversationStore.get(agent.id)?.messages.some((message) => message.id === messageId));
    const readLatest = async () => {
      if (conversationStore.isUpToDate(agent.id)) return;
      const kept = Boolean(conversationStore.get(agent.id));
      if (kept) setCatchingUp(true);
      try {
        await loadConversation(agent.id, agent.serverId);
      } finally {
        if (kept && request.current === id) setCatchingUp(false);
      }
    };
    const load = async () => {
      if (pending?.unread) {
        await readLatest();
        if (!stored() && !(await loadConversationAround(agent.id, pending.messageId, agent.serverId))) {
          if (request.current === id) setFocus(null);
          return;
        }
        if (request.current === id)
          setFocus((current) => (current?.messageId === pending.messageId ? { ...current, loaded: true } : current));
        return;
      }
      if (messageId && !stored()) {
        if (!(await loadConversationAround(agent.id, messageId, agent.serverId))) {
          if (request.current === id) setFocus(null);
          await loadLatestMessages(agent.id, agent.serverId);
          return;
        }
      }
      if (messageId && request.current === id)
        setFocus((current) => (current?.messageId === messageId ? { ...current, loaded: true } : current));
      await readLatest();
    };
    void load().catch(() => {
      if (request.current !== id) return;
      setHistoryLoadFailed(true);
      setFocus(null);
    });
  }, [
    agent.id,
    agent.serverId,
    online,
    conversationStore,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
  ]);
  useEffect(() => {
    fetchHistory();
    return () => {
      request.current += 1;
      setCatchingUp(false);
    };
  }, [fetchHistory]);
  useEffect(() => {
    if (!firstUnreadMessageId || focusRef.current || focusEnded.current || conversation) return;
    const next = { messageId: firstUnreadMessageId, loaded: false, unread: true };
    focusRef.current = next;
    setFocus(next);
    fetchHistory();
  }, [firstUnreadMessageId, conversation, fetchHistory]);
  const detached = conversation?.detached ?? false;
  const focusRowMissing = focus?.loaded === true && !focus.unread && chatRowIndex(messages, focus.messageId) < 0;
  useEffect(() => {
    if (!focusRowMissing) return;
    setFocus(null);
    if (detached) void loadLatestMessages(agent.id, agent.serverId).catch(() => undefined);
  }, [focusRowMissing, detached, agent.id, agent.serverId, loadLatestMessages]);
  const showLatestMessages = useCallback(
    () => loadLatestMessages(agent.id, agent.serverId),
    [agent.id, agent.serverId, loadLatestMessages],
  );
  const loadOlder = useCallback(() => {
    void loadOlderMessages(agent.id, agent.serverId);
  }, [agent.id, agent.serverId, loadOlderMessages]);
  const target = useMemo(() => ({ ...agent, kind: "agent" as const }), [agent]);
  const liveConversation = useMemo(
    () => ({ messages: conversation?.messages ?? [], activeTurnId: conversation?.activeTurnId ?? null }),
    [conversation?.messages, conversation?.activeTurnId],
  );
  const latest = latestReadBoundaryMessage(conversation?.messages ?? []);
  const latestId = latest?.id;
  const readHeldFor = useRef<{ agentId: string; shown: boolean } | null>(null);
  const [unreadLine, setUnreadLine] = useState<{ agentId: string; messageId: string } | null>(() =>
    firstUnreadMessageId ? { agentId: agent.id, messageId: firstUnreadMessageId } : null,
  );
  const unreadLineSettledFor = useRef<string | null>(null);
  useEffect(() => {
    const held = readHeldFor.current;
    if (isFocused) {
      if (held) held.shown = true;
      return;
    }
    unreadLineSettledFor.current = null;
    if (held?.shown && !messageActionsOpen()) readHeldFor.current = null;
  }, [isFocused]);
  useEffect(() => {
    if (firstUnreadMessageId && unreadLineSettledFor.current !== agent.id)
      setUnreadLine({ agentId: agent.id, messageId: firstUnreadMessageId });
  }, [agent.id, firstUnreadMessageId]);
  const markRead = useCallback(() => {
    if (!latestId || readHeldFor.current?.agentId === agent.id) return;
    unreadLineSettledFor.current = agent.id;
    markAgentRead(agent.id, latestId, agent.serverId);
  }, [agent.id, agent.serverId, latestId, markAgentRead]);
  const markUnread = useCallback(
    (messageId: string) => {
      const agentId = agent.id;
      readHeldFor.current = { agentId, shown: false };
      setUnreadLine({ agentId, messageId });
      markAgentUnreadFrom(agentId, messageId, agent.serverId).catch((error: unknown) => {
        if (readHeldFor.current?.agentId === agentId) readHeldFor.current = null;
        setUnreadLine((current) => (current?.messageId === messageId ? null : current));
        const text = currentText();
        showFailureAlert(
          error,
          "settings",
          text.t("mobile.workspace.alert.markUnreadTitle"),
          text.t("mobile.workspace.alert.markUnreadBody"),
        );
      });
    },
    [agent.id, agent.serverId, markAgentUnreadFrom],
  );
  const lastMarkUnreadIds = useRef<ReadonlySet<string>>(NO_MESSAGE_IDS);
  const markUnreadMessageIds = useMemo(() => {
    const ids = (conversation?.messages ?? [])
      .filter((message) => message.author !== "user" && itemTypeCountsAsUnread(message.itemType))
      .map((message) => message.id);
    lastMarkUnreadIds.current = keptIdSet(lastMarkUnreadIds.current, ids);
    return lastMarkUnreadIds.current;
  }, [conversation?.messages]);
  const unreadLineMessageId = unreadLine?.agentId === agent.id ? unreadLine.messageId : null;
  const lastUnreadLineIds = useRef<ReadonlySet<string> | null>(null);
  const unreadLineMessageIds = useMemo(() => {
    const all = conversation?.messages ?? [];
    const start = unreadLineMessageId ? all.findIndex((message) => message.id === unreadLineMessageId) : -1;
    lastUnreadLineIds.current =
      start < 0
        ? null
        : keptIdSet(
            lastUnreadLineIds.current,
            all.slice(start).map((message) => message.id),
          );
    return lastUnreadLineIds.current;
  }, [unreadLineMessageId, conversation?.messages]);
  const activePrompt = messages.findLast(
    (message) =>
      message.kind === "question" &&
      !message.prompt.resolution &&
      ((Boolean(conversation?.activeTurnId) && message.turnId === conversation?.activeTurnId) ||
        hostAwaitsQuestion(threadWaits, agent.id, message.turnId, message.prompt.requestId)),
  );
  const viewOnly = useAgentViewOnly(agent.serverId, agent.id);
  const messageDelete = useMessageDelete(agent.serverId, { kind: "agent", agentId: agent.id });
  const channelKey = useMemo(
    () =>
      JSON.stringify(
        channels.filter((channel) => !channel.archived).map((channel) => ({ id: channel.id, name: channel.name })),
      ),
    [channels],
  );
  const sendToChannel = useMemo(() => {
    const open: { id: string; name: string }[] = JSON.parse(channelKey);
    if (open.length === 0) return undefined;
    const serverId = agent.serverId;
    return {
      channels: open,
      onSend: (channelId: string, text: string) => {
        requestComposerText({ serverId, channelId, text });
        requestComposerFocus({ serverId, channelId });
        router.push({ pathname: "/channel/[channelId]", params: { channelId, serverId } });
      },
    };
  }, [channelKey, agent.serverId]);
  const branching = useBranchThread({
    serverId: agent.serverId,
    agentId: agent.id,
    sourceTaskId: null,
    messages: conversation?.messages,
    activeTurnId: conversation?.activeTurnId ?? null,
  });
  const mentionSkills = useAgentMentionSkills(agent.id, agent.serverId, showsOnline(server));
  const mentionReferences = useAgentMentionReferences(agent.serverId, agent.id);
  const questionForm = useQuestionPrompt(
    agent.id,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    showsOnline(server) && !viewOnly,
    respondToPrompt,
  );
  const swipeAction = useChatSwipePreference((state) => state.action);
  const browserAllowed = useBrowserFeature();
  const browserView = useMobileWorkspaceSelector((current) => current.browserViewSupport(agent.serverId).view);
  const browserShown = browserAllowed && showsOnline(server) && browserView;
  const threadsShown = threadMenu !== undefined;
  const sideQuestionShown = useMobileWorkspaceSelector((current) => current.canAskSideQuestion(agent.serverId));
  const swipeForward = useMemo(() => {
    const params = { agentId: agent.id, serverId: agent.serverId };
    if (swipeAction === "off") return null;
    if (swipeAction === "question" && sideQuestionShown)
      return () => router.push({ pathname: "/side-question/[agentId]", params });
    if (swipeAction === "threads" || swipeAction === "question")
      return threadsShown ? () => router.push({ pathname: "/server-tasks", params }) : null;
    return browserShown ? () => router.push({ pathname: "/browser/[agentId]", params }) : null;
  }, [swipeAction, sideQuestionShown, threadsShown, browserShown, agent.id, agent.serverId]);
  const pullOn = useChatPullPreference((state) => state.enabled);
  const openInfo = useCallback(
    () => router.push({ pathname: "/agent-info/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } }),
    [agent.id, agent.serverId],
  );
  const workActivity = workChannel ? liveActivity : undefined;
  const signInProvider = useProviderSignInNeeded(agent.serverId, agent.provider) ? agent.provider : undefined;
  const activityAccessory = useMemo(
    () =>
      workChannel && workActivity ? (
        <>
          {signInProvider ? <ChatProviderSignInRow serverId={agent.serverId} provider={signInProvider} /> : null}
          <ChatChannelWorkRow channel={workChannel} activity={workActivity} serverId={agent.serverId} />
        </>
      ) : signInProvider ? (
        <ChatProviderSignInRow serverId={agent.serverId} provider={signInProvider} />
      ) : null,
    [workChannel, workActivity, agent.serverId, signInProvider],
  );
  return (
    <ChatView
      target={target}
      queue={queue}
      agents={serverAgents}
      mentionAgents={mentionAgents}
      mentionSkills={mentionSkills}
      mentionReferences={mentionReferences}
      projectedMessages={messages}
      referenceMessages={references}
      ready={Boolean(conversation)}
      historyLoadFailed={historyLoadFailed}
      canSend={!viewOnly}
      notice={viewOnly ? t("mobile.chat.viewOnly") : null}
      activity={activity}
      activeTurnId={conversation?.activeTurnId ?? null}
      conversation={liveConversation}
      stopTurn={stopTurn}
      branchPoints={branching.branchPoints}
      onBranch={branching.branch}
      deleteMessage={messageDelete.deleteMessage}
      deletesAnyMessage={messageDelete.deletesAny}
      markUnread={canMarkUnreadFrom ? markUnread : undefined}
      markUnreadMessageIds={markUnreadMessageIds}
      togglePin={pins.enabled ? togglePin : undefined}
      pinnedMessageIds={pinnedMessageIds}
      unreadLineMessageIds={unreadLineMessageIds}
      sendToChannel={sendToChannel}
      questionForm={questionForm}
      activityAccessory={activityAccessory}
      threadMenu={threadMenu}
      contextMeter={contextMeter}
      threadId={threadId}
      approvals={approvals}
      readBoundary={latest ? `${latest.id}:${latest.status}` : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={conversation?.pageInfo.hasOlder ?? false}
      olderLoading={conversation?.olderLoading ?? false}
      olderError={conversation?.olderError ?? false}
      loadOlder={loadOlder}
      focusMessageId={focus && (!focus.unread || focus.loaded) ? focus.messageId : null}
      focusUnread={focus?.unread ?? false}
      holdOpening={focus !== null && online}
      catchingUp={catchingUp}
      onFocusPlaced={clearFocus}
      detached={detached}
      showLatestMessages={showLatestMessages}
      onLeave={onLeave}
      onSwipeForward={swipeForward}
      onPullPastEnd={pullOn ? openInfo : null}
    />
  );
}
