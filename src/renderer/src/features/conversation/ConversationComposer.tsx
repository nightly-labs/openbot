import { type AgentProviderId, agentSteersTurns, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import {
  type AccountUsageLimit,
  type AgentWait,
  CUSTOM_PROVIDER_DEFAULT_INPUTS,
  CUSTOM_PROVIDER_INPUT_KINDS,
  type CustomProviderModel,
  type CustomProviderSummary,
  canPreviewAttachment,
  customProviderOfModel,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type QueueSnapshot,
  queueHoldWorker,
  routineRunsTurn,
  savedCustomModelId,
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
import { readableAgentError } from "../agents/agent-error-text";
import { customProviderRestartMessage } from "../custom-providers/custom-provider-restart";
import { speechReading } from "../speech/speech-playback";
import { stopSpokenReply } from "../speech/speech-replies";
import { copyComposerSelection, readComposerCopy } from "./composer-clipboard";
import { createComposerResize } from "./composer-resize";
import { useConversationController } from "./conversation-controller-context";
import { composerDraftKey } from "./conversation-keys";
import { useConversationViewScope } from "./conversation-scope";
import { currentConversationTarget } from "./stores/composer-store";

const [dismissedCompactions, setDismissedCompactions] = createSignal<Record<string, string>>({});
const [dismissedUsageLimits, setDismissedUsageLimits] = createStore<Record<string, Record<string, string>>>({});

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
    stopAwaitingReply,
    openWaitingAgent,
    composerFocusRequest,
    composerHasContent,
    currentChatConversationKey,
    currentChatError,
    currentChatErrorReference,
    currentChatErrorRun,
    currentChatErrorLink,
    currentChatErrorDetails,
    currentChatErrorNotice,
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
    voicePhase: sharedVoicePhase,
    voiceThreadKey,
    voiceModelProgress,
    sideQuestionAvailable,
    openSideQuestion,
    voiceConversationAvailable,
    voiceConversationOpen,
    toggleVoiceConversation,
    sendStarting,
    channel,
    providerSilentMinutes,
    providerOffline,
    agentProviderName,
    sideThreadOpen,
    canTeachBrowserTask,
    openBrowserTeach,
  } = useConversationViewScope();
  const { t, format, errorMessage, sourceText: localizeSourceText } = useText();
  const voicePhase = () => (voiceThreadKey() === undefined ? sharedVoicePhase() : "idle");
  const threadVoiceBusy = () => voiceThreadKey() !== undefined && sharedVoicePhase() !== "idle";
  const messageLabel = () =>
    channel
      ? t("channel.composer.placeholder", { name: channel.name() })
      : props.agent?.name
        ? t("composer.placeholder.message", { name: props.agent.name })
        : t("composer.placeholder.messageAgent");
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  const pickSkill = () => (channel ? undefined : () => setSkillPickerRequest((current) => current + 1));
  const teachTask = () => (channel || !canTeachBrowserTask() ? undefined : () => void openBrowserTeach());
  const askSideQuestion = () => {
    if (channel || !sideQuestionAvailable()) return undefined;
    return () => {
      const draft = currentDraft();
      const text = draft.attachments.length === 0 ? draft.text : "";
      if (text) updateCurrentDraft({ text: "" });
      openSideQuestion(text);
    };
  };
  const openVoiceConversation = () =>
    voiceConversationAvailable() && !voiceConversationOpen() ? toggleVoiceConversation : undefined;
  const sendVoice = (): ComposerSendVoice | undefined => {
    if (!props.agent || !voiceConversationAvailable()) return undefined;
    if (composerHasContent() || editingDeliveryId() || sharedVoicePhase() !== "idle") return undefined;
    if (attachmentBusy() || uploadFailed() || submitting() || !agentReady() || providerUpdateRequired())
      return undefined;
    if (voiceConversationOpen()) return "end";
    return sendStarting() ? undefined : "start";
  };
  const savePending = () => Boolean(editingDeliveryId() && editingPendingSave());
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
  const editorLocked = () =>
    !agentReady() &&
    !((props.agent || channel) && (props.agentStatus.phase === "starting" || props.agentStatus.phase === "restarting"));
  const queueOwner = () => {
    const target = currentConversationTarget(props);
    return target && `${target.serverId}:${target.agentId}`;
  };
  const controller = useConversationController();
  const feedbackFix = () => {
    const target = currentConversationTarget(props);
    if (!target || channel) return undefined;
    const fix = controller.feedbackFixes()[composerDraftKey(target)];
    return fix && currentDraft().text.trim() ? { target, fix } : undefined;
  };
  const awaitingVisible = () => awaitingReplies().length > 0;
  const waitItems = createMemo(() => openWaitItems(props.waits ?? [], props.queue));
  const waitsVisible = () => waitItems().length > 0 && Boolean(props.onCancelWait);
  const queueRows = () => (queueOpen() ? presentedQueueDeliveries() : renderedQueueDeliveries());
  const voiceAvailable = () => !props.runtime;
  const speaking = () => {
    const reading = speechReading();
    return reading &&
      reading.agentId === props.agent?.id &&
      reading.serverId === (props.server?.id ?? "local") &&
      !voiceConversationOpen()
      ? reading
      : null;
  };
  const context = () =>
    props.contextState?.agentId === props.agent?.id && props.contextState?.threadId === props.agent?.threadId
      ? props.contextState
      : undefined;
  const newChat = () =>
    props.agent && props.onClearAgentContext ? { agent: props.agent, start: props.onClearAgentContext } : undefined;
  const newChatMenuItem = () => {
    const action = newChat();
    return action && { ...action, disabled: context()?.compaction?.status === "running" };
  };
  const compaction = () => {
    const value = context()?.compaction;
    return value && value.id !== dismissedCompactions()[currentChatConversationKey() ?? ""] ? value : null;
  };

  const signInRequired = createMemo(() => {
    const provider = props.agent?.provider;
    if (!provider || !props.onSignInProvider) return null;
    if (provider === "opencode") return null;
    const status = props.agentStatus.providers?.find((item) => item.id === provider);
    return status?.state === "sign-in-required" ? status : null;
  });
  const updateOpenCodeKey = () => {
    if (props.agent?.provider !== "opencode") return undefined;
    const error = currentChatError();
    const keyError = (["error.provider.opencodeKeyExpired", "error.provider.opencodeKeyRefused"] as const).some(
      (key) => error === localizeSourceText(sourceText(key)),
    );
    return keyError ? props.onManageProviders : undefined;
  };
  const errorInChat = (error: string) => {
    const marker = props.messages.at(-1)?.actionMarker;
    return marker?.kind === "sign-in-failure" && readableAgentError(marker.text) === error;
  };
  const errorBannerAction = () => {
    const updateKey = updateOpenCodeKey();
    if (updateKey)
      return (
        <Button variant="outline" size="sm" type="button" onClick={(event) => updateKey(event.currentTarget)}>
          {t("composer.updateKey.action")}
        </Button>
      );
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
  const steers = () => !props.agent || agentSteersTurns(props.agent, props.modelOptions);
  const sendQueued = () => (steers() ? props.onSteerQueuedMessage : props.onSendQueuedMessageNow);
  const routineTurn = () => routineRunsTurn(props.queue?.deliveries, props.activeTurnId);
  const steerRefused = () => steers() && routineTurn();
  const steerOnTab = () =>
    props.activeTurnId &&
    !channel &&
    sendQueued() &&
    !steerRefused() &&
    !editingDeliveryId() &&
    composerHasContent() &&
    sharedVoicePhase() === "idle" &&
    agentReady() &&
    !attachmentBusy() &&
    !uploadFailed() &&
    !submitting()
      ? steerComposer
      : undefined;
  const textOnlyCustomModel = createMemo(() => {
    const agent = props.agent;
    if (channel || agent?.provider !== "pi" || !props.onUpdateCustomProvider) return undefined;
    if (!currentDraft().attachments.some((attachment) => attachment.kind === "image")) return undefined;
    const endpoint = customProviderOfModel(agent.model, props.customProviders ?? []);
    if (endpoint?.harness !== "pi") return undefined;
    const model = endpoint.models.find(
      (item) => savedCustomModelId(endpoint.id, endpoint.harness, item.id) === agent.model,
    );
    if (!model || (model.inputs ?? CUSTOM_PROVIDER_DEFAULT_INPUTS.pi).includes("image")) return undefined;
    return { endpoint, model };
  });
  const [allowingImages, setAllowingImages] = createSignal(false);
  const allowImages = async (endpoint: CustomProviderSummary, model: CustomProviderModel) => {
    const update = props.onUpdateCustomProvider;
    if (!update || allowingImages()) return;
    setAllowingImages(true);
    try {
      const restart = await update({
        id: endpoint.id,
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        models: endpoint.models.map((item) =>
          item.id === model.id
            ? {
                ...item,
                inputs: CUSTOM_PROVIDER_INPUT_KINDS.filter((kind) => kind === "image" || item.inputs?.includes(kind)),
              }
            : item,
        ),
      });
      toast.success(customProviderRestartMessage("Saved", restart, t));
    } catch (error) {
      toast.error(errorMessage(error, t("customProvider.saveFailed")));
    } finally {
      setAllowingImages(false);
    }
  };
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
  const unreadableContent = () =>
    props.agent?.provider === "opencode" &&
    currentChatError() === localizeSourceText(sourceText("error.provider.opencodeUnreadableContent"));
  const [now, setNow] = createSignal(Date.now());
  const agentAccountId = () => props.agent?.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const agentUsageLimit = (limit: AccountUsageLimit) =>
    limit.id === props.agent?.provider && (limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === agentAccountId();
  const usageExhausted = createMemo(() => {
    const provider = props.agent?.provider;
    if (!provider || !isKnownAgentProvider(provider)) return null;
    const spent = spentUsageWindow(props.accountUsage?.limits, provider, agentAccountId(), props.agent?.model, now());
    if (!spent) return null;
    const { slot, window, covers, onCredits } = spent;
    return {
      provider,
      resetsAt: window.resetsAt,
      covers,
      onCredits,
      key: JSON.stringify([slot, window.windowDurationMins, onCredits]),
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
  const SendControl = () => (
    <ComposerSendControl
      stop={Boolean(
        (props.activeTurnId || props.subagentTurnId) &&
          !editingDeliveryId() &&
          !composerHasContent() &&
          voicePhase() !== "recording",
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
        threadVoiceBusy() ||
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
        <div class="composer-stack">
          <ComposerStackCard when={awaitingVisible() && awaitingReplies()}>
            {(items) => (
              <AwaitingReplies
                items={items()}
                title={channel ? t("chat.awaiting.subtasks") : undefined}
                onDismiss={dismissAwaitingReplies}
                onOpenAgent={openWaitingAgent}
                onSteer={
                  props.activeTurnId && !channel && steers() && !steerRefused() ? props.onSteerQueuedMessage : undefined
                }
                onStop={channel ? (channel.readOnly() ? undefined : channel.stopAwaitingReply) : stopAwaitingReply}
                stopDisplay={channel ? undefined : "icon"}
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
                      hold={queueHoldWorker(props.queue?.hold) === props.agent?.id ? null : props.queue?.hold}
                      agents={props.agents}
                      skills={installedSkills()}
                      editingDeliveryId={editingDeliveryId()}
                      canSteer={Boolean(props.activeTurnId) && !steerRefused()}
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
          <ComposerStackCard when={textOnlyCustomModel()}>
            {(shown) => (
              <ComposerNotice
                body={t("composer.imageInput.body", { model: shown().model.name })}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    loading={allowingImages()}
                    loadingLabel={t("composer.imageInput.pending")}
                    aria-label={t("composer.imageInput.label", { model: shown().model.name })}
                    onClick={() => void allowImages(shown().endpoint, shown().model)}
                  >
                    {t("composer.imageInput.action")}
                  </Button>
                }
              />
            )}
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
          <ComposerStackCard when={feedbackFix()}>
            {(request) => (
              <ComposerNotice
                body={t("composer.feedbackFix.body", { number: String(request().fix.number) })}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => controller.cancelFeedbackFix(request().target)}
                  >
                    {t("composer.feedbackFix.cancel")}
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
                onCredits={spent().onCredits}
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
                    severity: spent().onCredits ? "warning" : "error",
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
                reason={compaction()?.reason}
                onDone={() =>
                  setDismissedCompactions((current) => ({ ...current, [currentChatConversationKey() ?? ""]: id }))
                }
              />
            )}
          </Show>
          <ComposerStackCard
            when={
              currentChatError() &&
              currentChatError() !== providerUpdateRequired()?.message &&
              !errorInChat(currentChatError() ?? "")
                ? currentChatError()
                : null
            }
          >
            {(message) => (
              <ComposerErrorBanner
                message={message()}
                title={currentChatErrorRun() ?? undefined}
                tone={unreadableContent() || currentChatErrorNotice() ? "warning" : "danger"}
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
              onSearchThreads={props.onSearchThreads}
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
              newChat={newChatMenuItem()}
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
                  blocked={!(props.agent || channel) || !agentReady() || threadVoiceBusy()}
                  onStart={() => void startVoiceRecording()}
                  onCancel={cancelVoiceRecording}
                  onFinish={stopVoiceRecording}
                  onSend={submitComposer}
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
