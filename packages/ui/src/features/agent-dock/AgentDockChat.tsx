import type {
  AgentApproval,
  AgentDockBackupModel,
  AgentDockPrompt,
  AgentDockTakeover,
  AgentDockUsageLimit,
  BrowserTab,
  LocalBrowserSecretResponse,
} from "@openbot/contracts/ipc";
import {
  AppWindow,
  ArrowUp,
  Bubble,
  BubbleContent,
  Button,
  DropdownMenu,
  Ellipsis,
  IconButton,
  Maximize2,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  X,
} from "@openbot/ui";
import { createMemo, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { QuestionPromptBubble } from "../../components/QuestionPromptBubble";
import { TypingDots } from "../../components/TypingDots";
import type { AgentMessage, ComposerAgent } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { chatBubbleColor } from "../conversation/BackdropBubbles";
import { UsageLimitAskCard } from "../conversation/BackupModels";
import { ComposerEditor } from "../conversation/ComposerEditor";
import { ApprovalCard, BrowserTakeoverCard } from "../conversation/ConversationPrompts";
import { createComposerRowsResize } from "../conversation/createComposerRowsResize";
import { MarkdownMessageText } from "../conversation/MarkdownMessageText";
import { ComposerVoiceControls, type VoicePhase } from "../conversation/VoiceRecordingMorph";
import { SidebarWaitIcon } from "../sidebar/SidebarAgentIndicator";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_TITLE } from "../sidebar/sidebar-filtering";
import type { SidebarWaitReason } from "../sidebar/sidebar-types";
import type { AgentDockSeat } from "./AgentDock";

const VISIBLE_MESSAGES = 60;
const STICK_TO_END_PX = 80;
const THUMB_INSET_PX = 6;
const THUMB_MIN_PX = 24;
const THUMB_HIDE_MS = 900;
const SCROLL_INPUT_MS = 1000;

export interface AgentDockChatModel {
  messages: readonly AgentMessage[];
  working: boolean;
  wait: SidebarWaitReason | null;
  approval?: { approval: AgentApproval; attempt: number } | null | undefined;
  prompt?: AgentDockPrompt | null | undefined;
  takeover?: AgentDockTakeover | null | undefined;
  usageLimit?: AgentDockUsageLimit | null | undefined;
}

export interface AgentDockChatAnswers {
  approval: (approval: AgentApproval, decision: "accept" | "decline") => Promise<boolean>;
  prompt: (prompt: AgentDockPrompt, answers: Record<string, string[]>) => Promise<boolean>;
  takeover: (takeover: AgentDockTakeover, decision: "complete" | "cancel") => Promise<boolean>;
  takeoverDone?: ((takeover: AgentDockTakeover) => boolean) | undefined;
  secret: (takeover: AgentDockTakeover, input: LocalBrowserSecretResponse) => Promise<void>;
  usageLimitSend: (limit: AgentDockUsageLimit, option: AgentDockBackupModel, remember: boolean) => Promise<void>;
  usageLimitWait: (limit: AgentDockUsageLimit) => void;
}

export interface AgentDockPendingMessage {
  key: number;
  text: string;
  messageId: string | null;
  after: string | null;
}

export interface AgentDockChatVoice {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  liveText: string;
  modelProgress: number | null;
  blocked: boolean;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  onSend: () => void;
}

export function isDockMessage(message: AgentMessage): boolean {
  if (message.author !== "you" && message.author !== "agent") return false;
  if (message.kind !== undefined && message.kind !== "text" && message.kind !== "error") return false;
  return message.body.trim().length > 0;
}

function isOwn(message: AgentMessage): boolean {
  return message.author === "you" && !message.senderMember;
}

export function pendingMessageDelivered(pending: AgentDockPendingMessage, messages: readonly AgentMessage[]): boolean {
  if (pending.messageId !== null && messages.some((message) => message.id === pending.messageId)) return true;
  const start = pending.after === null ? 0 : messages.findIndex((message) => message.id === pending.after) + 1;
  return messages.slice(start).some((message) => isOwn(message) && message.body.trim() === pending.text);
}

