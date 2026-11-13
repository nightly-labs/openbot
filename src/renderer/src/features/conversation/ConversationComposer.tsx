import { type AgentProviderId, isKnownAgentProvider, providerSteersTurns } from "@openbot/contracts/agent-providers";
import { supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import {
  type AccountUsageLimit,
  type AgentWait,
  canPreviewAttachment,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type QueueSnapshot,
} from "@openbot/contracts/ipc";
import {
  TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  TEAM_SVG_ATTACHMENTS_CAPABILITY,
  TEAM_ZIP_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { spentUsageWindow } from "@openbot/team-client/plan-limits";
import { Button, CopyButton, Input, toast } from "@openbot/ui";
import { AwaitingReplies } from "@openbot/ui/features/conversation/AwaitingReplies";
import { ComposerAddMenu } from "@openbot/ui/features/conversation/ComposerAddMenu";
import { ComposerAttachmentRow } from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import {
  ComposerNotice,
  ComposerSignInNotice,
  ComposerUpdateNotice,
  ComposerUsageLimitNotice,
} from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerReplyPreview } from "@openbot/ui/features/conversation/ComposerReplyPreview";
import { ComposerSendControl, type ComposerSendVoice } from "@openbot/ui/features/conversation/ComposerSendControl";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import {
  ComposerCompactionNotice,
  ContextUsageMeter,
  contextUsageView,
} from "@openbot/ui/features/conversation/ContextUsage";
import { type OpenWaitItem, OpenWaits } from "@openbot/ui/features/conversation/OpenWaits";
import { SpeakingBar } from "@openbot/ui/features/conversation/SpeakingBar";
import { ComposerVoiceControls } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, Loading, lazy, Show } from "solid-js";
import { reportErrorBanner, reportNotification } from "../../error-reports";
import { deviceSendShortcut, sendShortcutAriaKey, sendShortcutHintKey } from "../../send-shortcut-preference";
import { speechReading } from "../speech/speech-playback";
import { stopSpokenReply } from "../speech/speech-replies";
import { copyComposerSelection, readComposerCopy } from "./composer-clipboard";
import { createComposerResize } from "./composer-resize";
import { useConversationViewScope } from "./conversation-scope";
import { currentConversationTarget } from "./stores/composer-store";

// Module scope: the composer remounts on navigation, and a dismissed notice must stay dismissed.
const [dismissedCompactions, setDismissedCompactions] = createSignal<Record<string, string>>({});
// Keyed by provider account, then by chat: a recovered window clears every chat of that account.
const [dismissedUsageLimits, setDismissedUsageLimits] = createStore<Record<string, Record<string, string>>>({});

