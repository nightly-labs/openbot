import type {
  AgentModelId,
  AgentProviderId,
  AgentReasoningEffort,
  BrowserBounds,
  BrowserTab,
  MarketplaceSkillDetail,
} from "@openbot/contracts/ipc";
import type { AgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { currentText } from "@openbot/ui/text";
import type { UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createSignal, createStore, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { readSidePanelWidth } from "../../components/side-panel-width";
import type { ChatSearchMatch } from "./chat-search";
import {
  appendDraftText,
  appendSkillCreationRequest,
  appendSkillExample,
  EMPTY_DRAFT,
  QUEUE_EDIT_STORAGE_KEY,
  readStoredQueueEdit,
  readStoredThreadQueueEdit,
  type StoredQueueEdit,
  type StoredThreadQueueEdit,
  THREAD_QUEUE_EDIT_STORAGE_KEY,
} from "./composer-draft";
import { type StoredComposerDrafts, writeComposerDraftsOnChange } from "./composer-draft-storage";
import { composerDraftKey } from "./conversation-keys";
import { releaseFilePreviewPage } from "./conversation-port";
import type {
  ComposerDraft,
  ConversationProps,
  ConversationTarget,
  RightPanelMode,
  SidebarFilePreview,
  VoiceLiveTranscript,
} from "./conversation-types";
import { readStoredSidePanels, writeSidePanelsOnChange } from "./side-panel-storage";
import type { TurnRuntime } from "./stores/activity-store";
import { createAttachmentUploadStore } from "./stores/attachment-upload-store";
import type { PastePreview } from "./stores/composer-actions";
import type { SidePanelsState } from "./stores/panels-store";
import { createPendingSendStore } from "./stores/pending-send-store";
import type { SideQuestionState } from "./stores/side-question-store";
import { createVoiceSessions } from "./stores/voice-session-store";
import type { VoiceCloudStream } from "./stores/voice-store";

const BROWSER_PIP_STORAGE_KEY = "openbot:browser-pip-native-bounds";

function readBrowserPipBounds(): BrowserBounds | null {
  const values = (window.localStorage.getItem(BROWSER_PIP_STORAGE_KEY) ?? "")
    .split(",")
    .map((value) => Number.parseFloat(value));
  const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = values;
  return values.length === 4 && [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
}

export interface FeedbackFix {
  number: number;
  before: string;
  request: string;
}

function draftWithoutFix(text: string, fix: FeedbackFix): string {
  if (text.startsWith(fix.before)) return fix.before;
  const start = text.indexOf(fix.request);
  return start === -1 ? text : text.slice(0, start).trimEnd();
}

interface ConversationResources {
  agentActivityLabels: Map<string, { activityId: string; label: AgentActivityLabel }>;
  turnRuntimes: Map<string, TurnRuntime>;
  browserOpenRequests: Map<
    string,
    {
      promise: Promise<BrowserTab | undefined>;
      serverId: string;
      agentId: string | null;
      url: string;
      existingTabIds: Set<string>;
    }
  >;
  importTargetAgents: Map<string, { agentId: string; serverId: string }>;
  seenMessageIds: Set<string>;
  typingIdleTimer: ReturnType<typeof setTimeout> | undefined;
  typingAgentId: string | null;
  voiceRecorder: Pick<MediaRecorder, "state" | "stop"> | undefined;
  voiceStream: { getTracks(): Array<Pick<MediaStreamTrack, "stop">> } | undefined;
  voiceRecordingTimer: ReturnType<typeof setTimeout> | undefined;
  voiceElapsedTimer: ReturnType<typeof setInterval> | undefined;
  voiceChunks: Blob[];
  voiceLiveRequest: Promise<void> | undefined;
  voiceCloudStream: VoiceCloudStream | undefined;
  voiceMeterStop: (() => void) | undefined;
  voiceAgentId: string | undefined;
  voiceServerId: string | undefined;
  voiceThreadSend: boolean;
  voiceSubmitRequest:
    | {
        agentId: string;
        serverId: string;
        draft: ComposerDraft;
        queuedEdit: { deliveryId: string; originalAttachmentIds: string[] } | undefined;
      }
    | undefined;
  voiceDisposed: boolean;
  voiceRequestGeneration: number;
  filePreviewRequestGeneration: number;
  runtimeSettingsSaveTails: Map<string, Promise<boolean>>;
  runtimeSettingsAttempts: Map<
    string,
    {
      generation: number;
      pending: boolean;
      settings: {
        provider: AgentProviderId;
        model: AgentModelId;
        reasoningEffort: AgentReasoningEffort;
      };
    }
  >;
}

export function createStableConversationState(
  props: Pick<ConversationProps, "onTypingChange">,
  persistDrafts = true,
  storedDrafts: StoredComposerDrafts | null = null,
) {
  const restoredEdit = persistDrafts ? readStoredQueueEdit() : null;
  const [drafts, setDrafts] = createSignal<Record<string, ComposerDraft>>({
    ...storedDrafts?.agents,
    ...(restoredEdit ? { [composerDraftKey(restoredEdit)]: restoredEdit.draft } : {}),
  });
  const [channelDrafts, setChannelDrafts] = createSignal<Record<string, ComposerDraft>>(storedDrafts?.channels ?? {});
  const restoredThreadEdit = persistDrafts ? readStoredThreadQueueEdit() : null;
  const [threadDrafts, setThreadDrafts] = createSignal<Record<string, ComposerDraft>>({
    ...storedDrafts?.threads,
    ...(restoredThreadEdit ? { [restoredThreadEdit.draftKey]: restoredThreadEdit.draft } : {}),
  });
  const [threadQueueEdit, setThreadQueueEdit] = createSignal<Omit<StoredThreadQueueEdit, "draft"> | null>(
    restoredThreadEdit,
  );
  const [editingAgentId, setEditingAgentId] = createSignal<string | null>(restoredEdit?.agentId ?? null);
  const [editingServerId, setEditingServerId] = createSignal<string | null>(restoredEdit?.serverId ?? null);
  const [editingEditId, setEditingEditId] = createSignal<string | null>(restoredEdit?.editId ?? null);
  const [editingDeliveryId, setEditingDeliveryId] = createSignal<string | null>(restoredEdit?.deliveryId ?? null);
  const [editingDraftBackup, setEditingDraftBackup] = createSignal<ComposerDraft | null>(restoredEdit?.backup ?? null);
  const [editingOriginalAttachmentIds, setEditingOriginalAttachmentIds] = createSignal<string[]>(
    restoredEdit?.originalAttachmentIds ?? [],
  );
  const [editingPendingSave, setEditingPendingSave] = createSignal<StoredQueueEdit["pendingSave"] | null>(
    restoredEdit?.pendingSave ?? null,
  );
  const [composerFocusRequest, setComposerFocusRequest] = createSignal(0);
  const [feedbackFixes, setFeedbackFixes] = createSignal<Record<string, FeedbackFix>>({});
  createEffect(
    () => {
      const current = drafts();
      return Object.keys(feedbackFixes()).filter((key) => !current[key]?.text.trim());
    },
    (ended) => {
      if (ended.length === 0) return;
      setFeedbackFixes((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !ended.includes(key))),
      );
    },
  );
  const pendingSends = createPendingSendStore();
  const attachmentUploads = createAttachmentUploadStore();
  const [conversationErrors, setConversationErrors] = createSignal<Record<string, string>>({});
  const [conversationErrorRuns, setConversationErrorRuns] = createSignal<
    Record<string, { message: string; run: string | null; link?: string; details?: string }>
  >({});
  createEffect(
    () => {
      const agentId = editingAgentId();
      const serverId = editingServerId();
      const deliveryId = editingDeliveryId();
      const editId = editingEditId();
      return agentId && serverId && deliveryId && editId
        ? {
            agentId,
            serverId,
            deliveryId,
            editId,
            originalAttachmentIds: editingOriginalAttachmentIds(),
            backup: editingDraftBackup() ?? EMPTY_DRAFT,
            draft: drafts()[composerDraftKey({ agentId, serverId })] ?? EMPTY_DRAFT,
            pendingSave: editingPendingSave() ?? undefined,
          }
        : null;
    },
    (edit) => {
      if (!edit || !persistDrafts) return;
      const persist = () => {
        const agentId = editingAgentId();
        const serverId = editingServerId();
        const deliveryId = editingDeliveryId();
        const editId = editingEditId();
        if (!agentId || !serverId || !deliveryId || !editId || editId !== edit.editId) return;
        const current = {
          agentId,
          serverId,
          deliveryId,
          editId,
          originalAttachmentIds: editingOriginalAttachmentIds(),
          backup: editingDraftBackup() ?? EMPTY_DRAFT,
          draft: drafts()[composerDraftKey({ agentId, serverId })] ?? EMPTY_DRAFT,
          pendingSave: editingPendingSave() ?? undefined,
        };
        try {
          window.localStorage.setItem(QUEUE_EDIT_STORAGE_KEY, JSON.stringify(current));
        } catch {
          setConversationErrors((currentErrors) => ({
            ...currentErrors,
            [composerDraftKey(current)]: currentText().t("composer.error.saveEditLocally"),
          }));
        }
      };
      const timer = setTimeout(persist, 300);
      return () => {
        clearTimeout(timer);
        persist();
      };
    },
  );
  createEffect(
    () => {
      const edit = threadQueueEdit();
      return edit ? { ...edit, draft: threadDrafts()[edit.draftKey] ?? EMPTY_DRAFT } : null;
    },
    (edit) => {
      if (!edit || !persistDrafts) return;
      const persist = () => {
        const current = threadQueueEdit();
        if (current?.editId !== edit.editId) return;
        try {
          window.localStorage.setItem(
            THREAD_QUEUE_EDIT_STORAGE_KEY,
            JSON.stringify({ ...current, draft: threadDrafts()[current.draftKey] ?? EMPTY_DRAFT }),
          );
        } catch {
          actionToast.error(currentText().t("composer.error.saveEditLocally"));
        }
      };
      const timer = setTimeout(persist, 300);
      return () => {
        clearTimeout(timer);
        persist();
      };
    },
  );
  if (storedDrafts && persistDrafts)
    writeComposerDraftsOnChange({
      drafts,
      channelDrafts,
      threadDrafts,
      editingAgentId,
      editingServerId,
      editingDraftBackup,
      threadQueueEdit,
      unsentTexts: pendingSends.unsentTexts,
    });
  const [composerErrors, setComposerErrors] = createSignal<Record<string, string>>({});
  const [composerErrorReferences, setComposerErrorReferences] = createSignal<Record<string, UserErrorDetails>>({});
  const [voicePhase, setVoicePhase] = createSignal<"idle" | "preparing" | "requesting" | "recording" | "transcribing">(
    "idle",
  );
  const [voiceModelProgress, setVoiceModelProgress] = createSignal<number | null>(null);
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = createSignal(0);
  const [voiceLiveTranscript, setVoiceLiveTranscript] = createSignal<VoiceLiveTranscript | null>(null);
  const [voiceThreadKey, setVoiceThreadKey] = createSignal<string | undefined>(undefined);
  const [voiceLevels, setVoiceLevels] = createSignal<number[]>([]);
  const [voiceLimitReached, setVoiceLimitReached] = createSignal<ConversationTarget | null>(null);
  const [voiceLanguageChoice, setVoiceLanguageChoice] = createSignal<ConversationTarget | null>(null);
  const [browserPipBounds, setBrowserPipBounds] = createSignal<BrowserBounds | null>(readBrowserPipBounds());
  const [sidePanelWidth, setSidePanelWidth] = createSignal(readSidePanelWidth());
  const resources: ConversationResources = {
    agentActivityLabels: new Map(),
    turnRuntimes: new Map(),
    browserOpenRequests: new Map(),
    importTargetAgents: new Map<string, { agentId: string; serverId: string }>(),
    seenMessageIds: new Set<string>(),
    typingIdleTimer: undefined,
    typingAgentId: null,
    voiceRecorder: undefined,
    voiceStream: undefined,
    voiceRecordingTimer: undefined,
    voiceElapsedTimer: undefined,
    voiceChunks: [],
    voiceLiveRequest: undefined,
    voiceCloudStream: undefined,
    voiceMeterStop: undefined,
    voiceAgentId: undefined,
    voiceServerId: undefined,
    voiceThreadSend: false,
    voiceSubmitRequest: undefined,
    voiceDisposed: false,
    voiceRequestGeneration: 0,
    filePreviewRequestGeneration: 0,
    runtimeSettingsSaveTails: new Map(),
    runtimeSettingsAttempts: new Map(),
  };

  function stopComposerTyping(): void {
    if (resources.typingIdleTimer) clearTimeout(resources.typingIdleTimer);
    resources.typingIdleTimer = undefined;
    if (!resources.typingAgentId) return;
    props.onTypingChange(resources.typingAgentId, false);
    resources.typingAgentId = null;
  }

  onCleanup(() => {
    resources.voiceDisposed = true;
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    if (resources.voiceElapsedTimer) clearInterval(resources.voiceElapsedTimer);
    if (resources.voiceRecorder?.state === "recording") resources.voiceRecorder.stop();
    for (const track of resources.voiceStream?.getTracks() ?? []) track.stop();
    resources.voiceMeterStop?.();
    stopComposerTyping();
  });

  return {
    startSkillCreation(target: { serverId: string; agentId: string }) {
      const key = composerDraftKey(target);
      setDrafts((current) => ({ ...current, [key]: appendSkillCreationRequest(current[key] ?? EMPTY_DRAFT) }));
      setComposerFocusRequest((value) => value + 1);
    },
    appendSkillExample(
      target: { serverId: string; agentId: string },
      skill: Pick<MarketplaceSkillDetail, "id" | "name" | "examplePrompt">,
    ) {
      const key = composerDraftKey(target);
      setDrafts((current) => ({ ...current, [key]: appendSkillExample(current[key] ?? EMPTY_DRAFT, skill) }));
      setComposerFocusRequest((value) => value + 1);
    },
    appendPluginPrompt(target: { serverId: string; agentId: string }, prompt: string) {
      const key = composerDraftKey(target);
      setDrafts((current) => ({ ...current, [key]: appendDraftText(current[key] ?? EMPTY_DRAFT, prompt) }));
      setComposerFocusRequest((value) => value + 1);
    },
    startFeedbackFix(target: { serverId: string; agentId: string }, number: number, prompt: string) {
      const key = composerDraftKey(target);
      const draft = drafts()[key] ?? EMPTY_DRAFT;
      const next = appendDraftText(draft, prompt);
      setDrafts((current) => ({ ...current, [key]: next }));
      setFeedbackFixes((current) => ({
        ...current,
        [key]: { number, before: draft.text, request: prompt.trim() },
      }));
      setComposerFocusRequest((value) => value + 1);
    },
    cancelFeedbackFix(target: { serverId: string; agentId: string }) {
      const key = composerDraftKey(target);
      const fix = feedbackFixes()[key];
      if (!fix) return;
      setDrafts((current) => {
        const draft = current[key] ?? EMPTY_DRAFT;
        return { ...current, [key]: { ...draft, text: draftWithoutFix(draft.text, fix) } };
      });
      setFeedbackFixes(({ [key]: _cancelled, ...rest }) => rest);
      setComposerFocusRequest((value) => value + 1);
    },
    feedbackFixes,
    appendChannelText(target: { serverId: string; channelId: string }, text: string) {
      const key = composerDraftKey({ serverId: target.serverId, agentId: target.channelId });
      setChannelDrafts((current) => ({ ...current, [key]: appendDraftText(current[key] ?? EMPTY_DRAFT, text) }));
      setComposerFocusRequest((value) => value + 1);
    },
    stopComposerTyping,
    drafts,
    setDrafts,
    channelDrafts,
    setChannelDrafts,
    threadDrafts,
    setThreadDrafts,
    threadQueueEdit,
    setThreadQueueEdit,
    editingAgentId,
    setEditingAgentId,
    editingServerId,
    setEditingServerId,
    editingEditId,
    setEditingEditId,
    editingDeliveryId,
    setEditingDeliveryId,
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
    conversationErrors,
    setConversationErrors,
    conversationErrorRuns,
    setConversationErrorRuns,
    composerErrors,
    setComposerErrors,
    composerErrorReferences,
    setComposerErrorReferences,
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
    voiceLanguageChoice,
    setVoiceLanguageChoice,
    browserPipBounds,
    setBrowserPipBounds,
    sidePanelWidth,
    setSidePanelWidth,
    resources,
  };
}

export function createServerConversationState(keepSidePanelFiles = false) {
  const storedSidePanels = keepSidePanelFiles ? readStoredSidePanels() : { shown: false, side: {} };
  const [showComposerActions, setShowComposerActions] = createSignal(false);
  const [importingDrafts, setImportingDrafts] = createSignal<ReadonlySet<string>>(new Set());
  const [pastePreviews, setPastePreviews] = createSignal<readonly PastePreview[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [markingRead, setMarkingRead] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [rightPanels, setRightPanels] = createSignal<Record<string, RightPanelMode>>({});
  const [browserTakeoverPageRequest, setBrowserTakeoverPageRequest] = createSignal<{
    agentId: string;
    tabId: string;
  } | null>(null);
  const [sidePanels, setSidePanels] = createStore<SidePanelsState>({
    side: storedSidePanels.side,
    subagents: {},
    threads: {},
  });
  const [sidePanelShown, setSidePanelShown] = createSignal(storedSidePanels.shown);
  if (keepSidePanelFiles) writeSidePanelsOnChange(sidePanels, rightPanels);
  const [settingsProvider, setSettingsProvider] = createSignal<AgentProviderId>("codex");
  const [settingsModel, setSettingsModel] = createSignal<AgentModelId>("gpt-6-luna");
  const [settingsReasoning, setSettingsReasoning] = createSignal<AgentReasoningEffort>("medium");
  const [browserAddress, setBrowserAddress] = createSignal("https://www.google.com");
  const [sidebarFilePreview, writeSidebarFilePreview] = createSignal<SidebarFilePreview | null>(null);
  let previewPageUrl: string | undefined;
  const setSidebarFilePreview = (preview: SidebarFilePreview | null) => {
    const nextPageUrl = preview?.preview?.pageUrl;
    if (previewPageUrl !== nextPageUrl) releaseFilePreviewPage(previewPageUrl);
    previewPageUrl = nextPageUrl;
    writeSidebarFilePreview(preview);
  };
  onCleanup(() => releaseFilePreviewPage(previewPageUrl));
  const [openReactionMessageId, setOpenReactionMessageId] = createSignal<string | null>(null);
  const [expandedEmojiMessageId, setExpandedEmojiMessageId] = createSignal<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = createSignal<string | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = createSignal(false);
  const [chatSearchQuery, setChatSearchQuery] = createSignal("");
  const [chatSearchMatches, setChatSearchMatches] = createSignal<ChatSearchMatch[]>([]);
  const [activeChatSearchIndex, setActiveChatSearchIndex] = createSignal(-1);
  const [chatSearchMessageIds, setChatSearchMessageIds] = createSignal<string[]>([]);
  const [chatSearchTotal, setChatSearchTotal] = createSignal(0);
  const [hiddenAwaitingReplyIds, setHiddenAwaitingReplyIds] = createSignal<ReadonlySet<string>>(new Set());
  const [sideQuestions, setSideQuestions] = createStore<Record<string, SideQuestionState>>({});
  const voiceSessions = createVoiceSessions();

  return {
    showComposerActions,
    setShowComposerActions,
    importingDrafts,
    setImportingDrafts,
    pastePreviews,
    setPastePreviews,
    submitting,
    setSubmitting,
    markingRead,
    setMarkingRead,
    dropActive,
    setDropActive,
    rightPanels,
    setRightPanels,
    browserTakeoverPageRequest,
    setBrowserTakeoverPageRequest,
    sidePanels,
    setSidePanels,
    sidePanelShown,
    setSidePanelShown,
    settingsProvider,
    setSettingsProvider,
    settingsModel,
    setSettingsModel,
    settingsReasoning,
    setSettingsReasoning,
    browserAddress,
    setBrowserAddress,
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
    hiddenAwaitingReplyIds,
    setHiddenAwaitingReplyIds,
    sideQuestions,
    setSideQuestions,
    voiceSessions,
  };
}

export function createConversationController(props: Pick<ConversationProps, "onTypingChange">, persistDrafts = true) {
  return { ...createStableConversationState(props, persistDrafts), ...createServerConversationState() };
}
