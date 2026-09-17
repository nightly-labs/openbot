import type { UpdateAgentInput } from "@openbot/contracts/ipc";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  untrack,
  useContext,
} from "solid-js";
import { createScopeGuard } from "../../scope-lifetime";
import { useConversationController } from "./conversation-controller-context";
import { agentConversationKey, composerDraftKey } from "./conversation-keys";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "./conversation-types";
import { createActivityStore } from "./stores/activity-store";
import { createBrowserStore } from "./stores/browser-store";
import { createComposerActions } from "./stores/composer-actions";
import { createComposerStore, currentConversationTarget } from "./stores/composer-store";
import { createMessageActions } from "./stores/message-actions";
import { createPanelsStore } from "./stores/panels-store";
import { createQueueStore } from "./stores/queue-store";
import { createScrollStore } from "./stores/scroll-store";
import { createSearchStore } from "./stores/search-store";
import { createSettingsStore, runtimeSettingsEqual } from "./stores/settings-store";
import { createSkillsStore } from "./stores/skills-store";
import { createVoiceStore } from "./stores/voice-store";

function followConversationBottom(element: HTMLDivElement): void {
  element.scrollTop = element.scrollHeight;
}

export function createConversationViewScope(props: ConversationProps) {
  const controller = useConversationController();
  const agentReady = () => props.agentStatus.phase === "ready";
  const {
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
    composerFocusRequest,
    setComposerFocusRequest,
    showComposerActions,
    setShowComposerActions,
    attachmentBusy,
    setAttachmentBusy,
    composerErrors,
    setComposerErrors,
    conversationErrors,
    setConversationErrors,
    voicePhase,
    setVoicePhase,
    voiceModelProgress,
    setVoiceModelProgress,
    voiceElapsedSeconds,
    setVoiceElapsedSeconds,
    markingRead,
    setMarkingRead,
    submitting,
    setSubmitting,
    selectionSending,
    setSelectionSending,
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
    browserAddressEditing,
    setBrowserAddressEditing,
    browserPipBounds,
    setBrowserPipBounds,
    mediaPreview,
    setMediaPreview,
    sidebarFilePreview,
    setSidebarFilePreview,
    openReactionMessageId,
    setOpenReactionMessageId,
    openMoreMessageId,
    setOpenMoreMessageId,
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
    resources,
  } = controller;
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
   */
  const setScopedComposerError = (error: string | null, targetOverride?: ConversationTarget): void => {
    const target = targetOverride ?? currentConversationTarget(props);
    if (!target) return;
    const key = composerDraftKey(target);
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
    settingsProvider,
    settingsModel,
    settingsReasoning,
    setBrowserPipBounds,
    mediaPreview,
    setMediaPreview,
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
    downloadAttachments,
    openSharedFile,
    openWorkspaceFile,
    openSidebarFileExternally,
    closeSidebarFilePreview,
  } = panels;
  const skills = createSkillsStore({ props, settingsOpen });
  const { installedSkills } = skills;
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
  const queue = createQueueStore({ props });
  const { activeDeliveries, orderedQueuedDeliveries, presentedQueueDeliveries, queuePanelVisible } = queue;
  const activity = createActivityStore({
    props,
    activeDeliveries,
    agentActivityPresentations: resources.agentActivityPresentations,
  });
  const { renderedAgentActivity, agentActivitySpaceReserved, setAgentActivitySpaceReserved, agentActivity } = activity;
  const browser = createBrowserStore({
    props,
    browserOpenRequests: resources.browserOpenRequests,
    browserAddress,
    setBrowserAddress,
    setBrowserAddressEditing,
    setComposerError: setScopedComposerError,
    panels: { setActiveRightPanel, screenOpen: () => screenOpen() },
  });
  const {
    browserInteractionAvailable,
    browserTabs,
    activeBrowserTab,
    browserTakeoverTab,
    browserTakeoverPreview,
    browserTakeoverResolution,
    respondToBrowserTakeover,
    activeBrowserControl,
    actingBrowserControl,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    openBrowserAddress,
    closeBrowserTab,
    activateBrowserTab,
    reloadBrowserTab,
    navigateBrowserTab,
  } = browser;
  const browserSidebarOpen = () => browserInteractionAvailable() && activeRightPanel() === "browser";
  const browserExpandedOpen = () => browserInteractionAvailable() && activeRightPanel() === "browser-expanded";
  const browserPipOpen = () => browserInteractionAvailable() && activeRightPanel() === "browser-pip";
  const screenOpen = () => browserSidebarOpen() || browserExpandedOpen() || browserPipOpen();
  function showBrowserPanel() {
    setActiveRightPanel("browser");
    if (browserTabs().length === 0) void openBrowserAddress();
  }
  const viewIsMounted = createScopeGuard();
  let imageAttachmentPicker: HTMLInputElement | undefined;
  let contextAttachmentPicker: HTMLInputElement | undefined;
  const scroll = createScrollStore({
    props,
    markingRead,
    setMarkingRead,
    setComposerError: setScopedComposerError,
    elements: {
      scrollElement: () => scrollElement,
      virtualRoot: () => virtualRoot,
      unreadMessagesDivider: () => unreadMessagesDivider,
    },
    sticky: {
      getStickToLatest: () => stickToLatest,
      setStickToLatest: (value: boolean) => {
        stickToLatest = value;
      },
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
    updateScrollFade,
    updateVirtualScrollMargin,
    updateUnreadDividerVisibility,
    scheduleUnreadDividerVisibilityUpdate,
    markUnreadMessages,
    jumpToUnreadMessages,
    jumpToLatestMessage,
  } = scroll;
  const search = createSearchStore({
    props,
    chatSearchOpen,
    chatSearchQuery,
    activeChatSearchIndex,
    scrollElement: () => scrollElement,
    revealMatch: () => {
      stickToLatest = false;
    },
    setChatSearchOpen,
    setChatSearchQuery,
    chatSearchMatches,
    setChatSearchMatches,
    chatSearchMessageIds,
    setChatSearchMessageIds,
    setChatSearchTotal,
    setActiveChatSearchIndex,
  });
  const { closeChatSearch, moveChatSearch, handleChatSearchShortcut, setChatSearchInputElement } = search;
  const voice = createVoiceStore({
    props,
    resources,
    voicePhase,
    setVoicePhase,
    setVoiceModelProgress,
    voiceElapsedSeconds,
    setVoiceElapsedSeconds,
    drafts,
    setDrafts,
    setConversationErrors,
    setComposerError: setScopedComposerError,
    setComposerFocusRequest,
    clearConversationError,
    setConversationError,
    viewIsMounted,
    hooks: {
      saveEdit: (...args) => actions.saveQueuedMessageEdit(...args),
      submit: (...args) => actions.submitMessage(...args),
      restoreTranscript: (...args) => composer.restoreVoiceTranscript(...args),
    },
  });
  const { startVoiceRecording, stopVoiceRecording } = voice;
  const actions = createComposerActions({
    props,
    attachmentBusy,
    agentReady,
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
    submitting,
    setSubmitting,
    selectionSending,
    setSelectionSending,
    voicePhase,
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
    setStickToLatest: (value: boolean) => {
      stickToLatest = value;
    },
    imageAttachmentPicker: () => imageAttachmentPicker,
    contextAttachmentPicker: () => contextAttachmentPicker,
  });
  const {
    updateTeamTyping,
    addAttachments,
    openAttachmentPicker,
    openAttachmentPickerFromKey,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    reorderPresentedQueue,
    submitComposer,
    sendSelectionInstruction,
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
    setOpenMoreMessageId,
    setExpandedEmojiMessageId,
    copiedMessageId,
    setCopiedMessageId,
    setComposerError: setScopedComposerError,
  });
  const { replyToMessage, reactToMessage, copyMessage, removeAttachment } = messageActions;
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
  let requiredInteractionElement: HTMLDivElement | undefined;
  let scrollResizeObserver: ResizeObserver | undefined;
  let unreadMessagesDivider: HTMLDivElement | undefined;
  let latestScrollFrame: number | undefined;
  let latestScrollSettleFrame: number | undefined;
  let currentUnreadCount = 0;
  let conversationPanel: HTMLElement | undefined;
  const [browserSurface, setBrowserSurface] = createSignal<HTMLDivElement>();
  let browserResizeObserver: ResizeObserver | undefined;
  let browserWindowResizeHandler: (() => void) | undefined;
  let browserVisibilityFrame: number | undefined;
  let browserBoundsFrame: number | undefined;
  let browserVisibilityGeneration = 0;
  let stickToLatest = true;
  let lastConversationIdentity: string | undefined;
  let lastPanelAgentId: string | undefined;
  let lastHandledSettingsRequestNonce: number | undefined;
  let lastHandledMessageFocusNonce: number | undefined;
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

  onSettled(() => {
    const unsubscribeImport = window.openbot.agent.onAttachmentImport((event) => {
      if (event.type === "started") {
        const target = currentTarget();
        if (target?.serverId === event.serverId) {
          resources.importTargetAgents.set(event.requestId, target);
          clearConversationError(target);
        }
        setAttachmentBusy(true);
        setScopedComposerError(null);
      } else if (event.type === "error") {
        const target = resources.importTargetAgents.get(event.requestId);
        resources.importTargetAgents.delete(event.requestId);
        setAttachmentBusy(resources.importTargetAgents.size > 0);
        if (target) {
          setConversationErrors((current) => ({
            ...current,
            [composerDraftKey(target)]: event.message,
          }));
        }
      } else {
        const target = resources.importTargetAgents.get(event.requestId);
        if (target) {
          void addAttachments(event.attachments, target).finally(() => {
            resources.importTargetAgents.delete(event.requestId);
            setAttachmentBusy(resources.importTargetAgents.size > 0);
          });
        } else {
          setAttachmentBusy(resources.importTargetAgents.size > 0);
          for (const attachment of event.attachments) {
            void window.openbot.agent.discardDraftAttachment(attachment.id, event.serverId);
          }
        }
      }
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (browserExpandedOpen() && !props.globalOverlayOpen && !mediaPreview()) {
        event.preventDefault();
        setActiveRightPanel("browser");
        return;
      }
      if (chatSearchOpen()) {
        event.preventDefault();
        closeChatSearch();
        return;
      }
      if (currentEditingDeliveryId()) {
        cancelQueuedMessageEdit();
        return;
      }
      setOpenReactionMessageId(null);
      setOpenMoreMessageId(null);
      setExpandedEmojiMessageId(null);
      hideBrowserPanel();
      setMediaPreview(null);
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
      setOpenMoreMessageId(null);
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
    scrollResizeObserver = new ResizeObserver(() => {
      updateVirtualScrollMargin();
      if (scrollElement && stickToLatest) followConversationBottom(scrollElement);
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
      if (stickToLatest) scrollElement.scrollTop = scrollElement.scrollHeight;
      updateScrollFade(scrollElement);
      updateUnreadDividerVisibility();
    });
    return () => {
      scrollResizeObserver?.disconnect();
      scrollResizeObserver = undefined;
      unsubscribeImport();
      keyboardTarget.removeEventListener("keydown", escapeListener);
      keyboardWindow.removeEventListener("keydown", closeActiveRemoteBrowserTab);
      keyboardTarget.removeEventListener("keydown", chatSearchListener);
      window.removeEventListener("pointerdown", closeMessageMenus);
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
        const target = scrollElement?.querySelector<HTMLElement>(
          `[data-chat-search-message="${CSS.escape(request.messageId)}"]`,
        );
        if (!target) return;
        lastHandledMessageFocusNonce = request.nonce;
        stickToLatest = false;
        target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      });
    },
  );

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
        stickToLatest = true;
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
          if (followLatest) {
            stickToLatest = true;
            followConversationBottom(scrollElement);
          }
          updateScrollFade(scrollElement);
          updateUnreadDividerVisibility();
        });
      });
    },
  );

  onCleanup(() => {
    if (latestScrollFrame !== undefined) cancelAnimationFrame(latestScrollFrame);
    if (latestScrollSettleFrame !== undefined) cancelAnimationFrame(latestScrollSettleFrame);
  });

  createEffect(
    () => {
      const agent = props.agent;
      if (!agent) return null;
      return {
        signature: [agent.id, agent.provider, agent.model, agent.reasoningEffort].join("\u0000"),
        provider: agent.provider,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
      };
    },
    (agent) => {
      if (!agent) return;
      const pendingSettings = resources.runtimeSettingsAttempts.get(
        agentConversationKey(props.server?.id ?? "local", props.agent?.id ?? ""),
      );
      if (
        pendingSettings?.pending &&
        !runtimeSettingsEqual(pendingSettings.settings, {
          provider: agent.provider,
          model: agent.model,
          reasoningEffort: agent.reasoningEffort,
        })
      ) {
        setSettingsProvider(pendingSettings.settings.provider);
        setSettingsModel(pendingSettings.settings.model);
        setSettingsReasoning(pendingSettings.settings.reasoningEffort);
        return;
      }
      if (agent.signature === lastRuntimeSettingsSignature) return;
      lastRuntimeSettingsSignature = agent.signature;
      setSettingsProvider(agent.provider);
      setSettingsModel(agent.model);
      setSettingsReasoning(agent.reasoningEffort);
    },
  );

  createEffect(
    () => {
      const agentId = props.agent?.id;
      return { agentId, panel: agentId ? rightPanels()[agentId] : undefined };
    },
    ({ agentId, panel }) => {
      if (agentId === lastPanelAgentId) return;
      const previousAgentId = lastPanelAgentId;
      lastPanelAgentId = agentId;
      clearRoutineSettingsRequest();
      resources.filePreviewRequestGeneration += 1;
      const preview = sidebarFilePreview();
      if (preview && preview.ownerAgentId !== agentId) {
        setSidebarFilePreview(null);
        setRightPanels((current) => ({ ...current, [preview.ownerAgentId]: "none" }));
      }
      if (!previousAgentId || !agentId || (panel !== "settings" && panel !== "file-preview")) return;
      setRightPanels((current) => ({ ...current, [agentId]: "none" }));
    },
  );

  createEffect(
    () => ({ request: props.settingsRequest, agentId: props.agent?.id }),
    ({ request, agentId }) => {
      if (!request || agentId !== request.agentId || request.nonce === lastHandledSettingsRequestNonce) return;
      lastHandledSettingsRequestNonce = request.nonce;
      setActiveRightPanel("settings", agentId);
    },
  );

  createEffect(
    () => ({
      agentId: props.agent?.id,
      activeTab: activeBrowserTab(),
      addressEditing: browserAddressEditing(),
      screenOpen: screenOpen(),
      activeBrowserTabId: props.activeBrowserTabId,
      onActivateBrowserTab: activateBrowserTab,
      suspended: props.browserVisibilitySuspended,
    }),
    ({ activeTab, addressEditing, screenOpen, activeBrowserTabId, onActivateBrowserTab, suspended }) => {
      if (props.browserEnabled === false || suspended) return;
      if (!addressEditing) setBrowserAddress(activeTab?.url ?? "https://www.google.com");
      if (screenOpen && activeTab && activeTab.id !== activeBrowserTabId) {
        onActivateBrowserTab(activeTab.id);
      }
    },
  );

  createEffect(
    () => ({
      agentId: props.agent?.id,
      surface: browserSurface(),
      visible:
        browserExpandedOpen() &&
        Boolean(browserSurface()) &&
        !props.browserVisibilitySuspended &&
        !props.globalOverlayOpen &&
        !props.remoteDesktopVisible &&
        !mediaPreview(),
    }),
    ({ agentId, visible, surface }) => {
      if (props.browserEnabled === false) return;
      const generation = ++browserVisibilityGeneration;
      if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
      browserResizeObserver?.disconnect();
      browserResizeObserver = undefined;
      if (browserWindowResizeHandler) window.removeEventListener("resize", browserWindowResizeHandler);
      browserWindowResizeHandler = undefined;
      if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
      browserBoundsFrame = undefined;
      if (!visible) {
        void window.openbot.browser.setVisible({ visible: false });
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
          void window.openbot.browser.setVisible({
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
    () => ({ agentId: props.agent?.id, open: browserPipOpen() }),
    ({ open }) => {
      if (props.browserEnabled === false) return;
      if (!open) {
        void window.openbot.browser.closePictureInPicture();
        return;
      }
      void window.openbot.browser
        .openPictureInPicture(untrack(browserPipBounds) ?? undefined)
        .then(saveBrowserPipBounds);
    },
  );

  const removeBrowserPictureInPictureListener = window.openbot.browser.onPictureInPictureEvent((event) => {
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
      void window.openbot.browser.setVisible({ visible: false });
      void window.openbot.browser.closePictureInPicture();
    }
  });

  async function openExternalMessageUrl(url: string) {
    const target = currentTarget();
    try {
      await window.openbot.openUrl(url);
    } catch {
      setScopedComposerError("Could not open the link in the external browser.", target);
    }
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
  const setStickToLatest = (value: boolean) => {
    stickToLatest = value;
  };
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
  const setRequiredInteractionElement = (element: HTMLDivElement | undefined) => {
    if (requiredInteractionElement) scrollResizeObserver?.unobserve(requiredInteractionElement);
    requiredInteractionElement = element;
    if (element) scrollResizeObserver?.observe(element);
  };
  const setBrowserSurfaceElement = (element: HTMLDivElement | undefined) => {
    setBrowserSurface(element);
  };
  const setImageAttachmentPickerElement = (element: HTMLInputElement) => {
    imageAttachmentPicker = element;
  };
  const setContextAttachmentPickerElement = (element: HTMLInputElement) => {
    contextAttachmentPicker = element;
  };

  return {
    conversationPanelElement,
    setAgentActivitySlotElement,
    setBrowserSurfaceElement,
    setChatSearchInputElement,
    setConversationPanelElement,
    setContextAttachmentPickerElement,
    setImageAttachmentPickerElement,
    setScrollElement,
    setStickToLatest,
    setUnreadMessagesDividerElement,
    setVirtualRootElement,
    activeBrowserControl,
    actingBrowserControl,
    activeBrowserTab,
    browserTakeoverPreview,
    browserTakeoverResolution,
    browserTakeoverTab,
    respondToBrowserTakeover,
    activeChatSearchIndex,
    agentActivity,
    agentReady,
    agentActivitySpaceReserved,
    activateBrowserTab,
    attachmentAction,
    downloadAttachments,
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
    closeChatSearch,
    clearNewMessages,
    closeSidebarFilePreview,
    composerError: currentComposerError,
    currentComposerError,
    currentChatError,
    currentChatConversationKey,
    dismissCurrentChatErrors,
    clearComposerError,
    setComposerErrorForTarget,
    clearChatErrors,
    composerFocusRequest,
    composerHasContent,
    copiedMessageId,
    copyMessage,
    currentDraft,
    currentConversationError,
    installedSkills,
    dropActive,
    editQueuedMessage,
    editingDeliveryId: currentEditingDeliveryId,
    editingPendingSave,
    expandedEmojiMessageId,
    scrollFades,
    filePreviewOpen,
    handleChatSearchShortcut,
    hideBrowserPanel,
    jumpToLatestMessage,
    jumpToUnreadMessages,
    markMessageSeen,
    markUnreadMessages,
    markingRead,
    mediaPreview,
    messageVirtualizer,
    timelineMessages,
    moveChatSearch,
    newMessageCount,
    openAttachmentPicker,
    openAttachmentPickerFromKey,
    openBrowserAddress,
    openExternalMessageUrl,
    openMoreMessageId,
    openReactionMessageId,
    openRoutineSettings,
    openRoutineRunMessage,
    openSharedFile,
    openSidebarFileExternally,
    openWorkspaceFile,
    presentedQueueDeliveries,
    previewAttachment,
    props,
    queuePanelVisible,
    reactToMessage,
    navigateBrowserTab,
    reloadBrowserTab,
    removeAttachment,
    renderedAgentActivity,
    reorderPresentedQueue,
    replyTarget,
    replyToMessage,
    skillSettingsRequest,
    openSkillSettings,
    routineSettingsRequest,
    updateRuntimeSettings,
    scheduleUnreadDividerVisibilityUpdate,
    screenOpen,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    selectionSending,
    sendSelectionInstruction,
    setActiveRightPanel,
    setBrowserAddress,
    setBrowserAddressEditing,
    setBrowserPanelWidth,
    setChatSearchQuery,
    setComposerError: setScopedComposerError,
    setComposerFocusRequest,
    setDropActive,
    setExpandedEmojiMessageId,
    setMediaPreview,
    setOpenMoreMessageId,
    setOpenReactionMessageId,
    setRequiredInteractionElement,
    handleRoutineSettingsRequest,
    setSettingsPanelWidth,
    setShowComposerActions,
    settingsModel,
    settingsProvider,
    settingsOpen,
    settingsPanelWidth,
    settingsReasoning,
    sidebarFilePreview,
    showBrowserPanel,
    showBrowserPip,
    showComposerActions,
    showScrollToLatest,
    startVoiceRecording,
    stopVoiceRecording,
    submitComposer,
    submitting,
    unreadDividerVisible,
    unreferencedDraftAttachments,
    updateCurrentDraft,
    updateScrollFade,
    updateTeamTyping,
    updateUnreadDividerVisibility,
    voiceElapsedSeconds,
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