/** @internal Stable HMR boundary for conversation composer. */
export function ConversationComposer() {
  const {
    agentReady,
    providerUpdateRequired,
    attachmentAction,
    attachmentBusy,
    uploadFailed,
    currentUploads,
    removeUpload,
    retryUpload,
    awaitingReplies,
    dismissAwaitingReplies,
    composerFocusRequest,
    composerHasContent,
    currentChatConversationKey,
    currentChatError,
    currentChatErrorReference,
    currentChatErrorRun,
    currentChatErrorLink,
    currentChatErrorDetails,
    currentDraft,
    dismissCurrentChatErrors,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    editQueuedMessage,
    cancelQueuedMessageEdit,
    editingDeliveryId,
    editingPendingSave,
    openAttachmentPicker,
    pasteFiles,
    presentedQueueDeliveries,
    previewAttachment,
    openExternalMessageUrl,
    props,
    quoteRequest,
    openQuote,
    taggableBrowserTabs,
    taggableThreads,
    openTaggedReference,
    queuePanelVisible,
    queueOpen,
    renderedQueueDeliveries,
    releaseCutAttachments,
    removeAttachment,
    reorderPresentedQueue,
    replyTarget,
    setComposerFocusRequest,
    setAttachmentPickerElement,
    setShowComposerActions,
    showComposerActions,
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
    submitComposer,
    steerComposer,
    composerAnswersPrompt,
    submitting,
    rowDraftAttachments,
    currentPastePreviews,
    updateCurrentDraft,
    updateTeamTyping,
    voiceElapsedSeconds,
    voiceLevels,
    voiceLimitNotice,
    dismissVoiceLimitNotice,
    voiceLiveText,
    voicePhase,
    voiceModelProgress,
    sideQuestionAvailable,
    openSideQuestion,
    voiceConversationAvailable,
    openSidePanelPane,
    closeSidePanelPane,
    activeRightPanel,
    sidePanel,
    sendStarting,
    channel,
    providerSilentMinutes,
    providerOffline,
    agentProviderName,
    sideThreadOpen,
    canTeachBrowserTask,
    openBrowserTeach,
  } = useConversationViewScope();
  const { t, format, sourceText: localizeSourceText } = useText();
  const messageLabel = () =>
    channel
      ? t("channel.composer.placeholder", { name: channel.name() })
      : props.agent?.name
        ? t("composer.placeholder.message", { name: props.agent.name })
        : t("composer.placeholder.messageAgent");
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  /** A skill belongs to one agent, and a channel message goes to the agents it routes to. */
  const pickSkill = () => (channel ? undefined : () => setSkillPickerRequest((current) => current + 1));
  /** As for a skill: the task is for one agent. Hidden while the host cannot record the steps. */
  const teachTask = () => (channel || !canTeachBrowserTask() ? undefined : () => void openBrowserTeach());
  /**
   * The draft goes to the side question, so that the chat gets nothing of it. A draft with attachments
   * stays: the side question cannot send files.
   */
  const askSideQuestion = () => {
    if (channel || !sideQuestionAvailable()) return undefined;
    return () => {
      const draft = currentDraft();
      const text = draft.attachments.length === 0 ? draft.text : "";
      if (text) updateCurrentDraft({ text: "" });
      openSideQuestion(text);
    };
  };
  const openVoiceConversation = () => (voiceConversationAvailable() ? () => openSidePanelPane("voice") : undefined);
  /** The voice conversation runs while its tab is in the side panel, also when another tab shows. */
  const voiceTabOpen = () => sidePanel().panes.includes("voice");
  /**
   * With nothing to send, Send starts a voice conversation, as on mobile. While the conversation runs,
   * the same button ends it. When Send cannot send to the agent, Send stays and is disabled.
   */
  const sendVoice = (): ComposerSendVoice | undefined => {
    if (!props.agent || !voiceConversationAvailable()) return undefined;
    if (composerHasContent() || editingDeliveryId() || voicePhase() !== "idle") return undefined;
    if (attachmentBusy() || uploadFailed() || submitting() || !agentReady() || providerUpdateRequired())
      return undefined;
    if (voiceTabOpen()) return "end";
    // Between a send and its turn, Send stays, so the voice icon does not show for a moment before Stop.
    return sendStarting() ? undefined : "start";
  };
  const toggleVoiceConversation = () => {
    if (voiceTabOpen()) closeSidePanelPane("voice");
    else openSidePanelPane("voice");
  };
  // A pending Save keeps its exact request for retry. Block changes until retry or cancel.
  const savePending = () => Boolean(editingDeliveryId() && editingPendingSave());
  // One chip for each file of each import. Only a single-file import knows the bytes of its file.
  const uploadFiles = createMemo(() =>
    currentUploads().flatMap((upload) =>
      upload.files.map((file, index) => ({
        key: `${upload.requestId}:${index}`,
        uploadId: upload.requestId,
        name: file.name,
        size: file.size,
        sent: upload.files.length === 1 ? upload.sent : null,
        error: upload.error,
      })),
    ),
  );
  const composerAttachmentRow = () =>
    rowDraftAttachments().length > 0 || currentPastePreviews().length > 0 || uploadFiles().length > 0;
  const composerResize = createComposerResize({
    full: () => currentDraft().text.includes("\n") || composerAttachmentRow(),
    empty: () => currentDraft().text.length === 0,
    conversationKey: () => currentChatConversationKey() ?? "",
  });
  // A provider start, restart or server reconnect is short. Keys typed in it must not drop, so only a
  // lasting stop locks the text. Sending still waits for the agent. Without an agent, no draft keeps the text.
  const editorLocked = () =>
    !agentReady() &&
    !((props.agent || channel) && (props.agentStatus.phase === "starting" || props.agentStatus.phase === "restarting"));
  // Each chat gets its own queue panel. One shared panel animated the rows and the height of the
  // previous chat's queue into this one, and the chat jumped while it resized (#3770). The keyed
  // <Show> builds its child again only when the child function takes the key as a parameter.
  const queueOwner = () => {
    const target = currentConversationTarget(props);
    return target && `${target.serverId}:${target.agentId}`;
  };
  const awaitingVisible = () => awaitingReplies().length > 0;
  const waitItems = createMemo(() => openWaitItems(props.waits ?? [], props.queue));
  const waitsVisible = () => waitItems().length > 0 && Boolean(props.onCancelWait);
  // A slot that closes keeps the last rows in place, so the whole panel goes down behind the input in
  // one move, the way it came up. In a slot that stays open, a row that goes leaves on its own.
  const queueRows = () => (queueOpen() ? presentedQueueDeliveries() : renderedQueueDeliveries());
  // A channel has many speakers, so it has no voice input.
  const voiceAvailable = () => !channel && !props.runtime;
  /** The reply of this agent that is read aloud. The voice pane shows its own. */
  const speaking = () => {
    const reading = speechReading();
    return reading &&
      reading.agentId === props.agent?.id &&
      reading.serverId === (props.server?.id ?? "local") &&
      activeRightPanel() !== "voice"
      ? reading
      : null;
  };
  const context = () =>
    props.contextState?.agentId === props.agent?.id && props.contextState?.threadId === props.agent?.threadId
      ? props.contextState
      : undefined;
  const newChat = () =>
    props.agent && props.onClearAgentContext ? { agent: props.agent, start: props.onClearAgentContext } : undefined;
  const compaction = () => {
    const value = context()?.compaction;
    return value && value.id !== dismissedCompactions()[currentChatConversationKey() ?? ""] ? value : null;
  };

  /**
   * The provider status is the only source of truth for a signed-out provider, so the notice and the
   * model picker's "Sign in required" label can never disagree, and the notice is shown before the
   * user sends rather than only after a request comes back 401.
   */
  const signInRequired = createMemo(() => {
    const provider = props.agent?.provider;
    if (!provider || !props.onSignInProvider) return null;
    // OpenCode is signed in by pasting a key in settings, not by a login this button can start, so
    // its notice would carry a button that does nothing. Every other provider opens its own OAuth.
    if (provider === "opencode") return null;
    const status = props.agentStatus.providers?.find((item) => item.id === provider);
    return status?.state === "sign-in-required" ? status : null;
  });
  /**
   * An expired OpenCode key is replaced in this server's Providers settings, so its banner opens
   * them (#2544). The banner holds the error in the reader's language, and that text has no
   * placeholder, so it is compared whole.
   */
  const updateOpenCodeKey = () => {
    if (props.agent?.provider !== "opencode") return undefined;
    const expired = localizeSourceText(sourceText("error.provider.opencodeKeyExpired"));
    return currentChatError() === expired ? props.onManageProviders : undefined;
  };
  /** The button of the error banner: the fix that the error names, or none. */
  const errorBannerAction = () => {
    const updateKey = updateOpenCodeKey();
    if (updateKey)
      return (
        <Button variant="outline" size="sm" type="button" onClick={(event) => updateKey(event.currentTarget)}>
          {t("composer.updateKey.action")}
        </Button>
      );
    // Google refuses Gemini until the user verifies the account on this page (#2419).
    const link = currentChatErrorLink();
    if (link)
      return (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void openExternalMessageUrl(link, { ownBrowser: true })}
        >
          {t("composer.verifyAccount.action")}
        </Button>
      );
    // The general sentence names no cause, so the user can copy the provider's text into a report (#6410).
    const details = currentChatErrorDetails();
    if (details)
      return (
        <CopyButton
          value={details}
          variant="outline"
          size="sm"
          label={t("agent.error.copyDetails")}
          onCopyError={() => toast.error(t("app.clipboard.copyFailed"))}
        />
      );
    return undefined;
  };
  /** An ACP provider has no steer request, so its queued messages wait for the turn to end (#3689). */
  const steers = () => !props.agent || providerSteersTurns(props.agent.provider);
  /** Steer for a provider that can steer; else Send now, which stops the turn and runs the message next. */
  const sendQueued = () => (steers() ? props.onSteerQueuedMessage : props.onSendQueuedMessageNow);
  /** Tab sends the draft into the running turn, in place of Send and then Steer on its queue row. */
  const steerOnTab = () =>
    props.activeTurnId &&
    !channel &&
    sendQueued() &&
    !editingDeliveryId() &&
    composerHasContent() &&
    voicePhase() === "idle" &&
    agentReady() &&
    !attachmentBusy() &&
    !uploadFailed() &&
    !submitting()
      ? steerComposer
      : undefined;
  /** Why the running turn has no reply: the computer is offline, or the provider sends nothing. */
  const providerWaitNotice = createMemo(() => {
    const provider = agentProviderName();
    if (!provider) return null;
    if (providerOffline())
      return { title: t("composer.providerWait.offlineTitle"), body: t("composer.providerWait.offline", { provider }) };
    const minutes = providerSilentMinutes();
    if (minutes === null) return null;
    const duration = format.number(minutes, { style: "unit", unit: "minute", unitDisplay: "long" });
    return { title: undefined, body: t("composer.providerWait.silent", { provider, duration }) };
  });
  /** A file the model cannot read is fixed by a model change, not by waiting, so it is not shown as a failure. */
  const unreadableContent = () =>
    props.agent?.provider === "opencode" &&
    currentChatError() === localizeSourceText(sourceText("error.provider.opencodeUnreadableContent"));
  /**
   * A window that ended gives the quota back, and the reading that named it stays as it was until
   * something asks the provider again. So the clock is part of the state, not only the percentage.
   */
  const [now, setNow] = createSignal(Date.now());
  const agentAccountId = () => props.agent?.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  /** A reading of another account of the same provider says nothing about the quota this agent uses. */
  const agentUsageLimit = (limit: AccountUsageLimit) =>
    limit.id === props.agent?.provider && (limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === agentAccountId();
  /** The first plan window that is spent and has not ended yet. It does not say whether paid credits remain. */
  const usageExhausted = createMemo(() => {
    const provider = props.agent?.provider;
    // The usage of a provider that this build does not know has no notice.
    if (!provider || !isKnownAgentProvider(provider)) return null;
    const spent = spentUsageWindow(props.accountUsage?.limits, provider, agentAccountId(), props.agent?.model, now());
    if (!spent) return null;
    const { slot, window, covers } = spent;
    return {
      provider,
      resetsAt: window.resetsAt,
      covers,
      // Not the reset time: Codex sends the same window's reset a second or two apart between readings.
      // A window that ends clears the dismissal below, and the clock ends it when no reading comes.
      key: JSON.stringify([slot, window.windowDurationMins]),
    };
  });
  const usageNoticeAccount = () => {
    const status = props.agentStatus.providers?.find((provider) => provider.id === props.agent?.provider);
    const email = status?.accounts?.find((account) => account.id === agentAccountId())?.email ?? status?.email;
    return JSON.stringify([props.agent?.provider, agentAccountId(), email]);
  };
  const usageNotice = () => {
    const spent = usageExhausted();
    return spent &&
      !signInRequired() &&
      spent.covers &&
      dismissedUsageLimits[usageNoticeAccount()]?.[currentChatConversationKey() ?? ""] !== spent.key
      ? spent
      : null;
  };
  // Retain dismissal across navigation and identical readings. A recovered window can warn again,
  // including providers that report no reset time. A pending usage load is not recovery.
  createEffect(
    () => ({
      account: usageNoticeAccount(),
      spent: usageExhausted(),
      loaded: props.accountUsage?.limits.some(
        (limit) => agentUsageLimit(limit) && (limit.primary !== null || limit.secondary !== null),
      ),
    }),
    ({ account, spent, loaded }) => {
      if (loaded && !spent) {
        setDismissedUsageLimits((state) => {
          delete state[account];
        });
      }
    },
  );
  // The card has to leave on its own. Nothing else reads usage again until the next turn, and the
  // user waiting for the reset is the one least likely to send one.
  createEffect(
    () => usageExhausted()?.resetsAt ?? null,
    (resetsAt) => {
      if (resetsAt === null) return;
      const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, resetsAt * 1_000 - Date.now()));
      return () => window.clearTimeout(timer);
    },
  );
  const attachmentAccept = () => {
    const server = props.server;
    const local = server?.kind !== "remote";
    const capabilities = server?.compatibility?.capabilities ?? [];
    // A host that takes any file gets no filter, so the picker shows every file.
    if (local || capabilities.includes(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY)) return undefined;
    return supportedAttachmentExtensions({
      eml: capabilities.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
      media: capabilities.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
      zip: capabilities.includes(TEAM_ZIP_ATTACHMENTS_CAPABILITY),
      mp4: capabilities.includes(TEAM_MP4_ATTACHMENTS_CAPABILITY),
      svg: capabilities.includes(TEAM_SVG_ATTACHMENTS_CAPABILITY),
    })
      .map((extension) => `.${extension}`)
      .join(",");
  };
  const sendLabel = () => {
    if (editingDeliveryId()) return t("composer.send.saveQueued");
    if (voicePhase() === "recording") return t("composer.send.voice");
    return composerAnswersPrompt() ? t("composer.send.answer") : t("composer.send.message");
  };
  const sendKeyShortcuts = () =>
    voicePhase() === "recording" ? undefined : sendShortcutAriaKey(deviceSendShortcut(props.platform));
  const sendTitle = () =>
    voicePhase() === "recording"
      ? undefined
      : t(sendShortcutHintKey(deviceSendShortcut(props.platform), editingDeliveryId() ? "save" : "send"));
  /** Send, or Stop while the agent works and the message box is empty. */
  const SendControl = () => (
    <ComposerSendControl
      stop={Boolean(
        props.activeTurnId && !editingDeliveryId() && !composerHasContent() && voicePhase() !== "recording",
      )}
      onStop={props.onStop}
      voice={sendVoice()}
      onVoice={toggleVoiceConversation}
      label={sendLabel()}
      keyShortcuts={sendKeyShortcuts()}
      title={sendTitle()}
      disabled={
        attachmentBusy() ||
        uploadFailed() ||
        submitting() ||
        !agentReady() ||
        Boolean(providerUpdateRequired()) ||
        voicePhase() === "preparing" ||
        voicePhase() === "requesting" ||
        voicePhase() === "transcribing"
      }
      busy={submitting()}
      onSend={submitComposer}
    />
  );
  return (
    <Show
      when={!channel?.readOnly()}
      fallback={<p class="channel-preview-notice">{t("channel.conversation.archivedNotice")}</p>}
    >
      <ComposerBody />
    </Show>
  );
  /** Built again for each provider: a sign-in that failed for one provider says nothing about the next. */
  function SignInCard(card: { provider: AgentProviderId }) {
    return (
      <Show when={card.provider} keyed>
        {(provider) => (
          <ComposerSignInNotice
            provider={provider}
            onShown={() =>
              reportNotification({
                operation: "provider",
                source: "provider",
                cause_code: "authentication",
                severity: "warning",
                presentation: "banner",
                provider,
              })
            }
            signingIn={signInRequired()?.connectionState === "connecting"}
            onSignIn={(provider) => props.onSignInProvider?.(provider)}
            onSignInWithCode={props.onSignInWithCodeProvider}
          />
        )}
      </Show>
    );
  }
  function ComposerBody() {
    return (
      <div class={["composer-wrap", { "conversation-covered": sideThreadOpen() }]} inert={sideThreadOpen()}>
        {channel ? <channel.AboveComposer /> : null}
        <Show when={speaking() && props.agent}>
          {(agent) => (
            <SpeakingBar
              agent={agent()}
              caption={speaking()?.part ?? ""}
              levels={speaking()?.levels ?? []}
              onStop={stopSpokenReply}
            />
          )}
        </Show>
        {/* One card for everything above the input: see composer-stack.css. */}
        <div class="composer-stack">
          <ComposerStackCard when={awaitingVisible() && awaitingReplies()}>
            {(items) => (
              <AwaitingReplies
                items={items()}
                title={channel ? t("chat.awaiting.subtasks") : undefined}
                onDismiss={dismissAwaitingReplies}
                onOpenAgent={props.onSelectAgent}
                // A channel's rows are its sub-tasks, not queued replies.
                onSteer={props.activeTurnId && !channel && steers() ? props.onSteerQueuedMessage : undefined}
                onStop={channel && !channel.readOnly() ? channel.stopAwaitingReply : undefined}
              />
            )}
          </ComposerStackCard>
          <ComposerStackCard when={waitsVisible() && props.onCancelWait && waitItems()}>
            {(items) => (
              <OpenWaits
                items={items()}
                onCancel={(waitId) => props.onCancelWait?.(waitId)}
                onShowRequest={
                  props.onOpenSearchMessage
                    ? (waitId) => {
                        const wait = props.waits?.find((entry) => entry.id === waitId);
                        if (wait) void props.onOpenSearchMessage?.(wait.requestMessageId);
                      }
                    : undefined
                }
              />
            )}
          </ComposerStackCard>
          <div
            class="agent-queue-slot"
            data-open={queueOpen() ? "true" : "false"}
            aria-hidden={queueOpen() ? undefined : "true"}
            inert={queueOpen() ? undefined : true}
          >
            <div class="agent-queue-slot-inner">
              <Show when={queuePanelVisible() ? queueOwner() : undefined} keyed>
                {(_owner) => (
                  <Loading>
                    <QueuePanel
                      deliveries={queueRows()}
                      // Only for an agent that is waiting. When the channel work is this agent's own,
                      // the activity line above already shows it working, and naming it twice reads as
                      // two different waits.
                      hold={props.queue?.hold?.agentId === props.agent?.id ? null : props.queue?.hold}
                      agents={props.agents}
                      skills={installedSkills()}
                      editingDeliveryId={editingDeliveryId()}
                      canSteer={Boolean(props.activeTurnId)}
                      onSteer={sendQueued()}
                      sendsNow={!steers()}
                      routineRuns={props.queue?.deliveries.some(
                        (delivery) =>
                          delivery.sender.kind === "routine" &&
                          (delivery.status === "starting" || delivery.status === "running"),
                      )}
                      onRunAsTask={props.threads?.onRunQueuedMessage}
                      onCancel={props.onCancelQueuedMessage}
                      onEdit={editQueuedMessage}
                      onReorder={reorderPresentedQueue}
                    />
                  </Loading>
                )}
              </Show>
            </div>
          </div>
          <ComposerStackCard when={providerWaitNotice()}>
            {(notice) => <ComposerNotice title={notice().title} body={notice().body} />}
          </ComposerStackCard>
          <ComposerStackCard when={editingDeliveryId()}>
            {() => (
              <ComposerNotice
                body={t("composer.queueEdit.body")}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={submitting() || attachmentBusy()}
                    onClick={() => void cancelQueuedMessageEdit()}
                  >
                    {t("composer.queueEdit.cancel")}
                  </Button>
                }
              />
            )}
          </ComposerStackCard>
          <ComposerStackCard when={voiceLimitNotice()}>
            {() => (
              <ComposerNotice
                body={t("composer.voice.limitReached")}
                onDismiss={() => {
                  dismissVoiceLimitNotice();
                  setComposerFocusRequest((current) => current + 1);
                }}
              />
            )}
          </ComposerStackCard>
          <ComposerStackCard when={replyTarget()}>
            {(message) => (
              <ComposerReplyPreview
                message={message()}
                agents={props.agents}
                skills={installedSkills()}
                disabled={voicePhase() === "transcribing"}
                onCancel={() => updateCurrentDraft({ replyToMessageId: null })}
              />
            )}
          </ComposerStackCard>
          <ComposerStackCard when={providerUpdateRequired()}>
            {(status) => (
              <ComposerUpdateNotice
                provider={status().id}
                onUpdate={
                  props.providerRuntimeStatuses?.[status().id]?.availableVersion ? props.onDownloadProvider : undefined
                }
                updating={
                  props.providerRuntimeStatuses?.[status().id]?.phase === "downloading" ||
                  props.providerRuntimeStatuses?.[status().id]?.phase === "finishing"
                }
              />
            )}
          </ComposerStackCard>
          <ComposerStackCard when={signInRequired()?.id}>
            {(shown) => <SignInCard provider={shown()} />}
          </ComposerStackCard>
          <ComposerStackCard when={usageNotice()}>
            {(spent) => (
              <ComposerUsageLimitNotice
                provider={spent().provider}
                resetsAt={spent().resetsAt}
                onDismiss={() => {
                  const account = usageNoticeAccount();
                  const chat = currentChatConversationKey() ?? "";
                  const window = spent().key;
                  setDismissedUsageLimits((state) => {
                    state[account] = { ...state[account], [chat]: window };
                  });
                  setComposerFocusRequest((current) => current + 1);
                }}
                onShown={() =>
                  reportNotification({
                    operation: "turn",
                    source: "provider",
                    cause_code: "usage_limit",
                    severity: "error",
                    presentation: "banner",
                    provider: spent().provider,
                  })
                }
              />
            )}
          </ComposerStackCard>
          <Show when={compaction()?.id} keyed>
            {(id) => (
              <ComposerCompactionNotice
                startedAt={compaction()?.startedAt ?? 0}
                expectedMs={compaction()?.expectedMs}
                status={compaction()?.status}
                onDone={() =>
                  setDismissedCompactions((current) => ({ ...current, [currentChatConversationKey() ?? ""]: id }))
                }
              />
            )}
          </Show>
          <ComposerStackCard
            when={
              currentChatError() && currentChatError() !== providerUpdateRequired()?.message ? currentChatError() : null
            }
          >
            {(message) => (
              <ComposerErrorBanner
                message={message()}
                title={currentChatErrorRun() ?? undefined}
                tone={unreadableContent() ? "warning" : "danger"}
                reference={currentChatErrorReference()}
                onShown={() => reportErrorBanner(message(), "turn")}
                conversationKey={currentChatConversationKey()}
                onDismiss={() => {
                  dismissCurrentChatErrors();
                  setComposerFocusRequest((current) => current + 1);
                }}
                action={errorBannerAction()}
              />
            )}
          </ComposerStackCard>
        </div>
        <div
          ref={composerResize.ref}
          class="composer"
          data-compact={composerResize.expanded() ? undefined : ""}
          data-has-attachments={composerAttachmentRow() ? "" : undefined}
          onPointerDown={(event) => {
            if (!(event.target instanceof Element)) return;
            // The "+" menu and the image viewer are in portals, but their events come here too. Focus taken
            // from the menu closes it before the item gets the pointerup.
            if (event.target.closest("button, .composer-editor-surface, .ui-action-menu, .image-lightbox")) return;
            event.preventDefault();
            setComposerFocusRequest((current) => current + 1);
          }}
        >
          <ComposerAttachmentRow
            attachments={rowDraftAttachments()}
            pending={currentPastePreviews()}
            uploads={uploadFiles()}
            onRemoveUpload={removeUpload}
            onRetryUpload={retryUpload}
            removeDisabled={voicePhase() === "transcribing" || savePending()}
            onRemove={(attachment) => removeAttachment(attachment.id)}
            macWindowControls={props.platform === "darwin"}
          />
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent?.id}
              agents={props.mentionAgents ?? props.agents}
              everyoneMention={Boolean(channel) && (props.mentionAgents ?? props.agents).length > 1}
              skills={installedSkills()}
              skillsLoadFailed={installedSkillsLoadFailed()}
              mcpServers={mcpServers()}
              attachments={currentDraft().attachments}
              value={currentDraft().text}
              disabled={submitting() || voicePhase() === "transcribing" || editorLocked() || savePending()}
              placeholder={
                !agentReady()
                  ? props.agentsConnecting
                    ? t("common.connecting")
                    : props.runtime
                      ? props.server?.state === "online"
                        ? t("composer.placeholder.hostSetup")
                        : props.server?.hostedSleep === "sleeping"
                          ? t("composer.placeholder.hostSleeping")
                          : props.server?.hostedSleep === "waking"
                            ? t("composer.placeholder.hostWaking")
                            : t("composer.placeholder.connectHost")
                      : t("composer.placeholder.cliSetup")
                  : replyTarget()
                    ? t("composer.placeholder.reply")
                    : composerAnswersPrompt()
                      ? t("composer.placeholder.answer")
                      : messageLabel()
              }
              ariaLabel={channel ? t("channel.composer.label") : messageLabel()}
              focusRequest={composerFocusRequest()}
              skillPickerRequest={skillPickerRequest()}
              quoteRequest={quoteRequest()}
              onOpenQuote={openQuote}
              browserTabs={taggableBrowserTabs()}
              threads={taggableThreads()}
              onOpenTag={openTaggedReference}
              onValueChange={(text) => {
                updateCurrentDraft({ text });
                updateTeamTyping(text);
              }}
              onSubmit={submitComposer}
              onSteer={steerOnTab()}
              sendShortcut={deviceSendShortcut(props.platform)}
              dictation={{ text: voiceLiveText(), final: voicePhase() === "transcribing" }}
              onPasteFiles={(files, selection, text) => pasteFiles(files, selection, undefined, text)}
              onCopyAttachments={(clipboard, text, attachments, remaining) => {
                const copied = copyComposerSelection(clipboard, text, attachments, props.runtime?.previewAttachment);
                if (remaining !== undefined) releaseCutAttachments(attachments, remaining, copied);
              }}
              onPasteAttachments={(clipboard, selection) => {
                const copy = readComposerCopy(clipboard);
                return copy ? pasteFiles(copy.files, selection, copy) : undefined;
              }}
              onOpenAttachment={(attachment) =>
                canPreviewAttachment(attachment)
                  ? void previewAttachment(attachment)
                  : attachmentAction(attachment, "open")
              }
            />
          </div>
          <div class="composer-toolbar">
            <Input
              ref={setAttachmentPickerElement}
              type="file"
              accept={attachmentAccept()}
              multiple
              hidden
              tabindex={-1}
              data-openbot-attachment-picker={props.runtime ? undefined : "true"}
              onChange={(event) => {
                if (props.runtime?.importFiles)
                  void props.runtime.importFiles(Array.from(event.currentTarget.files ?? []));
              }}
            />
            <ComposerAddMenu
              open={showComposerActions()}
              onOpenChange={setShowComposerActions}
              disabled={
                attachmentBusy() || submitting() || voicePhase() === "transcribing" || !agentReady() || savePending()
              }
              attachDisabled={attachmentBusy()}
              onAttach={openAttachmentPicker}
              onPickSkill={pickSkill()}
              onTeach={teachTask()}
              onSideQuestion={askSideQuestion()}
              onVoice={openVoiceConversation()}
            />
            <div class="composer-primary-actions">
              <Show when={contextUsageView(context())}>
                {(usage) => (
                  <ContextUsageMeter newChat={newChat()} compact={props.onCompactAgentContext} usage={usage()} />
                )}
              </Show>
              <Show when={attachmentBusy() && props.runtime?.cancelImportFiles} keyed>
                {(cancelImportFiles) => (
                  <Button variant="ghost" type="button" onClick={() => void cancelImportFiles()}>
                    {t("composer.upload.cancel")}
                  </Button>
                )}
              </Show>
              <Show when={voiceAvailable()} fallback={<SendControl />}>
                <ComposerVoiceControls
                  phase={voicePhase()}
                  levels={voiceLevels()}
                  elapsedSeconds={voiceElapsedSeconds()}
                  modelProgress={voiceModelProgress()}
                  blocked={!props.agent || !agentReady()}
                  onStart={() => void startVoiceRecording()}
                  onCancel={cancelVoiceRecording}
                  onFinish={stopVoiceRecording}
                  send={<SendControl />}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * A wait is resuming while the run that woke it waits in the queue or runs. A woken wait whose run
 * ended is open only because the agent did not close it.
 */
function openWaitItems(waits: readonly AgentWait[], queue: QueueSnapshot | undefined): OpenWaitItem[] {
  const pending = new Set(
    queue?.deliveries
      .filter(
        (delivery) => delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running",
      )
      .map((delivery) => delivery.id),
  );
  return waits.map((wait) => ({
    id: wait.id,
    note: wait.note,
    request: wait.requestText,
    openedAt: wait.createdAt,
    state: wait.wakeDeliveryId && pending.has(wait.wakeDeliveryId) ? "resuming" : wait.wokenAt ? "woken" : "waiting",
  }));
}

const QueuePanel = lazy(() =>
  import("@openbot/ui/features/conversation/QueuePanel").then((module) => ({ default: module.QueuePanel })),
);
