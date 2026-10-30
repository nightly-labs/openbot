import type { RespondToPromptInput } from "@openbot/contracts/ipc";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ChatChannelWorkRow } from "@/features/channels/components/chat-channel-work-row";
import { useChannels } from "@/features/channels/components/use-channels";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useApprovalRequests } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { openTurnActivity } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useText } from "@/shared/lib/text";
import { chatRowIndex, latestReadableMessage, projectChatMessages, withFailureReasons } from "../model/chat-messages";
import { useAgentMentionSkills } from "../model/use-agent-mention-skills";
import { MAIN_THREAD_ID, useChatThreadMenu } from "./chat-thread-menu";
import { ChatView } from "./chat-view";
import { useChatQueue } from "./use-chat-queue";
import { useOpenAgentTasks } from "./use-open-agent-tasks";
import { useQuestionPrompt } from "./use-question-prompt";

/** `focusMessageId` opens the chat at a message from search instead of at the latest message. */
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
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === agent.serverId));
  const loadConversation = useMobileWorkspaceSelector((current) => current.loadConversation);
  const loadConversationAround = useMobileWorkspaceSelector((current) => current.loadConversationAround);
  const loadLatestMessages = useMobileWorkspaceSelector((current) => current.loadLatestMessages);
  const loadOlderMessages = useMobileWorkspaceSelector((current) => current.loadOlderMessages);
  const markAgentRead = useMobileWorkspaceSelector((current) => current.markAgentRead);
  const respondToPrompt = useCallback(
    (agentId: string, input: RespondToPromptInput) => workspace().respondToPrompt(agentId, input),
    [workspace],
  );
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agent.id, notify),
    [agent.id, conversationStore],
  );
  const snapshot = useCallback(() => conversationStore.get(agent.id), [agent.id, conversationStore]);
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
  const projected = useMemo(
    () => projectChatMessages(conversation?.messages ?? [], memberId, accountUserId),
    [conversation?.messages, memberId, accountUserId],
  );
  const references = useMemo(
    () => projectChatMessages(Object.values(conversation?.references ?? {}), memberId, accountUserId),
    [conversation?.references, memberId, accountUserId],
  );
  const tasks = useOpenAgentTasks(agent.serverId, agent.id);
  const threadMenu = useChatThreadMenu(agent, MAIN_THREAD_ID);
  const liveActivity = openTurnActivity(useAgentActivity(agent.id), conversation);
  const threadId = conversation?.threadId ?? null;
  // A turn on another thread, such as channel work, is not this chat's work, as on desktop. A host
  // with channel-attention-v1 names the channel of the thread, and a row below opens it.
  const otherThread = Boolean(liveActivity?.threadId && threadId && liveActivity.threadId !== threadId);
  const channels = useChannels(agent.serverId).channels;
  const workChannel = otherThread
    ? channels.find(
        (channel) => !channel.archived && channel.threads?.some((thread) => thread.threadId === liveActivity?.threadId),
      )
    : undefined;
  // A thread's turn is the thread's work, not this chat's: the thread menu shows it.
  const activity =
    otherThread || (liveActivity?.turnId && tasks.some((task) => task.activeTurnId === liveActivity.turnId))
      ? undefined
      : liveActivity;
  const serverApprovals = useApprovalRequests(agent.serverId);
  // As on the desktop, only this chat's thread. A channel task of the same agent asks in the channel.
  const approvals = useMemo(
    () =>
      serverApprovals.filter(
        (approval) => approval.agentId === agent.id && (threadId === null || approval.threadId === threadId),
      ),
    [serverApprovals, agent.id, threadId],
  );
  // The history and the queue load again when the connection is back, so they read the live state.
  const online = server?.state === "online";
  const queue = useChatQueue(
    agent.id,
    agent.serverId,
    online,
    conversation?.activeTurnId ?? null,
    conversation?.messages,
  );
  const messages = useMemo(() => withFailureReasons(projected, queue.deliveries), [projected, queue.deliveries]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  // The message from search, until the chat shows it. `loaded` is set when its page is in the store.
  const [focus, setFocus] = useState(focusMessageId ? { messageId: focusMessageId, loaded: false } : null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const clearFocus = useCallback(() => setFocus(null), []);
  const request = useRef(0);
  const fetchHistory = useCallback(() => {
    if (!online) return;
    const id = ++request.current;
    setHistoryLoadFailed(false);
    const messageId = focusRef.current?.loaded === false ? focusRef.current.messageId : null;
    const load = async () => {
      if (messageId && !conversationStore.get(agent.id)?.messages.some((message) => message.id === messageId)) {
        if (!(await loadConversationAround(agent.id, messageId, agent.serverId))) {
          // The host no longer has the message. The chat opens at the latest message.
          if (request.current === id) setFocus(null);
          await loadLatestMessages(agent.id, agent.serverId);
          return;
        }
      }
      // The list can show the message, and clear the focus, before the request ends.
      if (messageId && request.current === id)
        setFocus((current) => (current?.messageId === messageId ? { messageId, loaded: true } : current));
      // Events keep a loaded chat up to date while the connection stays, so it opens without a read.
      if (conversationStore.isUpToDate(agent.id)) return;
      // The chat shows the messages that the phone kept while the latest page loads.
      const kept = Boolean(conversationStore.get(agent.id));
      if (kept) setCatchingUp(true);
      try {
        // A latest page that meets the window around the message joins the two.
        await loadConversation(agent.id, agent.serverId);
      } finally {
        if (kept && request.current === id) setCatchingUp(false);
      }
    };
    void load().catch(() => {
      if (request.current !== id) return;
      setHistoryLoadFailed(true);
      // Show what the phone has rather than wait for a message that did not load.
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
      // A run that ends after this cleanup does not clear the flag.
      setCatchingUp(false);
    };
  }, [fetchHistory]);
  const detached = conversation?.detached ?? false;
  // A message in the store that the chat shows no row for, such as a thinking step.
  const focusRowMissing = focus?.loaded === true && chatRowIndex(messages, focus.messageId) < 0;
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
  // The live voice conversation follows the turn that answers what the user said. Before the first
  // read it has an empty conversation, so it can still start.
  const liveConversation = useMemo(
    () => ({ messages: conversation?.messages ?? [], activeTurnId: conversation?.activeTurnId ?? null }),
    [conversation?.messages, conversation?.activeTurnId],
  );
  const latest = latestReadableMessage(conversation?.messages ?? []);
  const latestId = latest?.id;
  const markRead = useCallback(() => {
    if (latestId) markAgentRead(agent.id, latestId, agent.serverId);
  }, [agent.id, agent.serverId, latestId, markAgentRead]);
  const activePrompt = messages.findLast(
    (message) =>
      message.kind === "question" &&
      !message.prompt.resolution &&
      Boolean(conversation?.activeTurnId) &&
      message.turnId === conversation?.activeTurnId,
  );
  const viewOnly = useAgentViewOnly(agent.serverId, agent.id);
  const mentionSkills = useAgentMentionSkills(agent.id, agent.serverId, showsOnline(server));
  const questionForm = useQuestionPrompt(
    agent.id,
    activePrompt?.kind === "question" ? activePrompt : undefined,
    showsOnline(server) && !viewOnly,
    respondToPrompt,
  );
  const workActivity = workChannel ? liveActivity : undefined;
  // One element while its inputs stay, so a new render of this screen does not draw the list again.
  // The agent's threads are in the thread menu of the header, not in this chat.
  const activityAccessory = useMemo(
    () =>
      workChannel && workActivity ? (
        <ChatChannelWorkRow channel={workChannel} activity={workActivity} serverId={agent.serverId} />
      ) : null,
    [workChannel, workActivity, agent.serverId],
  );
  return (
    <ChatView
      target={target}
      queue={queue}
      agents={serverAgents}
      mentionAgents={mentionAgents}
      mentionSkills={mentionSkills}
      projectedMessages={messages}
      referenceMessages={references}
      ready={Boolean(conversation)}
      historyLoadFailed={historyLoadFailed}
      // The phone keeps a message while the server is offline and sends it when it is back.
      canSend={!viewOnly}
      notice={viewOnly ? t("mobile.chat.viewOnly") : null}
      activity={activity}
      activeTurnId={conversation?.activeTurnId ?? null}
      conversation={liveConversation}
      stopTurn={stopTurn}
      questionForm={questionForm}
      activityAccessory={activityAccessory}
      threadMenu={threadMenu}
      threadId={threadId}
      approvals={approvals}
      readBoundary={latest ? `${latest.id}:${latest.status}` : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={conversation?.pageInfo.hasOlder ?? false}
      olderLoading={conversation?.olderLoading ?? false}
      olderError={conversation?.olderError ?? false}
      loadOlder={loadOlder}
      focusMessageId={focus?.messageId ?? null}
      // Offline, the chat shows what the phone has and moves to the message when its page loads.
      holdOpening={focus !== null && online}
      catchingUp={catchingUp}
      onFocusPlaced={clearFocus}
      detached={detached}
      showLatestMessages={showLatestMessages}
      onLeave={onLeave}
    />
  );
}