export function AgentDockChat(props: {
  seat: AgentDockSeat;
  chat: AgentDockChatModel;
  draft: string;
  pending: readonly AgentDockPendingMessage[];
  error: string | null;
  sending: boolean;
  focusRequest: number;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  pinned?: boolean | undefined;
  onPinChange?: ((pinned: boolean) => void) | undefined;
  onRemove: () => void;
  onAdd: () => void;
  onOpenInMain: () => void;
  onOpenWindow?: (() => void) | undefined;
  voice?: AgentDockChatVoice | undefined;
  agents: ComposerAgent[];
  onSelectAgent?: ((agentId: string) => void) | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
  answers?: AgentDockChatAnswers | undefined;
}) {
  const { t } = useText();
  let log: HTMLDivElement | undefined;
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const messages = createMemo(() => props.chat.messages.filter(isDockMessage).slice(-VISIBLE_MESSAGES));
  const pending = createMemo(() =>
    props.pending.filter((message) => !pendingMessageDelivered(message, props.chat.messages)),
  );
  const agentSeat = () => (props.seat.kind === "agent" ? props.seat : undefined);
  const channel = () => (props.seat.kind === "channel" ? props.seat.channel : undefined);
  const name = () => (props.seat.kind === "agent" ? props.seat.agent.name : props.seat.channel.name);
  const subtitle = () => {
    if (props.chat.wait) return t(SIDEBAR_WAIT_TITLE[props.chat.wait]);
    if (props.chat.working) return t("agent.dock.working");
    return props.seat.kind === "agent" ? props.seat.agent.title : props.seat.channel.title;
  };
  const author = (message: AgentMessage): string | undefined => {
    if (!channel() || isOwn(message)) return undefined;
    if (message.senderMember) return message.senderMember.name;
    return props.agents.find((agent) => agent.id === message.senderAgentId)?.name;
  };
  const agentTint = (message: AgentMessage) => {
    if (message.author !== "agent" || message.kind === "error") return undefined;
    const seated = agentSeat()?.agent;
    const senderId = message.exchange?.senderAgentId ?? message.senderAgentId;
    const agent =
      senderId === undefined || senderId === seated?.id
        ? seated
        : props.agents.find((candidate) => candidate.id === senderId);
    return chatBubbleColor(null, { kind: "agent", agent });
  };
  const approval = () => (props.answers ? (props.chat.approval ?? undefined) : undefined);
  const approvalKey = () => {
    const current = approval();
    return current ? `${current.approval.agentId}:${current.approval.requestId}:${current.attempt}` : undefined;
  };
  const prompt = () => (props.answers ? (props.chat.prompt ?? undefined) : undefined);
  const promptKey = () => {
    const current = prompt();
    return current ? `${current.agentId}:${current.requestId}:${current.attempt}` : undefined;
  };
  const takeover = () => (props.answers ? (props.chat.takeover ?? undefined) : undefined);
  const takeoverKey = () => {
    const current = takeover();
    return current ? `${current.request.agentId}:${current.request.requestId}:${current.attempt}` : undefined;
  };
  const usageLimit = () => (props.answers ? (props.chat.usageLimit ?? undefined) : undefined);
  const usageLimitKey = () => {
    const current = usageLimit();
    return current ? `${current.agentId}:${current.resetsAt ?? ""}:${current.attempt}` : undefined;
  };
  const answering = () => Boolean(approval() || prompt() || takeover() || usageLimit());
  const waitReason = () => (answering() ? null : props.chat.wait);
  const voicePhase = (): VoicePhase => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  const transcribing = () => voicePhase() === "transcribing";
  const respond = (current: AgentApproval, decision: "accept" | "decline") =>
    props.answers ? props.answers.approval(current, decision) : Promise.resolve(false);
  const answerPrompt = (current: AgentDockPrompt, answers: Record<string, string[]>) =>
    props.answers ? props.answers.prompt(current, answers) : Promise.resolve(false);
  const respondTakeover = (current: AgentDockTakeover, decision: "complete" | "cancel") =>
    props.answers ? props.answers.takeover(current, decision) : Promise.resolve(false);
  const takeoverTab = (current: AgentDockTakeover): BrowserTab | undefined => {
    const page = current.page;
    if (!page) return undefined;
    return {
      id: current.request.tabId,
      title: page.title,
      url: page.origin,
      loading: false,
      ownerThreadId: null,
      ownerAgentId: null,
    };
  };
  const takeoverSecret = (current: AgentDockTakeover) => ({
    vault: current.vault ?? undefined,
    onRespond: (input: LocalBrowserSecretResponse) =>
      props.answers ? props.answers.secret(current, input) : Promise.resolve(),
  });
  const sendOnBackup = (current: AgentDockUsageLimit, option: AgentDockBackupModel, remember: boolean) =>
    props.answers ? props.answers.usageLimitSend(current, option, remember) : Promise.resolve();
  const usageLimitModel = (current: AgentDockUsageLimit) => current.model ?? undefined;
  const usageLimitAgent = (current: AgentDockUsageLimit) => current.agentName ?? undefined;
  function submit(): void {
    if (recording()) props.voice?.onSend();
    else if (!transcribing()) props.onSend();
  }

  let thumb: HTMLDivElement | undefined;
  let holdEnd = true;
  let lastTop = 0;
  let inputAt = Number.NEGATIVE_INFINITY;
  let pointerIn = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function keepAtEnd(): void {
    if (!log || !holdEnd) return;
    const end = log.scrollHeight - log.clientHeight;
    if (Math.abs(log.scrollTop - end) < 1) return;
    log.scrollTop = end;
  }

  function placeThumb(): void {
    if (!log || !thumb) return;
    const range = log.scrollHeight - log.clientHeight;
    thumb.toggleAttribute("data-scrollable", range > 1);
    if (range <= 1) return;
    const track = log.clientHeight - 2 * THUMB_INSET_PX;
    const size = Math.max(THUMB_MIN_PX, (track * log.clientHeight) / log.scrollHeight);
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${THUMB_INSET_PX + ((track - size) * log.scrollTop) / range}px)`;
  }

  function showThumb(): void {
    if (!thumb) return;
    clearTimeout(hideTimer);
    thumb.setAttribute("data-shown", "");
    if (!pointerIn) hideTimer = setTimeout(hideThumb, THUMB_HIDE_MS);
  }

  function hideThumb(): void {
    thumb?.removeAttribute("data-shown");
  }

  function markInput(): void {
    inputAt = performance.now();
  }

  function onLogScroll(): void {
    if (!log) return;
    const top = log.scrollTop;
    const atEnd = log.scrollHeight - top - log.clientHeight < STICK_TO_END_PX;
    if (atEnd) holdEnd = true;
    else if (top < lastTop) holdEnd = false;
    lastTop = top;
    fades.measure();
    placeThumb();
    if (performance.now() - inputAt < SCROLL_INPUT_MS) showThumb();
  }

  function sendButton() {
    const label = () => (recording() ? t("composer.send.voice") : t("agent.dock.send"));
    return (
      <Button
        type="submit"
        variant="ghost"
        class="voice-button"
        aria-label={label()}
        title={label()}
        disabled={!recording() && (props.sending || transcribing() || !props.draft.trim())}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
    );
  }

  const sizes = new ResizeObserver(() => {
    keepAtEnd();
    fades.measure();
    placeThumb();
  });
  const draftRows = createComposerRowsResize(() =>
    props.seat.kind === "agent" ? props.seat.agent.id : props.seat.channel.id,
  );
  onCleanup(() => {
    sizes.disconnect();
    clearTimeout(hideTimer);
  });

  return (
    <div class="agent-dock-chat">
      <header class="agent-dock-chat-header">
        <Show
          when={channel()}
          fallback={
            <Show when={agentSeat()}>
              {(seat) => (
                <AgentAvatar agent={seat().agent} motion="idle" mood={seat().mood} class="agent-dock-chat-avatar" />
              )}
            </Show>
          }
        >
          {(shown) => (
            <span class="agent-dock-chat-channel">
              <ChannelAvatar
                members={shown().members}
                agents={props.agents}
                layout="cluster"
                icon={shown().icon}
                imageUrl={shown().imageUrl}
              />
            </span>
          )}
        </Show>
        <div class="agent-dock-chat-title">
          <strong>{name()}</strong>
          <span>{subtitle()}</span>
        </div>
        <Show when={props.onPinChange}>
          {(change) => (
            <IconButton
              label={props.pinned ? t("agent.dock.closeOnLeave") : t("agent.dock.keepOpen")}
              variant="ghost"
              class="agent-dock-icon"
              onClick={() => change()(!props.pinned)}
            >
              <Show when={props.pinned} fallback={<Pin aria-hidden="true" />}>
                <PinOff aria-hidden="true" />
              </Show>
            </IconButton>
          )}
        </Show>
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger class="agent-dock-icon" aria-label={t("agent.dock.more")}>
            <Ellipsis aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelectAfterClose={() => props.onOpenInMain()}>
                <Maximize2 aria-hidden="true" />
                {t("agent.dock.openInMain")}
              </DropdownMenu.Item>
              <Show when={props.onOpenWindow}>
                {(open) => (
                  <DropdownMenu.Item onSelectAfterClose={() => open()()}>
                    <AppWindow aria-hidden="true" />
                    {t("agent.dock.openWindow")}
                  </DropdownMenu.Item>
                )}
              </Show>
              <DropdownMenu.Separator />
              <Show
                when={props.seat.temporary}
                fallback={
                  <DropdownMenu.Item onSelectAfterClose={() => props.onRemove()}>
                    <PanelRight aria-hidden="true" />
                    {t("agent.dock.remove")}
                  </DropdownMenu.Item>
                }
              >
                <DropdownMenu.Item onSelectAfterClose={() => props.onAdd()}>
                  <Plus aria-hidden="true" />
                  {t("agent.dock.add")}
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <IconButton label={t("common.close")} variant="ghost" class="agent-dock-icon" onClick={() => props.onClose()}>
          <X aria-hidden="true" />
        </IconButton>
      </header>

      <div
        class="agent-dock-log"
        onPointerEnter={() => {
          pointerIn = true;
          showThumb();
        }}
        onPointerLeave={() => {
          pointerIn = false;
          showThumb();
        }}
      >
        <div
          ref={(element) => {
            log = element;
            fades.bind(element);
            sizes.observe(element);
          }}
          class={["agent-dock-messages", fades.classes()]}
          role="log"
          aria-live="polite"
          onScroll={onLogScroll}
          onWheel={markInput}
          onPointerDown={markInput}
          onTouchStart={markInput}
        >
          <div class="agent-dock-messages-content" ref={(element) => sizes.observe(element)}>
            <Show
              when={messages().length > 0 || pending().length > 0}
              fallback={<p class="agent-dock-empty">{t("agent.dock.empty", { name: name() })}</p>}
            >
              <For each={messages()}>
                {(message) => {
                  const tint = createMemo(() => agentTint(message));
                  return (
                    <Bubble
                      align={isOwn(message) ? "end" : "start"}
                      variant={isOwn(message) ? "secondary" : "muted"}
                      class={["agent-dock-bubble", { "message-bubble-colored": tint() !== undefined }]}
                      style={tint() === undefined ? undefined : `--message-chat-color: ${tint()}`}
                      data-error={message.kind === "error" ? "" : undefined}
                    >
                      <BubbleContent>
                        <Show when={author(message)}>
                          {(shown) => <span class="agent-dock-author">{shown()}</span>}
                        </Show>
                        <div class="agent-dock-markdown message-markdown">
                          <MarkdownMessageText
                            body={message.body}
                            agents={props.agents}
                            attachments={message.attachments}
                            onSelectAgent={(agentId) => props.onSelectAgent?.(agentId)}
                            onOpenAttachment={() => props.onOpenInMain()}
                            onOpenLink={(url) => props.onOpenLink?.(url)}
                          />
                        </div>
                      </BubbleContent>
                    </Bubble>
                  );
                }}
              </For>
              <For each={pending()}>
                {(message) => (
                  <Bubble align="end" variant="secondary" class="agent-dock-bubble" data-pending="">
                    <BubbleContent>
                      <p class="agent-dock-text">{message.text}</p>
                    </BubbleContent>
                  </Bubble>
                )}
              </For>
            </Show>
            <Show when={usageLimitKey()} keyed>
              {(_key) => (
                <Show when={usageLimit()}>
                  {(current) => (
                    <div class="agent-dock-card">
                      <UsageLimitAskCard
                        provider={current().provider}
                        model={usageLimitModel(current())}
                        agentName={usageLimitAgent(current())}
                        resetsAt={current().resetsAt}
                        options={current().options}
                        rememberable={current().rememberable}
                        onSend={(option, remember) => sendOnBackup(current(), option, remember)}
                        onWait={() => props.answers?.usageLimitWait(current())}
                      />
                    </div>
                  )}
                </Show>
              )}
            </Show>
            <Show when={takeoverKey()} keyed>
              {(_key) => (
                <Show when={takeover()}>
                  {(current) => (
                    <div class="agent-dock-card">
                      <BrowserTakeoverCard
                        request={current().request}
                        agentName={current().agentName}
                        tab={takeoverTab(current())}
                        preview={null}
                        previewStatus="idle"
                        onOpen={() => props.onOpenInMain()}
                        onComplete={
                          props.answers?.takeoverDone?.(current()) === false
                            ? undefined
                            : () => respondTakeover(current(), "complete")
                        }
                        onCancel={() => respondTakeover(current(), "cancel")}
                        browserSecret={takeoverSecret(current())}
                      />
                    </div>
                  )}
                </Show>
              )}
            </Show>
            <Show when={promptKey()} keyed>
              {(_key) => (
                <Show when={prompt()}>
                  {(current) => (
                    <div class="agent-dock-card">
                      <QuestionPromptBubble
                        questions={current().questions}
                        onSubmit={(answers) => answerPrompt(current(), answers)}
                        onOpenLink={(url) => props.onOpenLink?.(url)}
                      />
                    </div>
                  )}
                </Show>
              )}
            </Show>
            <Show when={approvalKey()} keyed>
              {(_key) => (
                <Show when={approval()}>
                  {(current) => (
                    <div class="agent-dock-card">
                      <ApprovalCard
                        approval={current().approval}
                        onApprove={() => respond(current().approval, "accept")}
                        onReject={() => respond(current().approval, "decline")}
                      />
                    </div>
                  )}
                </Show>
              )}
            </Show>
            <Show when={props.chat.working && !props.chat.wait}>
              <Bubble align="start" variant="muted" class="agent-dock-bubble">
                <BubbleContent>
                  <span class="agent-dock-typing" role="status">
                    <TypingDots class="agent-dock-typing-dots" />
                    <span class="agent-dock-sr">
                      {channel() ? t("agent.dock.working") : t("agent.dock.writing", { name: name() })}
                    </span>
                  </span>
                </BubbleContent>
              </Bubble>
            </Show>
          </div>
        </div>
        <div class="agent-dock-scroll-thumb" aria-hidden="true" ref={(element) => (thumb = element)} />
      </div>

      <Show when={waitReason()}>
        {(reason) => (
          <div class="agent-dock-wait" role="status">
            <span class="agent-dock-wait-icon">
              <SidebarWaitIcon reason={reason()} />
            </span>
            <span class="agent-dock-wait-title">{t(SIDEBAR_WAIT_TITLE[reason()])}</span>
            <Button variant="secondary" size="sm" onClick={() => props.onOpenInMain()}>
              {t(SIDEBAR_WAIT_ACTION[reason()])}
            </Button>
          </div>
        )}
      </Show>

      <Show when={props.error}>{(error) => <p class="agent-dock-error">{error()}</p>}</Show>

      <div class="composer-wrap agent-dock-composer-wrap">
        <form
          ref={draftRows.form}
          class="composer agent-dock-composer"
          data-compact=""
          data-small=""
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault();
            submit();
          }}
        >
          <div class="composer-input-label" ref={draftRows.label}>
            <ComposerEditor
              agentId={undefined}
              agents={props.agents}
              value={props.draft}
              placeholder={t("composer.placeholder.message", { name: name() })}
              ariaLabel={t("composer.placeholder.message", { name: name() })}
              disabled={transcribing()}
              focusRequest={props.focusRequest}
              dictation={{ text: props.voice?.liveText ?? "", final: transcribing() }}
              onValueChange={(value) => props.onDraftChange(value)}
              onSubmit={submit}
            />
          </div>
          <div class="composer-primary-actions">
            <Show when={props.voice} fallback={sendButton()}>
              {(voice) => (
                <ComposerVoiceControls
                  phase={voice().phase}
                  levels={voice().levels}
                  elapsedSeconds={voice().elapsedSeconds}
                  modelProgress={voice().modelProgress}
                  blocked={voice().blocked}
                  onStart={() => voice().onStart()}
                  onCancel={() => voice().onCancel()}
                  onFinish={() => voice().onFinish()}
                  onSend={submit}
                  send={sendButton()}
                />
              )}
            </Show>
          </div>
        </form>
      </div>
    </div>
  );
}
