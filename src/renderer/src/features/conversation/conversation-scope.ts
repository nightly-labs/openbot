import { isKnownAgentProvider, providerDisplayName } from "@openbot/contracts/agent-providers";
import {
  type FileQuoteTarget,
  fileQuoteId,
  fileQuoteTarget,
  limitedQuoteText,
} from "@openbot/contracts/chat-tag-references";
import {
  customProviderOfModel,
  type McpSignInRelayPage,
  relayableSignInLink,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import type { QuoteRequest } from "@openbot/ui/features/conversation/ComposerEditor";
import { currentText } from "@openbot/ui/text";
import { usesTouchLayout } from "@openbot/ui/utils";
import { errorReference } from "@openbot/user-errors";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  flush,
  onCleanup,
  onSettled,
  untrack,
  useContext,
} from "solid-js";
import { actionToast } from "../../action-toast";
import { createScopeGuard } from "../../scope-lifetime";
import { appendVoiceTranscript } from "../../voice-recording";
import { createAttachmentImportSounds } from "./attachment-import-sounds";
import type { ChatSearchMatch } from "./chat-search";
import { useConversationController } from "./conversation-controller-context";
import { agentConversationKey, composerDraftKey } from "./conversation-keys";
import { conversationRuntime } from "./conversation-runtime";
import type {
  AgentSettingsRequest,
  ComposerDraft,
  ConversationProps,
  ConversationTarget,
  SidePanelPane,
} from "./conversation-types";
import {
  clearQuotedTextHighlight,
  highlightQuotedText,
  messageTextBlocks,
  revealFileQuote,
  stopRevealingFileQuote,
  workspaceAgentOfPath,
} from "./quoted-text";
import { createActivityStore } from "./stores/activity-store";
import { createBrowserStore } from "./stores/browser-store";
import { createComposerActions } from "./stores/composer-actions";
import { conversationOwnerId, createComposerStore, currentConversationTarget } from "./stores/composer-store";
import { createMcpServersStore } from "./stores/mcp-servers-store";
import { createMessageActions } from "./stores/message-actions";
import { createPanelsStore, SIDE_PANEL_MODES } from "./stores/panels-store";
import { PENDING_SEND_ID_PREFIX, pendingSendMessage } from "./stores/pending-send-store";
import { createQueueStore } from "./stores/queue-store";
import { createReplyJumpStore } from "./stores/reply-jump-store";
import { createScrollStore } from "./stores/scroll-store";
import { createSearchStore } from "./stores/search-store";
import { createSettingsStore, runtimeSettingsEqual } from "./stores/settings-store";
import { createSideQuestionStore } from "./stores/side-question-store";
import { createSkillsStore } from "./stores/skills-store";
import { createThreadComposerActions } from "./stores/thread-composer-actions";
import { createVoiceConversation } from "./stores/voice-conversation-store";
import { createVoiceStore } from "./stores/voice-store";

/** A keyboard or wheel scroll moves the chat within a few frames of its input. */
const READER_INPUT_WINDOW_MS = 250;

/**
 * Settings requests that a chat has already opened. The request stays set after it is handled, and the
 * chat mounts again when the user comes back from another page; it must not open a new routine again.
 */
const handledSettingsRequests = new WeakSet<AgentSettingsRequest>();

/** An http or https page that the built-in browser can show. A relayed sign-in page needs this computer's browser. */
function builtInBrowserPage(url: string): boolean {
  const page = URL.parse(url);
  return (page?.protocol === "http:" || page?.protocol === "https:") && relayableSignInLink(url) === null;
}

function followConversationBottom(element: HTMLDivElement): void {
  element.scrollTop = element.scrollHeight - element.clientHeight;
}

