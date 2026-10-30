import type {
  AgentModelId,
  AgentProviderId,
  AgentReasoningEffort,
  BrowserBounds,
  BrowserTab,
  MarketplaceSkillDetail,
} from "@openbot/contracts/ipc";
import { SETTINGS_PANEL_DEFAULT } from "@openbot/ui/components/SettingsPanel";
import type { AgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { currentText } from "@openbot/ui/text";
import type { UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createSignal, createStore, onCleanup } from "solid-js";
import type { ChatSearchMatch } from "./chat-search";
import {
  appendPluginPrompt,
  appendSkillCreationRequest,
  appendSkillExample,
  EMPTY_DRAFT,
  QUEUE_EDIT_STORAGE_KEY,
  readStoredQueueEdit,
  type StoredQueueEdit,
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
import type { TurnRuntime } from "./stores/activity-store";
import type { SidePanelsState } from "./stores/panels-store";
import { createPendingSendStore } from "./stores/pending-send-store";
import type { SideQuestionState } from "./stores/side-question-store";
import type { VoiceCloudStream } from "./stores/voice-store";

const BROWSER_PANEL_DEFAULT = 380;
const BROWSER_PIP_STORAGE_KEY = "openbot:browser-pip-native-bounds";

function readBrowserPipBounds(): BrowserBounds | null {
  const values = (window.localStorage.getItem(BROWSER_PIP_STORAGE_KEY) ?? "")
    .split(",")
    .map((value) => Number.parseFloat(value));
  const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = values;
  return values.length === 4 && [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
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
  /** The live transcription in flight, so the final pass waits for it instead of racing it. */
  voiceLiveRequest: Promise<void> | undefined;
  /** The ElevenLabs stream of the recording, when the selected model streams. */
  voiceCloudStream: VoiceCloudStream | undefined;
  /** Stops the microphone level meter that draws the recording waveform. */
  voiceMeterStop: (() => void) | undefined;
  voiceAgentId: string | undefined;
  voiceServerId: string | undefined;
  /** The thread sends its draft when the recording's text is in it. */
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

/**
 * The half of the conversation surface that outlives one server.
 *
 * Everything here is either work the user started and has not finished - a
 * composer draft, a queued-message edit, a pasted attachment - or an async call
 * already in flight against a named server. Discarding any of it on a server
 * switch would throw away typing the user still expects to find, so this owner
 * sits above the keyed scope in `app-providers.tsx` and lives as long as the app.
 *
 * Every signal here is keyed by `serverId:agentId` (`composerDraftKey`), by a
 * channel UUID, or carries its server in the value, which is what makes the shared
 * lifetime safe.
 */
export function createStableConversationState(
  props: Pick<ConversationProps, "onTypingChange">,
  persistDrafts = true,
  storedDrafts: StoredComposerDrafts | null = null,
) {
  const restoredEdit = persistDrafts ? readStoredQueueEdit() : null;
  // A restored queue edit wins over the composer draft stored for the same agent.
  const [drafts, setDrafts] = createSignal<Record<string, ComposerDraft>>({
    ...storedDrafts?.agents,
    ...(restoredEdit ? { [composerDraftKey(restoredEdit)]: restoredEdit.draft } : {}),
  });
  /** Keyed by channel id. A channel id is a UUID, so it does not need its server in the key. */
  const [channelDrafts, setChannelDrafts] = createSignal<Record<string, ComposerDraft>>(storedDrafts?.channels ?? {});
  /** The message box of each side thread, keyed by `threadDraftKey`. */
  const [threadDrafts, setThreadDrafts] = createSignal<Record<string, ComposerDraft>>(storedDrafts?.threads ?? {});
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
  // A send in flight belongs to the server it was sent to, so it outlives a server switch.
  const pendingSends = createPendingSendStore();
  const [conversationErrors, setConversationErrors] = createSignal<Record<string, string>>({});
  /** The provider and model of the run behind each conversation error, keyed like `conversationErrors`. */
  const [conversationErrorRuns, setConversationErrorRuns] = createSignal<
    Record<string, { message: string; run: string }>
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
        // Read fresh state: a pending Save set after this effect ran must not be
        // overwritten by the previous snapshot without it.
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
  if (storedDrafts && persistDrafts)
    writeComposerDraftsOnChange({
      drafts,
      channelDrafts,
      threadDrafts,
      editingAgentId,
      editingServerId,
      editingDraftBackup,
      unsentTexts: pendingSends.unsentTexts,
    });
  const [composerErrors, setComposerErrors] = createSignal<Record<string, string>>({});
  /** The code of each composer error that came from a failure, keyed like `composerErrors`. */
  const [composerErrorReferences, setComposerErrorReferences] = createSignal<Record<string, UserErrorDetails>>({});
  const [voicePhase, setVoicePhase] = createSignal<"idle" | "preparing" | "requesting" | "recording" | "transcribing">(
    "idle",
  );
  const [voiceModelProgress, setVoiceModelProgress] = createSignal<number | null>(null);
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = createSignal(0);
  const [voiceLiveTranscript, setVoiceLiveTranscript] = createSignal<VoiceLiveTranscript | null>(null);
  /** The side thread draft that the last recording was started for. Undefined for the agent's own chat. */
  const [voiceThreadKey, setVoiceThreadKey] = createSignal<string | undefined>(undefined);
  const [voiceLevels, setVoiceLevels] = createSignal<number[]>([]);
  /** The conversation whose last recording stopped at the time limit. */
  const [voiceLimitReached, setVoiceLimitReached] = createSignal<ConversationTarget | null>(null);
  const [browserPipBounds, setBrowserPipBounds] = createSignal<BrowserBounds | null>(readBrowserPipBounds());
  const [settingsPanelWidth, setSettingsPanelWidth] = createSignal(SETTINGS_PANEL_DEFAULT);
  const [browserPanelWidth, setBrowserPanelWidth] = createSignal(BROWSER_PANEL_DEFAULT);
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

  /**
   * "The user is not composing to that agent any more."
   *
   * It lives on the controller rather than in the view because three owners with
   * three different lifetimes have to be able to say it: the view, on the
   * transitions that unmount it; this controller, when the app goes away; and
   * `server-selection.tsx`, which has to say it *before* `servers.select()` so
   * the message reaches the server the user was typing on rather than the one
   * they are arriving at.
   */
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
      setDrafts((current) => ({ ...current, [key]: appendPluginPrompt(current[key] ?? EMPTY_DRAFT, prompt) }));
      setComposerFocusRequest((value) => value + 1);
    },
    stopComposerTyping,
    drafts,
    setDrafts,
    channelDrafts,
    setChannelDrafts,
    threadDrafts,
    setThreadDrafts,
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
    browserPipBounds,
    setBrowserPipBounds,
    settingsPanelWidth,
    setSettingsPanelWidth,
    browserPanelWidth,
    setBrowserPanelWidth,
    resources,
  };
}

/**
 * The half of the conversation surface that belongs to one server.
 *
 * These describe the workspace the user is looking at - which right panel is
 * open, what the browser address bar says, which message has its reaction picker
 * out, what the in-chat search found. `rightPanels` is the reason the split
 * exists: it is keyed by agent id alone, and agent ids repeat across servers, so a
 * shared owner would carry "the computer panel is open for chief" from one
 * server to the next and open the wrong panel on arrival.
 *
 * `attachmentBusy` and `submitting` are
 * here for the same reason by a different route: they carry no key at all. Each
 * describes the composer on screen right now - "a send is in flight" - so a
 * shared owner would disable the arriving server's composer for the length of
 * the server it was left on. What has to outlive the conversation goes in
 * `conversationErrors` and `composerErrors` instead, which are keyed by
 * chat/conversation and sit in the stable half so one chat's banner never
 * leaks into another chat on the same server.
 *
 * Created inside the keyed scope in `app-providers.tsx`, so a server switch
 * discards all of it by unmounting rather than by a list of setters.
 */
export function createServerConversationState() {
  const [showComposerActions, setShowComposerActions] = createSignal(false);
  const [attachmentBusy, setAttachmentBusy] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [markingRead, setMarkingRead] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [rightPanels, setRightPanels] = createSignal<Record<string, RightPanelMode>>({});
  const [sidePanels, setSidePanels] = createStore<SidePanelsState>({ side: {}, subagents: {}, threads: {} });
  const [settingsProvider, setSettingsProvider] = createSignal<AgentProviderId>("codex");
  const [settingsModel, setSettingsModel] = createSignal<AgentModelId>("gpt-6-luna");
  const [settingsReasoning, setSettingsReasoning] = createSignal<AgentReasoningEffort>("medium");
  const [browserAddress, setBrowserAddress] = createSignal("https://www.google.com");
  const [sidebarFilePreview, writeSidebarFilePreview] = createSignal<SidebarFilePreview | null>(null);
  // The accepted preview outlives its lazy view. Keep its page with the server-owned state,
  // including when it changes twice before Solid settles or the user visits another conversation.
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
  // The rows of the waiting block that the person closed. Row ids name the question message.
  const [hiddenAwaitingReplyIds, setHiddenAwaitingReplyIds] = createSignal<ReadonlySet<string>>(new Set());
  // Keyed by agent id, as `rightPanels` is: a side question lives as long as its pane, not its view.
  const [sideQuestions, setSideQuestions] = createStore<Record<string, SideQuestionState>>({});

  return {
    showComposerActions,
    setShowComposerActions,
    attachmentBusy,
    setAttachmentBusy,
    submitting,
    setSubmitting,
    markingRead,
    setMarkingRead,
    dropActive,
    setDropActive,
    rightPanels,
    setRightPanels,
    sidePanels,
    setSidePanels,
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
  };
}

/**
 * Both halves under one owner, which is what a single-server caller wants:
 * `Conversation.stories.tsx` and the HMR test have no scope boundary to split
 * across, and `ConversationView` reads one flat object either way.
 */
export function createConversationController(props: Pick<ConversationProps, "onTypingChange">, persistDrafts = true) {
  return { ...createStableConversationState(props, persistDrafts), ...createServerConversationState() };
}
