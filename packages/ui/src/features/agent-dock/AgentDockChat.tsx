/**
 * The chat in the agent dock's panel: a header, the recent text messages and a compact composer.
 * Tool steps, plans and other timeline items stay in the main window, which opens from the ⋯ menu.
 * A channel seat shows the same chat, with the author's name over each message from someone else.
 */

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
  X,
} from "@openbot/ui";
import { createMemo, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { TypingDots } from "../../components/TypingDots";
import type { AgentMessage, ComposerAgent } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { ComposerEditor } from "../conversation/ComposerEditor";
import { MarkdownMessageText } from "../conversation/MarkdownMessageText";
import { ComposerVoiceControls, type VoicePhase } from "../conversation/VoiceRecordingMorph";
import { SidebarWaitIcon } from "../sidebar/SidebarAgentIndicator";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_TITLE } from "../sidebar/sidebar-filtering";
import type { SidebarWaitReason } from "../sidebar/sidebar-types";
import type { AgentDockSeat } from "./AgentDock";

/** The panel shows the newest messages only; the main window has the full history. */
const VISIBLE_MESSAGES = 60;
/** Closer than this to the end, a new message scrolls the log down. */
const STICK_TO_END_PX = 80;
/** The space between the scroll thumb and the top and bottom of the log. */
const THUMB_INSET_PX = 6;
/** The shortest scroll thumb, so that a long log keeps a thumb that the eye finds. */
const THUMB_MIN_PX = 24;
/** How long the scroll thumb stays after the last scroll when the pointer is not on the log. */
const THUMB_HIDE_MS = 900;
/** How long after the reader's wheel, touch or pointer input a scroll counts as theirs. */
const SCROLL_INPUT_MS = 1000;

export interface AgentDockChatModel {
  /** The loaded messages of the agent or channel, oldest first. The panel shows the text ones. */
  messages: readonly AgentMessage[];
  /** True while the agent works on a turn. */
  working: boolean;
  /** Set while the agent waits for the user. The user answers in the main window. */
  wait: SidebarWaitReason | null;
}

/** A message the user sent from the panel, until the host's copy is in `messages`. */
export interface AgentDockPendingMessage {
  key: number;
  text: string;
  messageId: string | null;
  /** The last message of the chat when the user sent it: the host's copy comes after it. */
  after: string | null;
}

/** The microphone of one chat in the panel. */
export interface AgentDockChatVoice {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The words the recording heard so far. */
  liveText: string;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  /** Another chat records or transcribes, so this microphone cannot start. */
  blocked: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** Stops the recording. The words go into the draft. */
  onFinish: () => void;
  /** Stops the recording and sends the draft with the words. */
  onSend: () => void;
}

/** The messages that the panel shows: the text of the people and of the agents. */
export function isDockMessage(message: AgentMessage): boolean {
  if (message.author !== "you" && message.author !== "agent") return false;
  if (message.kind !== undefined && message.kind !== "text" && message.kind !== "error") return false;
  return message.body.trim().length > 0;
}

/** A message of the reader. In a channel, a message of another person carries its author. */
function isOwn(message: AgentMessage): boolean {
  return message.author === "you" && !message.senderMember;
}

/**
 * True when the host's copy of a pending message has arrived. An earlier message with the same text is
 * not the copy. When the mark is no longer in the list, all the messages are later.
 */
function delivered(pending: AgentDockPendingMessage, messages: readonly AgentMessage[]): boolean {
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
  onRemove: () => void;
  onOpenInMain: () => void;
  /** The ⋯ menu shows "Open in new window" only when it is set. */
  onOpenWindow?: (() => void) | undefined;
  /** The composer shows a microphone only when it is set. */
  voice?: AgentDockChatVoice | undefined;
  /** The agents that mentions in the messages and the composer name. */
  agents: ComposerAgent[];
  onSelectAgent?: ((agentId: string) => void) | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  const { t } = useText();
  let log: HTMLDivElement | undefined;
  /* An edge with more messages behind it fades out. */
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const messages = createMemo(() => props.chat.messages.filter(isDockMessage).slice(-VISIBLE_MESSAGES));
  const pending = createMemo(() => props.pending.filter((message) => !delivered(message, props.chat.messages)));
  const agentSeat = () => (props.seat.kind === "agent" ? props.seat : undefined);
  const channel = () => (props.seat.kind === "channel" ? props.seat.channel : undefined);
  const name = () => (props.seat.kind === "agent" ? props.seat.agent.name : props.seat.channel.name);
  const subtitle = () => {
    if (props.chat.wait) return t(SIDEBAR_WAIT_TITLE[props.chat.wait]);
    if (props.chat.working) return t("agent.dock.working");
    return props.seat.kind === "agent" ? props.seat.agent.title : props.seat.channel.title;
  };
  /** The author shown over a message in a channel. The reader's own messages have no name. */
  const author = (message: AgentMessage): string | undefined => {
    if (!channel() || isOwn(message)) return undefined;
    if (message.senderMember) return message.senderMember.name;
    return props.agents.find((agent) => agent.id === message.senderAgentId)?.name;
  };
  const waitReason = () => props.chat.wait;
  const voicePhase = (): VoicePhase => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  const transcribing = () => voicePhase() === "transcribing";
  /** A send while the microphone records sends the draft with the words. */
  function submit(): void {
    if (recording()) props.voice?.onSend();
    else if (!transcribing()) props.onSend();
  }

  /* The log holds its end while the reader is there: when the chat opens, when a message comes, while
     an answer streams in and when the typing dots show. A scroll up lets go; a scroll back down to the
     end holds again. Growth of the content, not a change of the data, moves the log, because Markdown
     and chips reach their full height after the data changes. */
  let thumb: HTMLDivElement | undefined;
  let holdEnd = true;
  let lastTop = 0;
  /**
   * When the reader last used the wheel, a touch or the pointer on the log. Only a scroll soon after
   * shows the thumb: content that loads late also moves the position, and that is not the reader.
   */
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
              <DropdownMenu.Item onSelectAfterClose={() => props.onRemove()}>
                <PanelRight aria-hidden="true" />
                {t("agent.dock.remove")}
              </DropdownMenu.Item>
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
                {(message) => (
                  <Bubble
                    align={isOwn(message) ? "end" : "start"}
                    variant={isOwn(message) ? "secondary" : "muted"}
                    class="agent-dock-bubble"
                    data-error={message.kind === "error" ? "" : undefined}
                  >
                    <BubbleContent>
                      <Show when={author(message)}>{(shown) => <span class="agent-dock-author">{shown()}</span>}</Show>
                      {/* Markdown with mention chips, as in the main chat. */}
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
                )}
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
        {/* Where the reader is in the log. It shows while the reader scrolls or points at the log. */}
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

      <form
        class="composer agent-dock-composer"
        data-compact=""
        onSubmit={(event: SubmitEvent) => {
          event.preventDefault();
          submit();
        }}
      >
        <div class="composer-input-label">
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
                send={sendButton()}
              />
            )}
          </Show>
        </div>
      </form>
    </div>
  );
}
