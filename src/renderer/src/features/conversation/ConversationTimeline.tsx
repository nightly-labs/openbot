import { fileQuoteId } from "@openbot/contracts/chat-tag-references";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AgentApproval, ConversationMessageSender, MessageReaction } from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import { Button } from "@openbot/ui";
import type { AgentMessage, ChatActionMarkerModel, MessageKind } from "@openbot/ui/data";
import { ChannelActivityIndicator, type ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { AgentChatEmptyState } from "@openbot/ui/features/conversation/AgentChatEmptyState";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsTrace,
} from "@openbot/ui/features/conversation/AgentSteps";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { agentActivityExitDelay, agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { UsageLimitAskCard } from "@openbot/ui/features/conversation/BackupModels";
import { branchPointIds } from "@openbot/ui/features/conversation/branch-points";
import { ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ChatRowBoundary } from "@openbot/ui/features/conversation/ChatRowBoundary";
import { ChatScrollRail, createChatScrollRail } from "@openbot/ui/features/conversation/ChatScrollRail";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { ContextCompactionMarker, type ContextCompactionView } from "@openbot/ui/features/conversation/ContextUsage";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";
import { feedbackApproval } from "@openbot/ui/features/conversation/feedback-approval";
import { markdownPlainText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { ReplyReturnButton, ScrollToLatestButton } from "@openbot/ui/features/conversation/MessageNavigation";
import {
  DeleteMessageDialog,
  MessageActions,
  MessageMenu,
  MessageMenuItems,
  type MessageMenuItemsProps,
} from "@openbot/ui/features/conversation/MessageRendering";
import { countableTimelineMessage } from "@openbot/ui/features/conversation/new-message-tally";
import { PendingSendStatus } from "@openbot/ui/features/conversation/PendingSendStatus";
import { SubagentDock, SubagentGroup } from "@openbot/ui/features/conversation/Subagents";
import { TaskList } from "@openbot/ui/features/conversation/TaskList";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { UnreadMessagesBanner, UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import { VoicePlayer } from "@openbot/ui/features/conversation/VoicePlayer";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, Loading, lazy, onCleanup, Show, untrack } from "solid-js";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { planItems, planTitle } from "../../app-message-projection";
import { useCompactMessageActions } from "../../compact-message-actions-preference";
import { currentDevicePlatform, deviceQuoteShortcut } from "../../send-shortcut-preference";
import { remoteRoutineRecovery, serverCanAdminister } from "../servers/server-capabilities";
import { speechModelReady } from "../speech/speech-model";
import { recordingGone, speechReading, spokenReply } from "../speech/speech-playback";
import {
  recordingWaveform,
  seekRecording,
  seekSpokenReply,
  toggleReadAloud,
  toggleRecording,
  toggleSpokenReply,
} from "../speech/speech-replies";
import { cycleSpeechSpeed, speechSpeed } from "../speech/speech-speed";
import { agentInstructionsCalls } from "./agent-folders-port";
import { groupedMessageIds } from "./agent-message-timeline";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { continuesSenderRun } from "./chat-grouping";
import { chatSearchCanOpen, chatSearchOpensMessage } from "./chat-search";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";
import { chatVisualPageUrl } from "./chat-visual-url";
import { isIncomingAgentMessage } from "./conversation-read-state";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { agentSkillsMode } from "./installed-skills-source";
import { MarketplaceSuggestionChatCard, marketplaceSuggestionKnown } from "./MarketplaceSuggestionChatCard";
import { McpSignInChatCard } from "./McpSignInChatCard";
import { createMessageImageFiles } from "./message-image-files";
import { RoutineChatCard } from "./RoutineChatCard";
import { createChatWebhookRoutines, RoutineWebhookChatCard } from "./RoutineWebhookChatCard";
import { desktopChatEventRoutinesApi } from "./routine-webhooks-api";
import { ServerInstallChatCard } from "./ServerInstallChatCard";
import { SkillSuggestionChatCard, skillSuggestionOutcome } from "./SkillSuggestionChatCard";
import { PENDING_SEND_ID_PREFIX, pendingSendRetrySafe } from "./stores/pending-send-store";
import { createSubagentDock } from "./subagent-dock";
import { createTurnSteps, SUBAGENT_SPAN_PREFIX } from "./turn-steps";

/**
 * A message that renders only an action marker, with no bubble of its own. A routine instruction is
 * one: its marker names the routine, and the instruction text stays in the routine settings.
 */
function markerOnlyMessage(message: AgentMessage): boolean {
  return Boolean(message.actionMarker);
}

/** A block the history draws: one that is answered, expired or closed. */
function frozenUiBlock(message: AgentMessage | undefined): ConversationUiBlock | undefined {
  const block = message?.uiBlock;
  return block && block.state.status !== "pending" ? block : undefined;
}

/**
 * Does this row draw a time of its own?
 *
 * A marker-only row carries the marker's own time, and a question prompt, a plan, the subagents and a visual reply
 * draw a card instead of a message row. None shows the header a run continues under, so none can
 * hold a run open.
 */
/** In the agent chat, a separator with the time stands above a message that comes this long after the one before it. */
const AGENT_CHAT_TIME_GAP_MS = 60 * 60 * 1000;

function rowDrawsTime(message: AgentMessage): boolean {
  return (
    !markerOnlyMessage(message) &&
    !message.questionPrompt &&
    message.kind !== "plan" &&
    message.kind !== "subagents" &&
    message.kind !== "memory-changes" &&
    message.kind !== "thinking" &&
    chatVisualReply(message) === null
  );
}

/** Marker-only rows that render attachment cards below the marker do not end with one. */
function markerRowEndsWithMarker(message: AgentMessage): boolean {
  if (!markerOnlyMessage(message)) return false;
  return !(message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0);
}

function routineMarkerAvailable(
  marker: ChatActionMarkerModel,
  availableRoutineIds: readonly string[] | undefined,
): boolean {
  if (!("routineId" in marker)) return true;
  if (marker.kind === "routine-lifecycle" && marker.action === "deleted") return false;
  return availableRoutineIds?.includes(marker.routineId) === true;
}

/** The message kinds that can be the reply on a rail card. */
const REPLY_KINDS: ReadonlySet<MessageKind> = new Set(["text", "question"]);

/** @internal Stable HMR boundary for conversation timeline. */
export function ConversationTimeline() {
  const {
    activeChatSearchIndex,
    agentActivitySpaceReserved,
    attachmentAction,
    attachmentDownloads,
    channel,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    clearNewMessages,
    closeChatSearch,
    composerHasContent,
    quotedMessageId,
    branchThread,
    dismissPendingSend,
    downloadMessageImageFile,
    editingDeliveryId,
    editPendingSend,
    copyMessage,
    copiedMessageId,
    messageText,
    expandedEmojiMessageId,
    installedSkills,
    scrollFades,
    jumpToLatestMessage,
    jumpToUnreadMessages,
    markMessageSeen,
    markUnreadMessages,
    markingRead,
    messageVirtualizer,
    newMessageCount,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    updateAnswers,
    timelineIndexById,
    unreadBoundaryMessageId,
    moveChatSearch,
    openExternalMessageUrl,
    openReactionMessageId,
    openRoutineSettings,
    openSkillSettings,
    openInstructionsSettings,
    openSharedFile,
    openWorkspaceFile,
    openQuote,
    openTaggedReference,
    pendingSendFor,
    presentedQueueDeliveries,
    providerUpdateRequired,
    previewAttachment,
    props,
    mcpServers,
    sendCardMessage,
    saveSkillSuggestion,
    reactToMessage,
    renderedAgentActivity,
    activeStepActivity,
    providerOffline,
    providerSilentMinutes,
    agentProviderName,
    replyJump,
    replyToMessage,
    addPageText,
    setPageContext,
    quoteSelection,
    retryPendingSend,
    scheduleUnreadDividerVisibilityUpdate,
    setChatSearchQuery,
    setExpandedEmojiMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
    registerPromptComposerAnswer,
    showScrollToLatest,
    unreadDividerVisible,
    updateScrollFade,
    updateUnreadDividerVisibility,
    setAgentActivitySlotElement,
    setChatSearchInputElement,
    setScrollElement,
    setStickToLatest,
    followReaderScroll,
    setUnreadMessagesDividerElement,
    unreadDividerArrives,
    setVirtualRootElement,
    shownSubagentId,
    toggleSubagentPanel,
    sideThreadOpen,
  } = useConversationViewScope();
  const { t, format, sourceText } = useText();
  // A named function, not a ternary in the prop: the compiler wraps a ternary prop in a memo, and
  // the avatar reads it in a tracked effect, where a new memo halts the reactive system.
  const waitingProviderName = () => {
    const waiting = providerSilentMinutes() !== null || providerOffline();
    return waiting ? agentProviderName() : undefined;
  };
  /** An agent reply can be read aloud by this computer's speech model, in this chat's voice. */
  const readAloudAction = (message: AgentMessage) => {
    const agentId = props.agent?.id;
    if (props.runtime || !agentId || message.author !== "agent" || message.streaming || !message.body.trim()) return;
    if (!speechModelReady()) return;
    return {
      reading: speechReading()?.messageId === message.id,
      onToggle: () =>
        toggleReadAloud({ serverId: props.server?.id ?? "local", agentId, messageId: message.id }, message.body),
    };
  };
  /** A message that counts as unread in an agent chat can be marked unread, with the messages after it. */
  const markUnreadAction = (message: AgentMessage) => {
    const onMarkUnread = props.onMarkUnread;
    if (channel || !onMarkUnread || !isIncomingAgentMessage(message) || message.streaming) return;
    return () => void onMarkUnread(message.id);
  };
  /** The message that the delete dialog asks about. */
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  /** A message that the host stores can be deleted, when the reader may delete it. */
  const deleteAction = (message: AgentMessage) => {
    if (!props.onDeleteMessage || message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX)) return;
    if (props.canDeleteMessage && !props.canDeleteMessage(message)) return;
    return () => setDeleteTargetId(message.id);
  };
  const deleteMessage = (messageId: string) => props.onDeleteMessage?.(messageId) ?? Promise.resolve();
  /** A finished message of an agent chat can start work in a channel. A channel message stays where it is. */
  const sendToChannelAction = (message: AgentMessage) => {
    const target = props.sendToChannel;
    if (
      channel ||
      !target ||
      message.streaming ||
      !message.body.trim() ||
      message.id.startsWith(PENDING_SEND_ID_PREFIX)
    )
      return;
    return { channels: target.channels, onSend: (channelId: string) => target.onSend(channelId, messageText(message)) };
  };
  /** The answers of the agent that end a finished turn. Each one offers a branch. */
  const branchPoints = createMemo(() =>
    channel ? new Set<string>() : branchPointIds(timelineMessages(), props.activeTurnId),
  );
  /** Copies the agent's own chat through the answer into a new thread. A channel has no branch. */
  const branchAction = (message: AgentMessage) => {
    if (channel || !props.threads?.onBranch || !branchPoints().has(message.id)) return;
    return () => void branchThread(null, message.id);
  };
  /** The last agent text of each turn the user spoke: it shows a play control at all times. */
  const spokenReplyIds = createMemo(() => {
    const ids = new Set<string>();
    let spoken = false;
    let reply: string | undefined;
    for (const message of timelineMessages()) {
      if (message.author === "you") {
        if (reply) ids.add(reply);
        spoken = message.voiceRecording !== undefined;
        reply = undefined;
      } else if (spoken && (message.kind ?? "text") === "text" && message.body.trim()) reply = message.id;
    }
    if (reply) ids.add(reply);
    return ids;
  });
  /** Plays a spoken turn again: the user's own recording, or the agent's reply read aloud. */
  const voicePlayer = (message: AgentMessage | undefined) => {
    if (!message) return;
    const reading = speechReading();
    const own = reading?.messageId === message.id ? reading : undefined;
    const state = !own ? ("idle" as const) : own.paused ? ("paused" as const) : ("playing" as const);
    const url = message.voiceRecording?.previewUrl;
    // The user can delete a recording in Storage; its message then keeps only the text.
    if (message.author === "you" && url && !recordingGone(url)) {
      const waveform = recordingWaveform(url);
      return {
        kind: "message" as const,
        state,
        peaks: waveform?.peaks,
        duration: waveform?.duration ?? own?.duration ?? undefined,
        elapsed: own?.elapsed,
        onToggle: () => toggleRecording(message.id, url),
        onSeek: (seconds: number) => seekRecording(message.id, url, seconds),
        levels: undefined,
      };
    }
    const agentId = props.agent?.id;
    if (!agentId || !spokenReplyIds().has(message.id) || !readAloudAction(message)) return;
    const summary = spokenReply(message.id);
    return {
      kind: "reply" as const,
      state,
      levels: own?.levels,
      peaks: summary?.peaks,
      duration: summary?.duration ?? own?.duration ?? undefined,
      elapsed: own?.elapsed,
      onSeek: (seconds: number) => seekSpokenReply(message.id, seconds),
      onToggle: () =>
        toggleSpokenReply({ serverId: props.server?.id ?? "local", agentId, messageId: message.id }, message.body),
    };
  };
  const compaction = (): ContextCompactionView | null => {
    const state = props.contextState;
    if (state?.agentId !== props.agent?.id || state?.threadId !== props.agent?.threadId || !state?.compaction)
      return null;
    return { ...state.compaction, timestamp: new Date(state.compaction.startedAt).toISOString() };
  };
  const compactionBefore = () => {
    const startedAt = props.contextState?.compaction?.startedAt;
    return startedAt === undefined
      ? undefined
      : timelineMessages().find((message) => message.createdAt && Date.parse(message.createdAt) > startedAt)?.id;
  };
  const CompactionMarker = () => (
    <Show when={compaction()}>{(state) => <ContextCompactionMarker compaction={state()} />}</Show>
  );

  const runtime = conversationRuntime(props);
  // The browser client reads a host file whole, with no size limit, so a named image stays a chip there.
  const messageImageFiles = props.runtime ? undefined : createMessageImageFiles(runtime.agent);
  const localInstructions = agentInstructionsCalls();
  /**
   * The server whose instruction file View and Undo read on a change line: a joined server only for an
   * owner or admin, through `agent-instructions-v1`. The calls follow the server id, so a new summary
   * of the same server keeps an open view. The web client gets the calls from its runtime, which gives
   * them only for such a host and user.
   */
  const webInstructionsApi = createMemo(() => props.runtime?.agentInstructions);
  const instructionsServerId = createMemo(() => {
    if (props.runtime) return webInstructionsApi() ? props.server?.id : undefined;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, "agent-instructions-v1")
      ? props.server.id
      : undefined;
  });
  const instructionsCalls = createMemo(() => {
    if (!props.runtime && props.server?.kind === "local") return localInstructions;
    const serverId = instructionsServerId();
    return serverId === undefined ? undefined : agentInstructionsCalls(serverId, webInstructionsApi());
  });
  /** The agent that asks in a card: in a channel, the working agent whose card shows. */
  const interactionAgentName = () => (channel ? channel.interactionAgentName() : props.agent?.name);

  /**
   * Send on a feedback card resolves the approval at once, but the tool still waits for GitHub. The
   * card stays, with its loader, until the next row (the thank-you card) arrives or the turn ends.
   */
  const [sendingFeedback, setSendingFeedback] = createSignal<{
    approval: AgentApproval;
    rows: number;
    turnId: string | null | undefined;
  } | null>(null);
  const heldFeedback = createMemo(() => {
    const held = sendingFeedback();
    if (!held || props.approval) return undefined;
    if (props.messages.length !== held.rows || props.activeTurnId !== held.turnId) return undefined;
    return held.approval;
  });
  async function approve(approval: AgentApproval) {
    if (feedbackApproval(approval)) {
      setSendingFeedback({ approval, rows: props.messages.length, turnId: props.activeTurnId });
    }
    const accepted = await props.onRespondToApproval("accept");
    if (!accepted) setSendingFeedback(null);
    return accepted;
  }
  /**
   * The other person who wrote a message. The reader's own message, an agent message, and a message
   * from before senders were kept have none, so a chat with one person looks as it always did.
   */
  const otherSender = (message: AgentMessage | undefined): ConversationMessageSender | undefined => {
    const sender = message?.author === "you" ? message.senderMember : undefined;
    return sender && !props.isOwnSender(sender.id) ? sender : undefined;
  };
  // Live presence gives the current name; the name kept with the message covers a member who left
  // the team. The member id seeds the colour of the name and the bubble, so it stays the same before
  // presence loads, after the person leaves, and on mobile.
  const memberAuthor = (sender: ConversationMessageSender): ChatMessageAuthor => {
    const member = props.presence.members.find((candidate) => candidate.id === sender.id);
    return {
      kind: "member",
      name: (member ? teamMemberName(member) : sender.name.trim()) || t("chat.message.memberFallback"),
      avatarSeed: sender.id,
      chatColor: member?.chatColor,
    };
  };
  /** The reader's own chat color: the member of the server that is the reader. */
  const ownChatColor = () => props.presence.members.find((member) => props.isOwnSender(member.id))?.chatColor;
  /** The agent messages of the chat by their exchange id, so a marker finds its text and its request. */
  const agentMessagesByExchangeId = createMemo(
    () =>
      new Map(
        props.messages.flatMap((message) => (message.exchange ? [[message.exchange.messageId, message] as const] : [])),
      ),
  );
  const exchangeAuthor = (message: AgentMessage): ChatMessageAuthor => {
    const agentId = message.exchange?.senderAgentId;
    const agent = props.agents.find((candidate) => candidate.id === agentId);
    return { kind: "agent", name: agent?.name ?? t("chat.message.agentFallback"), agent, avatarSeed: agentId };
  };
  // The request of an agent message is another agent message, or a message of this chat.
  const exchangeRequest = (replyToMessageId: string | null | undefined) =>
    replyToMessageId
      ? (agentMessagesByExchangeId().get(replyToMessageId) ??
        props.messages.find((candidate) => candidate.id === replyToMessageId) ??
        props.messageReferences?.[replyToMessageId])
      : undefined;
  const requestAuthorName = (request: AgentMessage): string | undefined => {
    if (request.exchange) return exchangeAuthor(request).name;
    const sender = otherSender(request);
    if (sender) return memberAuthor(sender).name;
    return request.author === "agent" ? props.agent?.name : undefined;
  };
  /*
   * The text of an agent message opens under its marker as the sender's message, with a quote of the
   * request it answers. Its attachments stay under the marker, so the row draws none. The quiet
   * answers of a teammate update follow it, as the agent's own messages.
   */
  const agentMessageText = (messageId: string) => {
    const message = () => agentMessagesByExchangeId().get(messageId);
    const quietAnswers = () => updateAnswers().get(messageId) ?? [];
    const request = () => exchangeRequest(message()?.exchange?.replyToMessageId);
    const quoted = (): AgentMessage | undefined => {
      const current = request();
      return (
        current && { id: current.id, author: current.author, body: current.body, time: current.time, kind: "text" }
      );
    };
    const quotedAuthorName = () => {
      const current = request();
      return current && requestAuthorName(current);
    };
    return (
      <>
        <Show when={message()}>
          {(current) => (
            <ChatMessageRow
              message={{
                id: current().id,
                author: "agent",
                body: current().body,
                time: current().time,
                ...(current().createdAt === undefined ? {} : { createdAt: current().createdAt }),
                kind: "text",
              }}
              author={exchangeAuthor(current())}
              showAuthor
              showTime
              agents={props.agents}
              referencedMessage={quoted()}
              referencedAuthorName={quotedAuthorName()}
              // The sender's name opens the side thread that sent the message, or else the sender's own chat.
              // Another agent, such as a mention in the text, opens as before.
              onSelectAgent={(agentId) =>
                agentId === current().exchange?.senderAgentId
                  ? props.onSelectAgent(agentId, current().exchange?.senderTaskId ?? MAIN_THREAD_ID)
                  : props.onSelectAgent(agentId)
              }
              onOpenLink={(url) => void openExternalMessageUrl(url)}
              onPreview={(attachment) => void previewAttachment(attachment)}
              onAttachmentAction={attachmentAction}
              onOpenSharedFile={(path) => openSharedFile(path)}
              // A workspace path is in the workspace of the agent that wrote it, as in a channel.
              onOpenWorkspaceFile={(path) => openWorkspaceFile(path, undefined, current().exchange?.senderAgentId)}
              onOpenQuote={openQuote}
              onOpenTag={openTaggedReference}
              macWindowControls={props.platform === "darwin"}
            />
          )}
        </Show>
        <For each={quietAnswers()}>
          {(answer) => (
            <ChatMessageRow
              message={answer}
              author={ownAgentAuthor()}
              showTime
              agents={props.agents}
              onSelectAgent={props.onSelectAgent}
              onOpenLink={(url) => void openExternalMessageUrl(url)}
              onPreview={(attachment) => void previewAttachment(attachment)}
              onAttachmentAction={attachmentAction}
              onOpenWorkspaceFile={(path) => openWorkspaceFile(path, undefined, props.agent?.id)}
              onOpenQuote={openQuote}
              onOpenTag={openTaggedReference}
              macWindowControls={props.platform === "darwin"}
            />
          )}
        </For>
      </>
    );
  };
  /* The agent of this chat as the author of its own message. */
  const ownAgentAuthor = (): ChatMessageAuthor => ({
    kind: "agent",
    name: props.agent?.name ?? t("chat.message.agentFallback"),
    agent: props.agent,
  });
  // A run of one sender breaks where another person starts to write, and in a channel where another
  // agent starts to write.
  const senderRunRow = (message: AgentMessage) => {
    const sender = otherSender(message);
    const author = sender
      ? `member:${sender.id}`
      : channel && message.author === "agent"
        ? `agent:${message.senderAgentId ?? ""}`
        : message.author;
    return {
      author,
      ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
      ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    };
  };
  /**
   * An agent's record of a routine it created or changed is a card whose schedule the person can
   * change. Only a record from an agent turn has a `turnId`. A change the person made in the app
   * keeps the plain marker, so an edit on a card does not add a second card that replaces it. A
   * deleted routine also keeps the plain marker, because its schedule is not known. Only the newest
   * record of a routine is a card: each card shows the routine as it is now, so an older card would
   * repeat it. An older record keeps the plain marker.
   */
  const routineCardMarker = (message: AgentMessage | undefined, marker: ChatActionMarkerModel | undefined) =>
    message?.turnId && marker?.kind === "routine-lifecycle" ? marker : undefined;
  // The newest agent record of each routine is its one card.
  const latestRoutineMessageIds = createMemo(() => {
    const latest = new Map<string, string>();
    for (const message of timelineMessages()) {
      const marker = routineCardMarker(message, message.actionMarker);
      if (marker) latest.set(marker.routineId, message.id);
    }
    return latest;
  });
  const routineCard = (message: AgentMessage | undefined, marker: ChatActionMarkerModel) => {
    const agentId = props.agent?.id;
    const cardMarker = routineCardMarker(message, marker);
    if (!message || !cardMarker || cardMarker.action === "deleted" || !agentId) return undefined;
    if (latestRoutineMessageIds().get(cardMarker.routineId) !== message.id) return undefined;
    const routine = props.routines?.find((candidate) => candidate.id === cardMarker.routineId);
    return routine && { action: cardMarker.action, routine, agentId };
  };
  // Webhook routines load only for a person who can manage them, and only for a chat with an agent
  // record of a routine that is not a schedule routine.
  const webhookRoutinesNeeded = createMemo(() => {
    // Before the schedule routines load, every record looks like one that is not a schedule routine.
    if (!props.routines) return false;
    const scheduled = new Set(props.routines.map((routine) => routine.id));
    return timelineMessages().some((message) => {
      const marker = routineCardMarker(message, message.actionMarker);
      return marker !== undefined && marker.action !== "deleted" && !scheduled.has(marker.routineId);
    });
  });
  const webhookRoutineSource = createMemo(
    () => {
      const agentId = props.agent?.id;
      const api = webhookRoutinesNeeded() ? desktopChatEventRoutinesApi(props.server, props.runtime) : undefined;
      return agentId && api
        ? { api, agentId, serverId: props.server?.id, recovery: remoteRoutineRecovery(props.server) }
        : undefined;
    },
    // A new adapter for the same host, agent and routes is the same source: no reload.
    {
      equals: (left, right) =>
        left?.agentId === right?.agentId && left?.serverId === right?.serverId && left?.recovery === right?.recovery,
    },
  );
  const webhookRoutines = createChatWebhookRoutines(webhookRoutineSource);
  /**
   * Opens the side thread of a routine's runs. A routine that now runs in the chat has no link, also when
   * an earlier run made a thread: its new runs are not there. A remote host without
   * `routine-run-place-v1` does not send the place, so its routines keep the link.
   */
  const openRoutineThread = (routineId: string) => {
    const routine =
      props.routines?.find((candidate) => candidate.id === routineId) ??
      webhookRoutines.state.routines.find((candidate) => candidate.id === routineId);
    return routine?.runIn === "chat" ? undefined : props.threads?.routineThread(routineId);
  };
  // The plain marker of a webhook routine opens it too: the host lists those routines on their own.
  const availableRoutineIds = createMemo(() =>
    props.availableRoutineIds
      ? [...props.availableRoutineIds, ...webhookRoutines.state.routines.map((routine) => routine.id)]
      : undefined,
  );
  /**
   * An agent's newest record of a webhook routine it created or changed is a card with its URL, its
   * signing secret and its events. An older record keeps the plain marker.
   */
  const webhookRoutineCard = (message: AgentMessage | undefined, marker: ChatActionMarkerModel) => {
    const source = webhookRoutineSource();
    const cardMarker = routineCardMarker(message, marker);
    if (!source || !message || !cardMarker || cardMarker.action === "deleted") return undefined;
    if (latestRoutineMessageIds().get(cardMarker.routineId) !== message.id) return undefined;
    const routine = webhookRoutines.state.routines.find((candidate) => candidate.id === cardMarker.routineId);
    return routine && { api: source.api, action: cardMarker.action, routine };
  };
  /** A suggestion this client can draw is a card. One for an app it does not know keeps the marker. */
  const suggestionMarker = (marker: ChatActionMarkerModel) =>
    marker.kind === "marketplace-suggestion" && marketplaceSuggestionKnown(marker.appId) ? marker : undefined;
  /** A memory review's skill suggestion with its name is a card; one from an older host keeps its text. */
  const skillSuggestionMarker = (marker: ChatActionMarkerModel) =>
    marker.kind === "skill-suggestion" ? marker : undefined;
  const skillOpener = () => (agentSkillsMode(props.server, props.runtime) === "hidden" ? undefined : openSkillSettings);
  /** The saved http row a sign-in card names. A row this client cannot read keeps the marker. */
  const mcpSignInConfig = (marker: ChatActionMarkerModel) =>
    marker.kind === "mcp-sign-in"
      ? mcpServers().find((config) => config.id === marker.mcpServerId && config.transport === "http")
      : undefined;
  /** An install command card, where this client can watch its server list. Elsewhere it keeps the marker. */
  const serverInstallCard = (marker: ChatActionMarkerModel) => {
    const watch = props.serverInstall;
    return marker.kind === "server-install" && watch ? { marker, watch } : undefined;
  };
  const virtualMessageRows = createMemo(() => messageVirtualizer.getVirtualItems());
  let timelineScrollElement: HTMLDivElement | undefined;
  const subagentDock = createSubagentDock({
    rows: timelineMessages,
    drawnRows: virtualMessageRows,
    scrollElement: () => timelineScrollElement,
    hidden: sideThreadOpen,
  });
  /**
   * Scrolls back to the subagent card, with its header in view when the card is taller than the chat.
   * The bar that had focus goes away, so focus goes to the card header.
   */
  const revealSubagents = async () => {
    const cardId = subagentDock.cardId();
    if (!cardId) return;
    const row = await replyJump.reveal(cardId, undefined, props.agent?.id);
    const header = row?.querySelector<HTMLElement>(".subagents-group-header");
    header?.scrollIntoView({ block: "nearest" });
    header?.focus({ preventScroll: true });
  };
  const rail = createChatScrollRail({
    rows: timelineMessages,
    // A change the person made in the app, such as to a routine, is a marker, not a message they wrote.
    // In a shared chat, a message from another member is theirs.
    question: (message) =>
      message.author === "you" && !message.actionMarker && !otherSender(message) ? message.body : undefined,
    // The first answer the reader would call a message, or a question the agent asks: not thinking, a plan,
    // a tool exchange, an error or a quiet run.
    reply: (message) =>
      countableTimelineMessage(message) && REPLY_KINDS.has(message.kind ?? "text") ? message.body : undefined,
    storedCount: () => props.messages.length,
    unloaded: () => props.unloadedHistory,
    virtualizer: messageVirtualizer,
    onLoadOlder: () => props.onLoadOlder?.(),
    onJump: () => setStickToLatest(false),
  });
  const turnSteps = createTurnSteps({
    messages: () => props.messages,
    lines: () => props.turnStepLines,
    activeTurnId: () => props.activeTurnId,
  });
  const showAgentSteps = useShowAgentSteps();
  const compactActions = useCompactMessageActions();
  const traceKeyboard = currentDevicePlatform() === "darwin" ? "mac" : "pc";
  /** The trace that the steps row of an answer opens. A channel names the agent that answered. */
  const traceAbove = (messageId: string | undefined, agentName?: string): AgentStepsTrace => ({
    spans: () =>
      turnSteps.traceAbove(messageId, {
        agent: agentName ?? props.agent?.name ?? t("chat.message.agentFallback"),
        thinking: t("chat.trace.step.thinking"),
        answer: t("chat.trace.step.answer"),
        progress: sourceText,
        message: (agents) => t("chat.trace.step.message", { agents }),
        subagent: (title) => t("chat.trace.step.subagent", { title }),
        reply: t("chat.trace.step.reply"),
        agentNames: (ids) =>
          format.list(
            ids.map(
              (id) => props.agents.find((candidate) => candidate.id === id)?.name ?? t("chat.message.agentFallback"),
            ),
          ),
      }),
    keyboard: traceKeyboard,
    // The chat shows a subagent of the trace in the side panel, as its card in the chat does.
    canSelectSpan: (id) => id.startsWith(SUBAGENT_SPAN_PREFIX),
    onSelectSpan: (id) => {
      const subagentId = id.slice(SUBAGENT_SPAN_PREFIX.length);
      if (shownSubagentId() !== subagentId) toggleSubagentPanel(subagentId);
    },
  });
  /** The Natural style shows the plain activity line: what the agent does now, and nothing more. */
  const plainActivity = () => !channel && props.responseStyle === "natural";
  const channelWorkingSteps = createMemo(() => (channel ? turnSteps.workingSteps(channel.workingTurns()) : []));
  /*
   * The channel's activity line leaves as the agent chat's line does: it waits a moment for the next
   * member, then folds away with the workers and steps it last showed. When it went at once, the chat
   * above it jumped down.
   */
  const [channelActivity, setChannelActivity] = createSignal<{
    workers: ChannelWorker[];
    steps: readonly AgentStep[];
    phase: "active" | "exiting";
  } | null>(null);
  createEffect(
    (): ChannelWorker[] => channel?.workers() ?? [],
    (workers) => {
      if (workers.length > 0) {
        setChannelActivity({
          workers,
          steps: untrack(channelWorkingSteps),
          phase: "active",
        });
        return;
      }
      if (!untrack(channelActivity)) return;
      let exitTimer: number | undefined;
      const delayTimer = window.setTimeout(() => {
        setChannelActivity((latest) => latest && { ...latest, phase: "exiting" });
        exitTimer = window.setTimeout(() => setChannelActivity(null), agentActivityExitDuration());
      }, agentActivityExitDelay());
      return () => {
        window.clearTimeout(delayTimer);
        window.clearTimeout(exitTimer);
      };
    },
  );
  createEffect(channelWorkingSteps, (steps) => {
    if (untrack(channelActivity)?.phase === "active" && untrack(() => channel?.workers().length))
      setChannelActivity((latest) => latest && { ...latest, steps });
  });
  /**
   * A direct chat with no message yet, and no turn, queued send, welcome or question. A queued send leaves the
   * timeline for the queue tray, and the activity line shows only after a delay, so both are read here.
   * Its empty state plays a faint turn from the agent's own routine and skill.
   */
  const emptyAgent = createMemo(() =>
    !channel &&
    timelineMessages().length === 0 &&
    !props.hasOlder &&
    !props.activeTurnId &&
    presentedQueueDeliveries().length === 0 &&
    !(props.queue?.welcome && props.queue.agentId === props.agent?.id) &&
    !renderedAgentActivity() &&
    !props.prompt
      ? props.agent
      : undefined,
  );
  const sampleRoutinePrompt = () =>
    props.routines?.find((routine) => routine.active && routine.instruction.trim())?.instruction ??
    props.routines?.find((routine) => routine.instruction.trim())?.instruction;
  // A skill of the agent's own: every agent has the managed OpenBot skills.
  const sampleSkillName = () =>
    installedSkills().find((skill) => skill.enabled !== false && skill.origin !== "managed")?.name;
  return (
    <>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.prompt
          ? t("prompt.inputRequiredAnnouncement", {
              question: markdownPlainText(props.prompt.questions[0]?.question ?? ""),
            })
          : ""}
      </span>
      <Show when={chatSearchOpen() && !sideThreadOpen()}>
        <ChatSearch
          query={chatSearchQuery()}
          current={activeChatSearchIndex()}
          total={props.onSearchMessages ? chatSearchTotal() : chatSearchMatches().length}
          inputRef={setChatSearchInputElement}
          onQueryChange={setChatSearchQuery}
          onPrevious={() => moveChatSearch(-1)}
          onNext={() => moveChatSearch(1)}
          onClose={closeChatSearch}
        />
      </Show>

      <Show when={props.unreadCount > 0 && !unreadDividerVisible() && !sideThreadOpen()}>
        <UnreadMessagesBanner
          count={props.unreadCount}
          busy={markingRead()}
          onJumpToUnread={jumpToUnreadMessages}
          onMarkRead={() => void markUnreadMessages()}
        />
      </Show>

      <SubagentDock
        subagents={subagentDock.subagents()}
        cardHeader={subagentDock.cardHeader}
        onReveal={() => void revealSubagents()}
      />

      <div
        class={["conversation-scroll", scrollFades.classes(), { "conversation-covered": sideThreadOpen() }]}
        inert={sideThreadOpen()}
        ref={(element) => {
          timelineScrollElement = element;
          setScrollElement(element);
          rail.ref(element);
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          followReaderScroll(element);
          updateScrollFade(element);
          updateUnreadDividerVisibility();
          replyJump.updateReturnVisibility();
          subagentDock.update();
        }}
      >
        <ChatScrollRail {...rail.props} />
        <Show
          when={replyJump.returnReplyId()}
          fallback={
            <Show when={showScrollToLatest() || props.discontinuous}>
              <ScrollToLatestButton
                onClick={() => void jumpToLatestMessage()}
                newMessageCount={newMessageCount()}
                onDismiss={clearNewMessages}
              />
            </Show>
          }
        >
          <ReplyReturnButton onBack={() => void replyJump.returnToReply()} onStay={replyJump.stayHere} />
        </Show>
        <Show when={props.loaded}>
          <Show when={props.loadingOlder || props.olderError}>
            <div class="conversation-history-status" role={props.olderError ? "alert" : "status"}>
              <Show when={props.olderError} fallback={t("chat.history.loadingOlder")}>
                <span>{props.olderError}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => props.onLoadOlder?.()}>
                  {t("common.retry")}
                </Button>
              </Show>
            </div>
          </Show>
          {channel ? (
            <Show when={timelineMessages().length === 0}>
              <channel.EmptyState />
            </Show>
          ) : (
            <Show when={emptyAgent()}>
              {(agent) => (
                <AgentChatEmptyState
                  agent={agent()}
                  samplePrompt={sampleRoutinePrompt()}
                  sampleSkillName={sampleSkillName()}
                />
              )}
            </Show>
          )}
          <div
            ref={setVirtualRootElement}
            class={["virtual-chat-list", { "virtual-chat-list-static": !messageVirtualizer.isVirtualized() }]}
            style={{ height: messageVirtualizer.isVirtualized() ? `${messageVirtualizer.getTotalSize()}px` : "auto" }}
          >
            <For each={virtualMessageRows()}>
              {(virtualRow) => {
                // The row's own message, found by id: `virtualRow.index` can be stale for a tick.
                const index = createMemo(() => timelineIndexById().get(virtualRow.key));
                const message = createMemo(() => {
                  const current = index();
                  return current === undefined ? undefined : timelineMessages()[current];
                });
                const previousMessage = () => {
                  const current = index();
                  return current === undefined ? undefined : timelineMessages()[current - 1];
                };
                const initialMessage = untrack(message);
                if (!initialMessage) return null;
                const arrives = untrack(() => initialMessage.animate === true && markMessageSeen(initialMessage.id));
                const initialActionMarker = untrack(() => initialMessage.actionMarker);
                // Each state of a routine run is a new message, so the run's row is drawn again for
                // each one. The run enters once, the first time a row of it is drawn; each new state
                // is still announced.
                const animateEntrance =
                  initialActionMarker?.kind === "routine-run"
                    ? untrack(() => markMessageSeen(`routine-run:${initialActionMarker.runId}`)) && arrives
                    : arrives;
                /*
                 * The separator above the row. The first row always carries one, and a later row
                 * carries one when it opens a new day. The agent chat shows no time under a message,
                 * so a pause of an hour or more also gets one there. A message with no stored timestamp can only
                 * open the transcript, so it falls back to the time it prints in its footer.
                 */
                const dayMarker = createMemo(() => {
                  const current = message();
                  if (!current) return null;
                  const previous = previousMessage();
                  if (current.createdAt)
                    return dayMarkerLabel(previous?.createdAt, current.createdAt, {
                      t,
                      format,
                      ...(channel || !compactActions() ? {} : { gapMs: AGENT_CHAT_TIME_GAP_MS }),
                    });
                  return previous === undefined ? (current.time ?? t("chat.day.now")) : null;
                });
                /*
                 * A row that continues a run by the same sender draws no time: the run carries one
                 * time at its top, and a header on every row leaves an empty line between them. A
                 * row that draws a marker of its own opens a run, because the marker stands between
                 * it and the message above it.
                 */
                const continuesRun = createMemo(() => {
                  const current = message();
                  if (!current) return false;
                  if (current.id === unreadBoundaryMessageId() || current.actionMarker) return false;
                  const previous = previousMessage();
                  return continuesSenderRun(previous && senderRunRow(previous), senderRunRow(current), {
                    previousDrawsTime: previous !== undefined && rowDrawsTime(previous),
                    startsDay: dayMarker() !== null,
                  });
                });
                const author = createMemo((): ChatMessageAuthor => {
                  const current = message();
                  const sender = otherSender(current);
                  if (sender) return memberAuthor(sender);
                  if (current?.author === "you")
                    return { kind: "you", name: t("chat.message.you"), chatColor: ownChatColor() };
                  if (channel && current) return channel.author(current);
                  // The profile gives the row the agent's color, for the name and the bubble tint.
                  return {
                    kind: "agent",
                    name: props.agent?.name ?? t("chat.message.agentFallback"),
                    agent: props.agent,
                  };
                });
                const referencedMessage = createMemo(() => {
                  const replyToMessageId = message()?.replyToMessageId;
                  if (!replyToMessageId) return undefined;
                  return (
                    timelineMessages().find((candidate) => candidate.id === replyToMessageId) ??
                    props.messageReferences?.[replyToMessageId]
                  );
                });
                const openReference = () => {
                  const current = message();
                  if (current) void replyJump.openReference(current);
                };
                // A quote of another person's message names them; any other quote keeps its label.
                const referencedAuthorName = () => {
                  const referenced = referencedMessage();
                  const sender = otherSender(referenced);
                  if (sender) return memberAuthor(sender).name;
                  return channel && referenced?.author === "agent" ? channel.author(referenced).name : undefined;
                };
                // A workspace path is in the workspace of the agent that wrote it. A person's message in
                // a channel names no agent, so its paths stay text.
                const workspaceAgentId = () => {
                  if (!channel) return props.agent?.id;
                  const current = message();
                  return current?.author === "agent" ? current.senderAgentId : undefined;
                };
                // A bare file name can be a file that the same turn attached, from a subfolder or a tool
                // that reports no path. It opens when the workspace has no such file (#5189).
                const turnAttachment = (path: string) => {
                  const turnId = message()?.turnId;
                  if (!turnId || /[/\\]/u.test(path)) return undefined;
                  const matches = timelineMessages()
                    .filter((candidate) => candidate.turnId === turnId)
                    .flatMap((candidate) => candidate.attachments ?? [])
                    .filter((attachment) => attachment.name === path);
                  return matches.length === 1 ? matches[0] : undefined;
                };
                const imageScope = () => ({
                  serverId: props.server?.id ?? "local",
                  messageId: message()?.id ?? initialMessage.id,
                  agentId: workspaceAgentId(),
                });
                // A chip joins a file name to the folder that the message names. When nothing is there,
                // the name opens as the agent wrote it, from its workspace (#5270).
                const writtenFile = (asWritten: string | undefined) => {
                  const agentId = workspaceAgentId();
                  return asWritten && agentId
                    ? () => openWorkspaceFile(asWritten, undefined, agentId, "tab", turnAttachment(asWritten))
                    : undefined;
                };
                // A row the host has not drawn yet has no reactions, replies or menu: its id is not the
                // host's, even after the host answered.
                const hostless = createMemo(() => message()?.id.startsWith(PENDING_SEND_ID_PREFIX) === true);
                // The text before a waiting question is a step of the turn (#4897). A step keeps no
                // reaction, reply or menu, and the row goes back into the steps after the answer.
                const turnStep = createMemo(() => message()?.itemType === "commentary");
                const pendingSend = createMemo(() => {
                  const send = pendingSendFor(message()?.id);
                  return send && send.state !== "sent" ? send : undefined;
                });
                // The status line stays one element while its state changes, so its live region speaks.
                const pending = createMemo(() => pendingSend() !== undefined);
                // Only the kind rebuilds the player, so its controls keep focus when it starts or stops.
                const player = createMemo(() => voicePlayer(message()));
                const playerKind = createMemo(() => player()?.kind);
                // Only a reply has a speed: the user's own recording plays at normal speed.
                const replySpeed = () => (playerKind() === "reply" ? speechSpeed() : undefined);
                const replySpeedChange = () => (playerKind() === "reply" ? cycleSpeechSpeed : undefined);
                const pendingState = () => {
                  const state = pendingSend()?.state;
                  return state === "failed" || state === "waiting" ? state : "sending";
                };
                const pendingRetrySafe = () => {
                  const send = pendingSend();
                  return send ? pendingSendRetrySafe(send) : false;
                };
                const markerOnly = untrack(() => markerOnlyMessage(initialMessage));
                // Consecutive markers keep the tighter marker gap so they read as one group.
                const groupedWithMarker = createMemo(() => {
                  const current = message();
                  if (!current?.actionMarker) return false;
                  if (current.id === unreadBoundaryMessageId()) return false;
                  const previous = previousMessage();
                  return previous !== undefined && markerRowEndsWithMarker(previous);
                });
                if (markerOnly) {
                  return (
                    <div
                      data-index={virtualRow.index}
                      data-grouped={groupedWithMarker() ? "marker" : undefined}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          data-chat-search-group={groupedMessageIds(message())}
                          class={{ "chat-action-entry-animated": animateEntrance }}
                        >
                          <Show when={message()?.actionMarker ?? initialActionMarker}>
                            {(marker) => (
                              <Show
                                when={routineCard(message() ?? initialMessage, marker())}
                                fallback={
                                  <Show
                                    when={skillSuggestionMarker(marker())}
                                    fallback={
                                      <Show
                                        when={suggestionMarker(marker())}
                                        fallback={
                                          <Show
                                            when={mcpSignInConfig(marker())}
                                            fallback={
                                              <Show
                                                when={webhookRoutineCard(message() ?? initialMessage, marker())}
                                                fallback={
                                                  <Show
                                                    when={serverInstallCard(marker())}
                                                    fallback={
                                                      <ChatActionMarker
                                                        onOpenSkill={
                                                          agentSkillsMode(props.server, props.runtime) === "hidden"
                                                            ? undefined
                                                            : openSkillSettings
                                                        }
                                                        marker={marker()}
                                                        agents={props.agents}
                                                        announce={arrives}
                                                        routineAvailable={routineMarkerAvailable(
                                                          marker(),
                                                          availableRoutineIds(),
                                                        )}
                                                        onSelectAgent={props.onSelectAgent}
                                                        onOpenRoutine={openRoutineSettings}
                                                        openRoutineThread={openRoutineThread}
                                                        onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                                                        onOpenLink={(url) => void openExternalMessageUrl(url)}
                                                        onToggleRoutineRun={toggleRoutineRun}
                                                        onToggleAgentMessage={toggleAgentMessage}
                                                        agentMessageText={agentMessageText}
                                                        instructions={instructionsCalls()}
                                                        onOpenInstructions={
                                                          channel || !instructionsCalls()
                                                            ? undefined
                                                            : openInstructionsSettings
                                                        }
                                                      />
                                                    }
                                                  >
                                                    {(card) => (
                                                      <ServerInstallChatCard
                                                        messageId={message()?.id ?? initialMessage.id}
                                                        name={card().marker.name}
                                                        expiresAt={card().marker.expiresAt}
                                                        watch={card().watch}
                                                      />
                                                    )}
                                                  </Show>
                                                }
                                              >
                                                {(card) => (
                                                  <RoutineWebhookChatCard
                                                    api={card().api}
                                                    action={card().action}
                                                    routine={card().routine}
                                                    connected={webhookRoutines.state.connected}
                                                    secret={webhookRoutines.state.secrets[card().routine.id] ?? null}
                                                    onSecret={(secret) =>
                                                      webhookRoutines.setSecret(card().routine.id, secret)
                                                    }
                                                    onOpenRoutine={openRoutineSettings}
                                                  />
                                                )}
                                              </Show>
                                            }
                                          >
                                            {(config) => (
                                              <McpSignInChatCard
                                                config={config()}
                                                signedIn={props.mcpSignedIn?.(config().id) ?? false}
                                                onSignIn={
                                                  props.onOpenMcpSignIn
                                                    ? (trigger) => props.onOpenMcpSignIn?.(config().id, trigger)
                                                    : undefined
                                                }
                                                onContinue={sendCardMessage}
                                              />
                                            )}
                                          </Show>
                                        }
                                      >
                                        {(suggestion) => (
                                          <MarketplaceSuggestionChatCard
                                            messageId={message()?.id ?? initialMessage.id}
                                            appId={suggestion().appId}
                                            connectors={props.connectors}
                                            mcpServers={mcpServers()}
                                            onOpenMarketplaceApp={props.onOpenMarketplaceApp}
                                          />
                                        )}
                                      </Show>
                                    }
                                  >
                                    {(suggestion) => (
                                      <SkillSuggestionChatCard
                                        messageId={message()?.id ?? initialMessage.id}
                                        suggestion={suggestion()}
                                        outcome={skillSuggestionOutcome(
                                          timelineMessages(),
                                          message()?.id ?? initialMessage.id,
                                          suggestion(),
                                          Boolean(props.activeTurnId),
                                        )}
                                        onSave={sendCardMessage}
                                        onSaveSkill={() => saveSkillSuggestion(message()?.id ?? initialMessage.id)}
                                        onOpenSkill={skillOpener()}
                                      />
                                    )}
                                  </Show>
                                }
                              >
                                {(card) => (
                                  <RoutineChatCard
                                    action={card().action}
                                    routine={card().routine}
                                    agentId={card().agentId}
                                    onOpenRoutine={openRoutineSettings}
                                  />
                                )}
                              </Show>
                            )}
                          </Show>
                          <Show
                            when={
                              initialMessage.exchange?.direction === "incoming" &&
                              (message()?.attachments?.length ?? 0) > 0
                            }
                          >
                            <div class="chat-action-attachments">
                              <AttachmentCards
                                attachments={message()?.attachments ?? []}
                                mediaSource={runtime.attachmentMedia}
                                downloads={attachmentDownloads}
                                onPreview={(attachment) => void previewAttachment(attachment)}
                                onAction={attachmentAction}
                              />
                            </div>
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "plan")) {
                  // A plan has no bubble, reactions or time: it is the agent's live checklist.
                  const plan = () => message()?.plan ?? initialMessage.plan;
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          class={{ "message-entry-animated": animateEntrance }}
                        >
                          <Show when={plan()}>
                            {(current) => (
                              <TaskList
                                items={planItems(current(), message()?.streaming === true)}
                                title={planTitle(current())}
                                defaultOpen={untrack(() => initialMessage.streaming === true)}
                              />
                            )}
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "subagents")) {
                  // The subagents have no bubble, reactions or time: they are the live work of the turn.
                  const subagents = () => message()?.subagents ?? initialMessage.subagents;
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          class={{ "message-entry-animated": animateEntrance }}
                        >
                          <Show when={subagents()}>
                            {(current) => (
                              <SubagentGroup
                                subagents={current()}
                                selectedId={shownSubagentId()}
                                onOpen={toggleSubagentPanel}
                              />
                            )}
                          </Show>
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                if (untrack(() => initialMessage.kind === "memory-changes" || initialMessage.kind === "thinking")) {
                  // Only a finished turn with no answer gets this row: an answer shows the steps above it.
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article data-chat-search-message={message()?.id}>
                          <AgentStepsDisclosure
                            steps={turnSteps.stepsOfTurn((message() ?? initialMessage).turnId)}
                            defaultOpen={showAgentSteps()}
                          />
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                const initialVisual = untrack(() => chatVisualReply(initialMessage));
                // The desktop loads the page from its own scheme. The web client has no page URL: it
                // reads the HTML and shows it as `srcdoc`. Another client shows the title and file.
                const loadPage = runtime.visualPage;
                if (initialVisual && (chatVisualPageUrl(initialVisual.attachment.previewUrl) || loadPage)) {
                  // A visual reply is the agent's page. It shows above the final reply, with no bubble.
                  const visual = () => chatVisualReply(message() ?? initialMessage) ?? initialVisual;
                  const pageUrl = () => chatVisualPageUrl(visual().attachment.previewUrl);
                  // The page quotes as its file, as in the side panel, so the quote chip opens the page.
                  const pageQuoteId = () =>
                    fileQuoteId({
                      source: "attachment",
                      attachmentId: visual().attachment.id,
                      name: visual().attachment.name,
                    });
                  const [page, setPage] = createSignal<{ html?: string; failed?: boolean }>({});
                  if (loadPage && !pageUrl()) {
                    let mounted = true;
                    onCleanup(() => {
                      mounted = false;
                    });
                    void loadPage(initialVisual.attachment).then(
                      (html) => {
                        if (mounted) setPage({ html });
                      },
                      () => {
                        if (mounted) setPage({ failed: true });
                      },
                    );
                  }
                  return (
                    <div
                      data-index={virtualRow.index}
                      ref={messageVirtualizer.measureElement}
                      class="virtual-chat-row"
                      style={{
                        transform: messageVirtualizer.isVirtualized()
                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={message()?.id === compactionBefore()}>
                        <CompactionMarker />
                      </Show>
                      <Show when={dayMarker()}>
                        {(label) => (
                          <div class="time-marker">
                            <span>{label()}</span>
                          </div>
                        )}
                      </Show>
                      <Show when={message()?.id === unreadBoundaryMessageId()}>
                        <UnreadMessagesDivider
                          animateIn={unreadDividerArrives}
                          elementRef={(element) => {
                            setUnreadMessagesDividerElement(element);
                            scheduleUnreadDividerVisibilityUpdate();
                          }}
                        />
                      </Show>
                      <ChatRowBoundary>
                        <article
                          data-chat-search-message={message()?.id}
                          aria-label={(message() ?? initialMessage).body}
                          class={{ "message-entry-animated": animateEntrance }}
                        >
                          <ChatVisual
                            src={pageUrl()}
                            html={page().html}
                            failed={pageUrl() === undefined && (!loadPage || page().failed === true)}
                            title={(message() ?? initialMessage).body}
                            height={visual().height}
                            onOpenLink={(url) => void openExternalMessageUrl(url)}
                            onMessage={addPageText}
                            onContext={(text) => setPageContext(message() ?? initialMessage, text)}
                            onQuote={(text) => quoteSelection(pageQuoteId(), text)}
                            quoteShortcut={deviceQuoteShortcut(props.platform)}
                            onOpenInSidePanel={() => void previewAttachment(visual().attachment)}
                            isAppShortcut={isChatVisualAppShortcut}
                            macWindowControls={props.platform === "darwin"}
                          />
                        </article>
                      </ChatRowBoundary>
                    </div>
                  );
                }
                const displayedReactions = createMemo(() => {
                  const currentMessage = message();
                  if (currentMessage?.reactions?.length) return currentMessage.reactions;
                  if (currentMessage?.reaction) {
                    return [{ emoji: currentMessage.reaction, actor: { kind: "user" as const } }];
                  }
                  return (currentMessage?.reactionSummary?.emojis ?? []).map((emoji) => ({
                    emoji,
                    actor: { kind: "user" as const },
                  }));
                });
                // The action row and the right-click menu run the same actions.
                const messageActions = {
                  onReact: (emoji: MessageReaction | null) => {
                    const currentMessage = message();
                    if (currentMessage) void reactToMessage(currentMessage, emoji);
                  },
                  onReply: () => {
                    const currentMessage = message();
                    if (currentMessage) replyToMessage(currentMessage);
                  },
                  onCopy: () => {
                    const currentMessage = message();
                    if (currentMessage) void copyMessage(currentMessage);
                  },
                };
                // An agent's actions stand beside its answer, and its steps show with them and open only the
                // trace. In an agent chat, "Show agent steps" keeps the open list above the answer.
                const stepsInRow = () =>
                  author().kind === "agent" && !message()?.questionPrompt && (Boolean(channel) || !showAgentSteps());
                // The reader's own actions stand beside the bubble, so a run of their messages sits close.
                const actionsBeside = () => stepsInRow() || author().kind === "you";
                const stepsDisclosure = () => (
                  <Show when={turnSteps.stepsAbove(message()?.id)}>
                    {(steps) => (
                      <AgentStepsDisclosure
                        steps={steps()}
                        defaultOpen={showAgentSteps()}
                        list={!stepsInRow()}
                        trace={traceAbove(
                          message()?.id,
                          channel && author().kind === "agent" ? author().name : undefined,
                        )}
                        facts={turnSteps.factsAbove(message()?.id)}
                      />
                    )}
                  </Show>
                );
                const messageReadAloud = () =>
                  spokenReplyIds().has((message() ?? initialMessage).id)
                    ? undefined
                    : readAloudAction(message() ?? initialMessage);
                // The right-click menu and the More button of the action row show the same items.
                const menuItems = (): MessageMenuItemsProps => ({
                  message: message() ?? initialMessage,
                  reactions: !channel,
                  ...messageActions,
                  readAloud: messageReadAloud(),
                  onMarkUnread: markUnreadAction(message() ?? initialMessage),
                  sendToChannel: sendToChannelAction(message() ?? initialMessage),
                  onBranch: branchAction(message() ?? initialMessage),
                  branchDisabled: Boolean(props.activeTurnId),
                  onDelete: deleteAction(message() ?? initialMessage),
                });
                /*
                 * With "Compact message actions" on, the row shows React, Reply and More. With it off, the row
                 * shows every action and the time, as before. Named functions keep the conditions out of the
                 * component props.
                 */
                const rowMenu = () => (compactActions() ? () => <MessageMenuItems {...menuItems()} /> : undefined);
                const rowCopy = () => (compactActions() ? undefined : messageActions.onCopy);
                const rowCopied = () => !compactActions() && copiedMessageId() === message()?.id;
                const rowReadAloud = () => (compactActions() ? undefined : messageReadAloud());
                const rowBranch = () => (compactActions() ? undefined : branchAction(message() ?? initialMessage));
                const rowActionTime = () => Boolean(channel) || !compactActions();
                return (
                  <div
                    data-index={virtualRow.index}
                    data-grouped={groupedWithMarker() ? "marker" : continuesRun() ? "sender" : undefined}
                    ref={messageVirtualizer.measureElement}
                    class="virtual-chat-row"
                    style={{
                      transform: messageVirtualizer.isVirtualized()
                        ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`
                        : "none",
                    }}
                  >
                    <Show when={message()?.id === compactionBefore()}>
                      <CompactionMarker />
                    </Show>
                    <Show when={dayMarker()}>
                      {(label) => (
                        <div class="time-marker">
                          <span>{label()}</span>
                        </div>
                      )}
                    </Show>
                    <Show when={message()?.id === unreadBoundaryMessageId()}>
                      <UnreadMessagesDivider
                        animateIn={unreadDividerArrives}
                        elementRef={(element) => {
                          setUnreadMessagesDividerElement(element);
                          scheduleUnreadDividerVisibilityUpdate();
                        }}
                      />
                    </Show>
                    <Show when={!stepsInRow() && turnSteps.stepsAbove(message()?.id)}>
                      <ChatRowBoundary>{stepsDisclosure()}</ChatRowBoundary>
                    </Show>
                    <ChatRowBoundary>
                      <Show
                        when={message()?.questionPrompt}
                        keyed
                        fallback={
                          <ChatMessageRow
                            message={message() ?? initialMessage}
                            author={author()}
                            showFull={
                              chatSearchOpen() && chatSearchOpensMessage(message()?.body ?? "", chatSearchQuery())
                            }
                            open={quotedMessageId() === message()?.id && chatSearchCanOpen(message()?.body ?? "")}
                            showAuthor={
                              author().kind === "member" || (channel && author().kind === "agent")
                                ? !continuesRun()
                                : undefined
                            }
                            showTime={!continuesRun()}
                            actionRow={!turnStep()}
                            actionTime={rowActionTime()}
                            steps={stepsInRow() ? stepsDisclosure() : undefined}
                            actionsBeside={actionsBeside()}
                            animate={animateEntrance}
                            // Natural shows a message once it is complete, in an agent chat and in a channel.
                            // Its bubble enters with all of its text, so the height does not grow while the
                            // words fade in, and a complete answer does not look as if it still arrives.
                            textAtOnce={props.responseStyle === "natural"}
                            agents={props.agents}
                            skills={installedSkills()}
                            referencedMessage={referencedMessage()}
                            referencedAuthorName={referencedAuthorName()}
                            onOpenReference={openReference}
                            referenceState={replyJump.referenceState(message(), referencedMessage())}
                            reactions={channel ? undefined : displayedReactions()}
                            reactionOverflowCount={message()?.reactionSummary?.overflowCount}
                            onRemoveReaction={() => {
                              const currentMessage = message();
                              if (currentMessage) void reactToMessage(currentMessage, null);
                            }}
                            data-chat-search-message={message()?.id}
                            onSelectAgent={props.onSelectAgent}
                            onOpenLink={(url) => void openExternalMessageUrl(url)}
                            onPreview={(attachment) => void previewAttachment(attachment)}
                            onAttachmentAction={attachmentAction}
                            onOpenSharedFile={(path, asWritten) => openSharedFile(path, "tab", writtenFile(asWritten))}
                            onOpenWorkspaceFile={
                              workspaceAgentId()
                                ? (path, asWritten) =>
                                    openWorkspaceFile(
                                      path,
                                      undefined,
                                      workspaceAgentId(),
                                      "tab",
                                      turnAttachment(path),
                                      writtenFile(asWritten),
                                    )
                                : undefined
                            }
                            onOpenQuote={openQuote}
                            onOpenTag={openTaggedReference}
                            onDownload={(attachment) => attachmentAction(attachment, "download")}
                            mediaSource={runtime.attachmentMedia}
                            downloads={attachmentDownloads}
                            macWindowControls={props.platform === "darwin"}
                            loadImageFile={messageImageFiles && ((file) => messageImageFiles.load(file, imageScope()))}
                            onDownloadImageFile={
                              messageImageFiles &&
                              ((file) =>
                                downloadMessageImageFile(
                                  messageImageFiles.source(file, imageScope()),
                                  workspaceAgentId(),
                                ))
                            }
                            actions={
                              <>
                                <Show when={pending()}>
                                  <PendingSendStatus
                                    state={pendingState()}
                                    updateRequired={Boolean(providerUpdateRequired())}
                                    error={pendingSend()?.error ?? null}
                                    errorReference={pendingSend()?.errorReference ?? null}
                                    retrySafe={pendingRetrySafe()}
                                    canEdit={!composerHasContent() && !editingDeliveryId()}
                                    onRetry={() => {
                                      const send = pendingSend();
                                      if (send) retryPendingSend(send.clientMessageId);
                                    }}
                                    onEdit={() => {
                                      const send = pendingSend();
                                      if (send) editPendingSend(send.clientMessageId);
                                    }}
                                    onDismiss={() => {
                                      const send = pendingSend();
                                      if (send) dismissPendingSend(send.clientMessageId);
                                    }}
                                  />
                                </Show>
                                <Show when={!hostless() && !turnStep()}>
                                  <MessageActions
                                    message={message() ?? initialMessage}
                                    pickerOpen={openReactionMessageId() === message()?.id}
                                    expandedEmoji={expandedEmojiMessageId() === message()?.id}
                                    reactions={!channel}
                                    authorName={channel ? author().name : undefined}
                                    onTogglePicker={() => {
                                      const messageId = message()?.id;
                                      if (!messageId) return;
                                      setOpenReactionMessageId((current) => (current === messageId ? null : messageId));
                                      setExpandedEmojiMessageId(null);
                                    }}
                                    onExpandEmoji={() => {
                                      const messageId = message()?.id;
                                      if (!messageId) return;
                                      setExpandedEmojiMessageId((current) =>
                                        current === messageId ? null : messageId,
                                      );
                                    }}
                                    onReact={messageActions.onReact}
                                    onReply={messageActions.onReply}
                                    menu={rowMenu()}
                                    onCopy={rowCopy()}
                                    copied={rowCopied()}
                                    readAloud={rowReadAloud()}
                                    onBranch={rowBranch()}
                                    branchDisabled={Boolean(props.activeTurnId)}
                                  />
                                </Show>
                              </>
                            }
                            menu={
                              hostless() || turnStep()
                                ? undefined
                                : () => (
                                    <MessageMenu {...menuItems()} authorName={channel ? author().name : undefined} />
                                  )
                            }
                          >
                            <Show when={playerKind()}>
                              {(kind) => (
                                <VoicePlayer
                                  kind={kind()}
                                  state={player()?.state ?? "idle"}
                                  peaks={player()?.peaks}
                                  duration={player()?.duration}
                                  elapsed={player()?.elapsed}
                                  levels={player()?.levels}
                                  onToggle={() => player()?.onToggle()}
                                  onSeek={(seconds) => player()?.onSeek?.(seconds)}
                                  speed={replySpeed()}
                                  onCycleSpeed={replySpeedChange()}
                                />
                              )}
                            </Show>
                          </ChatMessageRow>
                        }
                      >
                        {(questionPrompt) => (
                          <Show
                            when={frozenUiBlock(message())}
                            fallback={
                              <Show when={questionPrompt.resolution} keyed>
                                {(resolution) => (
                                  <article
                                    data-chat-search-message={message()?.id}
                                    class="question-prompt-history-entry"
                                  >
                                    <QuestionPromptBubble
                                      questions={questionPrompt.questions}
                                      resolution={resolution}
                                      onSubmit={async () => false}
                                      onOpenLink={(url) => void openExternalMessageUrl(url)}
                                    />
                                  </article>
                                )}
                              </Show>
                            }
                          >
                            {(block) => (
                              <article data-chat-search-message={message()?.id} class="question-prompt-history-entry">
                                <UiBlockPrompt
                                  block={block()}
                                  agents={props.agents}
                                  onSelectAgent={props.onSelectAgent}
                                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                                />
                              </article>
                            )}
                          </Show>
                        )}
                      </Show>
                    </ChatRowBoundary>
                  </div>
                );
              }}
            </For>
          </div>
          <div class="conversation-live">
            <Show when={!compactionBefore()}>
              <CompactionMarker />
            </Show>
            {/* Under an open side thread, the thread draws the card of its own question. */}
            <Show when={!sideThreadOpen()}>
              <ConversationQuestionPrompt
                elementRef={setRequiredInteractionElement}
                registerComposerAnswer={registerPromptComposerAnswer}
              />
            </Show>
            <Show keyed when={props.approval ?? heldFeedback()}>
              {(approval) => (
                <Loading>
                  <ApprovalCard
                    approval={approval}
                    agentName={interactionAgentName()}
                    sending={heldFeedback() !== undefined}
                    onApprove={() => approve(approval)}
                    onReject={() => props.onRespondToApproval("decline")}
                    onAlwaysAllow={props.onAlwaysAllowApproval}
                  />
                </Loading>
              )}
            </Show>
            <Show when={props.usageLimitAsk}>
              {(ask) => (
                <UsageLimitAskCard
                  provider={ask().provider}
                  model={ask().model}
                  agentName={ask().agentName}
                  resetsAt={ask().resetsAt}
                  options={ask().options}
                  onSend={ask().onSend}
                  onWait={ask().onWait}
                />
              )}
            </Show>
            {/* Under an open side thread, the thread draws the card of its own request. */}
            <Show when={!sideThreadOpen()}>
              <ConversationBrowserTakeover />
            </Show>
            {/* The working line goes under an open card, as the steps line goes under an agent message. */}
            <div
              class="agent-activity-slot"
              data-reserved={agentActivitySpaceReserved() ? "true" : "false"}
              ref={setAgentActivitySlotElement}
            >
              <Show
                when={!channel}
                fallback={
                  <Show when={channelActivity()}>
                    {(activity) => (
                      <ChannelActivityIndicator
                        workers={activity().workers}
                        steps={activity().steps}
                        phase={activity().phase}
                        stepsOpenByDefault={showAgentSteps()}
                      />
                    )}
                  </Show>
                }
              >
                <Show when={renderedAgentActivity()}>
                  {(activity) => (
                    <AgentActivityIndicator
                      agent={activity().agent}
                      detail={activity().detail}
                      label={activity().label}
                      phase={activity().phase}
                      since={activity().since}
                      steps={turnSteps.activeSteps()}
                      stepsOpenByDefault={showAgentSteps()}
                      waitingFor={waitingProviderName()}
                      plain={plainActivity()}
                      activity={activeStepActivity()}
                    />
                  )}
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>
      <DeleteMessageDialog
        messageId={deleteTargetId()}
        onDelete={deleteMessage}
        onClose={() => setDeleteTargetId(null)}
      />
    </>
  );
}

const ApprovalCard = lazy(() =>
  import("@openbot/ui/features/conversation/ConversationPrompts").then((module) => ({ default: module.ApprovalCard })),
);
const QuestionPromptBubble = lazy(() =>
  import("@openbot/ui/components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
const UiBlockPrompt = lazy(() => import("./UiBlockPrompt").then((module) => ({ default: module.UiBlockPrompt })));