export function createConversationViewScope(props: ConversationProps) {
  const controller = useConversationController();
  /** A view shows one agent or one channel for its whole life, so each branch below is fixed. */
  const channel = untrack(() => props.channel);
  const agentReady = () => props.agentStatus.phase === "ready";
  /** A side thread covers the agent's own chat, which stays mounted under it. */
  const sideThreadOpen = () => props.threads?.open !== undefined;
  const providerUpdateRequired = () =>
    props.agentStatus.providers?.find(
      (provider) => provider.id === props.agent?.provider && provider.state === "outdated",
    );
  const {
    drafts: agentDrafts,
    setDrafts: setAgentDrafts,
    channelDrafts,
    setChannelDrafts,
    editingAgentId,
    setEditingAgentId,
    editingServerId,
    setEditingServerId,
    editingDeliveryId,
    setEditingDeliveryId,
    editingEditId,
    setEditingEditId,
    editingDraftBackup,
    setEditingDraftBackup,
    editingOriginalAttachmentIds,
    setEditingOriginalAttachmentIds,
    editingPendingSave,
    setEditingPendingSave,
    persistDrafts,
    composerFocusRequest,
    setComposerFocusRequest,
    pendingSends,
    showComposerActions,
    setShowComposerActions,
    attachmentBusy,
    setAttachmentBusy,
    composerErrors,
    setComposerErrors,
    composerErrorReferences,
    setComposerErrorReferences,
    conversationErrors,
    setConversationErrors,
    conversationErrorRuns,
    voicePhase,
    setVoicePhase,
    voiceModelProgress,
    setVoiceModelProgress,
    voiceElapsedSeconds,
    setVoiceElapsedSeconds,
    voiceLiveTranscript,
    setVoiceLiveTranscript,
    voiceThreadKey,
    setVoiceThreadKey,
    voiceLevels,
    setVoiceLevels,
    voiceLimitReached,
    setVoiceLimitReached,
    markingRead,
    setMarkingRead,
    submitting,
    setSubmitting,
    dropActive,
    setDropActive,
    rightPanels,
    setRightPanels,
    settingsProvider,
    setSettingsProvider,
    settingsModel,
    setSettingsModel,
    settingsReasoning,
    setSettingsReasoning,
    browserAddress,
    setBrowserAddress,
    browserPipBounds,
    setBrowserPipBounds,
    sidebarFilePreview,
    setSidebarFilePreview,
    openReactionMessageId,
    setOpenReactionMessageId,
    expandedEmojiMessageId,
    setExpandedEmojiMessageId,
    copiedMessageId,
    setCopiedMessageId,
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchQuery,
    setChatSearchQuery,
    chatSearchMatches,
    setChatSearchMatches,
    activeChatSearchIndex,
    setActiveChatSearchIndex,
    chatSearchMessageIds,
    setChatSearchMessageIds,
    chatSearchTotal,
    setChatSearchTotal,
    settingsPanelWidth,
    setSettingsPanelWidth,
    browserPanelWidth,
    setBrowserPanelWidth,
    hiddenAwaitingReplyIds,
    setHiddenAwaitingReplyIds,
    sideQuestions: sideQuestionStates,
    setSideQuestions,
    sidePanels,
    setSidePanels,
    resources,
  } = controller;
  const drafts = channel ? channelDrafts : agentDrafts;
  const setDrafts = channel ? setChannelDrafts : setAgentDrafts;
  /**
   * Chat-scoped composer errors, keyed by conversation.
   *
   * The previous server-scoped `composerError` string leaked one chat's banner
   * into unrelated chats on the same server. Every write is keyed by
   * `composerDraftKey(target)` so navigating between chats never carries stale
   * state, and dismissal removes only the current chat's entry.
   *
   * Async completions must pass an explicit target captured at operation start;
   * reading `currentConversationTarget(props)` at completion time would
   * attribute the failure to whichever chat the user has since opened.
   *
   * `cause` is the failure behind the sentence. The banner shows its code.
   */
  const setScopedComposerError = (error: string | null, targetOverride?: ConversationTarget, cause?: unknown): void => {
    const target = targetOverride ?? currentConversationTarget(props);
    if (!target) return;
    const key = composerDraftKey(target);
    const reference = error === null || cause === undefined ? null : errorReference(cause);
    setComposerErrorReferences((current) => {
      if (reference && error) return { ...current, [key]: { message: error, reference } };
      if (!(key in current)) return current;
      const { [key]: _removed, ...next } = current;
      return next;
    });
    if (error === null) {
      setComposerErrors((current) => {
        if (!(key in current)) return current;
        const { [key]: _removed, ...next } = current;
        return next;
      });
      return;
    }
    setComposerErrors((current) => (current[key] === error ? current : { ...current, [key]: error }));
  };
  const panels = createPanelsStore({
    props,
    rightPanels,
    setRightPanels,
    panels: sidePanels,
    setPanels: setSidePanels,
    settingsProvider,
    settingsModel,
    settingsReasoning,
    setBrowserPipBounds,
    sidebarFilePreview,
    setSidebarFilePreview,
    setComposerError: setScopedComposerError,
    nextFilePreviewGeneration: () => {
      resources.filePreviewRequestGeneration += 1;
      return resources.filePreviewRequestGeneration;
    },
    currentFilePreviewGeneration: () => resources.filePreviewRequestGeneration,
    invalidateFilePreviewGeneration: () => {
      resources.filePreviewRequestGeneration += 1;
    },
  });
  const {
    skillSettingsRequest,
    openSkillSettings,
    routineSettingsRequest,
    activeRightPanel,
    settingsOpen,
    filesOpen,
    panelSubagentId,
    openSubagentPanel,
    panelThreadId,
    openPanelThread,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    removeSidePanelPane,
    filePreviewOpen,
    setActiveRightPanel,
    openRoutineSettings,
    handleRoutineSettingsRequest,
    clearRoutineSettingsRequest,
    openRoutineRunMessage,
    showBrowserPip,
    saveBrowserPipBounds,
    hideBrowserPanel,
    previewAttachment,
    attachmentAction,
    openSharedFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewWorkspaceAgentId,
    sidebarFileBack,
    openSidebarFileBack,
    openSidebarFileExternally,
    downloadSidebarFile,
    downloadMessageImageFile,
    revealSidebarFile,
    closeSidebarFilePreview,
  } = panels;
  const sideQuestions = createSideQuestionStore({
    props,
    questions: sideQuestionStates,
    setQuestions: setSideQuestions,
    openPane: () => setActiveRightPanel("question"),
  });
  const {
    sideQuestionAvailable,
    sideQuestion,
    setSideQuestionDraft,
    openSideQuestion,
    askSideQuestion,
    deleteSideQuestion,
  } = sideQuestions;
  const skills = createSkillsStore({ props, settingsOpen });
  const { installedSkills, installedSkillsLoadFailed } = skills;
  const { mcpServers } = createMcpServersStore({ props });
  const composer = createComposerStore({
    props,
    drafts,
    setDrafts,
    conversationErrors,
    setConversationErrors,
    composerErrors,
    setComposerErrors,
    editingAgentId,
    editingServerId,
    editingDeliveryId,
    editingPendingSave,
    seenMessageIds: resources.seenMessageIds,
  });
  const {
    currentTarget,
    currentEditingDeliveryId,
    currentDraft,
    currentConversationError,
    currentComposerError,
    currentChatError,
    unreferencedDraftAttachments,
    composerHasContent,
    replyTarget,
    markMessageSeen,
    updateCurrentDraft,
    clearSubmittedDraft,
    clearConversationError,
    setConversationError,
    clearComposerError,
    setComposerErrorForTarget,
    clearChatErrors,
  } = composer;
  /** The code of the shown composer error. A later sentence without a cause shows no code. */
  const currentChatErrorReference = createMemo(() => {
    const target = currentTarget();
    const message = currentComposerError();
    if (!target || !message) return null;
    const entry = composerErrorReferences()[composerDraftKey(target)];
    return entry?.message === message ? entry.reference : null;
  });
  /** The provider and model of the run behind the shown error. A later error of another run shows none. */
  const currentChatErrorRun = createMemo(() => {
    const target = currentTarget();
    const message = currentChatError();
    if (!target || !message) return null;
    const entry = conversationErrorRuns()[composerDraftKey(target)];
    return entry?.message === message ? entry.run : null;
  });
  const currentPendingSends = createMemo(() => pendingSends.list(currentTarget()));
  // The host queues a message for a moment before it starts it. A send made while the agent was idle
  // stays in the chat for that moment, so it does not jump to the queue panel and back.
  const startingDeliveryIds = createMemo(
    () => new Set(currentPendingSends().flatMap((send) => (send.starting && send.messageId ? [send.messageId] : []))),
  );
  const queue = createQueueStore({ props, hiddenAwaitingReplyIds, startingDeliveryIds });
  const { activeDeliveries, orderedQueuedDeliveries, presentedQueueDeliveries, queuePanelVisible } = queue;
  const awaitingReplies = channel
    ? createMemo(() => {
        const hidden = hiddenAwaitingReplyIds();
        return channel
          .awaitingReplies()
          .filter((row) => !(hidden.has(row.id) && (row.state === "replied" || row.state === "failed")));
      })
    : queue.awaitingReplies;
  const dismissAwaitingReplies = () => {
    setHiddenAwaitingReplyIds((ids) => new Set([...ids, ...awaitingReplies().map((row) => row.id)]));
    // The close button leaves with the block, so the focus goes back to the composer.
    setComposerFocusRequest((value) => value + 1);
  };
  const activity = createActivityStore({
    props,
    activeDeliveries,
    agentActivityLabels: resources.agentActivityLabels,
    turnRuntimes: resources.turnRuntimes,
  });
  const {
    renderedAgentActivity,
    agentActivitySpaceReserved,
    setAgentActivitySpaceReserved,
    agentActivity,
    runningTurnRuntime,
    providerSilentMinutes,
    providerOffline,
  } = activity;
  /** The name of what the agent's turns wait for. OpenCode serves a custom endpoint, so it names the endpoint (#3234). */
  const agentProviderName = () => {
    const agent = props.agent;
    if (!agent) return undefined;
    const endpoint =
      agent.provider === "opencode" ? customProviderOfModel(agent.model, props.customProviders ?? []) : undefined;
    return endpoint?.name ?? providerDisplayName(agent.provider);
  };
  const browser = createBrowserStore({
    props,
    browserOpenRequests: resources.browserOpenRequests,
    browserAddress,
    setBrowserAddress,
    setComposerError: setScopedComposerError,
    panels: { activeRightPanel, setActiveRightPanel },
  });
  const {
    browserSidebarOpen,
    browserExpandedOpen,
    browserPipOpen,
    screenOpen,
    allBrowserTabs,
    browserTabs,
    activeBrowserTab,
    browserTakeoverTab,
    browserTakeoverPreview,
    browserTakeoverResolution,
    respondToBrowserTakeover,
    openBrowserTakeoverTab,
    localSignIn,
    activeBrowserControl,
    actingBrowserControl,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    openBrowserAddress,
    closeBrowserTab,
    activateBrowserTab,
    showBrowserTabOf,
    browserTabOwner,
    reloadBrowserTab,
    stopBrowserTab,
    navigateBrowserTab,
    takeBrowserControl,
    releaseBrowserControl,
  } = browser;
  function showBrowserPanel() {
    setActiveRightPanel("browser");
    if (browserTabs().length === 0) void openBrowserAddress();
  }
  function openSidePanelPane(pane: SidePanelPane) {
    if (pane === "browser") showBrowserPanel();
    else setActiveRightPanel(SIDE_PANEL_MODES[pane]);
  }
  const sideThreadIds = () => props.threads?.side.tabs.map((thread) => thread.id) ?? [];
  /** The side thread that the side panel shows, or null when its tab is gone. */
  const shownPanelThreadId = () => {
    const id = panelThreadId();
    return id !== null && sideThreadIds().includes(id) ? id : null;
  };
  /**
   * The panel button opens the side panel at its last pane or side thread, or at the list of panes
   * when no tab is open.
   */
  function toggleSidePanel() {
    if (sidePanelOpen()) {
      hideBrowserPanel();
      return;
    }
    const { panes, selected } = sidePanel();
    const pane = selected && panes.includes(selected) ? selected : null;
    const thread = shownPanelThreadId() ?? sideThreadIds()[0];
    if (pane) openSidePanelPane(pane);
    else if (thread && selected === null) openPanelThread(thread);
    else if (panes[0]) openSidePanelPane(panes[0]);
    else setActiveRightPanel("side-panel");
  }
  /**
   * A side thread tab left the side panel. When it showed, the side thread next to it shows, else the
   * last pane. With no tab, the panel lists the panes.
   */
  function leavePanelThread(id: string, leave: () => void) {
    const shown = activeRightPanel() === "thread" && shownPanelThreadId() === id;
    const ids = sideThreadIds();
    const index = ids.indexOf(id);
    leave();
    if (!shown) return;
    const rest = ids.filter((other) => other !== id);
    const thread = rest[Math.min(Math.max(index, 0), rest.length - 1)];
    const pane = sidePanel().panes.at(-1);
    if (thread) openPanelThread(thread);
    else if (pane) openSidePanelPane(pane);
    else setActiveRightPanel("side-panel");
  }
  /** Closes the tab of a side thread in the side panel. The thread stays in the thread list. */
  function closePanelThread(id: string) {
    leavePanelThread(id, () => props.threads?.side.onClose(id));
  }
  /** Moves the tab of a side panel thread back to the chat, and opens it there. */
  function movePanelThreadToChat(id: string) {
    leavePanelThread(id, () => props.threads?.side.onToChat(id));
  }
  /** Moves a chat tab to the side panel, and shows its thread there. */
  function moveThreadToPanel(id: string) {
    props.threads?.side.onToSide(id);
    openPanelThread(id);
  }
  // A side thread that shows can also leave the side panel from outside it: the thread list or a
  // notification opens it in the chat, or it is archived. The side thread next to it then shows, else
  // the last pane, as when its tab closes. A thread that is not in the list yet, as before the threads
  // load after a start, did not show, so the panel keeps it.
  createEffect(
    () => ({
      shown: activeRightPanel() === "thread" ? shownPanelThreadId() : null,
      requested: activeRightPanel() === "thread" ? panelThreadId() : null,
      ids: sideThreadIds(),
      pane: sidePanel().panes.at(-1),
    }),
    (next, previous) => {
      if (next.shown !== null || !previous?.shown || next.requested !== previous.shown) return;
      const index = previous.ids.indexOf(previous.shown);
      const thread = next.ids[Math.min(Math.max(index, 0), next.ids.length - 1)];
      if (thread) openPanelThread(thread);
      else if (next.pane) openSidePanelPane(next.pane);
    },
  );
  /** The subagent that the side panel shows now, or null. */
  const shownSubagentId = () => (activeRightPanel() === "subagent" ? panelSubagentId() : null);
  /** A click on a subagent opens it on the side; a click on the subagent that shows closes its pane. */
  function toggleSubagentPanel(subagentId: string) {
    if (shownSubagentId() === subagentId) closeSidePanelPane("subagent");
    else openSubagentPanel(subagentId);
  }
  /** Closes the tab of a pane. The next tab takes its place; with no tab, the panel lists the panes. */
  function closeSidePanelPane(pane: SidePanelPane) {
    if (pane === "question") deleteSideQuestion();
    const shown = sidePanelOpen() && sidePanel().selected === pane;
    const next = removeSidePanelPane(pane);
    if (!shown) return;
    const thread = sideThreadIds()[0];
    if (next) openSidePanelPane(next);
    else if (thread) openPanelThread(thread);
    else setActiveRightPanel("side-panel");
  }
  const viewIsMounted = createScopeGuard();
  let attachmentPicker: HTMLInputElement | undefined;
  // The host rows on screen: a sent message hands over to its row in the transcript or the queue.
  // Built only while a send waits for its row, so a streaming reply does not rebuild it for nothing.
  const drawnHostIds = createMemo(() =>
    currentPendingSends().some((send) => send.messageId)
      ? new Set([
          ...props.messages.map((message) => message.id),
          ...presentedQueueDeliveries().map((delivery) => delivery.id),
        ])
      : new Set<string>(),
  );
  // Filtered here as well as settled below, so the two rows never stand together for a frame. A send
  // made while the agent works goes to the queue panel; drawn here first, it would jump there.
  // A send behind a failed one waits for Retry or Dismiss, and the host does not have it yet, so the
  // queue panel cannot show it: the chat shows it, queued or not.
  const pendingMessages = createMemo(() => {
    const sends = currentPendingSends();
    const firstFailed = sends.findIndex((send) => send.state === "failed");
    return sends
      .filter((send) => !(send.messageId && drawnHostIds().has(send.messageId)))
      .filter((send) => !send.queued || (firstFailed !== -1 && sends.indexOf(send) >= firstFailed))
      .map(pendingSendMessage);
  });
  /** The pending send a timeline row draws, by the row's message id. */
  const pendingSendFor = (messageId: string | undefined) =>
    messageId?.startsWith(PENDING_SEND_ID_PREFIX)
      ? currentPendingSends().find((send) => `${PENDING_SEND_ID_PREFIX}${send.clientMessageId}` === messageId)
      : undefined;
  createEffect(
    () => ({
      target: currentTarget(),
      sent: currentPendingSends().some((send) => send.state === "sent"),
      drawnIds: drawnHostIds(),
    }),
    ({ target, sent, drawnIds }) => {
      if (target && sent) pendingSends.settle(target, drawnIds);
    },
  );
  const scroll = createScrollStore({
    props,
    markingRead,
    setMarkingRead,
    setComposerError: setScopedComposerError,
    pendingMessages,
    elements: {
      scrollElement: () => scrollElement,
      virtualRoot: () => virtualRoot,
      unreadMessagesDivider: () => unreadMessagesDivider,
    },
    sticky: {
      getStickToLatest: () => stickToLatest,
      setStickToLatest,
      getCurrentUnreadCount: () => currentUnreadCount,
    },
  });
  const {
    scrollFades,
    showScrollToLatest,
    unreadDividerVisible,
    newMessageCount,
    clearNewMessages,
    messageVirtualizer,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    timelineIndexById,
    unreadBoundaryMessageId,
    updateScrollFade,
    updateVirtualScrollMargin,
    updateUnreadDividerVisibility,
    scheduleUnreadDividerVisibilityUpdate,
    markUnreadMessages,
    jumpToUnreadMessages,
    jumpToLatestMessage,
  } = scroll;
  const replyJump = createReplyJumpStore({
    props,
    scrollElement: () => scrollElement,
    timelineIndexById,
    scrollToIndex: (index) => messageVirtualizer.scrollToIndex(index),
    setStickToLatest,
  });
  const search = createSearchStore({
    props,
    chatSearchOpen,
    chatSearchQuery,
    activeChatSearchIndex,
    scrollElement: () => scrollElement,
    revealMatch: () => setStickToLatest(false),
    setChatSearchOpen,
    setChatSearchQuery,
    chatSearchMatches,
    setChatSearchMatches,
    chatSearchMessageIds,
    setChatSearchMessageIds,
    setChatSearchTotal,
    setActiveChatSearchIndex,
  });
  const { closeChatSearch, moveChatSearch, setChatSearchInputElement } = search;
  // The open side thread has its own search. It finds text only in the thread rows on the page, because
  // the host search (`onSearchMessages`) finds messages of the agent's own chat. The thread shows all
  // the messages that its snapshot has.
  const [threadSearchOpen, setThreadSearchOpen] = createSignal(false);
  const [threadSearchQuery, setThreadSearchQuery] = createSignal("");
  const [threadSearchMatches, setThreadSearchMatches] = createSignal<ChatSearchMatch[]>([]);
  const [activeThreadSearchIndex, setActiveThreadSearchIndex] = createSignal(-1);
  const [threadSearchMessageIds, setThreadSearchMessageIds] = createSignal<string[]>([]);
  const [threadScrollElement, setThreadScrollElement] = createSignal<HTMLElement>();
  const threadSearch = createSearchStore({
    props: {
      get messages() {
        return props.threads?.conversation?.messages.map((message) => ({ id: message.id, body: message.text })) ?? [];
      },
    },
    chatSearchOpen: threadSearchOpen,
    chatSearchQuery: threadSearchQuery,
    activeChatSearchIndex: activeThreadSearchIndex,
    scrollElement: threadScrollElement,
    revealMatch: () => undefined,
    setChatSearchOpen: setThreadSearchOpen,
    setChatSearchQuery: setThreadSearchQuery,
    chatSearchMatches: threadSearchMatches,
    setChatSearchMatches: setThreadSearchMatches,
    chatSearchMessageIds: threadSearchMessageIds,
    setChatSearchMessageIds: setThreadSearchMessageIds,
    setChatSearchTotal: () => undefined,
    setActiveChatSearchIndex: setActiveThreadSearchIndex,
  });
  // Another thread, or the agent's own chat, has other messages, so the search of the thread closes.
  // A new thread has no task (`null`), and the agent's own chat has no thread (`undefined`).
  createEffect(
    () => {
      const open = props.threads?.open;
      return open === undefined ? undefined : (open?.id ?? null);
    },
    () => {
      if (untrack(threadSearchOpen)) threadSearch.closeChatSearch(false);
    },
  );
  // Both searches show the same highlights, so the search of the covered chat closes.
  createEffect(threadSearchOpen, (open) => {
    if (open && untrack(chatSearchOpen)) closeChatSearch(false);
  });
  /** The shortcut searches the chat that the user sees: the open side thread, or the agent's own chat. */
  const handleChatSearchShortcut = (event: KeyboardEvent) => {
    (sideThreadOpen() ? threadSearch : search).handleChatSearchShortcut(event);
  };
  const threadComposer = createThreadComposerActions({
    props,
    threadDrafts: controller.threadDrafts,
    setThreadDrafts: controller.setThreadDrafts,
  });
  /** Moves the open thread's caret to the end of the dictated text. */
  const [threadFocusRequest, setThreadFocusRequest] = createSignal(0);
  const voice = createVoiceStore({
    props,
    resources,
    voicePhase,
    setVoicePhase,
    setVoiceModelProgress,
    voiceElapsedSeconds,
    setVoiceElapsedSeconds,
    setVoiceLiveTranscript,
    voiceThreadKey,
    setVoiceThreadKey,
    setVoiceLevels,
    drafts,
    setDrafts,
    setConversationErrors,
    setComposerError: setScopedComposerError,
    setComposerFocusRequest,
    clearConversationError,
    setConversationError,
    viewIsMounted,
    // A recording in one conversation does not end the notice of another.
    setVoiceLimitReached: (target, reached) =>
      setVoiceLimitReached((current) =>
        reached ? target : current?.agentId === target.agentId && current.serverId === target.serverId ? null : current,
      ),
    hooks: {
      saveEdit: (...args) => actions.saveQueuedMessageEdit(...args),
      submit: (...args) => actions.submitMessage(...args),
      restoreTranscript: (...args) => composer.restoreVoiceTranscript(...args),
    },
    thread: {
      openDraftKey: () => threadComposer.openDraftKey(),
      appendTranscript: (key, text) => {
        threadComposer.setText(key, appendVoiceTranscript(threadComposer.draft(key).text, text));
        if (threadComposer.openDraftKey() === key) setThreadFocusRequest((current) => current + 1);
      },
      send: async (key) => {
        // The transcript was just appended; the send reads the draft, so apply that write first.
        flush();
        const threads = props.threads;
        if (!threads || threadComposer.openDraftKey() !== key) return;
        await threadComposer.send(threads, threadComposer.draft(key).text.trim());
        // The locked editor did not take the earlier focus request.
        if (threadComposer.openDraftKey() === key) setThreadFocusRequest((current) => current + 1);
      },
      reportError: (message) => actionToast.error(message),
      // The stop chime already played, so the notice is silent.
      reportLimit: () => toast.warning(currentText().t("composer.voice.limitReached")),
    },
  });
  const { startVoiceRecording, stopVoiceRecording, stopVoiceRecordingAndSend, cancelVoiceRecording } = voice;
  /** Dictates into the open side thread's draft. */
  const startThreadVoiceRecording = () => {
    const key = threadComposer.openDraftKey();
    if (key !== undefined) void startVoiceRecording(key);
  };
  /** The recording, or its preparation, is for the open side thread. */
  const threadVoiceOwned = () => {
    const key = threadComposer.openDraftKey();
    return key !== undefined && voicePhase() !== "idle" && voiceThreadKey() === key;
  };
  // A recording ends when the message box that it writes to closes or is covered: its text then stays
  // in the draft that it was for.
  createEffect(
    () => ({ key: threadComposer.openDraftKey(), owner: voiceThreadKey(), recording: voicePhase() === "recording" }),
    ({ key, owner, recording }) => {
      if (recording && owner !== key) stopVoiceRecording();
    },
  );
  // Live text belongs to the conversation it is dictated into, not to whichever one is open.
  const voiceLiveText = () => {
    const live = voiceLiveTranscript();
    return live &&
      live.threadKey === undefined &&
      live.agentId === conversationOwnerId(props) &&
      live.serverId === (props.server?.id ?? "local")
      ? live.text
      : "";
  };
  const threadVoiceLiveText = () => {
    const live = voiceLiveTranscript();
    const key = threadComposer.openDraftKey();
    return live && key !== undefined && live.threadKey === key ? live.text : "";
  };
  const voiceLimitNotice = () => {
    const reached = voiceLimitReached();
    return Boolean(
      reached && reached.agentId === conversationOwnerId(props) && reached.serverId === (props.server?.id ?? "local"),
    );
  };
  const dismissVoiceLimitNotice = () => setVoiceLimitReached(null);
  // The notice explains the text in the message box, so it ends when that text is sent or cleared.
  createEffect(
    () => voiceLimitNotice() && !currentDraft().text.trim(),
    (emptied) => {
      if (emptied) dismissVoiceLimitNotice();
    },
  );
  // The open question form. The composer text answers it instead of steering the turn.
  const [promptComposerAnswer, setPromptComposerAnswer] = createSignal<QuestionPromptComposerAnswer>();
  const registerPromptComposerAnswer = (answer: QuestionPromptComposerAnswer) => {
    setPromptComposerAnswer(() => answer);
    // A new form can arrive before the old one goes, so the old one takes back only its own answer.
    return () => setPromptComposerAnswer((current) => (current === answer ? undefined : current));
  };
  const actions = createComposerActions({
    props,
    attachmentBusy,
    setAttachmentBusy,
    attachmentImports: resources.importTargetAgents,
    agentReady: () => agentReady() && !providerUpdateRequired(),
    drafts,
    setDrafts,
    editingAgentId,
    setEditingAgentId,
    editingServerId,
    setEditingServerId,
    editingDeliveryId,
    setEditingDeliveryId,
    editingEditId,
    setEditingEditId,
    editingDraftBackup,
    setEditingDraftBackup,
    editingOriginalAttachmentIds,
    setEditingOriginalAttachmentIds,
    editingPendingSave,
    setEditingPendingSave,
    persistQueueEdit: persistDrafts,
    submitting,
    setSubmitting,
    voicePhase,
    voiceThreadKey,
    setComposerError: setScopedComposerError,
    setComposerFocusRequest,
    setShowComposerActions,
    orderedQueuedDeliveries,
    presentedQueueDeliveries,
    typing: {
      get idleTimer() {
        return resources.typingIdleTimer;
      },
      set idleTimer(timer: ReturnType<typeof setTimeout> | undefined) {
        resources.typingIdleTimer = timer;
      },
      get agentId() {
        return resources.typingAgentId;
      },
      set agentId(id: string | null) {
        resources.typingAgentId = id;
      },
    },
    voice: {
      get agentId() {
        return resources.voiceAgentId;
      },
      get serverId() {
        return resources.voiceServerId;
      },
      get submitRequest() {
        return resources.voiceSubmitRequest;
      },
      set submitRequest(request:
        | {
            agentId: string;
            serverId: string;
            draft: ComposerDraft;
            queuedEdit: { deliveryId: string; originalAttachmentIds: string[] } | undefined;
          }
        | undefined,) {
        resources.voiceSubmitRequest = request;
      },
    },
    stopComposerTyping: controller.stopComposerTyping,
    stopVoiceRecording,
    currentTarget,
    currentDraft,
    currentEditingDeliveryId,
    clearConversationError,
    clearSubmittedDraft,
    setConversationError,
    setStickToLatest,
    pendingSends,
    attachmentPicker: () => attachmentPicker,
    promptComposerAnswer,
  });
  const {
    updateTeamTyping,
    addAttachments,
    pasteFiles,
    releaseCutAttachments,
    openAttachmentPicker,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    reorderPresentedQueue,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    sendSelectionInstruction,
    sendCardMessage,
    retryPendingSend,
    editPendingSend,
    dismissPendingSend,
  } = actions;
  createEffect(
    () => {
      const deliveryId = currentEditingDeliveryId();
      return (
        !submitting() &&
        deliveryId !== null &&
        props.queue?.agentId === props.agent?.id &&
        props.queue?.deliveries.some((item) => item.id === deliveryId && item.status === "cancelled")
      );
    },
    (deleted) => {
      if (deleted) void cancelQueuedMessageEdit();
    },
  );
  const messageActions = createMessageActions({
    props,
    installedSkills,
    currentDraft,
    updateCurrentDraft,
    currentTarget,
    editingAgentId,
    editingServerId,
    editingDeliveryId,
    editingPendingSave,
    setOpenReactionMessageId,
    setExpandedEmojiMessageId,
    copiedMessageId,
    setCopiedMessageId,
    setComposerError: setScopedComposerError,
    setComposerFocusRequest,
  });
  const { replyToMessage, addPageText, setPageContext, reactToMessage, copyMessage, removeAttachment } = messageActions;
  const settings = createSettingsStore({
    props,
    runtimeSettingsAttempts: resources.runtimeSettingsAttempts,
    runtimeSettingsSaveTails: resources.runtimeSettingsSaveTails,
    settingsProvider,
    setSettingsProvider,
    settingsModel,
    setSettingsModel,
    settingsReasoning,
    setSettingsReasoning,
    setComposerError: setScopedComposerError,
    viewIsMounted,
    saveAgentPatch,
  });
  const { updateRuntimeSettings, selectAndConfirmModel, selectAndConfirmReasoning } = settings;
  let scrollElement: HTMLDivElement | undefined;
  let virtualRoot: HTMLDivElement | undefined;
  let agentActivitySlot: HTMLDivElement | undefined;
  let requiredInteractionElement: HTMLElement | undefined;
  let scrollResizeObserver: ResizeObserver | undefined;
  let unreadMessagesDivider: HTMLDivElement | undefined;
  let latestScrollFrame: number | undefined;
  let latestScrollSettleFrame: number | undefined;
  let lastScrollTop = 0;
  let readerLeftLatest = false;
  let readerDragging = false;
  let readerIntent: { up: boolean; at: number } | undefined;
  let lastTouchY: number | undefined;
  let currentUnreadCount = 0;
  let unreadOpening: {
    identity: string | undefined;
    pending: boolean;
    boundaryId: string | null | undefined;
    /** The chat opened at the divider and keeps it in view until the reader or a jump moves the chat. */
    holding: boolean;
  } = {
    identity: undefined,
    pending: false,
    boundaryId: undefined,
    holding: false,
  };
  let conversationPanel: HTMLElement | undefined;
  const [browserSurface, setBrowserSurface] = createSignal<HTMLDivElement>();
  /** A link sign-in that the host relays, while it waits for the address that the browser shows. */
  const [messageLinkRelay, setMessageLinkRelay] = createSignal<{
    url: string;
    target: ConversationTarget;
    page: McpSignInRelayPage;
  } | null>(null);
  let browserResizeObserver: ResizeObserver | undefined;
  let browserWindowResizeHandler: (() => void) | undefined;
  let browserVisibilityFrame: number | undefined;
  let browserBoundsFrame: number | undefined;
  let browserVisibilityGeneration = 0;
  let stickToLatest = true;
  let lastConversationIdentity: string | undefined;
  let lastPanelAgentId: string | undefined;
  let lastHandledMessageFocusNonce: number | undefined;
  const [quoteRequest, setQuoteRequest] = createSignal<QuoteRequest | undefined>(undefined);
  let lastRuntimeSettingsSignature: string | undefined;
  async function saveAgentPatch(
    updates: Omit<UpdateAgentInput, "agentId">,
    targetAgentId = props.agent?.id,
  ): Promise<boolean> {
    const agentId = targetAgentId;
    if (!agentId) return false;
    try {
      await props.onUpdateAgent(agentId, updates);
      return true;
    } catch {
      return false;
    }
  }
  // The switch shows the new value while the save runs. The saved agent then holds it.
  const [fastModeDraft, setFastModeDraft] = createSignal<{ agentId: string; fastMode: boolean }>();
  const fastMode = () => {
    const draft = fastModeDraft();
    return draft && draft.agentId === props.agent?.id ? draft.fastMode : props.agent?.fastMode === true;
  };
  async function changeFastMode(next: boolean): Promise<void> {
    const agentId = props.agent?.id;
    if (!agentId) return;
    const draft = { agentId, fastMode: next };
    setFastModeDraft(draft);
    setScopedComposerError(null);
    const saved = await saveAgentPatch({ fastMode: next }, agentId);
    if (fastModeDraft() !== draft) return;
    setFastModeDraft(undefined);
    if (!saved && props.agent?.id === agentId) {
      setScopedComposerError(currentText().t("composer.error.changeFastMode"));
    }
  }

  onSettled(() => {
    const importSounds = createAttachmentImportSounds();
    const unsubscribeImport = conversationRuntime(props).agent.onAttachmentImport((event) => {
      const threadKey = event.type === "started" ? undefined : threadComposer.releaseImport(event.requestId);
      if (event.type === "started") {
        // A side thread covers the agent's own chat, so a file dropped or picked there goes to the thread.
        if (threadComposer.openDraftKey() !== undefined) {
          if (threadComposer.claimImport(event.requestId, event.serverId)) importSounds.started(event.requestId);
          return;
        }
        const target = currentTarget();
        if (target?.serverId === event.serverId) {
          resources.importTargetAgents.set(event.requestId, target);
          clearConversationError(target);
          importSounds.started(event.requestId);
        }
        setAttachmentBusy(true);
        setScopedComposerError(null);
      } else if (threadKey !== undefined) {
        if (event.type === "error") {
          importSounds.cancel(event.requestId);
          actionToast.error(event.message);
        } else {
          // A cancelled import completes with no attachments.
          if (event.attachments.length > 0) importSounds.finished(event.requestId, "success");
          else importSounds.cancel(event.requestId);
          threadComposer.addFiles(threadKey, event.serverId, event.attachments);
        }
      } else if (event.type === "error") {
        const target = resources.importTargetAgents.get(event.requestId);
        resources.importTargetAgents.delete(event.requestId);
        setAttachmentBusy(resources.importTargetAgents.size > 0);
        if (target) {
          importSounds.finished(event.requestId, "error");
          setConversationErrors((current) => ({
            ...current,
            [composerDraftKey(target)]: event.message,
          }));
        }
      } else {
        const target = resources.importTargetAgents.get(event.requestId);
        if (target) {
          // A cancelled import completes with no attachments.
          if (event.attachments.length > 0) importSounds.finished(event.requestId, "success");
          else importSounds.cancel(event.requestId);
          void addAttachments(event.attachments, target).finally(() => {
            resources.importTargetAgents.delete(event.requestId);
            setAttachmentBusy(resources.importTargetAgents.size > 0);
          });
        } else {
          setAttachmentBusy(resources.importTargetAgents.size > 0);
          for (const attachment of event.attachments) {
            void conversationRuntime(props).agent.discardDraftAttachment(attachment.id, event.serverId);
          }
        }
      }
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open popover or menu, such as a routine chip, the model picker or the side panel's add
      // menu, closes on this key from a document listener that runs after this one. Closing the
      // panel under it too discards the edit the person was making.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        return;
      if (browserExpandedOpen() && !props.globalOverlayOpen) {
        event.preventDefault();
        setActiveRightPanel("browser");
        return;
      }
      if (threadSearchOpen() && sideThreadOpen()) {
        event.preventDefault();
        threadSearch.closeChatSearch();
        return;
      }
      // A side thread covers the search and the queued message edit of the agent's own chat. Escape in
      // the thread does not close or cancel what the user cannot see.
      if (chatSearchOpen() && !sideThreadOpen()) {
        event.preventDefault();
        closeChatSearch();
        return;
      }
      if (currentEditingDeliveryId() && !sideThreadOpen()) {
        void cancelQueuedMessageEdit();
        return;
      }
      setOpenReactionMessageId(null);
      setExpandedEmojiMessageId(null);
      hideBrowserPanel();
    };
    const closeActiveRemoteBrowserTab = (event: KeyboardEvent) => {
      if (
        props.server?.kind !== "remote" ||
        !screenOpen() ||
        props.browserVisibilitySuspended ||
        event.key.toLowerCase() !== "w" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const tab = activeBrowserTab();
      if (!tab) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void closeBrowserTab(tab.id);
    };
    const closeMessageMenus = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".message-actions")) return;
      setOpenReactionMessageId(null);
      setExpandedEmojiMessageId(null);
    };
    const keyboardTarget = conversationPanel?.ownerDocument ?? document;
    const keyboardWindow = keyboardTarget.defaultView ?? window;
    /**
     * A panel over the workspace content leaves this conversation mounted, so these
     * listeners stay on the document; `inert` on the covered markup does not reach
     * them. Escape would then cancel a queued-message edit the user cannot see -
     * restoring the previous draft and discarding the attachments added to it - and
     * the search shortcut would open a search behind the panel. Both belong to the
     * pane the user is looking at, and that is no longer this one.
     *
     * `closeActiveRemoteBrowserTab` needs no wrapper: it already returns early on
     * `browserVisibilitySuspended`, which the same panel sets.
     */
    const whenVisible = (handler: (event: KeyboardEvent) => void) => (event: KeyboardEvent) => {
      if (props.workspaceCovered) return;
      handler(event);
    };
    const escapeListener = whenVisible(closeOnEscape);
    const chatSearchListener = whenVisible(handleChatSearchShortcut);
    keyboardTarget.addEventListener("keydown", escapeListener);
    keyboardWindow.addEventListener("keydown", closeActiveRemoteBrowserTab);
    keyboardTarget.addEventListener("keydown", chatSearchListener);
    window.addEventListener("pointerdown", closeMessageMenus);
    const readerInput = scrollElement;
    const endReaderDrag = () => {
      readerDragging = false;
    };
    readerInput?.addEventListener("wheel", readerWheel, { passive: true });
    readerInput?.addEventListener("touchmove", readerTouchMove, { passive: true });
    readerInput?.addEventListener("touchend", readerTouchEnd);
    readerInput?.addEventListener("touchcancel", readerTouchEnd);
    readerInput?.addEventListener("pointerdown", readerPointerDown);
    readerInput?.addEventListener("focusin", readerFocusIn);
    keyboardTarget.addEventListener("keydown", readerKeyDown);
    keyboardWindow.addEventListener("pointerup", endReaderDrag);
    keyboardWindow.addEventListener("pointercancel", endReaderDrag);
    scrollResizeObserver = new ResizeObserver(() => {
      updateVirtualScrollMargin();
      if (scrollElement && stickToLatest) followConversationBottom(scrollElement);
      // An image or a preview that lays out after the opening grows a row above the divider. The chat
      // has no browser scroll anchoring, so without this the divider moves down out of view.
      else if (scrollElement && unreadOpening.holding) scrollToUnreadDivider(scrollElement);
      updateScrollFade();
      updateUnreadDividerVisibility();
    });
    if (scrollElement) scrollResizeObserver.observe(scrollElement);
    if (virtualRoot) scrollResizeObserver.observe(virtualRoot);
    if (agentActivitySlot) scrollResizeObserver.observe(agentActivitySlot);
    if (requiredInteractionElement) scrollResizeObserver.observe(requiredInteractionElement);
    requestAnimationFrame(() => {
      if (!scrollElement) return;
      updateVirtualScrollMargin();
      if (stickToLatest) followConversationBottom(scrollElement);
      updateScrollFade(scrollElement);
      updateUnreadDividerVisibility();
    });
    return () => {
      scrollResizeObserver?.disconnect();
      scrollResizeObserver = undefined;
      unsubscribeImport();
      importSounds.dispose();
      keyboardTarget.removeEventListener("keydown", escapeListener);
      keyboardWindow.removeEventListener("keydown", closeActiveRemoteBrowserTab);
      keyboardTarget.removeEventListener("keydown", chatSearchListener);
      window.removeEventListener("pointerdown", closeMessageMenus);
      readerInput?.removeEventListener("wheel", readerWheel);
      readerInput?.removeEventListener("touchmove", readerTouchMove);
      readerInput?.removeEventListener("touchend", readerTouchEnd);
      readerInput?.removeEventListener("touchcancel", readerTouchEnd);
      readerInput?.removeEventListener("pointerdown", readerPointerDown);
      readerInput?.removeEventListener("focusin", readerFocusIn);
      keyboardTarget.removeEventListener("keydown", readerKeyDown);
      keyboardWindow.removeEventListener("pointerup", endReaderDrag);
      keyboardWindow.removeEventListener("pointercancel", endReaderDrag);
    };
  });

  createEffect(
    () => ({
      request: props.messageFocusRequest,
      agentId: props.agent?.id,
      loaded: props.loaded,
      messageIds: props.messages.map((message) => message.id).join("\u0000"),
    }),
    ({ request, agentId, loaded }) => {
      if (!request || request.agentId !== agentId || !loaded || request.nonce === lastHandledMessageFocusNonce) return;
      requestAnimationFrame(() => {
        // A message in a group of agent messages has no row of its own, so the group row is the target.
        const messageId = CSS.escape(request.messageId);
        const target = scrollElement?.querySelector<HTMLElement>(
          `[data-chat-search-message="${messageId}"], [data-chat-search-group~="${messageId}"]`,
        );
        if (!target) return;
        lastHandledMessageFocusNonce = request.nonce;
        // The message the user picked replaces the opening at the unread divider.
        unreadOpening = { ...unreadOpening, pending: false, holding: false };
        stickToLatest = false;
        // A page that loaded just before the request queued a scroll to the latest message. That scroll
        // must not move the transcript away from the message the user picked, so it is cancelled and
        // its other updates run here.
        if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
        if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
        latestScrollFrame = undefined;
        latestScrollSettleFrame = undefined;
        updateVirtualScrollMargin();
        target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        updateScrollFade();
        updateUnreadDividerVisibility();
      });
    },
  );

  function quoteSelection(messageId: string, text: string) {
    // A passage past the message limit would make the composer drop it with the text after it.
    const quoted = limitedQuoteText(text);
    setQuoteRequest((current) => ({ id: (current?.id ?? 0) + 1, messageId, text: quoted }));
  }

  /** Scrolls to the passage that a quote points to and marks it. A file passage opens in the side panel. */
  function openQuote(messageId: string, text: string) {
    stopRevealingFileQuote();
    const file = fileQuoteTarget(messageId);
    if (file) {
      const shown = filePreviewOpen() && previewQuoteId() === fileQuoteId({ ...file, lines: undefined });
      if (shown || openQuotedFile(file)) revealFileQuote(document, file, text);
      return;
    }
    if (!showQuotedText(messageId, text)) void revealQuote(messageId, text);
  }

  /* An attachment opens from its record, so it must be in a loaded message. */
  function openQuotedFile(file: FileQuoteTarget): boolean {
    if (file.source !== "attachment") {
      if (file.source === "shared") openSharedFile(file.path);
      // A channel quote names an absolute path, so its workspace gives the agent.
      else
        openWorkspaceFile(
          file.path,
          undefined,
          props.channel ? workspaceAgentOfPath(props.agents, file.path) : undefined,
        );
      return true;
    }
    const attachment = props.messages
      .flatMap((message) => message.attachments ?? [])
      .find((candidate) => candidate.id === file.attachmentId);
    if (!attachment) {
      setScopedComposerError(currentText().t("attachment.error.preview", { name: file.name }));
      return false;
    }
    void previewAttachment(attachment);
    return true;
  }

  /* A row far away is not drawn, and a message outside the loaded pages is loaded first. */
  async function revealQuote(messageId: string, text: string) {
    const agentId = props.agent?.id;
    const row = await replyJump.reveal(messageId, undefined, agentId);
    if (row && props.agent?.id === agentId) showQuotedText(messageId, text);
  }

  function showQuotedText(messageId: string, text: string): boolean {
    const blocks = scrollElement ? messageTextBlocks(scrollElement, messageId) : [];
    const firstBlock = blocks[0];
    if (!firstBlock) return false;
    stickToLatest = false;
    unreadOpening.holding = false;
    const range = highlightQuotedText(blocks, text);
    (range?.startContainer.parentElement ?? firstBlock).scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    });
    updateScrollFade();
    updateUnreadDividerVisibility();
    return true;
  }

  createEffect(
    () => {
      const lastMessage = props.messages[props.messages.length - 1];
      return {
        agentId: props.agent?.id,
        serverId: props.server?.id ?? "local",
        activeTurnId: props.activeTurnId,
        queueSignature: props.queue?.deliveries.map((delivery) => `${delivery.id}:${delivery.status}`).join("|"),
        lastMessageBody: lastMessage?.body,
        lastMessageStatus: lastMessage?.status,
        deliverySignature: lastMessage?.exchange?.deliveries
          .map((delivery) => `${delivery.id}:${delivery.status}:${delivery.position}`)
          .join("|"),
        loaded: props.loaded,
        prompt: props.prompt,
        unreadCount: props.unreadCount,
      };
    },
    ({ agentId, serverId, unreadCount }) => {
      currentUnreadCount = unreadCount;
      const conversationIdentity = `${serverId}:${agentId ?? ""}`;
      if (conversationIdentity !== lastConversationIdentity) {
        if (lastConversationIdentity !== undefined) closeChatSearch(false);
        lastConversationIdentity = conversationIdentity;
        setStickToLatest(true);
        setAgentActivitySpaceReserved(false);
      }
      if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
      if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
      const followLatest = stickToLatest;
      latestScrollFrame = requestAnimationFrame(() => {
        latestScrollFrame = undefined;
        if (!scrollElement) return;
        updateVirtualScrollMargin();
        if (followLatest) followConversationBottom(scrollElement);
        updateScrollFade(scrollElement);
        updateUnreadDividerVisibility();
        latestScrollSettleFrame = requestAnimationFrame(() => {
          latestScrollSettleFrame = undefined;
          if (!scrollElement) return;
          // A later layout, such as the activity line, can leave the first follow short of the
          // bottom. Stay there only while this follow is still on; do not turn it back on.
          if (followLatest && stickToLatest) followConversationBottom(scrollElement);
          updateScrollFade(scrollElement);
          updateUnreadDividerVisibility();
        });
      });
    },
  );

  function scrollToUnreadDivider(element: HTMLDivElement): void {
    const divider = unreadMessagesDivider;
    if (!divider?.isConnected) return;
    const readRow = divider.closest(".virtual-chat-row")?.previousElementSibling;
    const viewTop = element.getBoundingClientRect().top - element.scrollTop;
    const dividerTop = divider.getBoundingClientRect().top - viewTop;
    const readTop = readRow instanceof HTMLElement ? readRow.getBoundingClientRect().top - viewTop : dividerTop;
    // A long read row shows only its end, so the divider stays in view. An offset, not an index:
    // the virtualizer would otherwise move back to the divider row as rows measure.
    messageVirtualizer.scrollToOffset(Math.max(0, readTop, dividerTop - element.clientHeight / 3));
  }

  /*
   * A chat with unread messages opens at the divider, with the end of the last read row above it, so
   * the reader sees where they stopped. It runs after the effect above, so it cancels that effect's
   * follow. A boundary that the chat has not loaded yet waits for its page; a different boundary,
   * such as a message that arrives later, or a scroll by the reader ends the wait. After the opening,
   * the chat holds the divider in view while rows lay out, until the reader moves the chat.
   */
  createEffect(
    () => {
      const boundaryId = unreadBoundaryMessageId();
      return {
        identity: `${props.server?.id ?? "local"}:${props.agent?.id ?? ""}`,
        loaded: props.loaded,
        boundaryId,
        boundaryIndex: boundaryId ? timelineIndexById().get(boundaryId) : undefined,
      };
    },
    ({ identity, loaded, boundaryId, boundaryIndex }) => {
      if (identity !== unreadOpening.identity) {
        unreadOpening = { identity, pending: true, boundaryId: undefined, holding: false };
      }
      // A later boundary, such as a message that arrived while the reader was away, is not where they opened.
      if (boundaryId !== unreadOpening.boundaryId) unreadOpening.holding = false;
      if (!unreadOpening.pending || !loaded) return;
      unreadOpening.boundaryId ??= boundaryId;
      if (!boundaryId || boundaryId !== unreadOpening.boundaryId || readerLeftLatest) {
        unreadOpening.pending = false;
        return;
      }
      if (boundaryIndex === undefined) return;
      unreadOpening.pending = false;
      unreadOpening.holding = true;
      stickToLatest = false;
      if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
      if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
      latestScrollFrame = undefined;
      latestScrollSettleFrame = undefined;
      // A virtualized chat draws only the rows near the view, so the divider row is drawn first.
      if (!unreadMessagesDivider?.isConnected) messageVirtualizer.scrollToIndex(boundaryIndex);
      const opening = unreadOpening;
      const openAtDivider = (settle: boolean) =>
        requestAnimationFrame(() => {
          // A scroll by the reader or a jump ends the hold, so it also cancels these frames.
          if (unreadOpening !== opening || !opening.holding || !scrollElement) return;
          // A scroll event that an earlier follow queued can land at the bottom before this frame.
          stickToLatest = false;
          scrollToUnreadDivider(scrollElement);
          updateScrollFade(scrollElement);
          updateUnreadDividerVisibility();
          if (!settle) openAtDivider(true);
        });
      openAtDivider(false);
    },
  );

  onCleanup(() => {
    stopRevealingFileQuote();
    clearQuotedTextHighlight();
    if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
    if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
  });

  createEffect(
    () => {
      const agent = props.agent;
      if (!agent) return null;
      const queued = agent.pendingRuntime;
      return {
        signature: [
          agent.id,
          agent.provider,
          agent.model,
          agent.reasoningEffort,
          queued?.provider,
          queued?.model,
          queued?.reasoningEffort,
          queued?.providerAccountId,
        ].join("\u0000"),
        provider: queued?.provider ?? agent.provider,
        model: queued?.model ?? agent.model,
        reasoningEffort: queued?.reasoningEffort ?? agent.reasoningEffort,
      };
    },
    (agent) => {
      if (!agent) return;
      const pendingSettings = resources.runtimeSettingsAttempts.get(
        untrack(() => agentConversationKey(props.server?.id ?? "local", props.agent?.id ?? "")),
      );
      const provider = agent.provider;
      if (
        pendingSettings?.pending &&
        (!isKnownAgentProvider(provider) ||
          !runtimeSettingsEqual(pendingSettings.settings, {
            provider,
            model: agent.model,
            reasoningEffort: agent.reasoningEffort,
          }))
      ) {
        setSettingsProvider(pendingSettings.settings.provider);
        setSettingsModel(pendingSettings.settings.model);
        setSettingsReasoning(pendingSettings.settings.reasoningEffort);
        return;
      }
      if (agent.signature === lastRuntimeSettingsSignature) return;
      lastRuntimeSettingsSignature = agent.signature;
      // A provider that this build does not know has no picker tab; the picker shows it from the agent.
      if (isKnownAgentProvider(provider)) setSettingsProvider(provider);
      setSettingsModel(agent.model);
      setSettingsReasoning(agent.reasoningEffort);
    },
  );

  function resetPanelsForAgent(agentId: string | undefined, panel: string | undefined): void {
    const previousAgentId = lastPanelAgentId;
    lastPanelAgentId = agentId;
    clearRoutineSettingsRequest();
    resources.filePreviewRequestGeneration += 1;
    const preview = untrack(sidebarFilePreview);
    if (preview && preview.ownerAgentId !== agentId) {
      setSidebarFilePreview(null);
      setRightPanels((current) => ({ ...current, [preview.ownerAgentId]: "none" }));
    }
    if (!previousAgentId || !agentId || (panel !== "settings" && panel !== "file-preview" && panel !== "files")) return;
    setRightPanels((current) => ({ ...current, [agentId]: "none" }));
  }

  // One effect, so a settings request that selects the agent opens its panel after the agent change
  // closes the old one. As two effects, either order was possible.
  createEffect(
    () => {
      const agentId = conversationOwnerId(props);
      return { agentId, panel: agentId ? rightPanels()[agentId] : undefined, request: props.settingsRequest };
    },
    ({ agentId, panel, request }) => {
      const settingsRequested =
        request !== null && agentId === request.agentId && !handledSettingsRequests.has(request);
      if (agentId !== lastPanelAgentId) {
        resetPanelsForAgent(agentId, panel);
        // The user can type to the agent they opened. Edit agent leaves the focus where it is, and a touch
        // screen does not open its keyboard over the transcript.
        if (agentId && !channel && !settingsRequested && !usesTouchLayout())
          setComposerFocusRequest((value) => value + 1);
      }
      if (!request || !settingsRequested) return;
      handledSettingsRequests.add(request);
      if (request.routine) openRoutineSettings(request.routine);
      else setActiveRightPanel("settings", agentId);
    },
  );

  createEffect(
    () => ({
      agentId: props.agent?.id,
      activeTab: activeBrowserTab(),
      screenOpen: screenOpen(),
      activeBrowserTabId: props.activeBrowserTabId,
      onActivateBrowserTab: activateBrowserTab,
      suspended: props.browserVisibilitySuspended,
      // Read here, not in the callback: the prop can be a compiled memo, and the callback has no owner.
      browserDisabled: untrack(() => props.browserEnabled === false),
    }),
    ({ activeTab, screenOpen, activeBrowserTabId, onActivateBrowserTab, suspended, browserDisabled }) => {
      if (browserDisabled || suspended) return;
      setBrowserAddress(activeTab?.url ?? "https://www.google.com");
      if (screenOpen && activeTab && activeTab.id !== activeBrowserTabId) {
        onActivateBrowserTab(activeTab.id);
      }
    },
  );

  createEffect(
    () => ({
      agentId: props.agent?.id,
      // Tracked, so a switch to a server with no browser tears down the last view's observers.
      browserEnabled: props.browserEnabled !== false,
      surface: browserSurface(),
      visible:
        browserExpandedOpen() &&
        Boolean(browserSurface()) &&
        !props.browserVisibilitySuspended &&
        !props.globalOverlayOpen &&
        !props.remoteDesktopVisible,
    }),
    ({ agentId, browserEnabled, visible, surface }) => {
      const generation = ++browserVisibilityGeneration;
      if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
      browserResizeObserver?.disconnect();
      browserResizeObserver = undefined;
      if (browserWindowResizeHandler) window.removeEventListener("resize", browserWindowResizeHandler);
      browserWindowResizeHandler = undefined;
      if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
      browserBoundsFrame = undefined;
      if (!browserEnabled) return;
      if (!visible) {
        void conversationRuntime(props).browser.setVisible({ visible: false });
        return;
      }
      browserVisibilityFrame = requestAnimationFrame(() => {
        browserVisibilityFrame = undefined;
        if (
          generation !== browserVisibilityGeneration ||
          props.agent?.id !== agentId ||
          !browserExpandedOpen() ||
          !surface?.isConnected
        ) {
          return;
        }
        const syncBounds = () => {
          if (
            generation !== browserVisibilityGeneration ||
            props.agent?.id !== agentId ||
            !browserExpandedOpen() ||
            !surface?.isConnected
          ) {
            return;
          }
          const bounds = surface.getBoundingClientRect();
          void conversationRuntime(props).browser.setVisible({
            visible: true,
            target: "main",
            bounds: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
          });
        };
        syncBounds();
        const scheduleBoundsSync = () => {
          if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
          browserBoundsFrame = requestAnimationFrame(() => {
            browserBoundsFrame = undefined;
            syncBounds();
          });
        };
        browserResizeObserver = new ResizeObserver(scheduleBoundsSync);
        browserResizeObserver.observe(surface);
        if (conversationPanel) browserResizeObserver.observe(conversationPanel);
        browserWindowResizeHandler = scheduleBoundsSync;
        window.addEventListener("resize", browserWindowResizeHandler);
      });
    },
  );

  createEffect(
    () => ({ agentId: props.agent?.id, open: browserPipOpen(), browserEnabled: props.browserEnabled !== false }),
    ({ open, browserEnabled }) => {
      if (!browserEnabled) return;
      if (!open) {
        void conversationRuntime(props).browser.closePictureInPicture();
        return;
      }
      void conversationRuntime(props)
        .browser.openPictureInPicture(untrack(browserPipBounds) ?? undefined)
        .then(saveBrowserPipBounds);
    },
  );

  const removeBrowserPictureInPictureListener = conversationRuntime(props).browser.onPictureInPictureEvent((event) => {
    if (event.type === "bounds-changed") {
      saveBrowserPipBounds(event.bounds);
      return;
    }
    setActiveRightPanel(event.type === "dock" ? "browser-expanded" : "none");
  });

  onCleanup(() => {
    browserVisibilityGeneration += 1;
    if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
    if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
    browserResizeObserver?.disconnect();
    if (browserWindowResizeHandler) window.removeEventListener("resize", browserWindowResizeHandler);
    removeBrowserPictureInPictureListener();
    if (props.browserEnabled !== false) {
      void conversationRuntime(props).browser.setVisible({ visible: false });
      void conversationRuntime(props).browser.closePictureInPicture();
    }
  });

  async function openExternalMessageUrl(url: string) {
    const target = currentTarget();
    const runtime = conversationRuntime(props);
    try {
      // A relayed sign-in page must open on this computer, so it does not go to the built-in browser.
      // A joined server's browser runs on its host, and the other members see its tabs.
      // When no tab opens, the link opens as it does with no setting.
      if (
        props.openLinksInBrowser &&
        props.server?.kind !== "remote" &&
        props.browserEnabled !== false &&
        builtInBrowserPage(url) &&
        (await openBrowserAddress(url, true))
      ) {
        setActiveRightPanel("browser");
        return;
      }
      if (target && runtime.agent.openMessageLink) {
        const page = await runtime.agent.openMessageLink({ agentId: target.agentId, url }, target.serverId);
        if (page) setMessageLinkRelay({ url, target, page });
      } else await runtime.openUrl(url);
    } catch (error) {
      setScopedComposerError(currentText().t("composer.error.openLink"), target, error);
    }
  }

  /** Opens the relayed sign-in page of a link again, after the user checked its host name. */
  async function openMessageLinkRelay(): Promise<void> {
    const relay = messageLinkRelay();
    if (!relay) throw new Error(currentText().t("error.mcp.relayEnded"));
    await conversationRuntime(props).openUrl(relay.url);
  }

  /** The address that the browser shows at the end of a relayed link sign-in. Main sends only its query. */
  async function pasteMessageLinkRelay(address: string): Promise<void> {
    const relay = messageLinkRelay();
    const paste = conversationRuntime(props).agent.pasteMessageLink;
    if (!relay || !paste) throw new Error(currentText().t("error.mcp.relayEnded"));
    await paste({ url: relay.url, address }, relay.target.serverId);
    if (messageLinkRelay() === relay) setMessageLinkRelay(null);
  }

  /** Ends the relayed sign-in of a link on the host. */
  function cancelMessageLinkRelay(): void {
    const relay = messageLinkRelay();
    setMessageLinkRelay(null);
    const cancel = conversationRuntime(props).agent.cancelMessageLink;
    if (relay && cancel) void cancel({ url: relay.url }, relay.target.serverId).catch(() => undefined);
  }

  /**
   * Dismiss the current chat's banner. Removes both the transient composer
   * error and the keyed conversation error for this chat only, so dismissal
   * never clears another chat and a dismissed banner does not reappear on
   * rerender, navigation, or reconnect unless a new error is recorded.
   */
  function dismissCurrentChatErrors(): void {
    const target = currentTarget();
    if (!target) return;
    clearChatErrors(target);
  }

  const currentChatConversationKey = createMemo(() => {
    const target = currentTarget();
    return target ? composerDraftKey(target) : null;
  });

  const setConversationPanelElement = (element: HTMLElement) => {
    conversationPanel = element;
  };
  const conversationPanelElement = () => conversationPanel;
  const setScrollElement = (element: HTMLDivElement) => {
    scrollElement = element;
    scrollFades.adopt(element);
    updateVirtualScrollMargin();
  };
  /*
   * Following the latest message again, by request or because the reader came back, ends the reader's hold.
   * A jump away, such as to a search match, holds the chat as a scroll up does: a smooth scroll starts at
   * the bottom, and its first scroll events must not follow the latest message again.
   */
  function setStickToLatest(value: boolean) {
    if (!value) {
      leaveLatest();
      return;
    }
    stickToLatest = true;
    readerLeftLatest = false;
    unreadOpening.holding = false;
  }
  /**
   * The reader moved up, so the chat stops following new content until the reader moves down again
   * or asks for the latest message. While a reply streams, the content grows many times a second and
   * each growth moves a following chat back to the bottom; a scroll of less than 80px still counts as
   * the bottom, and a scroll event that the chat's own follow queued can arrive after the reader's
   * input. So the reader decides, not the distance. The queued follow is cancelled too.
   */
  function leaveLatest() {
    readerLeftLatest = true;
    stopFollowingLatest();
  }
  function stopFollowingLatest() {
    stickToLatest = false;
    unreadOpening.holding = false;
    if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
    if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
    latestScrollFrame = undefined;
    latestScrollSettleFrame = undefined;
  }
  /**
   * Tab or a screen reader can move the focus to a control above the view. The chat then scrolls up
   * with no wheel, key, touch or drag, so the chat stops following, as after a jump to a search match.
   * A return to the bottom follows again. A click focuses without a scroll. Chromium scrolls before
   * `focusin`, so the chat is already above its last scroll event. A dialog or menu that closes gives
   * the focus back to its opener without a scroll; the opener can be above the view by then, and the
   * chat continues to follow.
   */
  function readerFocusIn() {
    if (readerDragging || !scrollElement) return;
    if (scrollElement.scrollTop < lastScrollTop) stopFollowingLatest();
    // A focus that moved the chat down also leaves the unread divider; the hold must not move the focus out of view.
    else if (scrollElement.scrollTop > lastScrollTop) unreadOpening.holding = false;
  }
  /**
   * A scroll is the reader's when the chat moves the way that the reader's last input asked, soon after
   * it, or while the reader drags the scroll bar or a text selection. Input that moves something else,
   * such as a code block that scrolls, a sideways swipe or a key in a field, does not move the chat.
   */
  const followReaderScroll = (element: HTMLElement) => {
    const moved = element.scrollTop - lastScrollTop;
    lastScrollTop = element.scrollTop;
    const intent = readerIntent && performance.now() - readerIntent.at < READER_INPUT_WINDOW_MS ? readerIntent : null;
    if (moved < 0 && (readerDragging || intent?.up === true)) leaveLatest();
    else if (moved > 0 && (readerDragging || intent?.up === false)) {
      readerLeftLatest = false;
      // A scroll up ends the hold at the unread divider in `leaveLatest`; a scroll down ends it here.
      unreadOpening.holding = false;
    }
    // Distance only rejoins. A follow that has not yet landed, or a correction to the last row
    // above the activity line, can sit more than 80px from the real bottom while a turn runs.
    if (!readerLeftLatest && element.scrollHeight - element.scrollTop - element.clientHeight <= 80) {
      stickToLatest = true;
    }
  };
  function noteReaderIntent(up: boolean) {
    readerIntent = { up, at: performance.now() };
  }
  function readerWheel(event: WheelEvent) {
    // Ctrl with the wheel zooms, and a sideways swipe can report a small vertical delta.
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    noteReaderIntent(event.deltaY < 0);
  }
  function readerKeyDown(event: KeyboardEvent) {
    // A control that used the key, such as the rows of a trace dialog, did not scroll the chat. A key in
    // a side thread does not scroll the agent's own chat under it.
    if (event.defaultPrevented || sideThreadOpen()) return;
    // A key in a field, such as the composer, moves the caret. A scroll soon after it is not the reader's.
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") noteReaderIntent(true);
    else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") noteReaderIntent(false);
    else if (event.key === " ") noteReaderIntent(event.shiftKey);
  }
  function readerTouchMove(event: TouchEvent) {
    const y = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    // A finger that moves down scrolls the chat up.
    if (y !== undefined && lastTouchY !== undefined && y !== lastTouchY) noteReaderIntent(y > lastTouchY);
    lastTouchY = y;
  }
  function readerTouchEnd() {
    lastTouchY = undefined;
  }
  /* Only the main button drags. A context menu can take the release of another button. */
  function readerPointerDown(event: PointerEvent) {
    if (event.button === 0) readerDragging = true;
  }
  const setVirtualRootElement = (element: HTMLDivElement) => {
    virtualRoot = element;
    updateVirtualScrollMargin();
    scrollResizeObserver?.observe(element);
  };
  const setUnreadMessagesDividerElement = (element: HTMLDivElement) => {
    unreadMessagesDivider = element;
  };
  const setAgentActivitySlotElement = (element: HTMLDivElement) => {
    agentActivitySlot = element;
    scrollResizeObserver?.observe(element);
  };
  const setRequiredInteractionElement = (element: HTMLElement | undefined) => {
    if (requiredInteractionElement) scrollResizeObserver?.unobserve(requiredInteractionElement);
    requiredInteractionElement = element;
    if (element) scrollResizeObserver?.observe(element);
  };
  const setBrowserSurfaceElement = (element: HTMLDivElement | undefined) => {
    setBrowserSurface(element);
  };
  const setAttachmentPickerElement = (element: HTMLInputElement) => {
    attachmentPicker = element;
  };
  /**
   * A voice conversation hears and speaks on this computer, so it needs its speech models. A remote
   * server gets the text only.
   */
  const voiceConversationAvailable = () => !channel && !props.runtime;
  /** Starts a voice conversation with an agent. It ends with the owner that calls this. */
  const startVoiceConversation = (agentId: string) =>
    createVoiceConversation({
      agentId,
      serverId: props.server?.id ?? "local",
      voice: conversationRuntime(props).voice,
      submit: (draft, target, submittedSnapshot, voice) =>
        actions.submitMessage(draft, target, submittedSnapshot, voice),
      serverOnline: () => props.server?.kind !== "remote" || props.server.state === "online",
    });

  return {
    sideThreadOpen,
    threadSearch,
    threadSearchOpen,
    threadSearchQuery,
    threadSearchMatches,
    activeThreadSearchIndex,
    setThreadSearchQuery,
    setThreadScrollElement,
    threadComposer,
    threadFocusRequest,
    threadVoiceLiveText,
    threadVoiceOwned,
    replyJump,
    voiceConversationAvailable,
    startVoiceConversation,
    sideQuestionAvailable,
    sideQuestion,
    setSideQuestionDraft,
    openSideQuestion,
    askSideQuestion,
    conversationPanelElement,
    setAgentActivitySlotElement,
    setBrowserSurfaceElement,
    setChatSearchInputElement,
    setConversationPanelElement,
    setAttachmentPickerElement,
    setScrollElement,
    setStickToLatest,
    followReaderScroll,
    setUnreadMessagesDividerElement,
    setVirtualRootElement,
    activeBrowserControl,
    actingBrowserControl,
    activeBrowserTab,
    allBrowserTabs,
    browserTakeoverPreview,
    browserTakeoverResolution,
    browserTakeoverTab,
    respondToBrowserTakeover,
    openBrowserTakeoverTab,
    localSignIn,
    activeChatSearchIndex,
    agentActivity,
    runningTurnRuntime,
    agentReady,
    providerUpdateRequired,
    agentActivitySpaceReserved,
    activateBrowserTab,
    showBrowserTabOf,
    browserTabOwner,
    attachmentAction,
    attachmentBusy,
    browserAddress,
    browserSidebarOpen,
    browserExpandedOpen,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    browserPanelWidth,
    browserTabs,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    closeBrowserTab,
    takeBrowserControl,
    releaseBrowserControl,
    closeChatSearch,
    clearNewMessages,
    closeSidebarFilePreview,
    composerError: currentComposerError,
    currentComposerError,
    currentChatError,
    currentChatErrorReference,
    currentChatErrorRun,
    currentChatConversationKey,
    dismissCurrentChatErrors,
    dismissAwaitingReplies,
    clearComposerError,
    setComposerErrorForTarget,
    clearChatErrors,
    composerFocusRequest,
    composerHasContent,
    copiedMessageId,
    copyMessage,
    pasteFiles,
    releaseCutAttachments,
    clearSubmittedDraft,
    currentDraft,
    currentTarget,
    currentConversationError,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    dropActive,
    editQueuedMessage,
    editingDeliveryId: currentEditingDeliveryId,
    cancelQueuedMessageEdit,
    editingPendingSave,
    expandedEmojiMessageId,
    scrollFades,
    filesOpen,
    activeRightPanel,
    panelSubagentId,
    shownSubagentId,
    shownPanelThreadId,
    openPanelThread,
    closePanelThread,
    movePanelThreadToChat,
    moveThreadToPanel,
    toggleSubagentPanel,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    openSidePanelPane,
    toggleSidePanel,
    closeSidePanelPane,
    filePreviewOpen,
    handleChatSearchShortcut,
    hideBrowserPanel,
    jumpToLatestMessage,
    jumpToUnreadMessages,
    markMessageSeen,
    markUnreadMessages,
    markingRead,
    messageVirtualizer,
    timelineMessages,
    toggleRoutineRun,
    toggleAgentMessage,
    timelineIndexById,
    unreadBoundaryMessageId,
    moveChatSearch,
    newMessageCount,
    openAttachmentPicker,
    openBrowserAddress,
    openExternalMessageUrl,
    messageLinkRelay,
    openMessageLinkRelay,
    pasteMessageLinkRelay,
    cancelMessageLinkRelay,
    openReactionMessageId,
    openRoutineSettings,
    openRoutineRunMessage,
    openSharedFile,
    openSidebarFileExternally,
    downloadSidebarFile,
    downloadMessageImageFile,
    revealSidebarFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewWorkspaceAgentId,
    sidebarFileBack,
    openSidebarFileBack,
    awaitingReplies,
    channel,
    pendingSendFor,
    retryPendingSend,
    editPendingSend,
    dismissPendingSend,
    presentedQueueDeliveries,
    previewAttachment,
    props,
    queuePanelVisible,
    reactToMessage,
    navigateBrowserTab,
    reloadBrowserTab,
    stopBrowserTab,
    removeAttachment,
    renderedAgentActivity,
    providerSilentMinutes,
    providerOffline,
    agentProviderName,
    reorderPresentedQueue,
    replyTarget,
    replyToMessage,
    addPageText,
    setPageContext,
    skillSettingsRequest,
    openSkillSettings,
    routineSettingsRequest,
    updateRuntimeSettings,
    scheduleUnreadDividerVisibilityUpdate,
    screenOpen,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    sendSelectionInstruction,
    sendCardMessage,
    quoteRequest,
    quoteSelection,
    openQuote,
    setActiveRightPanel,
    setBrowserAddress,
    setBrowserPanelWidth,
    setChatSearchQuery,
    setComposerError: setScopedComposerError,
    changeFastMode,
    fastMode,
    setComposerFocusRequest,
    setDropActive,
    setExpandedEmojiMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
    registerPromptComposerAnswer,
    handleRoutineSettingsRequest,
    setSettingsPanelWidth,
    setShowComposerActions,
    settingsModel,
    settingsProvider,
    settingsOpen,
    settingsPanelWidth,
    settingsReasoning,
    sidebarFilePreview,
    showBrowserPip,
    showComposerActions,
    showScrollToLatest,
    startVoiceRecording,
    startThreadVoiceRecording,
    stopVoiceRecording,
    stopVoiceRecordingAndSend,
    cancelVoiceRecording,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    submitting,
    unreadDividerVisible,
    unreferencedDraftAttachments,
    updateCurrentDraft,
    updateScrollFade,
    updateTeamTyping,
    updateUnreadDividerVisibility,
    voiceElapsedSeconds,
    voiceLevels,
    voiceLimitNotice,
    dismissVoiceLimitNotice,
    voiceLiveText,
    voicePhase,
    voiceModelProgress,
  };
}

export type ConversationViewScope = ReturnType<typeof createConversationViewScope>;

export const ConversationViewScopeContext = createContext<ConversationViewScope>();

export function useConversationViewScope(): ConversationViewScope {
  const scope = useContext(ConversationViewScopeContext);
  if (!scope) throw new Error("Conversation view scope is unavailable outside ConversationView.");
  return scope;
}
