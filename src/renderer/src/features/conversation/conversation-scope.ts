import { isKnownAgentProvider, providerDisplayName } from "@openbot/contracts/agent-providers";
import {
  type FileQuoteTarget,
  fileQuoteId,
  fileQuoteTarget,
  limitedQuoteText,
} from "@openbot/contracts/chat-tag-references";
import { isNarrationItemId } from "@openbot/contracts/conversation-narration";
import {
  customProviderOfModel,
  isCustomProviderHarness,
  type McpSignInRelayPage,
  relayableSignInLink,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { AGENT_FAST_MODE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_SPEED_CAPABILITY } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { toast } from "@openbot/ui";
import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import type { QuoteRequest } from "@openbot/ui/features/conversation/ComposerEditor";
import { currentText } from "@openbot/ui/text";
import { prefersReducedMotion, usesTouchLayout } from "@openbot/ui/utils";
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
import { holdNativeBrowserPage } from "../../native-browser-page";
import { createScopeGuard } from "../../scope-lifetime";
import { appendVoiceTranscript } from "../../voice-recording";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { codexLiveAccess } from "../speech/codex-live-access";
import { createAttachmentImportSounds } from "./attachment-import-sounds";
import { createChangeMarkerActions } from "./change-marker-actions";
import type { ChatSearchMatch } from "./chat-search";
import { appendDraftText, EMPTY_DRAFT } from "./composer-draft";
import { useConversationController } from "./conversation-controller-context";
import { agentConversationKey, composerDraftKey, promptRequestKey } from "./conversation-keys";
import { conversationPort } from "./conversation-port";
import { conversationRuntime } from "./conversation-runtime";
import type {
  AgentSettingsRequest,
  ComposerDraft,
  ConversationProps,
  ConversationTarget,
  RightPanelMode,
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
import type { SkillSuggestionSaveResult } from "./SkillSuggestionChatCard";
import { createActivityStore } from "./stores/activity-store";
import { createBrowserStore } from "./stores/browser-store";
import { createComposerActions } from "./stores/composer-actions";
import { conversationOwnerId, createComposerStore, currentConversationTarget } from "./stores/composer-store";
import { createMcpServersStore } from "./stores/mcp-servers-store";
import { createMessageActions } from "./stores/message-actions";
import { createMessagePinsStore } from "./stores/message-pins-store";
import { createPanelsStore, isSidePanelMode } from "./stores/panels-store";
import { PENDING_SEND_ID_PREFIX, type PendingSend, pendingSendMessage } from "./stores/pending-send-store";
import { createQueueStore } from "./stores/queue-store";
import { createReplyJumpStore } from "./stores/reply-jump-store";
import { createScrollStore } from "./stores/scroll-store";
import { createSearchStore } from "./stores/search-store";
import { createSettingsStore, runtimeSettingsEqual } from "./stores/settings-store";
import { createSideQuestionStore } from "./stores/side-question-store";
import { createSkillsStore } from "./stores/skills-store";
import { createThreadComposerActions } from "./stores/thread-composer-actions";
import { createThreadQueue } from "./stores/thread-queue-edit";
import { createVoiceConversation } from "./stores/voice-conversation-store";
import { createVoiceStore } from "./stores/voice-store";

const READER_INPUT_WINDOW_MS = 250;

const handledSettingsRequests = new WeakSet<AgentSettingsRequest>();

const handledMessageFocusRequests = new WeakSet<NonNullable<ConversationProps["messageFocusRequest"]>>();
const MESSAGE_FOCUS_ROW_FRAMES = 4;

function builtInBrowserPage(url: string): boolean {
  const page = URL.parse(url);
  return (page?.protocol === "http:" || page?.protocol === "https:") && relayableSignInLink(url) === null;
}

const CHAT_GLIDE_TIME_CONSTANT_MS = 70;
const CHAT_GLIDE_MAX_STEP_MS = 34;
const CHAT_PUSH_DURATION_MS = 280;
const CHAT_PUSH_EASING = "cubic-bezier(0.2, 0.9, 0.3, 1)";
const CHAT_GLIDE_OPEN_DELAY_MS = 600;
const MEDIA_SETTLE_MS = 150;
const MEDIA_LAYOUT_EVENTS = ["load", "error", "loadedmetadata"] as const;
const SENT_MESSAGE_PIN_MS = 400;
const WAITING_QUESTION_CARD = '.question-prompt-bubble:not([data-state="done"])';

export function createConversationViewScope(props: ConversationProps) {
  const controller = useConversationController();
  const channel = untrack(() => props.channel);
  const agentReady = () => props.agentStatus.phase === "ready";
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
    attachmentUploads,
    showComposerActions,
    setShowComposerActions,
    importingDrafts,
    setImportingDrafts,
    pastePreviews,
    setPastePreviews,
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
    sidePanelWidth,
    setSidePanelWidth,
    hiddenAwaitingReplyIds,
    setHiddenAwaitingReplyIds,
    sideQuestions: sideQuestionStates,
    setSideQuestions,
    sidePanels,
    setSidePanels,
    sidePanelShown,
    setSidePanelShown,
    resources,
  } = controller;
  const drafts = channel ? channelDrafts : agentDrafts;
  const setDrafts = channel ? setChannelDrafts : setAgentDrafts;
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
    instructionsSettingsRequest,
    openInstructionsSettings,
    agentSettingRowRequest,
    openAgentSettingRow,
    handleAgentSettingRowRequest,
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
    removeSidePanelFile,
    moveSidePanelFile,
    openSidePanelFile,
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
    attachmentDownloads,
    openSharedFile,
    openThreadFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewFileKey,
    previewWorkspaceAgentId,
    sidebarFileBack,
    openSidebarFileBack,
    openSidebarFileExternally,
    downloadSidebarFile,
    downloadMessageImageFile,
    revealSidebarFile,
    clearSidebarFilePreview,
  } = panels;
  const changeMarkerActions = createChangeMarkerActions(props, Boolean(channel), {
    skill: openSkillSettings,
    instructions: openInstructionsSettings,
  });
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
  async function saveSkillSuggestion(messageId: string, reply: string): Promise<SkillSuggestionSaveResult> {
    const target = currentTarget();
    const agentId = props.agent?.id;
    if (agentId) {
      const input = { agentId, messageId };
      const save = props.runtime
        ? props.runtime.saveSkillSuggestion?.(input)
        : conversationPort().agent.saveSkillSuggestion(input, props.server?.id);
      const result = await save?.catch(() => null);
      if (result?.saved === true) return "saved";
    }
    return sendCardMessage(reply, target) ? "sent" : null;
  }
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
    pastePreviews,
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
    rowDraftAttachments,
    currentPastePreviews,
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
  const currentChatErrorReference = createMemo(() => {
    const target = currentTarget();
    const message = currentComposerError();
    if (!target || !message) return null;
    const entry = composerErrorReferences()[composerDraftKey(target)];
    return entry?.message === message ? entry.reference : null;
  });
  const currentChatErrorEntry = createMemo(() => {
    const target = currentTarget();
    const message = currentChatError();
    if (!target || !message) return null;
    const entry = conversationErrorRuns()[composerDraftKey(target)];
    return entry?.message === message ? entry : null;
  });
  const currentChatErrorRun = () => currentChatErrorEntry()?.run ?? null;
  const currentChatErrorLink = () => currentChatErrorEntry()?.link ?? null;
  const currentChatErrorDetails = () => currentChatErrorEntry()?.details ?? null;
  const attachmentBusy = (target = currentTarget()) =>
    target !== undefined && importingDrafts().has(composerDraftKey(target));
  const uploadFailed = (target = currentTarget()) =>
    target !== undefined && attachmentUploads.hasFailed(composerDraftKey(target));
  const syncAttachmentImports = () =>
    setImportingDrafts(new Set(Array.from(resources.importTargetAgents.values(), composerDraftKey)));
  const currentUploads = createMemo(() => {
    const target = currentTarget();
    return target ? attachmentUploads.list(composerDraftKey(target)) : [];
  });
  const removeUpload = (requestId: string) => {
    attachmentUploads.remove(requestId);
    resources.importTargetAgents.delete(requestId);
    syncAttachmentImports();
    conversationRuntime(props).agent.discardAttachmentImport?.(requestId);
  };
  const retryUpload = (requestId: string) => conversationRuntime(props).agent.retryAttachmentImport?.(requestId);
  const currentPendingSends = createMemo(() => pendingSends.list(currentTarget()));
  const startingDeliveryIds = createMemo(() => {
    const ids = new Set<string>();
    const unanswered: string[] = [];
    for (const send of currentPendingSends()) {
      if (send.starting && send.messageId) ids.add(send.messageId);
      else if (send.state === "sending" && !send.queued) unanswered.push(send.text.trim());
    }
    if (unanswered.length === 0) return ids;
    for (const delivery of [...(props.queue?.deliveries ?? [])].reverse()) {
      const waiting = delivery.status === "queued" || delivery.status === "starting";
      if (!waiting || delivery.sender.kind !== "user" || ids.has(delivery.id)) continue;
      const index = unanswered.indexOf(delivery.text.trim());
      if (index < 0) continue;
      ids.add(delivery.id);
      unanswered.splice(index, 1);
    }
    return ids;
  });
  const sendStarting = createMemo(() =>
    currentPendingSends().some((send) => send.state === "sending" || send.starting),
  );
  const queue = createQueueStore({ props, hiddenAwaitingReplyIds, startingDeliveryIds });
  const {
    activeDeliveries,
    orderedQueuedDeliveries,
    presentedQueueDeliveries,
    queuePanelVisible,
    queueOpen,
    renderedQueueDeliveries,
  } = queue;
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
    setComposerFocusRequest((value) => value + 1);
  };
  const activity = createActivityStore({
    props,
    activeDeliveries,
    shownMessages: () => scroll.shownMessages(),
    agentActivityLabels: resources.agentActivityLabels,
    turnRuntimes: resources.turnRuntimes,
  });
  const {
    renderedAgentActivity,
    activeStepActivity,
    activeTurnOutputShown,
    agentActivitySpaceReserved,
    setAgentActivitySpaceReserved,
    agentActivity,
    runningTurnRuntime,
    providerSilentMinutes,
    providerOffline,
  } = activity;
  createEffect(
    () =>
      !channel && currentPendingSends().length > 0
        ? agentConversationKey(props.server?.id ?? "local", props.agent?.id ?? "")
        : undefined,
    (sendingChat) => {
      if (sendingChat) setAgentActivitySpaceReserved(true);
    },
  );
  const agentProviderName = () => {
    const agent = props.agent;
    if (!agent) return undefined;
    const endpoint = isCustomProviderHarness(agent.provider)
      ? customProviderOfModel(agent.model, props.customProviders ?? [])
      : undefined;
    return endpoint?.name ?? providerDisplayName(agent.provider);
  };
  const browser = createBrowserStore({
    props,
    browserOpenRequests: resources.browserOpenRequests,
    browserAddress,
    setBrowserAddress,
    setComposerError: setScopedComposerError,
    takeoverPageRequest: controller.browserTakeoverPageRequest,
    setTakeoverPageRequest: controller.setBrowserTakeoverPageRequest,
    panels: {
      activeRightPanel,
      setActiveRightPanel,
      closeBrowserPane,
    },
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
    openWaitingAgent,
    canOpenBrowserTakeoverTab,
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
    browserTeach,
    canTeachBrowserTask,
    openBrowserTeach,
    closeBrowserTeach,
    startBrowserTeach,
    stopBrowserTeach,
  } = browser;
  function showBrowserPanel() {
    setActiveRightPanel("browser");
    if (browserTabs().length === 0) void openBrowserAddress();
  }
  const sidePanelPaneActions: { [Pane in SidePanelPane]?: { open?: () => void; release?: () => void } } = {
    browser: { open: showBrowserPanel },
    question: { release: () => deleteSideQuestion() },
  };
  function openSidePanelPane(pane: SidePanelPane) {
    const open = sidePanelPaneActions[pane]?.open;
    if (open) open();
    else setActiveRightPanel(pane);
  }
  const sideThreadIds = () => props.threads?.side.tabs.map((thread) => thread.id) ?? [];
  const shownPanelThreadId = () => {
    const id = panelThreadId();
    return id !== null && sideThreadIds().includes(id) ? id : null;
  };
  function toggleSidePanel() {
    if (sidePanelOpen()) hideBrowserPanel();
    else showSidePanel();
  }
  function showSidePanel(startsBrowser = true) {
    const { panes, selected, files, file } = sidePanel();
    const opens = (pane: SidePanelPane | undefined): pane is SidePanelPane =>
      pane !== undefined && (startsBrowser || pane !== "browser" || browserTabs().length > 0);
    const pane = selected && panes.includes(selected) && opens(selected) ? selected : null;
    const thread = shownPanelThreadId() ?? sideThreadIds()[0];
    if (file && files.some((item) => item.key === file)) {
      setActiveRightPanel("side-panel");
      openSidePanelFile(file);
    } else if (pane) openSidePanelPane(pane);
    else if (thread && selected === null) openPanelThread(thread);
    else if (opens(panes[0])) openSidePanelPane(panes[0]);
    else setActiveRightPanel("side-panel");
  }
  function leavePanelThread(id: string, leave: () => void) {
    const shown = activeRightPanel() === "thread" && shownPanelThreadId() === id;
    const ids = sideThreadIds();
    const index = ids.indexOf(id);
    leave();
    if (!shown) return;
    const rest = ids.filter((other) => other !== id);
    const thread = rest[Math.min(Math.max(index, 0), rest.length - 1)];
    const pane = sidePanel().panes.at(-1);
    const file = sidePanel().files.at(-1);
    if (thread) openPanelThread(thread);
    else if (pane) openSidePanelPane(pane);
    else if (file) {
      setActiveRightPanel("side-panel");
      openSidePanelFile(file.key);
    } else setActiveRightPanel("side-panel");
  }
  function closePanelThread(id: string) {
    leavePanelThread(id, () => props.threads?.side.onClose(id));
  }
  function movePanelThreadToChat(id: string) {
    leavePanelThread(id, () => props.threads?.side.onToChat(id));
  }
  function moveThreadToPanel(id: string) {
    props.threads?.side.onToSide(id);
    openPanelThread(id);
  }
  createEffect(
    () => ({
      shown: activeRightPanel() === "thread" ? shownPanelThreadId() : null,
      requested: activeRightPanel() === "thread" ? panelThreadId() : null,
      ids: sideThreadIds(),
      pane: sidePanel().panes.at(-1),
      file: sidePanel().files.at(-1)?.key,
    }),
    (next, previous) => {
      if (next.shown !== null || !previous?.shown || next.requested !== previous.shown) return;
      const index = previous.ids.indexOf(previous.shown);
      const thread = next.ids[Math.min(Math.max(index, 0), next.ids.length - 1)];
      if (thread) openPanelThread(thread);
      else if (next.pane) openSidePanelPane(next.pane);
      else if (next.file) {
        setActiveRightPanel("side-panel");
        openSidePanelFile(next.file);
      }
    },
  );
  const shownSubagentId = () => (activeRightPanel() === "subagent" ? panelSubagentId() : null);
  function toggleSubagentPanel(subagentId: string) {
    if (shownSubagentId() === subagentId) closeSidePanelPane("subagent");
    else openSubagentPanel(subagentId);
  }
  function closeSidePanelPane(pane: SidePanelPane) {
    sidePanelPaneActions[pane]?.release?.();
    const shown = sidePanelOpen() && sidePanel().selected === pane;
    const next = removeSidePanelPane(pane);
    if (shown) showSidePanelInPlaceOf(next);
  }
  function closeBrowserPane() {
    showSidePanelInPlaceOf(removeSidePanelPane("browser"));
  }
  function showSidePanelInPlaceOf(next: SidePanelPane | null) {
    const thread = sideThreadIds()[0];
    const file = sidePanel().files.at(-1);
    if (next) openSidePanelPane(next);
    else if (thread) openPanelThread(thread);
    else if (file) {
      setActiveRightPanel("side-panel");
      openSidePanelFile(file.key);
    } else setActiveRightPanel("side-panel");
  }
  function closeSidePanelFile(key: string) {
    const shown = filePreviewOpen() && sidePanel().file === key;
    const next = removeSidePanelFile(key);
    if (!shown) return;
    clearSidebarFilePreview();
    if (next) {
      setActiveRightPanel("side-panel");
      openSidePanelFile(next);
      return;
    }
    const pane = sidePanel().panes.at(-1);
    const thread = sideThreadIds()[0];
    if (pane) openSidePanelPane(pane);
    else if (thread) openPanelThread(thread);
    else setActiveRightPanel("side-panel");
  }
  function closeShownSidePanelFile() {
    const key = sidePanel().file;
    if (key) closeSidePanelFile(key);
  }
  const viewIsMounted = createScopeGuard();
  let attachmentPicker: HTMLInputElement | undefined;
  const ownMessagesBefore = new Map<string, ReadonlySet<string>>();
  const channelSentIds = createMemo((): ReadonlyMap<string, string> => {
    const found = new Map<string, string>();
    if (!channel) return found;
    const sends = currentPendingSends();
    const waiting = sends.filter((send) => send.state === "sending" && !send.messageId);
    for (const id of ownMessagesBefore.keys())
      if (!waiting.some((send) => send.clientMessageId === id)) ownMessagesBefore.delete(id);
    if (waiting.length === 0) return found;
    const own = props.messages.filter((message) => channel.ownMessage(message));
    const taken = new Set(sends.flatMap((send) => (send.messageId ? [send.messageId] : [])));
    for (const send of waiting) {
      const before = ownMessagesBefore.get(send.clientMessageId);
      if (!before) {
        ownMessagesBefore.set(send.clientMessageId, new Set(own.map((message) => message.id)));
        continue;
      }
      const after = own.filter((message) => !before.has(message.id) && !taken.has(message.id));
      const match =
        after.find((message) => message.body.trim() === send.text.trim()) ??
        (waiting.length === 1 ? after[0] : undefined);
      if (!match) continue;
      found.set(send.clientMessageId, match.id);
      taken.add(match.id);
    }
    return found;
  });
  const sentMessageId = (send: PendingSend) => send.messageId ?? channelSentIds().get(send.clientMessageId) ?? null;
  const drawnHostIds = createMemo(() =>
    currentPendingSends().some((send) => sentMessageId(send))
      ? new Set([
          ...props.messages.map((message) => message.id),
          ...presentedQueueDeliveries().map((delivery) => delivery.id),
        ])
      : new Set<string>(),
  );
  const deliveriesBefore = new Map<string, ReadonlySet<string>>();
  const queuedSendIds = createMemo((): ReadonlySet<string> => {
    const found = new Set<string>();
    const waiting = currentPendingSends().filter((send) => send.queued && send.state === "sending");
    for (const id of deliveriesBefore.keys())
      if (!waiting.some((send) => send.clientMessageId === id)) deliveriesBefore.delete(id);
    if (waiting.length === 0) return found;
    const deliveries = (props.queue?.deliveries ?? []).filter((delivery) => delivery.sender.kind === "user");
    const taken = new Set<string>();
    for (const send of waiting) {
      const before = deliveriesBefore.get(send.clientMessageId);
      if (!before) {
        deliveriesBefore.set(send.clientMessageId, new Set(deliveries.map((delivery) => delivery.id)));
        continue;
      }
      const match = deliveries.find(
        (delivery) => !before.has(delivery.id) && !taken.has(delivery.id) && delivery.text.trim() === send.text.trim(),
      );
      if (!match) continue;
      found.add(send.clientMessageId);
      taken.add(match.id);
    }
    return found;
  });
  const pendingMessages = createMemo(() => {
    const queuedIds = queuedSendIds();
    return currentPendingSends()
      .filter((send) => {
        const messageId = sentMessageId(send);
        return !(messageId && drawnHostIds().has(messageId));
      })
      .filter((send) => !send.queued || send.state === "failed" || (send.late && !queuedIds.has(send.clientMessageId)))
      .map(pendingSendMessage);
  });
  const pendingSendFor = (messageId: string | undefined) =>
    messageId?.startsWith(PENDING_SEND_ID_PREFIX)
      ? currentPendingSends().find((send) => `${PENDING_SEND_ID_PREFIX}${send.clientMessageId}` === messageId)
      : undefined;
  const handedOverRowKeys = createMemo<ReadonlyMap<string, string>>((previous = new Map()) => {
    const usedKeys = new Set(previous.values());
    const sent = currentPendingSends().flatMap((send) => {
      const messageId = sentMessageId(send);
      const rowKey = `${PENDING_SEND_ID_PREFIX}${send.clientMessageId}`;
      if (!messageId || previous.has(messageId) || usedKeys.has(rowKey)) return [];
      usedKeys.add(rowKey);
      return [[messageId, rowKey] as const];
    });
    return sent.length ? new Map([...previous, ...sent]) : previous;
  });
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
    drawLatestFirst: () => !chatSearchOpen(),
    markingRead,
    setMarkingRead,
    setComposerError: setScopedComposerError,
    pendingMessages,
    handedOverRowKeys,
    elements: {
      scrollElement: () => scrollElement,
      virtualRoot: () => virtualRoot,
      unreadMessagesDivider: () => unreadMessagesDivider,
    },
    sticky: {
      getStickToLatest: () => stickToLatest,
      setStickToLatest,
      getCurrentUnreadCount: () => currentUnreadCount,
      followLatest: (element) => glideConversationBottom(element),
      followReaderScroll: (element) => followReaderScroll(element),
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
    updateAnswers,
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
  createEffect(chatSearchOpen, (open) => {
    if (open) messageVirtualizer.drawAllRows();
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
  createEffect(
    () => {
      const open = props.threads?.open;
      return open === undefined ? undefined : (open?.id ?? null);
    },
    () => {
      if (untrack(threadSearchOpen)) threadSearch.closeChatSearch(false);
    },
  );
  createEffect(threadSearchOpen, (open) => {
    if (open && untrack(chatSearchOpen)) closeChatSearch(false);
  });
  const handleChatSearchShortcut = (event: KeyboardEvent) => {
    (sideThreadOpen() ? threadSearch : search).handleChatSearchShortcut(event);
  };
  const threadQueue = createThreadQueue({
    props,
    threadDrafts: controller.threadDrafts,
    setThreadDrafts: controller.setThreadDrafts,
    edit: controller.threadQueueEdit,
    setEdit: controller.setThreadQueueEdit,
    persist: persistDrafts,
  });
  const threadComposer = createThreadComposerActions({
    props,
    threadDrafts: controller.threadDrafts,
    setThreadDrafts: controller.setThreadDrafts,
    pastePreviews,
    setPastePreviews,
    draftLocked: threadQueue.draftLocked,
    keepsAttachment: threadQueue.keepsAttachment,
  });
  const messagePins = createMessagePinsStore({ props });
  const [threadFocusRequest, setThreadFocusRequest] = createSignal(0);
  const requestThreadFocus = () => setThreadFocusRequest((current) => current + 1);
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
        flush();
        const threads = props.threads;
        if (!threads || threadComposer.openDraftKey() !== key) return;
        if (threadQueue.editsDraft(key)) {
          await threadComposer.importsEnded(key);
          await threadQueue.save(key);
        } else await threadComposer.send(threads, threadComposer.draft(key).text.trim());
        if (threadComposer.openDraftKey() === key) setThreadFocusRequest((current) => current + 1);
      },
      reportError: (message) => actionToast.error(message),
      reportLimit: () => toast.warning(currentText().t("composer.voice.limitReached")),
    },
  });
  const { startVoiceRecording, stopVoiceRecording, stopVoiceRecordingAndSend, cancelVoiceRecording } = voice;
  const branchThread = async (sourceTaskId: string | null, messageId: string) => {
    const onBranch = props.threads?.onBranch;
    if (!onBranch || !(await onBranch(sourceTaskId, messageId))) return;
    flush();
    setThreadFocusRequest((current) => current + 1);
  };
  const startNewThread = () => {
    const onNew = props.threads?.header.onNew;
    if (!onNew) return;
    onNew();
    flush();
    requestThreadFocus();
  };
  const startThreadVoiceRecording = () => {
    const key = threadComposer.openDraftKey();
    if (key !== undefined) void startVoiceRecording(key);
  };
  const threadVoiceOwned = () => {
    const key = threadComposer.openDraftKey();
    return key !== undefined && voicePhase() !== "idle" && voiceThreadKey() === key;
  };
  createEffect(
    () => ({ key: threadComposer.openDraftKey(), owner: voiceThreadKey(), recording: voicePhase() === "recording" }),
    ({ key, owner, recording }) => {
      if (recording && owner !== key) stopVoiceRecording();
    },
  );
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
  createEffect(
    () => voiceLimitNotice() && !currentDraft().text.trim(),
    (emptied) => {
      if (emptied) dismissVoiceLimitNotice();
    },
  );
  const [promptComposerAnswer, setPromptComposerAnswer] = createSignal<QuestionPromptComposerAnswer>();
  const registerPromptComposerAnswer = (answer: QuestionPromptComposerAnswer) => {
    setPromptComposerAnswer(() => answer);
    return () => setPromptComposerAnswer((current) => (current === answer ? undefined : current));
  };
  const openPromptKey = () => promptRequestKey(props.prompt?.turnId, props.prompt?.requestId);
  const openChatKey = () => {
    const open = props.threads?.open;
    return JSON.stringify([
      agentConversationKey(props.server?.id ?? "local", conversationOwnerId(props) ?? ""),
      open === undefined ? null : (open?.id ?? ""),
    ]);
  };
  const composerHasText = () => Boolean(currentDraft().text.trim() || voiceLiveText().trim());
  const [draftHeldPromptKey, setDraftHeldPromptKey] = createSignal<string | null>(null);
  let unsentPromptAnswer: { chat: string; key: string; text: string } | undefined;
  const keepUnsentPromptAnswer = (text: string | undefined) => {
    const key = openPromptKey();
    unsentPromptAnswer = text === undefined || key === null ? undefined : { chat: openChatKey(), key, text };
  };
  createEffect(
    () => ({ chat: openChatKey(), key: openPromptKey() }),
    ({ chat, key }) => {
      const unsent = unsentPromptAnswer;
      const target = currentConversationTarget(props);
      if (!unsent || unsent.chat !== chat || unsent.key === key || !target) return;
      unsentPromptAnswer = undefined;
      const draftKey = composerDraftKey(target);
      setDrafts((current) => ({
        ...current,
        [draftKey]: appendDraftText(current[draftKey] ?? EMPTY_DRAFT, unsent.text),
      }));
    },
  );
  let lastOpenPrompt: { chat: string; key: string | null } | undefined;
  createEffect(
    () => {
      return {
        chat: openChatKey(),
        key: openPromptKey(),
        hasText: untrack(composerHasText),
      };
    },
    ({ chat, key, hasText }) => {
      const arrived = lastOpenPrompt?.chat === chat && lastOpenPrompt.key !== key;
      lastOpenPrompt = { chat, key };
      if (arrived && key && hasText) setDraftHeldPromptKey(key);
    },
  );
  createEffect(
    () => draftHeldPromptKey() !== null && draftHeldPromptKey() === openPromptKey() && !composerHasText(),
    (released) => {
      if (released) setDraftHeldPromptKey(null);
    },
  );
  const composerPromptAnswer = () => {
    const key = draftHeldPromptKey();
    return key !== null && key === openPromptKey() ? undefined : promptComposerAnswer();
  };
  const actions = createComposerActions({
    props,
    attachmentBusy,
    uploadFailed,
    syncAttachmentImports,
    setPastePreviews,
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
    followSentMessage,
    pendingSends,
    attachmentPicker: () => attachmentPicker,
    promptComposerAnswer: composerPromptAnswer,
  });
  const {
    updateTeamTyping,
    addAttachments,
    pasteFiles,
    releaseCutAttachments,
    openAttachmentPicker,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    endQueuedMessageEdit,
    reorderPresentedQueue,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    sendSelectionInstruction,
    sendCardMessage,
    sendCardFile,
    retryPendingSend,
    editPendingSend,
    dismissPendingSend,
  } = actions;
  createEffect(
    () => {
      const deliveryId = currentEditingDeliveryId();
      if (submitting() || deliveryId === null || props.queue?.agentId !== props.agent?.id) return null;
      const delivery = props.queue?.deliveries.find((item) => item.id === deliveryId);
      if (
        !delivery ||
        delivery.status === "queued" ||
        delivery.editing ||
        (delivery.status !== "cancelled" && editingPendingSave())
      )
        return null;
      return delivery;
    },
    (ended) => {
      if (ended) endQueuedMessageEdit(ended);
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
  const { replyToMessage, addPageText, setPageContext, reactToMessage, copyMessage, messageText, removeAttachment } =
    messageActions;
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
  let lastMaxScrollTop = 0;
  let readerLeftLatest = false;
  let readerDragging = false;
  let readerIntent: { up: boolean; at: number } | undefined;
  let lastTouchY: number | undefined;
  let currentUnreadCount = 0;
  let unreadOpening: {
    identity: string | undefined;
    pending: boolean;
    boundaryId: string | null | undefined;
    holding: boolean;
    settled: boolean;
  } = {
    identity: undefined,
    pending: false,
    boundaryId: undefined,
    holding: false,
    settled: false,
  };
  let conversationPanel: HTMLElement | undefined;
  const [browserSurface, setBrowserSurface] = createSignal<HTMLDivElement>();
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
  let lastLoaded: boolean | undefined;
  let chatGlideFrame: number | undefined;
  let chatGlideAfter = Number.POSITIVE_INFINITY;
  let sentMessagePinUntil = 0;
  function followSentMessage(): void {
    setStickToLatest(true);
    stopChatGlides();
    sentMessagePinUntil = performance.now() + SENT_MESSAGE_PIN_MS;
  }
  function requiredInteractionScrollTop(element: HTMLDivElement): number | undefined {
    const card = requiredInteractionElement;
    if (!card?.matches(WAITING_QUESTION_CARD) || !element.contains(card)) return undefined;
    const style = getComputedStyle(card);
    const slideOffset = new DOMMatrixReadOnly(style.transform).m42;
    const cardTop = card.getBoundingClientRect().top - slideOffset - element.getBoundingClientRect().top;
    return Math.max(0, Math.round(element.scrollTop + cardTop - Number.parseFloat(style.scrollMarginTop)));
  }
  function latestScrollTop(element: HTMLDivElement): number {
    const bottom = element.scrollHeight - element.clientHeight;
    const cardTop = requiredInteractionScrollTop(element);
    if (cardTop === undefined || element.scrollTop > cardTop + 1) return bottom;
    return Math.min(bottom, cardTop);
  }
  function followConversationBottom(element: HTMLDivElement): void {
    element.scrollTop = latestScrollTop(element);
  }
  function glideConversationBottom(element: HTMLDivElement): void {
    if (performance.now() < sentMessagePinUntil) {
      stopChatGlides();
      followConversationBottom(element);
      return;
    }
    if (pushConversationBottom(element)) return;
    if (chatGlideFrame !== undefined && !followAtOnce()) return;
    const distance = latestScrollTop(element) - element.scrollTop;
    if (distance <= 1 || distance > element.clientHeight || followAtOnce() || prefersReducedMotion()) {
      stopChatGlides();
      followConversationBottom(element);
      return;
    }
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(CHAT_GLIDE_MAX_STEP_MS, Math.max(0, now - last));
      last = now;
      const current = element.scrollTop;
      const left = latestScrollTop(element) - current;
      if (left <= 0.5) {
        if (left > 0) followConversationBottom(element);
        chatGlideFrame = undefined;
        return;
      }
      element.scrollTop = current + left * (1 - Math.exp(-elapsed / CHAT_GLIDE_TIME_CONSTANT_MS));
      chatGlideFrame = requestAnimationFrame(step);
    };
    chatGlideFrame = requestAnimationFrame(step);
  }
  let chatPush: Animation | undefined;
  function pushConversationBottom(element: HTMLDivElement): boolean {
    const list = virtualRoot;
    if (props.responseStyle !== "natural" || !list) return false;
    if (!agentActivitySlot?.querySelector(".agent-activity-entry")) return false;
    const distance = latestScrollTop(element) - element.scrollTop;
    if (distance <= 1 || distance > element.clientHeight || followAtOnce() || prefersReducedMotion()) return false;
    stopChatGlides();
    const before = element.scrollTop;
    followConversationBottom(element);
    const moved = element.scrollTop - before;
    if (moved <= 0) return true;
    list.dataset.pushing = "";
    let push: Animation | undefined;
    for (const row of list.children) {
      push = row.animate([{ transform: `translateY(${moved}px)` }, { transform: "translateY(0)" }], {
        duration: CHAT_PUSH_DURATION_MS,
        easing: CHAT_PUSH_EASING,
        composite: "add",
      });
    }
    chatPush = push;
    const finish = () => {
      if (chatPush !== push) return;
      chatPush = undefined;
      delete list.dataset.pushing;
    };
    push?.finished.then(finish, finish);
    if (!push) finish();
    return true;
  }
  function followAtOnce(): boolean {
    const now = performance.now();
    return now < chatGlideAfter || now < mediaSettleUntil;
  }
  function followJumps(element: HTMLDivElement): boolean {
    return followAtOnce() || latestScrollTop(element) - element.scrollTop > element.clientHeight;
  }
  let mediaSettleUntil = 0;
  function mediaLoaded(): void {
    mediaSettleUntil = performance.now() + MEDIA_SETTLE_MS;
  }
  function stopChatGlides(): void {
    if (chatGlideFrame !== undefined) cancelAnimationFrame(chatGlideFrame);
    chatGlideFrame = undefined;
  }
  function holdChatGlides(): void {
    stopChatGlides();
    chatGlideAfter = performance.now() + CHAT_GLIDE_OPEN_DELAY_MS;
  }
  onCleanup(stopChatGlides);
  let lastPanelAgentId: string | undefined;
  const [quoteRequest, setQuoteRequest] = createSignal<QuoteRequest | undefined>(undefined);
  let lastRuntimeSettingsSignature: string | undefined;
  async function saveAgentPatch(
    updates: Omit<UpdateAgentInput, "agentId">,
    targetAgentId = props.agent?.id,
  ): Promise<boolean> {
    const agentId = targetAgentId;
    if (!agentId) return false;
    await props.onUpdateAgent(agentId, updates);
    return true;
  }
  const [fastModeDraft, setFastModeDraft] = createSignal<{ agentId: string; fastMode: boolean; ultrafast: boolean }>();
  const fastMode = () => {
    const draft = fastModeDraft();
    return draft && draft.agentId === props.agent?.id ? draft.fastMode : props.agent?.fastMode === true;
  };
  const ultrafast = () => {
    const draft = fastModeDraft();
    return draft && draft.agentId === props.agent?.id ? draft.ultrafast : props.agent?.ultrafast === true;
  };
  const fastModeChange = () =>
    props.server?.kind === "local" ||
    serverSupportsCapability(props.server, AGENT_SPEED_CAPABILITY) ||
    serverSupportsCapability(props.server, AGENT_FAST_MODE_CAPABILITY)
      ? (next: boolean, nextUltrafast: boolean) => requestFastMode(next, nextUltrafast)
      : undefined;
  const [fastModeConfirmation, setFastModeConfirmation] = createSignal<string>();
  function requestFastMode(next: boolean, nextUltrafast: boolean): void {
    const agentId = props.agent?.id;
    if (next && agentId && settingsProvider() === "claude") {
      setFastModeConfirmation(agentId);
      return;
    }
    void changeFastMode(next, nextUltrafast);
  }
  createEffect(
    () => props.agent?.id,
    (agentId) => {
      if (agentId !== untrack(fastModeConfirmation)) setFastModeConfirmation(undefined);
    },
  );
  const fastModeConfirmationOpen = () => {
    const agentId = fastModeConfirmation();
    return agentId !== undefined && agentId === props.agent?.id;
  };
  function confirmFastMode(): void {
    if (!fastModeConfirmationOpen()) return;
    setFastModeConfirmation(undefined);
    void changeFastMode(true, false);
  }
  function cancelFastModeConfirmation(): void {
    setFastModeConfirmation(undefined);
  }
  async function changeFastMode(next: boolean, nextUltrafast: boolean): Promise<void> {
    const agentId = props.agent?.id;
    if (!agentId) return;
    const draft = { agentId, fastMode: next, ultrafast: next && nextUltrafast };
    setFastModeDraft(draft);
    setScopedComposerError(null);
    const { t, errorMessage } = currentText();
    let saved = false;
    let failure = t("composer.error.changeFastMode");
    try {
      saved = await saveAgentPatch({ fastMode: next, ...(draft.ultrafast ? { ultrafast: true } : {}) }, agentId);
    } catch (error) {
      failure = errorMessage(error, failure);
    }
    if (fastModeDraft() !== draft) return;
    setFastModeDraft(undefined);
    if (!saved && props.agent?.id === agentId) setScopedComposerError(failure);
  }

  onSettled(() => {
    const importSounds = createAttachmentImportSounds();
    const unsubscribeImport = conversationRuntime(props).agent.onAttachmentImport((event) => {
      if (event.type === "progress") {
        attachmentUploads.progress(event.requestId, event.sent);
        return;
      }
      const retried = event.type === "started" ? attachmentUploads.get(event.requestId) : undefined;
      const threadKey = event.type === "started" ? undefined : threadComposer.releaseImport(event.requestId);
      if (event.type === "started") {
        if (!retried && threadComposer.openDraftKey() !== undefined) {
          if (threadComposer.claimImport(event.requestId, event.serverId)) importSounds.started(event.requestId);
          return;
        }
        const target = retried?.target ?? currentTarget();
        if (target?.serverId === event.serverId) {
          resources.importTargetAgents.set(event.requestId, target);
          clearConversationError(target);
          importSounds.started(event.requestId);
          if (event.files.length > 0) attachmentUploads.start(event.requestId, target, event.files);
        }
        syncAttachmentImports();
        setScopedComposerError(null);
      } else if (threadKey !== undefined) {
        if (event.type === "error") {
          importSounds.cancel(event.requestId);
          conversationRuntime(props).agent.discardAttachmentImport?.(event.requestId);
          const { t, errorMessage } = currentText();
          actionToast.error(errorMessage(event.message, t("composer.upload.failed")));
        } else {
          if (event.attachments.length > 0) importSounds.finished(event.requestId, "success");
          else importSounds.cancel(event.requestId);
          threadComposer.addFiles(threadKey, event.serverId, event.attachments);
        }
      } else if (event.type === "error") {
        const target = resources.importTargetAgents.get(event.requestId);
        resources.importTargetAgents.delete(event.requestId);
        syncAttachmentImports();
        if (target) {
          importSounds.finished(event.requestId, "error");
          const { t, errorMessage } = currentText();
          const message = errorMessage(event.message, t("composer.upload.failed"));
          if (attachmentUploads.get(event.requestId)) attachmentUploads.fail(event.requestId, message);
          else
            setConversationErrors((current) => ({
              ...current,
              [composerDraftKey(target)]: message,
            }));
        } else importSounds.cancel(event.requestId);
        if (!attachmentUploads.get(event.requestId))
          conversationRuntime(props).agent.discardAttachmentImport?.(event.requestId);
      } else {
        const target = resources.importTargetAgents.get(event.requestId);
        if (target) {
          if (event.attachments.length > 0) importSounds.finished(event.requestId, "success");
          else importSounds.cancel(event.requestId);
          void addAttachments(event.attachments, target).finally(() => {
            resources.importTargetAgents.delete(event.requestId);
            attachmentUploads.remove(event.requestId);
            syncAttachmentImports();
          });
        } else {
          importSounds.cancel(event.requestId);
          syncAttachmentImports();
          for (const attachment of event.attachments) {
            void conversationRuntime(props).agent.discardDraftAttachment(attachment.id, event.serverId);
          }
        }
      }
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
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
      if (event.target instanceof Element && event.target.closest(".message-actions, .reaction-picker")) return;
      setOpenReactionMessageId(null);
      setExpandedEmojiMessageId(null);
    };
    const keyboardTarget = conversationPanel?.ownerDocument ?? document;
    const keyboardWindow = keyboardTarget.defaultView ?? window;
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
    for (const type of MEDIA_LAYOUT_EVENTS) readerInput?.addEventListener(type, mediaLoaded, true);
    keyboardTarget.addEventListener("keydown", readerKeyDown);
    keyboardWindow.addEventListener("pointerup", endReaderDrag);
    keyboardWindow.addEventListener("pointercancel", endReaderDrag);
    let viewportHeight = scrollElement?.clientHeight ?? 0;
    scrollResizeObserver = new ResizeObserver(() => {
      updateVirtualScrollMargin();
      const viewportGrowth = scrollElement ? scrollElement.clientHeight - viewportHeight : 0;
      viewportHeight = scrollElement?.clientHeight ?? 0;
      if (scrollElement && stickToLatest && viewportGrowth < 0) scrollElement.scrollTop -= viewportGrowth;
      const contentGrew =
        scrollElement !== undefined && scrollElement.scrollHeight - scrollElement.clientHeight > lastMaxScrollTop;
      const readerAbove = scrollElement !== undefined && readerAboveShrinkingContent(scrollElement);
      if (scrollElement && stickToLatest) {
        if (!readerAbove) glideConversationBottom(scrollElement);
      } else if (scrollElement && unreadOpening.holding) {
        if (unreadOpening.settled && contentGrew && props.activeTurnId) {
          setStickToLatest(true);
          glideConversationBottom(scrollElement);
        } else scrollToUnreadDivider(scrollElement);
      }
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
      for (const type of MEDIA_LAYOUT_EVENTS) readerInput?.removeEventListener(type, mediaLoaded, true);
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
      messageIds: props.messageFocusRequest ? props.messages.map((message) => message.id).join("\u0000") : "",
      index: props.messageFocusRequest ? timelineIndexById().get(props.messageFocusRequest.messageId) : undefined,
    }),
    ({ request, agentId, loaded, index }) => {
      if (!request || request.agentId !== agentId || !loaded || handledMessageFocusRequests.has(request)) return;
      const focus = (frame: number) =>
        requestAnimationFrame(() => {
          if (handledMessageFocusRequests.has(request)) return;
          const messageId = CSS.escape(request.messageId);
          const target = scrollElement?.querySelector<HTMLElement>(
            `[data-chat-search-message="${messageId}"], [data-chat-search-group~="${messageId}"]`,
          );
          if (!target) {
            if (index === undefined || frame >= MESSAGE_FOCUS_ROW_FRAMES) return;
            messageVirtualizer.scrollToIndex(index);
            focus(frame + 1);
            return;
          }
          handledMessageFocusRequests.add(request);
          unreadOpening = { ...unreadOpening, pending: false, holding: false };
          stickToLatest = false;
          if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
          if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
          latestScrollFrame = undefined;
          latestScrollSettleFrame = undefined;
          stopChatGlides();
          updateVirtualScrollMargin();
          target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
          updateScrollFade();
          updateUnreadDividerVisibility();
          requestAnimationFrame(() => {
            if (stickToLatest || !target.isConnected) return;
            target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
            updateScrollFade();
          });
        });
      focus(0);
    },
  );

  function quoteSelection(messageId: string, text: string) {
    const quoted = limitedQuoteText(text);
    setQuoteRequest((current) => ({ id: (current?.id ?? 0) + 1, messageId, text: quoted }));
  }

  const taggableBrowserTabs = createMemo(() =>
    props.channel ? [] : browserTabs().filter((tab) => tab.ownerAgentId === props.agent?.id),
  );
  const taggableThreads = createMemo(() =>
    props.channel
      ? []
      : (props.threads?.tasks ?? [])
          .filter((task) => task.closedAt === null)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  );

  function openTaggedReference(kind: "tab" | "thread", id: string) {
    if (kind === "tab") {
      if (!browserTabs().some((tab) => tab.id === id)) return;
      if (activeBrowserTab()?.id !== id) activateBrowserTab(id);
      setActiveRightPanel("browser-expanded");
      return;
    }
    if (!taggableThreads().some((task) => task.id === id)) return;
    if (sideThreadIds().includes(id)) openPanelThread(id);
    else moveThreadToPanel(id);
  }

  const [quotedMessageId, setQuotedMessageId] = createSignal<string | null>(null);

  function openQuote(messageId: string, text: string) {
    stopRevealingFileQuote();
    const file = fileQuoteTarget(messageId);
    if (file) {
      const shown = filePreviewOpen() && previewQuoteId() === fileQuoteId({ ...file, lines: undefined });
      if (shown || openQuotedFile(file)) revealFileQuote(document, file, text);
      return;
    }
    setQuotedMessageId(messageId);
    flush();
    if (showQuotedText(messageId, text)) setQuotedMessageId(null);
    else void revealQuote(messageId, text);
  }

  function openQuotedFile(file: FileQuoteTarget): boolean {
    if (file.source !== "attachment") {
      if (file.source === "shared") openSharedFile(file.path);
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

  async function revealQuote(messageId: string, text: string) {
    const agentId = props.agent?.id;
    const row = await replyJump.reveal(messageId, undefined, agentId);
    if (row && props.agent?.id === agentId) showQuotedText(messageId, text);
    setQuotedMessageId((current) => (current === messageId ? null : current));
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
    ({ agentId, serverId, unreadCount, loaded }) => {
      currentUnreadCount = unreadCount;
      const conversationIdentity = `${serverId}:${agentId ?? ""}`;
      if (conversationIdentity !== lastConversationIdentity) {
        if (lastConversationIdentity !== undefined) closeChatSearch(false);
        lastConversationIdentity = conversationIdentity;
        setStickToLatest(true);
        holdChatGlides();
      }
      if (loaded !== lastLoaded) {
        lastLoaded = loaded;
        holdChatGlides();
      }
      if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
      if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
      const followLatest = stickToLatest;
      if (followLatest && unreadCount === 0 && scrollElement && followJumps(scrollElement)) {
        updateVirtualScrollMargin();
        followConversationBottom(scrollElement);
      }
      latestScrollFrame = requestAnimationFrame(() => {
        latestScrollFrame = undefined;
        if (!scrollElement) return;
        updateVirtualScrollMargin();
        if (followLatest) glideConversationBottom(scrollElement);
        updateScrollFade(scrollElement);
        updateUnreadDividerVisibility();
        latestScrollSettleFrame = requestAnimationFrame(() => {
          latestScrollSettleFrame = undefined;
          if (!scrollElement) return;
          if (followLatest && stickToLatest) glideConversationBottom(scrollElement);
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
    messageVirtualizer.scrollToOffset(Math.max(0, readTop, dividerTop - element.clientHeight / 3));
  }

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
        unreadOpening = { identity, pending: true, boundaryId: undefined, holding: false, settled: false };
      }
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
      if (!unreadMessagesDivider?.isConnected) messageVirtualizer.scrollToIndex(boundaryIndex);
      const opening = unreadOpening;
      const openAtDivider = (settle: boolean) =>
        requestAnimationFrame(() => {
          if (unreadOpening !== opening || !opening.holding || !scrollElement) return;
          stickToLatest = false;
          scrollToUnreadDivider(scrollElement);
          updateScrollFade(scrollElement);
          updateUnreadDividerVisibility();
          if (settle) opening.settled = true;
          else openAtDivider(true);
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
      if (isKnownAgentProvider(provider)) setSettingsProvider(provider);
      setSettingsModel(agent.model);
      setSettingsReasoning(agent.reasoningEffort);
    },
  );

  function resetPanelsForAgent(agentId: string | undefined, panel: RightPanelMode | undefined): RightPanelMode {
    const previousAgentId = lastPanelAgentId;
    lastPanelAgentId = agentId;
    clearRoutineSettingsRequest();
    resources.filePreviewRequestGeneration += 1;
    const preview = untrack(sidebarFilePreview);
    if (preview && preview.ownerAgentId !== agentId) {
      setSidebarFilePreview(null);
      setRightPanels((current) => ({ ...current, [preview.ownerAgentId]: "none" }));
    }
    if (!previousAgentId || !agentId || (panel !== "settings" && panel !== "file-preview" && panel !== "files"))
      return panel ?? "none";
    setRightPanels((current) => ({ ...current, [agentId]: "none" }));
    return "none";
  }

  function keepSidePanelShown(agentId: string | undefined, panel: RightPanelMode): void {
    if (!agentId) return;
    if (untrack(sidePanelShown)) {
      if (panel === "none") showSidePanel(false);
    } else if (isSidePanelMode(panel)) setActiveRightPanel("none", agentId);
  }

  createEffect(
    () => {
      const agentId = conversationOwnerId(props);
      return { agentId, panel: agentId ? rightPanels()[agentId] : undefined, request: props.settingsRequest };
    },
    ({ agentId, panel, request }) => {
      const settingsRequested =
        request !== null && agentId === request.agentId && !handledSettingsRequests.has(request);
      if (agentId !== lastPanelAgentId) {
        const reset = resetPanelsForAgent(agentId, panel);
        if (!settingsRequested) keepSidePanelShown(agentId, reset);
        if (agentId && !channel && !settingsRequested && !usesTouchLayout())
          setComposerFocusRequest((value) => value + 1);
      } else if (panel === "none" || isSidePanelMode(panel)) setSidePanelShown(isSidePanelMode(panel));
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

  const browserPageVisible = () =>
    browserExpandedOpen() &&
    Boolean(browserSurface()) &&
    !props.browserVisibilitySuspended &&
    !props.globalOverlayOpen &&
    !props.remoteDesktopVisible;
  createEffect(
    () => props.browserEnabled !== false && browserPageVisible() && !props.runtime && props.server?.kind === "local",
    (shown) => (shown ? holdNativeBrowserPage() : undefined),
  );
  createEffect(
    () => ({
      agentId: props.agent?.id,
      browserEnabled: props.browserEnabled !== false,
      surface: browserSurface(),
      visible: browserPageVisible(),
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

  async function openExternalMessageUrl(url: string, options: { ownBrowser?: boolean } = {}) {
    const target = currentTarget();
    const runtime = conversationRuntime(props);
    try {
      if (
        !options.ownBrowser &&
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

  async function openMessageLinkRelay(): Promise<void> {
    const relay = messageLinkRelay();
    if (!relay) throw new Error(currentText().t("error.mcp.relayEnded"));
    await conversationRuntime(props).openUrl(relay.url);
  }

  async function pasteMessageLinkRelay(address: string): Promise<void> {
    const relay = messageLinkRelay();
    const paste = conversationRuntime(props).agent.pasteMessageLink;
    if (!relay || !paste) throw new Error(currentText().t("error.mcp.relayEnded"));
    await paste({ url: relay.url, address }, relay.target.serverId);
    if (messageLinkRelay() === relay) setMessageLinkRelay(null);
  }

  function cancelMessageLinkRelay(): void {
    const relay = messageLinkRelay();
    setMessageLinkRelay(null);
    const cancel = conversationRuntime(props).agent.cancelMessageLink;
    if (relay && cancel) void cancel({ url: relay.url }, relay.target.serverId).catch(() => undefined);
  }

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
  function setStickToLatest(value: boolean) {
    if (!value) {
      leaveLatest();
      return;
    }
    stickToLatest = true;
    readerLeftLatest = false;
    unreadOpening.holding = false;
  }
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
    stopChatGlides();
  }
  function readerFocusIn() {
    if (readerDragging || !scrollElement) return;
    if (scrollElement.scrollTop < lastScrollTop) {
      stopFollowingLatest();
      updateScrollFade(scrollElement);
    } else if (scrollElement.scrollTop > lastScrollTop) unreadOpening.holding = false;
  }
  function readerAboveShrinkingContent(element: HTMLDivElement): boolean {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    const previousMaxScrollTop = lastMaxScrollTop;
    lastMaxScrollTop = maxScrollTop;
    return (
      maxScrollTop < previousMaxScrollTop &&
      maxScrollTop - element.scrollTop > 1 &&
      previousMaxScrollTop - element.scrollTop > 80
    );
  }
  const followReaderScroll = (element: HTMLElement) => {
    const moved = element.scrollTop - lastScrollTop;
    lastScrollTop = element.scrollTop;
    lastMaxScrollTop = element.scrollHeight - element.clientHeight;
    const intent = readerIntent && performance.now() - readerIntent.at < READER_INPUT_WINDOW_MS ? readerIntent : null;
    if (moved < 0 && (readerDragging || intent?.up === true)) leaveLatest();
    else if (moved > 0 && (readerDragging || intent?.up === false)) {
      readerLeftLatest = false;
      unreadOpening.holding = false;
    }
    if (!readerLeftLatest && element.scrollHeight - element.scrollTop - element.clientHeight <= 80) {
      stickToLatest = true;
    }
  };
  function noteReaderIntent(up: boolean) {
    readerIntent = { up, at: performance.now() };
    stopChatGlides();
  }
  function readerWheel(event: WheelEvent) {
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    noteReaderIntent(event.deltaY < 0);
  }
  function readerKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || sideThreadOpen()) return;
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
    if (y !== undefined && lastTouchY !== undefined && y !== lastTouchY) noteReaderIntent(y > lastTouchY);
    lastTouchY = y;
  }
  function readerTouchEnd() {
    lastTouchY = undefined;
  }
  function readerPointerDown(event: PointerEvent) {
    if (event.button === 0) {
      readerDragging = true;
      stopChatGlides();
    }
  }
  const setVirtualRootElement = (element: HTMLDivElement) => {
    virtualRoot = element;
    updateVirtualScrollMargin();
    scrollResizeObserver?.observe(element);
  };
  const setUnreadMessagesDividerElement = (element: HTMLDivElement) => {
    unreadMessagesDivider = element;
  };
  let animatedUnreadBoundary: string | undefined;
  const unreadDividerArrives = (): boolean => {
    const boundary = untrack(
      () => `${props.server?.id ?? "local"}:${conversationOwnerId(props) ?? ""}:${unreadBoundaryMessageId() ?? ""}`,
    );
    if (boundary === animatedUnreadBoundary) return false;
    animatedUnreadBoundary = boundary;
    return true;
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
  const voiceConversationAvailable = () =>
    !channel &&
    (!props.runtime ||
      (props.runtime.liveVoice !== undefined && codexLiveAccess(props.agentStatus.providers) !== "signIn"));
  const voiceConversationOpen = () => Boolean(props.agent && controller.voiceSessions.active(props.agent.id));
  function toggleVoiceConversation() {
    const agentId = props.agent?.id;
    if (!agentId) return;
    if (controller.voiceSessions.active(agentId)) controller.voiceSessions.stop(agentId);
    else if (voiceConversationAvailable()) controller.voiceSessions.start(agentId);
  }
  function endVoiceConversation() {
    if (props.agent) controller.voiceSessions.stop(props.agent.id);
  }
  onCleanup(() => controller.voiceSessions.end("transcribed"));
  const startVoiceConversation = (agentId: string) =>
    createVoiceConversation({
      agentId,
      serverId: props.server?.id ?? "local",
      voice: conversationRuntime(props).voice,
      submit: (draft, target, submittedSnapshot, voice) =>
        actions.submitMessage(draft, target, submittedSnapshot, voice),
      serverOnline: () => props.server?.kind !== "remote" || props.server.state === "online",
      progressUpdate: (message) => isNarrationItemId(message.id, props.agent?.provider),
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
    threadQueue,
    threadFocusRequest,
    requestThreadFocus,
    branchThread,
    startNewThread,
    threadVoiceLiveText,
    threadVoiceOwned,
    replyJump,
    messagePins,
    voiceConversationAvailable,
    voiceConversationOpen,
    toggleVoiceConversation,
    endVoiceConversation,
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
    unreadDividerArrives,
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
    openWaitingAgent,
    canOpenBrowserTakeoverTab,
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
    attachmentDownloads,
    attachmentBusy,
    uploadFailed,
    currentUploads,
    removeUpload,
    retryUpload,
    browserAddress,
    browserSidebarOpen,
    browserExpandedOpen,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    browserTabs,
    chatSearchMatches,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchTotal,
    closeBrowserTab,
    takeBrowserControl,
    releaseBrowserControl,
    browserTeach,
    canTeachBrowserTask,
    openBrowserTeach,
    closeBrowserTeach,
    startBrowserTeach,
    stopBrowserTeach,
    closeChatSearch,
    clearNewMessages,
    closeShownSidePanelFile,
    composerError: currentComposerError,
    currentComposerError,
    currentChatError,
    currentChatErrorReference,
    currentChatErrorRun,
    currentChatErrorLink,
    currentChatErrorDetails,
    currentChatConversationKey,
    dismissCurrentChatErrors,
    dismissAwaitingReplies,
    clearComposerError,
    setComposerErrorForTarget,
    clearChatErrors,
    composerFocusRequest,
    composerHasContent,
    copiedMessageId,
    quotedMessageId,
    copyMessage,
    messageText,
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
    sendStarting,
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
    openSidePanelFile,
    moveSidePanelFile,
    closeSidePanelFile,
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
    updateAnswers,
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
    openThreadFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewFileKey,
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
    queueOpen,
    renderedQueueDeliveries,
    reactToMessage,
    navigateBrowserTab,
    reloadBrowserTab,
    stopBrowserTab,
    removeAttachment,
    renderedAgentActivity,
    activeStepActivity,
    activeTurnOutputShown,
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
    instructionsSettingsRequest,
    openInstructionsSettings,
    changeMarkerActions,
    agentSettingRowRequest,
    openAgentSettingRow,
    handleAgentSettingRowRequest,
    routineSettingsRequest,
    updateRuntimeSettings,
    scheduleUnreadDividerVisibilityUpdate,
    screenOpen,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    sendSelectionInstruction,
    sendCardMessage,
    sendCardFile,
    saveSkillSuggestion,
    quoteRequest,
    quoteSelection,
    openQuote,
    taggableBrowserTabs,
    taggableThreads,
    openTaggedReference,
    setActiveRightPanel,
    setBrowserAddress,
    setChatSearchQuery,
    setComposerError: setScopedComposerError,
    changeFastMode,
    fastMode,
    ultrafast,
    fastModeChange,
    fastModeConfirmationOpen,
    confirmFastMode,
    cancelFastModeConfirmation,
    setComposerFocusRequest,
    setDropActive,
    setExpandedEmojiMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
    registerPromptComposerAnswer,
    keepUnsentPromptAnswer,
    handleRoutineSettingsRequest,
    setShowComposerActions,
    settingsModel,
    settingsProvider,
    settingsOpen,
    settingsReasoning,
    setSidePanelWidth,
    sidePanelWidth,
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
    rowDraftAttachments,
    currentPastePreviews,
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
