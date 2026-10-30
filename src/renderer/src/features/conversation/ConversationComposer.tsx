import { isKnownAgentProvider, providerSteersTurns } from "@openbot/contracts/agent-providers";
import { supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import {
  type AccountUsageLimit,
  type AgentWait,
  accountUsageCoversModel,
  canPreviewAttachment,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type QueueSnapshot,
  usageQuotaForModel,
} from "@openbot/contracts/ipc";
import {
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  TEAM_ZIP_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { Button, ImageRemoveButton, Input } from "@openbot/ui";
import { fileBadge } from "@openbot/ui/features/conversation/AttachmentCards";
import { attachmentReferenceTone } from "@openbot/ui/features/conversation/AttachmentReference";
import { AwaitingReplies } from "@openbot/ui/features/conversation/AwaitingReplies";
import { ComposerAddMenu } from "@openbot/ui/features/conversation/ComposerAddMenu";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import {
  ComposerNotice,
  ComposerSignInNotice,
  ComposerUpdateNotice,
  ComposerUsageLimitNotice,
} from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerSendControl } from "@openbot/ui/features/conversation/ComposerSendControl";
import {
  ComposerCompactionNotice,
  ContextUsageMeter,
  contextUsageView,
} from "@openbot/ui/features/conversation/ContextUsage";
import { CloseIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { type OpenWaitItem, OpenWaits } from "@openbot/ui/features/conversation/OpenWaits";
import { ReplyQuote } from "@openbot/ui/features/conversation/ReplyQuote";
import { SpeakingBar } from "@openbot/ui/features/conversation/SpeakingBar";
import { ComposerVoiceControls } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, For, Loading, lazy, Show } from "solid-js";
import { reportErrorBanner, reportNotification } from "../../error-reports";
import { deviceSendShortcut, sendShortcutAriaKey, sendShortcutHintKey } from "../../send-shortcut-preference";
import { speechReading } from "../speech/speech-playback";
import { stopSpokenReply } from "../speech/speech-replies";
import { copyComposerSelection, readComposerCopy } from "./composer-clipboard";
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
    awaitingReplies,
    dismissAwaitingReplies,
    composerFocusRequest,
    composerHasContent,
    currentChatConversationKey,
    currentChatError,
    currentChatErrorReference,
    currentChatErrorRun,
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
    props,
    quoteRequest,
    openQuote,
    queuePanelVisible,
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
    unreferencedDraftAttachments,
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
    activeRightPanel,
    channel,
    providerSilentMinutes,
    providerOffline,
    agentProviderName,
    sideThreadOpen,
  } = useConversationViewScope();
  const { t, format, sourceText: localizeSourceText } = useText();
  const messageLabel = () =>
    channel
      ? t("channel.composer.placeholder", { name: channel.name() })
      : props.agent?.name
        ? t("composer.placeholder.message", { name: props.agent.name })
        : t("composer.placeholder.messageAgent");
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  /** A skill belongs to one agent, and a channel message goes to the agents it routes to. */
  const pickSkill = () => (channel ? undefined : () => setSkillPickerRequest((current) => current + 1));
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
  // A pending Save keeps its exact request for retry. Block changes until retry or cancel.
  const savePending = () => Boolean(editingDeliveryId() && editingPendingSave());
  // A provider start, restart or server reconnect is short. Keys typed in it must not drop, so only a
  // lasting stop locks the text. Sending still waits for the agent. Without an agent, no draft keeps the text.
  const editorLocked = () =>
    !agentReady() &&
    !((props.agent || channel) && (props.agentStatus.phase === "starting" || props.agentStatus.phase === "restarting"));
  // The mention picker grows out of the same edge as the queue, so only one of them holds it.
  const queueVisible = () => queuePanelVisible() && !pickerOpen();
  // Each chat gets its own queue panel. One shared panel animated the rows and the height of the
  // previous chat's queue into this one, and the chat jumped while it resized (#3770). The keyed
  // <Show> builds its child again only when the child function takes the key as a parameter.
  const queueOwner = () => {
    const target = currentConversationTarget(props);
    return target && `${target.serverId}:${target.agentId}`;
  };
  const awaitingVisible = () => awaitingReplies().length > 0 && !pickerOpen();
  const waitItems = createMemo(() => openWaitItems(props.waits ?? [], props.queue));
  const waitsVisible = () => waitItems().length > 0 && Boolean(props.onCancelWait) && !pickerOpen();
  const slotOpen = () => queueVisible() || awaitingVisible() || waitsVisible();
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
  /** An ACP provider has no steer request, so its queued messages wait for the turn to end (#3689). */
  const steers = () => !props.agent || providerSteersTurns(props.agent.provider);
  /** Tab sends the draft into the running turn, in place of Send and then Steer on its queue row. */
  const steerOnTab = () =>
    props.activeTurnId &&
    !channel &&
    steers() &&
    !editingDeliveryId() &&
    composerHasContent() &&
    voicePhase() === "idle" &&
    agentReady() &&
    !attachmentBusy() &&
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
  /**
   * The first plan window that is spent and has not ended yet. `usedPercent` is what the provider
   * reports, so it can pass 100 slightly. A spent plan does not say whether paid credits remain.
   */
  const usageExhausted = createMemo(() => {
    const provider = props.agent?.provider;
    // The usage of a provider that this build does not know has no notice.
    if (!provider || !isKnownAgentProvider(provider)) return null;
    for (const limit of props.accountUsage?.limits ?? []) {
      if (!agentUsageLimit(limit)) continue;
      // A provider that names quota groups limits each group apart: only the agent's model's group
      // can stop it, and a model that no group lists has no notice.
      const model = props.agent?.model;
      const quota = usageQuotaForModel(limit, model);
      if (!quota) continue;
      for (const window of ["primary", "secondary"] as const) {
        const plan = quota[window];
        if (!plan || plan.usedPercent < 100) continue;
        if (plan.resetsAt !== null && plan.resetsAt * 1_000 <= now()) continue;
        return {
          provider,
          resetsAt: plan.resetsAt,
          // A named group is the model's own quota.
          covers: quota !== limit || accountUsageCoversModel(provider, model),
          key: JSON.stringify([window, plan.windowDurationMins, plan.resetsAt]),
        };
      }
    }
    return null;
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
    return supportedAttachmentExtensions({
      eml: local || capabilities.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
      media: local || capabilities.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
      zip: local || capabilities.includes(TEAM_ZIP_ATTACHMENTS_CAPABILITY),
      mp4: local || capabilities.includes(TEAM_MP4_ATTACHMENTS_CAPABILITY),
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
      label={sendLabel()}
      keyShortcuts={sendKeyShortcuts()}
      title={sendTitle()}
      disabled={
        attachmentBusy() ||
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
          <div
            class="agent-queue-slot"
            data-open={slotOpen() ? "true" : "false"}
            aria-hidden={slotOpen() ? undefined : "true"}
            inert={slotOpen() ? undefined : true}
          >
            <div class="agent-queue-slot-inner">
              <Show when={awaitingVisible()}>
                <AwaitingReplies
                  items={awaitingReplies()}
                  title={channel ? t("chat.awaiting.subtasks") : undefined}
                  onDismiss={dismissAwaitingReplies}
                  onOpenAgent={props.onSelectAgent}
                  // A channel's rows are its sub-tasks, not queued replies.
                  onSteer={props.activeTurnId && !channel && steers() ? props.onSteerQueuedMessage : undefined}
                />
              </Show>
              <Show when={waitsVisible() && props.onCancelWait}>
                {(cancelWait) => (
                  <OpenWaits
                    items={waitItems()}
                    onCancel={cancelWait()}
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
              </Show>
              <Show when={queueVisible() ? queueOwner() : undefined} keyed>
                {(_owner) => (
                  <Loading>
                    <QueuePanel
                      deliveries={presentedQueueDeliveries()}
                      // Only for an agent that is waiting. When the channel work is this agent's own,
                      // the activity line above already shows it working, and naming it twice reads as
                      // two different waits.
                      hold={props.queue?.hold?.agentId === props.agent?.id ? null : props.queue?.hold}
                      agents={props.agents}
                      skills={installedSkills()}
                      editingDeliveryId={editingDeliveryId()}
                      canSteer={Boolean(props.activeTurnId)}
                      onSteer={steers() ? props.onSteerQueuedMessage : undefined}
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
          <Show when={providerWaitNotice()}>
            {(notice) => <ComposerNotice title={notice().title} body={notice().body} />}
          </Show>
          <Show when={editingDeliveryId()}>
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
          </Show>
          <Show when={voiceLimitNotice()}>
            <ComposerNotice
              body={t("composer.voice.limitReached")}
              onDismiss={() => {
                dismissVoiceLimitNotice();
                setComposerFocusRequest((current) => current + 1);
              }}
            />
          </Show>
          <Show when={replyTarget()}>
            {(message) => (
              <div class="composer-reply-preview">
                <div>
                  <span>{t(message().author === "you" ? "composer.reply.toYou" : "composer.reply.toAgent")}</span>
                  <ReplyQuote
                    body={message().body || t("composer.reply.attachment")}
                    agents={props.agents}
                    skills={installedSkills()}
                    attachments={message().attachments}
                    citations={message().citations}
                  />
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={t("composer.reply.cancel")}
                  disabled={voicePhase() === "transcribing"}
                  onClick={() => updateCurrentDraft({ replyToMessageId: null })}
                >
                  <CloseIcon />
                </Button>
              </div>
            )}
          </Show>
          <Show when={providerUpdateRequired()}>
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
          </Show>
          {/* Keyed on the provider: a sign-in that failed for one provider says nothing about the next. */}
          <Show when={signInRequired()?.id} keyed>
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
          <Show when={usageNotice()}>
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
          </Show>
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
          <Show
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
                action={
                  updateOpenCodeKey() ? (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={(event) => updateOpenCodeKey()?.(event.currentTarget)}
                    >
                      {t("composer.updateKey.action")}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Show>
        </div>
        <div
          class="composer"
          data-compact={
            currentDraft().text.includes("\n") || unreferencedDraftAttachments().length > 0 ? undefined : ""
          }
          data-has-attachments={unreferencedDraftAttachments().length > 0 ? "" : undefined}
          onPointerDown={(event) => {
            if (!(event.target instanceof Element)) return;
            // The "+" menu is in a portal, but its events come here too. Focus taken from it closes the menu
            // before the item gets the pointerup.
            if (event.target.closest("button, .composer-editor-surface, .ui-action-menu")) return;
            event.preventDefault();
            setComposerFocusRequest((current) => current + 1);
          }}
        >
          <Show when={unreferencedDraftAttachments().length > 0}>
            <div class="composer-attachments">
              <For each={unreferencedDraftAttachments()}>
                {(attachment) => {
                  // An image with no preview (the web client) shows as a file, with its name.
                  const chip = () => (attachment.kind === "image" && attachment.previewUrl ? "image" : "file");
                  return (
                    <div class="composer-attachment ui-removable-image" data-kind={chip()}>
                      <span
                        class="composer-attachment-preview"
                        data-file-tone={chip() === "file" ? attachmentReferenceTone(attachment.name) : undefined}
                      >
                        <Show when={chip() === "image"} fallback={fileBadge(attachment)}>
                          <img src={attachment.previewUrl ?? ""} alt="" />
                        </Show>
                      </span>
                      <Show when={chip() === "file"}>
                        <span class="composer-attachment-copy">
                          <strong title={attachment.name}>{attachment.name}</strong>
                          <small>{format.fileSize(attachment.size)}</small>
                        </span>
                      </Show>
                      <ImageRemoveButton
                        label={t("composer.attachment.remove", { name: attachment.name })}
                        disabled={voicePhase() === "transcribing" || savePending()}
                        onClick={() => removeAttachment(attachment.id)}
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
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
              onValueChange={(text) => {
                updateCurrentDraft({ text });
                updateTeamTyping(text);
              }}
              onSubmit={submitComposer}
              onSteer={steerOnTab()}
              sendShortcut={deviceSendShortcut(props.platform)}
              onPickerOpenChange={setPickerOpen}
              dictation={{ text: voiceLiveText(), final: voicePhase() === "transcribing" }}
              onPasteFiles={pasteFiles}
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
              onSideQuestion={askSideQuestion()}
              onVoice={openVoiceConversation()}
            />
            <div class="composer-primary-actions">
              <Show when={contextUsageView(context())}>
                {(usage) => (
                  <ContextUsageMeter
                    newChat={
                      props.agent && props.onClearAgentContext
                        ? { agent: props.agent, start: props.onClearAgentContext }
                        : undefined
                    }
                    compact={props.onCompactAgentContext}
                    usage={usage()}
                  />
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
