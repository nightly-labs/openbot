import { IMAGE_ATTACHMENT_ACCEPT, supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import { canPreviewAttachment } from "@openbot/contracts/ipc";
import {
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import {
  ArrowUp,
  Button,
  DropdownMenu,
  File,
  Image,
  ImageRemoveButton,
  Input,
  LoaderCircle,
  Mic,
  Plus,
  Puzzle,
} from "@openbot/ui";
import { accountUsageCoversModel } from "@openbot/ui/features/account/account-usage-view";
import { fileBadge, formatFileSize } from "@openbot/ui/features/conversation/AttachmentCards";
import { attachmentReferenceTone } from "@openbot/ui/features/conversation/AttachmentReference";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { ComposerSignInNotice, ComposerUsageLimitNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { CloseIcon, MoreIcon, StopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { RichMessageText } from "@openbot/ui/features/conversation/RichMessageText";
import { createEffect, createMemo, createSignal, For, Loading, lazy, onCleanup, Show } from "solid-js";
import { useConversationViewScope } from "./conversation-scope";
import { formatVoiceDuration, voiceButtonLabel, voiceSupported } from "./voice-status";

/** @internal Stable HMR boundary for conversation composer. */
export function ConversationComposer() {
  const {
    agentReady,
    attachmentAction,
    attachmentBusy,
    composerFocusRequest,
    composerHasContent,
    currentChatConversationKey,
    currentChatError,
    currentDraft,
    dismissCurrentChatErrors,
    installedSkills,
    mcpServers,
    editQueuedMessage,
    editingDeliveryId,
    editingPendingSave,
    openAttachmentPicker,
    openAttachmentPickerFromKey,
    openExternalMessageUrl,
    presentedQueueDeliveries,
    previewAttachment,
    props,
    queuePanelVisible,
    removeAttachment,
    reorderPresentedQueue,
    replyTarget,
    selectionSending,
    setComposerFocusRequest,
    setContextAttachmentPickerElement,
    setImageAttachmentPickerElement,
    setShowComposerActions,
    showComposerActions,
    startVoiceRecording,
    stopVoiceRecording,
    submitComposer,
    submitting,
    unreferencedDraftAttachments,
    updateCurrentDraft,
    updateTeamTyping,
    voiceElapsedSeconds,
    voicePhase,
    voiceModelProgress,
  } = useConversationViewScope();
  const [pickerOpen, setPickerOpen] = createSignal(false);
  // A pending Save keeps its exact request for retry. Block changes until retry or cancel.
  const savePending = () => Boolean(editingDeliveryId() && editingPendingSave());
  // The mention picker grows out of the same edge as the queue, so only one of them holds it.
  const queueVisible = () => queuePanelVisible() && !pickerOpen();
  const voiceAvailable = () => !props.runtime && voiceSupported(props.platform);
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
   * A window that ended gives the quota back, and the reading that named it stays as it was until
   * something asks the provider again. So the clock is part of the state, not only the percentage.
   */
  const [now, setNow] = createSignal(Date.now());
  /**
   * The first plan window that is spent and has not ended yet. `usedPercent` is what the provider
   * reports, so it can pass 100 slightly; anything at or over the line refuses the next turn.
   */
  const usageExhausted = createMemo(() => {
    const provider = props.agent?.provider;
    if (!provider || signInRequired() || !accountUsageCoversModel(provider, props.agent?.model)) return null;
    for (const limit of props.accountUsage?.limits ?? []) {
      if (limit.id !== provider) continue;
      for (const plan of [limit.primary, limit.secondary]) {
        if (!plan || plan.usedPercent < 100) continue;
        if (plan.resetsAt !== null && plan.resetsAt * 1_000 <= now()) continue;
        return { provider, resetsAt: plan.resetsAt };
      }
    }
    return null;
  });
  // The card has to leave on its own. Nothing else reads usage again until the next turn, and the
  // user waiting for the reset is the one least likely to send one.
  createEffect(
    () => usageExhausted()?.resetsAt ?? null,
    (resetsAt) => {
      if (resetsAt === null) return;
      const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, resetsAt * 1_000 - Date.now()));
      onCleanup(() => window.clearTimeout(timer));
    },
  );
  const attachmentAccept = () => {
    const server = props.server;
    const local = server?.kind !== "remote";
    const capabilities = server?.compatibility?.capabilities ?? [];
    return supportedAttachmentExtensions({
      eml: local || capabilities.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
      media: local || capabilities.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
    })
      .map((extension) => `.${extension}`)
      .join(",");
  };
  return (
    <Show when={!props.approval && !props.browserTakeover}>
      <div class="composer-wrap">
        <div
          class="agent-queue-slot"
          data-open={queueVisible() ? "true" : "false"}
          aria-hidden={queueVisible() ? undefined : "true"}
          inert={queueVisible() ? undefined : true}
        >
          <div class="agent-queue-slot-inner">
            <Show when={queueVisible()}>
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
                  onSteer={props.onSteerQueuedMessage}
                  onCancel={props.onCancelQueuedMessage}
                  onEdit={editQueuedMessage}
                  onReorder={reorderPresentedQueue}
                />
              </Loading>
            </Show>
          </div>
        </div>
        <Show when={replyTarget()}>
          {(message) => (
            <div class="composer-reply-preview">
              <div>
                <span>Replying to {message().author === "you" ? "your message" : "Agent"}</span>
                <p>
                  <RichMessageText
                    body={message().body || "Attachment"}
                    agents={props.agents}
                    skills={installedSkills()}
                    attachments={message().attachments}
                    onSelectAgent={props.onSelectAgent}
                    onOpenLink={(url) => void openExternalMessageUrl(url)}
                    onOpenAttachment={(attachment) => void previewAttachment(attachment)}
                  />
                </p>
              </div>
              <Button
                variant="ghost"
                type="button"
                aria-label="Cancel reply"
                disabled={voicePhase() === "transcribing"}
                onClick={() => updateCurrentDraft({ replyToMessageId: null })}
              >
                <CloseIcon />
              </Button>
            </div>
          )}
        </Show>
        <Show when={signInRequired()}>
          {(status) => (
            <ComposerSignInNotice
              provider={status().id}
              signingIn={status().connectionState === "connecting"}
              onSignIn={(provider) => props.onSignInProvider?.(provider)}
            />
          )}
        </Show>
        <Show when={usageExhausted()}>
          {(spent) => <ComposerUsageLimitNotice provider={spent().provider} resetsAt={spent().resetsAt} />}
        </Show>
        <Show when={currentChatError()}>
          {(message) => (
            <ComposerErrorBanner
              message={message()}
              conversationKey={currentChatConversationKey()}
              onDismiss={() => {
                dismissCurrentChatErrors();
                setComposerFocusRequest((current) => current + 1);
              }}
            />
          )}
        </Show>
        <div
          class={`composer${voicePhase() === "recording" ? " composer-recording" : ""}`}
          data-compact={
            currentDraft().text.includes("\n") || unreferencedDraftAttachments().length > 0 ? undefined : ""
          }
          data-has-attachments={unreferencedDraftAttachments().length > 0 ? "" : undefined}
          onPointerDown={(event) => {
            if (!(event.target instanceof Element)) return;
            if (event.target.closest("button, .composer-editor-surface")) return;
            event.preventDefault();
            setComposerFocusRequest((current) => current + 1);
          }}
        >
          <Show when={unreferencedDraftAttachments().length > 0}>
            <div class="composer-attachments">
              <For each={unreferencedDraftAttachments()}>
                {(attachment) => (
                  <div class="composer-attachment ui-removable-image" data-kind={attachment.kind}>
                    <span
                      class="composer-attachment-preview"
                      data-file-tone={attachment.kind === "file" ? attachmentReferenceTone(attachment.name) : undefined}
                    >
                      <Show when={attachment.kind === "image"} fallback={fileBadge(attachment)}>
                        <img src={attachment.previewUrl ?? ""} alt="" />
                      </Show>
                    </span>
                    <Show when={attachment.kind === "file"}>
                      <span class="composer-attachment-copy">
                        <strong title={attachment.name}>{attachment.name}</strong>
                        <small>{formatFileSize(attachment.size)}</small>
                      </span>
                    </Show>
                    <ImageRemoveButton
                      label={`Remove ${attachment.name}`}
                      disabled={voicePhase() === "transcribing" || savePending()}
                      onClick={() => removeAttachment(attachment.id)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent?.id}
              agents={props.agents}
              skills={installedSkills()}
              mcpServers={mcpServers()}
              attachments={currentDraft().attachments}
              value={currentDraft().text}
              disabled={
                submitting() || selectionSending() || voicePhase() === "transcribing" || !agentReady() || savePending()
              }
              placeholder={
                !agentReady()
                  ? props.runtime
                    ? props.server?.state === "online"
                      ? "Complete provider setup on your host to start"
                      : "Connect to your host to start"
                    : "Complete agent CLI setup to start"
                  : replyTarget()
                    ? "Reply…"
                    : `Message ${props.agent?.name ?? "agent"}`
              }
              ariaLabel={`Message ${props.agent?.name ?? "agent"}`}
              focusRequest={composerFocusRequest()}
              onValueChange={(text) => {
                updateCurrentDraft({ text });
                updateTeamTyping(text);
              }}
              onSubmit={submitComposer}
              onPickerOpenChange={setPickerOpen}
              onOpenAttachment={(attachment) =>
                canPreviewAttachment(attachment)
                  ? void previewAttachment(attachment)
                  : attachmentAction(attachment, "open")
              }
            />
          </div>
          <div class="composer-toolbar">
            <Input
              ref={setImageAttachmentPickerElement}
              type="file"
              accept={IMAGE_ATTACHMENT_ACCEPT}
              multiple
              hidden
              tabindex={-1}
              data-openbot-attachment-picker={props.runtime ? undefined : "true"}
              onChange={(event) => {
                if (props.runtime?.importFiles)
                  void props.runtime.importFiles(Array.from(event.currentTarget.files ?? []));
              }}
            />
            <Input
              ref={setContextAttachmentPickerElement}
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
            <DropdownMenu.Root
              open={showComposerActions()}
              onOpenChange={setShowComposerActions}
              placement="top-start"
              gutter={8}
              modal={false}
            >
              <DropdownMenu.Trigger
                class="composer-button"
                aria-label="Add to prompt"
                disabled={
                  attachmentBusy() ||
                  submitting() ||
                  selectionSending() ||
                  voicePhase() === "transcribing" ||
                  !agentReady() ||
                  savePending()
                }
              >
                <Plus aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content aria-label="Add to prompt">
                  <DropdownMenu.Item
                    disabled={attachmentBusy()}
                    onPointerDown={(event) => {
                      if (event.button === 0) openAttachmentPicker("images");
                    }}
                    onKeyDown={(event) => openAttachmentPickerFromKey(event, "images")}
                  >
                    <Image aria-hidden="true" />
                    <span>Attach image</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item disabled title="Skill selection is not available yet.">
                    <Puzzle aria-hidden="true" />
                    <span>Use a skill</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={attachmentBusy()}
                    onPointerDown={(event) => {
                      if (event.button === 0) openAttachmentPicker("all");
                    }}
                    onKeyDown={(event) => openAttachmentPickerFromKey(event, "all")}
                  >
                    <File aria-hidden="true" />
                    <span>Add context</span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div class="composer-primary-actions">
              <Show when={attachmentBusy() && props.runtime?.cancelImportFiles} keyed>
                {(cancelImportFiles) => (
                  <Button variant="ghost" type="button" onClick={() => void cancelImportFiles()}>
                    Cancel upload
                  </Button>
                )}
              </Show>
              <Show when={voiceAvailable()}>
                <Show when={voicePhase() === "preparing"}>
                  <span class="voice-model-progress" role="status">
                    Downloading voice model {voiceModelProgress() ?? 0}%
                  </span>
                </Show>
                <Show
                  when={voicePhase() === "recording"}
                  fallback={
                    <Button
                      variant="ghost"
                      type="button"
                      class="dictation-button"
                      aria-label={voiceButtonLabel(voicePhase())}
                      disabled={
                        voicePhase() === "requesting" ||
                        voicePhase() === "preparing" ||
                        voicePhase() === "transcribing" ||
                        (voicePhase() === "idle" && (!props.agent || !agentReady()))
                      }
                      onClick={() => void startVoiceRecording()}
                    >
                      <Show
                        when={
                          voicePhase() === "preparing" ||
                          voicePhase() === "requesting" ||
                          voicePhase() === "transcribing"
                        }
                        fallback={<Mic aria-hidden="true" />}
                      >
                        <LoaderCircle class="composer-spinner" aria-hidden="true" />
                      </Show>
                    </Button>
                  }
                >
                  <fieldset class="voice-recording-status" aria-label="Voice recording">
                    <Button
                      variant="ghost"
                      type="button"
                      class="voice-recording-stop"
                      aria-label="Stop voice recording"
                      onClick={stopVoiceRecording}
                    >
                      <StopIcon />
                    </Button>
                    <time class="voice-recording-duration" datetime={`PT${voiceElapsedSeconds()}S`}>
                      {formatVoiceDuration(voiceElapsedSeconds())}
                    </time>
                    <MoreIcon />
                  </fieldset>
                </Show>
              </Show>
              <Show
                when={
                  props.activeTurnId && !editingDeliveryId() && !composerHasContent() && voicePhase() !== "recording"
                }
                fallback={
                  <Button
                    variant="ghost"
                    type="button"
                    class="voice-button"
                    aria-label={
                      editingDeliveryId()
                        ? "Save queued message"
                        : voicePhase() === "recording"
                          ? "Send voice message"
                          : "Send message"
                    }
                    disabled={
                      attachmentBusy() ||
                      submitting() ||
                      selectionSending() ||
                      !agentReady() ||
                      voicePhase() === "preparing" ||
                      voicePhase() === "requesting" ||
                      voicePhase() === "transcribing"
                    }
                    onClick={submitComposer}
                  >
                    <Show when={submitting()} fallback={<ArrowUp aria-hidden="true" />}>
                      <LoaderCircle class="composer-spinner" aria-hidden="true" />
                    </Show>
                  </Button>
                }
              >
                <Button
                  variant="ghost"
                  type="button"
                  class="voice-button voice-button-active"
                  aria-label="Stop agent"
                  onClick={props.onStop}
                >
                  <StopIcon />
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

const QueuePanel = lazy(() =>
  import("@openbot/ui/features/conversation/QueuePanel").then((module) => ({ default: module.QueuePanel })),
);
