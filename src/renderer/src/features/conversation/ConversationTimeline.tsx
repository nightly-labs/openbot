import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { ConversationMessageSender, MessageReaction } from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import { Button } from "@openbot/ui";
import type { AgentMessage, ChatActionMarkerModel } from "@openbot/ui/data";
import { ChannelActivityIndicator } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { AgentChatEmptyState } from "@openbot/ui/features/conversation/AgentChatEmptyState";
import { AgentStepsDisclosure, type AgentStepsTrace } from "@openbot/ui/features/conversation/AgentSteps";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { UsageLimitAskCard } from "@openbot/ui/features/conversation/BackupModels";
import { ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ChatRowBoundary } from "@openbot/ui/features/conversation/ChatRowBoundary";
import { ChatScrollRail, createChatScrollRail } from "@openbot/ui/features/conversation/ChatScrollRail";
import { ChatSearch } from "@openbot/ui/features/conversation/ChatSearch";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { ContextCompactionMarker, type ContextCompactionView } from "@openbot/ui/features/conversation/ContextUsage";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";
import { ReplyReturnButton, ScrollToLatestButton } from "@openbot/ui/features/conversation/MessageNavigation";
import { MessageActions, MessageMenu } from "@openbot/ui/features/conversation/MessageRendering";
import { PendingSendStatus } from "@openbot/ui/features/conversation/PendingSendStatus";
import { SubagentGroup } from "@openbot/ui/features/conversation/Subagents";
import { TaskList } from "@openbot/ui/features/conversation/TaskList";
import { UnreadMessagesBanner, UnreadMessagesDivider } from "@openbot/ui/features/conversation/UnreadMessages";
import { VoicePlayer } from "@openbot/ui/features/conversation/VoicePlayer";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Loading, lazy, onCleanup, Show, untrack } from "solid-js";
import { useShowAgentSteps } from "../../agent-steps-preference";
import { planItems, planTitle } from "../../app-message-projection";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import { remoteRoutineRecovery } from "../servers/server-capabilities";
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
import { groupedMessageIds } from "./agent-message-timeline";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { continuesSenderRun } from "./chat-grouping";
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
import { PENDING_SEND_ID_PREFIX, pendingSendRetrySafe } from "./stores/pending-send-store";
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
function rowDrawsTime(message: AgentMessage): boolean {
  return (
    !markerOnlyMessage(message) &&
    !message.questionPrompt &&
    message.kind !== "plan" &&
    message.kind !== "subagents" &&
    message.kind !== "memory-changes" &&
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

/** @internal Stable HMR boundary for conversation timeline. */
export function ConversationTimeline() {
  const {
    activeChatSearchIndex,
    agentActivitySpaceReserved,
    attachmentAction,
    channel,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    clearNewMessages,
    closeChatSearch,
    composerHasContent,
    copiedMessageId,
    dismissPendingSend,
    downloadMessageImageFile,
    editingDeliveryId,
    editPendingSend,
    copyMessage,
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
    timelineIndexById,
    unreadBoundaryMessageId,
    moveChatSearch,
    openExternalMessageUrl,
    openReactionMessageId,
    openRoutineSettings,
    openSkillSettings,
    openSharedFile,
    openWorkspaceFile,
    openQuote,
    pendingSendFor,
    presentedQueueDeliveries,
    providerUpdateRequired,
    previewAttachment,
    props,
    mcpServers,
    sendCardMessage,
    reactToMessage,
    renderedAgentActivity,
    providerOffline,
    providerSilentMinutes,
    agentProviderName,
    replyJump,
    replyToMessage,
    addPageText,
    setPageContext,
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
  const loadImageFile = props.runtime ? undefined : createMessageImageFiles(runtime.agent);
  /** The agent that asks in a card: in a channel, the working agent whose card shows. */
  const interactionAgentName = () => (channel ? channel.interactionAgentName() : props.agent?.name);
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
    };
  };
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
   * request it answers. Its attachments stay under the marker, so the row draws none.
   */
  const agentMessageText = (messageId: string) => {
    const message = () => agentMessagesByExchangeId().get(messageId);
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
            onSelectAgent={props.onSelectAgent}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onPreview={(attachment) => void previewAttachment(attachment)}
            onAttachmentAction={attachmentAction}
            onOpenQuote={openQuote}
            macWindowControls={props.platform === "darwin"}
          />
        )}
      </Show>
    );
  };
  // A run of one sender breaks where another person starts to write, and in a channel where another
  // agent starts to write.
  const senderRunRow = (message: AgentMessage) => {
    const sender = otherSender(message);
    const author = sender
      ? `member:${sender.id}`
      : channel && message.author === "agent"
        ? `agent:${message.senderAgentId ?? ""}`
        : message.author;
    return message.createdAt === undefined ? { author } : { author, createdAt: message.createdAt };
  };
  /**
   * An agent's record of a routine it created or changed is a card whose schedule the person can
   * change. Only a record from an agent turn has a `turnId`. A change the person made in the app
   * keeps the plain marker, so an edit on a card does not add a second card that replaces it. A
   * deleted routine also keeps the plain marker, because its schedule is not known.
   */
  const routineCardMarker = (message: AgentMessage | undefined, marker: ChatActionMarkerModel | undefined) =>
    message?.turnId && marker?.kind === "routine-lifecycle" ? marker : undefined;
  // "Show latest" moves focus to this card. The list mounts it only after the scroll.
  const [routineCardFocus, setRoutineCardFocus] = createSignal<string | null>(null);
  // The newest agent record of each routine is the one card that still edits it.
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
    if (!cardMarker || cardMarker.action === "deleted" || !agentId) return undefined;
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
  /** The saved http row a sign-in card names. A row this client cannot read keeps the marker. */
  const mcpSignInConfig = (marker: ChatActionMarkerModel) =>
    marker.kind === "mcp-sign-in"
      ? mcpServers().find((config) => config.id === marker.mcpServerId && config.transport === "http")
      : undefined;
  const virtualMessageRows = createMemo(() => messageVirtualizer.getVirtualItems());
  const rail = createChatScrollRail({
    rows: timelineMessages,
    // A change the person made in the app, such as to a routine, is a marker, not a message they wrote.
    // In a shared chat, a message from another member is theirs.
    question: (message) =>
      message.author === "you" && !message.actionMarker && !otherSender(message) ? message.body : undefined,
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
  const traceKeyboard = currentDevicePlatform() === "darwin" ? "mac" : "pc";
  /** The trace that the steps row above an answer opens. */
  const traceAbove = (messageId: string | undefined): AgentStepsTrace => ({
    spans: () =>
      turnSteps.traceAbove(messageId, {
        agent: props.agent?.name ?? t("chat.message.agentFallback"),
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
  const channelWorkingSteps = createMemo(() => (channel ? turnSteps.workingSteps(channel.workingTurns()) : []));
  /**
   * A direct chat with no message yet, and no turn, queued send or question. A queued send leaves the
   * timeline for the queue tray, and the activity line shows only after a delay, so both are read here.
   * Its empty state plays a faint turn from the agent's own routine and skill.
   */
  const emptyAgent = createMemo(() =>
    !channel &&
    timelineMessages().length === 0 &&
    !props.hasOlder &&
    !props.activeTurnId &&
    presentedQueueDeliveries().length === 0 &&
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
          ? t("prompt.inputRequiredAnnouncement", { question: props.prompt.questions[0]?.question ?? "" })
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

      <div
        class={["conversation-scroll", scrollFades.classes(), { "conversation-covered": sideThreadOpen() }]}
        inert={sideThreadOpen()}
        ref={(element) => {
          setScrollElement(element);
          rail.ref(element);
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          followReaderScroll(element);
          updateScrollFade(element);
          updateUnreadDividerVisibility();
          replyJump.updateReturnVisibility();
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
                 * carries one when it opens a new day. A message with no stored timestamp can only
                 * open the transcript, so it falls back to the time it prints in its footer.
                 */
                const dayMarker = createMemo(() => {
                  const current = message();
                  if (!current) return null;
                  const previous = previousMessage();
                  if (current.createdAt) return dayMarkerLabel(previous?.createdAt, current.createdAt, { t, format });
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
                  if (current?.author === "you") return { kind: "you", name: t("chat.message.you") };
                  if (channel && current) return channel.author(current);
                  return { kind: "agent", name: props.agent?.name ?? t("chat.message.agentFallback") };
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
                // A row the host has not drawn yet has no reactions, replies or menu: its id is not the
                // host's, even after the host answered.
                const hostless = createMemo(() => message()?.id.startsWith(PENDING_SEND_ID_PREFIX) === true);
                const pendingSend = createMemo(() => {
                  const send = pendingSendFor(message()?.id);
                  return send && send.state !== "sent" ? send : undefined;
                });
                // The status line stays one element while its state changes, so its live region speaks.
                const pending = createMemo(() => pendingSend() !== undefined);
                // Only the kind rebuilds the player, so its controls keep focus when it starts or stops.
                const player = createMemo(() => voicePlayer(message()));
                const playerKind = createMemo(() => player()?.kind);
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
                                    when={suggestionMarker(marker())}
                                    fallback={
                                      <Show
                                        when={mcpSignInConfig(marker())}
                                        fallback={
                                          <Show
                                            when={webhookRoutineCard(message() ?? initialMessage, marker())}
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
                                                onOpenHostedSite={(url) => void openExternalMessageUrl(url)}
                                                onToggleRoutineRun={toggleRoutineRun}
                                                onToggleAgentMessage={toggleAgentMessage}
                                                agentMessageText={agentMessageText}
                                              />
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
                                {(card) => {
                                  const latestMessageId = () => latestRoutineMessageIds().get(card().routine.id);
                                  const rowMessageId = () => message()?.id ?? initialMessage.id;
                                  return (
                                    <RoutineChatCard
                                      action={card().action}
                                      routine={card().routine}
                                      agentId={card().agentId}
                                      latest={latestMessageId() === rowMessageId()}
                                      onOpenRoutine={openRoutineSettings}
                                      onShowLatest={
                                        props.onOpenSearchMessage
                                          ? () => {
                                              const messageId = latestMessageId();
                                              if (!messageId) return;
                                              setRoutineCardFocus(messageId);
                                              void props.onOpenSearchMessage?.(messageId);
                                            }
                                          : undefined
                                      }
                                      focusRequested={routineCardFocus() === rowMessageId()}
                                      onFocusHandled={() => setRoutineCardFocus(null)}
                                    />
                                  );
                                }}
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
                if (untrack(() => initialMessage.kind === "memory-changes")) {
                  // Only a turn with no answer gets this row: an answer shows the changes in its steps.
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
                const messageReadAloud = () =>
                  spokenReplyIds().has((message() ?? initialMessage).id)
                    ? undefined
                    : readAloudAction(message() ?? initialMessage);
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
                    <Show when={turnSteps.stepsAbove(message()?.id)}>
                      {(steps) => (
                        <ChatRowBoundary>
                          <AgentStepsDisclosure
                            steps={steps()}
                            defaultOpen={showAgentSteps()}
                            trace={traceAbove(message()?.id)}
                            facts={turnSteps.factsAbove(message()?.id)}
                          />
                        </ChatRowBoundary>
                      )}
                    </Show>
                    <ChatRowBoundary>
                      <Show
                        when={message()?.questionPrompt}
                        keyed
                        fallback={
                          <ChatMessageRow
                            message={message() ?? initialMessage}
                            author={author()}
                            showAuthor={
                              author().kind === "member" || (channel && author().kind === "agent")
                                ? !continuesRun()
                                : undefined
                            }
                            showTime={!continuesRun()}
                            animate={animateEntrance}
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
                            onOpenSharedFile={openSharedFile}
                            onOpenWorkspaceFile={
                              workspaceAgentId()
                                ? (path) => openWorkspaceFile(path, undefined, workspaceAgentId())
                                : undefined
                            }
                            onOpenQuote={openQuote}
                            onDownload={(attachment) => attachmentAction(attachment, "download")}
                            mediaSource={runtime.attachmentMedia}
                            macWindowControls={props.platform === "darwin"}
                            loadImageFile={
                              loadImageFile &&
                              ((file) =>
                                loadImageFile(file, {
                                  serverId: props.server?.id ?? "local",
                                  messageId: message()?.id ?? initialMessage.id,
                                  agentId: workspaceAgentId(),
                                }))
                            }
                            onDownloadImageFile={
                              loadImageFile && ((file) => downloadMessageImageFile(file, workspaceAgentId()))
                            }
                            actions={
                              <>
                                <Show when={pending()}>
                                  <PendingSendStatus
                                    state={pendingState()}
                                    updateRequired={Boolean(providerUpdateRequired())}
                                    error={pendingSend()?.error ?? null}
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
                                <Show when={!hostless()}>
                                  <MessageActions
                                    message={message() ?? initialMessage}
                                    pickerOpen={openReactionMessageId() === message()?.id}
                                    expandedEmoji={expandedEmojiMessageId() === message()?.id}
                                    copied={copiedMessageId() === message()?.id}
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
                                    {...messageActions}
                                    readAloud={messageReadAloud()}
                                  />
                                </Show>
                              </>
                            }
                            menu={
                              hostless()
                                ? undefined
                                : () => (
                                    <MessageMenu
                                      message={message() ?? initialMessage}
                                      reactions={!channel}
                                      authorName={channel ? author().name : undefined}
                                      {...messageActions}
                                      readAloud={messageReadAloud()}
                                      onMarkUnread={markUnreadAction(message() ?? initialMessage)}
                                    />
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
            <div
              class="agent-activity-slot"
              data-reserved={agentActivitySpaceReserved() ? "true" : "false"}
              ref={setAgentActivitySlotElement}
            >
              <Show
                when={!channel}
                fallback={
                  <Show when={channel && channel.workers().length > 0}>
                    <ChannelActivityIndicator
                      workers={channel?.workers() ?? []}
                      steps={channelWorkingSteps()}
                      stepsOpenByDefault={showAgentSteps()}
                    />
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
                    />
                  )}
                </Show>
              </Show>
            </div>
            {/* Under an open side thread, the thread draws the card of its own question. */}
            <Show when={!sideThreadOpen()}>
              <ConversationQuestionPrompt
                elementRef={setRequiredInteractionElement}
                registerComposerAnswer={registerPromptComposerAnswer}
              />
            </Show>
            <Show keyed when={props.approval}>
              {(approval) => (
                <Loading>
                  <ApprovalCard
                    approval={approval}
                    agentName={interactionAgentName()}
                    onApprove={() => props.onRespondToApproval("accept")}
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
          </div>
        </Show>
      </div>
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
