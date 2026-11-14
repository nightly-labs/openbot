import { itemTypeCountsAsUnread } from "@openbot/contracts/conversation-read";
import type { RespondToPromptInput } from "@openbot/contracts/ipc";
import { router, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ChatChannelWorkRow } from "@/features/channels/components/chat-channel-work-row";
import { useChannelList } from "@/features/channels/components/use-channels";
import { useAgentViewOnly } from "@/features/servers/model/use-server-roles";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useAgentFirstUnreadMessageId, useApprovalRequests } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { openTurnActivity } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import { currentText, useText } from "@/shared/lib/text";
import {
  chatRowIndex,
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
import { MAIN_THREAD_ID, useChatThreadMenu } from "./chat-thread-menu";
import { ChatView } from "./chat-view";
import { useBranchThread } from "./use-branch-thread";
import { useChatQueue } from "./use-chat-queue";
import { useMessageDelete } from "./use-message-delete";
import { useMessagePins } from "./use-message-pins";
import { useOpenAgentTasks } from "./use-open-agent-tasks";
import { useQuestionPrompt } from "./use-question-prompt";

const NO_MESSAGE_IDS: ReadonlySet<string> = new Set();

/** `previous` when it holds exactly `ids`, else a new set of them. */
function keptIdSet(previous: ReadonlySet<string> | null, ids: readonly string[]): ReadonlySet<string> {
  if (previous && previous.size === ids.length && ids.every((id) => previous.has(id))) return previous;
  return new Set(ids);
}

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
  const progressUpdates = useProgressUpdates(agent.serverId, serverAgents, agent.id);
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
  // The pins of the agent's own chat, on a host with `message-pins-v1`.
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
  // A turn on another thread, such as channel work, is not this chat's work, as on desktop. A host
  // with channel-attention-v1 names the channel of the thread, and a row below opens it.
  const otherThread = Boolean(liveActivity?.threadId && threadId && liveActivity.threadId !== threadId);
  const channels = useChannelList(agent.serverId);
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
  // Without one, a chat with unread messages opens at its NEW line (`unread`), as on desktop.
  const [focus, setFocus] = useState<{ messageId: string; loaded: boolean; unread: boolean } | null>(() =>
    focusMessageId
      ? { messageId: focusMessageId, loaded: false, unread: false }
      : firstUnreadMessageId
        ? { messageId: firstUnreadMessageId, loaded: false, unread: true }
        : null,
  );
  const focusRef = useRef(focus);
  focusRef.current = focus;
  // True after the chat showed its opening place. A later unread state does not move the chat.
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
    const load = async () => {
      if (pending?.unread) {
        // The latest page first: it usually holds the first unread message, and a window around a
        // message adds only older messages to the messages that the phone kept.
        await readLatest();
        if (!stored() && !(await loadConversationAround(agent.id, pending.messageId, agent.serverId))) {
          // The host no longer has the message. The chat opens at the latest message.
          if (request.current === id) setFocus(null);
          return;
        }
        if (request.current === id)
          setFocus((current) => (current?.messageId === pending.messageId ? { ...current, loaded: true } : current));
        return;
      }
      if (messageId && !stored()) {
        if (!(await loadConversationAround(agent.id, messageId, agent.serverId))) {
          // The host no longer has the message. The chat opens at the latest message.
          if (request.current === id) setFocus(null);
          await loadLatestMessages(agent.id, agent.serverId);
          return;
        }
      }
      // The list can show the message, and clear the focus, before the request ends.
      if (messageId && request.current === id)
        setFocus((current) => (current?.messageId === messageId ? { ...current, loaded: true } : current));
      await readLatest();
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
  // The unread state can come after the chat opened, such as on a cold start. Until the chat has
  // messages to show, it still opens at the NEW line.
  useEffect(() => {
    if (!firstUnreadMessageId || focusRef.current || focusEnded.current || conversation) return;
    const next = { messageId: firstUnreadMessageId, loaded: false, unread: true };
    focusRef.current = next;
    setFocus(next);
    fetchHistory();
  }, [firstUnreadMessageId, conversation, fetchHistory]);
  const detached = conversation?.detached ?? false;
  // A message in the store that the chat shows no row for, such as a thinking step. The NEW line
  // moves to the next row that has one, and the list opens at the latest message when none has.
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
  // The live voice conversation follows the turn that answers what the user said. Before the first
  // read it has an empty conversation, so it can still start.
  const liveConversation = useMemo(
    () => ({ messages: conversation?.messages ?? [], activeTurnId: conversation?.activeTurnId ?? null }),
    [conversation?.messages, conversation?.activeTurnId],
  );
  const latest = latestReadBoundaryMessage(conversation?.messages ?? []);
  const latestId = latest?.id;
  // After Mark unread, the open chat does not read itself again until the reader leaves it, as on
  // desktop. A message sheet covers the chat but does not leave it, so its focus loss keeps the hold.
  // The sheet that marks it is open when the hold starts, so the hold waits until the chat is on
  // screen again.
  const readHeldFor = useRef<{ agentId: string; shown: boolean } | null>(null);
  // The NEW line of this visit, as on desktop. The open chat reads itself at once, so the host read
  // state loses its first unread message: the line keeps it. It takes the host's message until the
  // chat reads itself, and again after the chat was covered, so it does not jump to a reply that
  // the reader watches arrive.
  const [unreadLine, setUnreadLine] = useState<{ agentId: string; messageId: string } | null>(() =>
    firstUnreadMessageId ? { agentId: agent.id, messageId: firstUnreadMessageId } : null,
  );
  // The agent whose chat has read itself since it was last covered.
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
  // As on desktop, Mark unread is on the messages that the host counts as unread.
  // The conversation is a new array on each streamed chunk, with the same messages. Each set stays
  // the same object while its ids stay, as the list asks.
  const lastMarkUnreadIds = useRef<ReadonlySet<string>>(NO_MESSAGE_IDS);
  const markUnreadMessageIds = useMemo(() => {
    const ids = (conversation?.messages ?? [])
      .filter((message) => message.author !== "user" && itemTypeCountsAsUnread(message.itemType))
      .map((message) => message.id);
    lastMarkUnreadIds.current = keptIdSet(lastMarkUnreadIds.current, ids);
    return lastMarkUnreadIds.current;
  }, [conversation?.messages]);
  const unreadLineMessageId = unreadLine?.agentId === agent.id ? unreadLine.messageId : null;
  // The line shows above the first of these messages that has a row.
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
      Boolean(conversation?.activeTurnId) &&
      message.turnId === conversation?.activeTurnId,
  );
  const viewOnly = useAgentViewOnly(agent.serverId, agent.id);
  const messageDelete = useMessageDelete(agent.serverId, { kind: "agent", agentId: agent.id });
  // As on desktop, the text of a message can start work in an open channel. The channel opens with
  // the text in its composer. The list changes on each channel event, so it is kept by its contents.
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
      mentionReferences={mentionReferences}
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
      threadId={threadId}
      approvals={approvals}
      readBoundary={latest ? `${latest.id}:${latest.status}` : null}
      markRead={markRead}
      fetchHistory={fetchHistory}
      hasOlder={conversation?.pageInfo.hasOlder ?? false}
      olderLoading={conversation?.olderLoading ?? false}
      olderError={conversation?.olderError ?? false}
      loadOlder={loadOlder}
      // The NEW line waits for its page: the messages that the phone kept can end before it.
      focusMessageId={focus && (!focus.unread || focus.loaded) ? focus.messageId : null}
      focusUnread={focus?.unread ?? false}
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
