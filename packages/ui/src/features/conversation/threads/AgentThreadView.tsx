import type {
  AgentApproval,
  AgentTask,
  AgentTaskHold,
  AttachmentSummary,
  DraftAttachment,
  InstalledSkill,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentMessage, AgentProfile, ComposerMcpServer } from "@openbot/ui/data";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import {
  type AgentStep,
  AgentStepsDisclosure,
  type AgentStepsFacts,
} from "@openbot/ui/features/conversation/AgentSteps";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerAddMenu } from "@openbot/ui/features/conversation/ComposerAddMenu";
import {
  ComposerEditor,
  type ComposerPasteResult,
  type ComposerSelection,
} from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ComposerSendControl } from "@openbot/ui/features/conversation/ComposerSendControl";
import { ContextUsageMeter, type ContextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { ComposerVoiceControls, type VoicePhase } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { type TextValue, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { children, createEffect, createSignal, For, onSettled, Show, untrack } from "solid-js";

const HOLD_TEXT = {
  "agent-restarting": "conversation.threads.hold.agentRestarting",
  "usage-limit": "conversation.threads.hold.usageLimit",
  "server-busy": "conversation.threads.hold.serverBusy",
  "agent-busy": "conversation.threads.hold.agentBusy",
  "one-turn": "conversation.threads.hold.oneTurn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, AppTextKey>;

/** The list stays at its end while new text comes in, when the user has not scrolled up. */
const STICK_DISTANCE = 48;

/**
 * Whether the thread shows this message as a row. A stopped turn can leave an agent message with no
 * text and nothing else in it. The thinking and the memory changes of a turn show in its steps.
 */
function shownInThread(message: AgentMessage): boolean {
  if (message.kind === "thinking" || message.kind === "memory-changes") return false;
  return (
    message.author === "you" ||
    message.streaming === true ||
    message.body.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    message.imageGeneration !== undefined ||
    message.questionPrompt !== undefined ||
    message.plan !== undefined ||
    message.actionMarker !== undefined
  );
}

/** Why the next message of a queued thread waits. */
export function agentThreadHoldText(task: AgentTask, limit: number, t: TextValue["t"]): string | null {
  if (task.state !== "queued") return null;
  if (task.hold === "task-limit" || task.hold === null)
    return t("conversation.threads.hold.threadLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}

/** Dictation into the thread's message box, as in the agent's own chat. */
export interface AgentThreadVoice {
  /** The phase of this thread's recording; "idle" when it has none. */
  phase: VoicePhase;
  /** Another message box records, so this one cannot start. */
  blocked: boolean;
  /** What was said so far. */
  liveText: string;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** Stops the recording and sends the message with its text. */
  onSend: () => void;
}

export interface AgentThreadViewProps {
  /** Null for a new thread: its first message starts it. */
  task: AgentTask | null;
  /** How many threads of the agent can run at the same time. */
  limit: number;
  agent: AgentProfile;
  agents: AgentProfile[];
  messages: readonly AgentMessage[];
  /** The agent's skills, for the `$` picker and the skill tags in messages. */
  skills?: InstalledSkill[] | undefined;
  /** The last skill list request failed, so an empty picker says so instead of "no skills". */
  skillsLoadFailed?: boolean | undefined;
  /** The host's MCP servers, offered by the same `$` the skills answer. */
  mcpServers?: ComposerMcpServer[] | undefined;
  /** The unsent text of this thread's message box. The host keeps it for each thread. */
  draft: string;
  /** The files that the draft names. */
  draftAttachments?: DraftAttachment[] | undefined;
  onDraftChange: (text: string) => void;
  /** Receives pasted files. Without it, a file paste does nothing here. */
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onOpenDraftAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  /** Opens the file picker. Without it, the "+" menu has no image or context item. */
  onAttachFiles?: (() => void) | undefined;
  /** Opens the agent's side question with the draft. Without it, the "+" menu has no side question. */
  onSideQuestion?: (() => void) | undefined;
  /** Without it, the message box has no microphone. */
  voice?: AgentThreadVoice | undefined;
  /** Each increase moves the caret to the end of the text, as after a dictation. */
  focusRequest?: number | undefined;
  /** Sends a message. The host clears the text when the message went; when it did not, the text stays. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** The window draws the macOS window controls over the top start corner. The image viewer leaves room. */
  macWindowControls?: boolean | undefined;
  /** The approval that the thread's running turn waits for. */
  approval?: AgentApproval | undefined;
  onRespondApproval: (decision: "accept" | "decline") => Promise<boolean>;
  /** How full the thread's context is, when its provider reported it. */
  context?: ContextUsageView | undefined;
  /** Compacts the thread's context now. Missing when the host cannot. */
  onCompactContext?: (() => Promise<void>) | undefined;
  /** Whether the thread's running turn waits for the person: a question or a browser takeover. */
  waitsForAnswer?: boolean | undefined;
  /** Another card that the thread shows, such as a question or a browser takeover. The app builds it. */
  attention?: JSX.Element | undefined;
  /** The steps of the finished turn above an answer, or undefined for a message that has none. */
  stepsAbove?: ((messageId: string) => AgentStep[] | undefined) | undefined;
  /** The time that the turn of an answer took, and how many of its steps failed. */
  factsAbove?: ((messageId: string) => AgentStepsFacts | undefined) | undefined;
  /** The steps of the running turn, for its activity row. */
  activeSteps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open at first. */
  stepsOpenByDefault?: boolean | undefined;
  /** Receives the message list, where the app searches the thread. */
  scrollRef?: ((element: HTMLElement) => void) | undefined;
  /** The user's send shortcut. Enter when absent. */
  sendShortcut?: SendShortcut | undefined;
}

/**
 * A side thread of an agent, in the place of its chat: the messages, why the thread waits, and a
 * message box. While a turn runs, a message waits in the thread, or steers the turn as the
 * busy-message mode says.
 */
export function AgentThreadView(props: AgentThreadViewProps) {
  const { t } = useText();
  // Resolved once, so the card is built one time for the check and the row.
  const attention = children(() => props.attention);
  const [sending, setSending] = createSignal(false);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [skillPickerRequest, setSkillPickerRequest] = createSignal(0);
  let scroller: HTMLElement | undefined;
  let atEnd = true;
  let shownTaskId = untrack(() => props.task?.id);
  const activityLabel = nextAgentActivityLabel();
  const fades = createScrollFades();
  // The view stays when another thread opens in its place, so each thread opens at its latest message.
  // The effect can run again with the same thread, which must not move the reader.
  createEffect(
    () => props.task?.id,
    (taskId) => {
      if (taskId === shownTaskId) return;
      shownTaskId = taskId;
      atEnd = true;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  );
  onSettled(() => {
    const element = scroller;
    const list = element?.firstElementChild;
    if (!element || !list) return fades.stop;
    const onScroll = () => {
      atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_DISTANCE;
    };
    const follow = new ResizeObserver(() => {
      if (atEnd) element.scrollTop = element.scrollHeight;
    });
    follow.observe(list);
    element.scrollTop = element.scrollHeight;
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      follow.disconnect();
      element.removeEventListener("scroll", onScroll);
      fades.stop();
    };
  });
  const active = () => (props.task ? isAgentTaskActive(props.task) : false);
  const title = () => props.task?.title ?? t("conversation.threads.new");
  const placeholder = () =>
    props.task
      ? t("conversation.threads.view.placeholder", { name: props.agent.name, title: props.task.title })
      : t("conversation.threads.view.newPlaceholder", { name: props.agent.name });
  const voicePhase = () => props.voice?.phase ?? "idle";
  const recording = () => voicePhase() === "recording";
  /** As in the agent's own chat, nothing sends while the microphone opens or the speech becomes text. */
  const voiceBusy = () => voicePhase() !== "idle" && !recording();
  const send = async () => {
    // As in the agent's own chat, a send while recording sends what was said.
    if (recording()) {
      props.voice?.onSend();
      return;
    }
    const text = props.draft.trim();
    if (!text || sending() || voiceBusy()) return;
    setSending(true);
    try {
      await props.onSend(text);
    } finally {
      setSending(false);
    }
  };
  // An answer from another agent to a request of this thread shows with the name of that agent.
  const author = (message: AgentMessage): ChatMessageAuthor => {
    if (message.author === "you") return { kind: "you", name: t("chat.message.you") };
    const senderId = message.senderAgentId;
    if (senderId === undefined || senderId === props.agent.id)
      return { kind: "agent", name: props.agent.name, agent: props.agent };
    const sender = props.agents.find((candidate) => candidate.id === senderId);
    return {
      kind: "agent",
      name: sender?.name ?? t("chat.message.agentFallback"),
      agent: sender,
      avatarSeed: senderId,
    };
  };
  const failed = () => (props.task?.state === "idle" && props.task.outcome === "failed" ? props.task : undefined);
  const running = () =>
    props.task?.state === "running" && !props.approval && !props.waitsForAnswer ? props.task : undefined;
  const queued = () => (props.task && props.task.queuedMessages.length > 0 ? props.task : undefined);
  const hold = () => (props.task ? agentThreadHoldText(props.task, props.limit, t) : null);
  const sendLabel = () => t(recording() ? "composer.send.voice" : "composer.send.message");
  const draftEmpty = () => props.draft.trim().length === 0;
  /** As in the agent's own chat: Send, Send what was said while a recording runs, or Stop while the thread works. */
  const sendButton = () => (
    <ComposerSendControl
      stop={active() && draftEmpty() && !recording()}
      onStop={() => props.onStop()}
      label={sendLabel()}
      disabled={sending() || voiceBusy() || (!recording() && draftEmpty())}
      busy={sending()}
    />
  );
  return (
    <>
      <section
        ref={(element: HTMLElement) => {
          scroller = element;
          fades.bind(element);
          props.scrollRef?.(element);
        }}
        class={["conversation-scroll agent-thread-scroll", fades.classes()]}
        aria-label={t("conversation.threads.view.label", { title: title() })}
        onScroll={fades.measure}
      >
        <div class="virtual-chat-list virtual-chat-list-static" ref={fades.watch}>
          <Show when={props.task?.origin === "agent"}>
            <p class="agent-thread-origin">
              {t("conversation.threads.view.startedByAgent", { name: props.agent.name })}
            </p>
          </Show>
          <For each={props.messages.filter(shownInThread)} keyed={(message) => message.id}>
            {(message) => (
              <div class="virtual-chat-row">
                <Show when={props.stepsAbove?.(message().id)}>
                  {(steps) => (
                    <AgentStepsDisclosure
                      steps={steps()}
                      defaultOpen={props.stepsOpenByDefault ?? false}
                      facts={props.factsAbove?.(message().id)}
                    />
                  )}
                </Show>
                <ChatMessageRow
                  message={message()}
                  author={author(message())}
                  agents={props.agents}
                  skills={props.skills}
                  onSelectAgent={() => undefined}
                  onOpenLink={props.onOpenLink}
                  onPreview={props.onPreview}
                  onAttachmentAction={props.onAttachmentAction}
                  onDownload={(attachment) => props.onAttachmentAction(attachment, "download")}
                  macWindowControls={props.macWindowControls}
                  data-chat-search-message={message().id}
                />
              </div>
            )}
          </For>
          <Show when={running()}>
            {(task) => (
              <div class="virtual-chat-row">
                <AgentActivityIndicator
                  agent={props.agent}
                  label={activityLabel}
                  detail={task().progress}
                  steps={props.activeSteps}
                  stepsOpenByDefault={props.stepsOpenByDefault}
                />
              </div>
            )}
          </Show>
          <Show keyed when={props.approval}>
            {(approval) => (
              <div class="virtual-chat-row">
                <ApprovalCard
                  approval={approval}
                  agentName={props.agent.name}
                  onApprove={() => props.onRespondApproval("accept")}
                  onReject={() => props.onRespondApproval("decline")}
                />
              </div>
            )}
          </Show>
          <Show when={attention.toArray().length > 0}>
            <div class="virtual-chat-row">{attention()}</div>
          </Show>
          <Show when={hold()}>
            {(text) => (
              <div class="virtual-chat-row">
                <p class="agent-queue-hold" role="status">
                  {text()}
                </p>
              </div>
            )}
          </Show>
          <Show when={queued()}>
            {(task) => (
              <section class="agent-thread-queued" aria-label={t("conversation.threads.view.queued")}>
                <For each={task().queuedMessages} keyed={(message) => message.deliveryId}>
                  {(message) => <p class="agent-thread-queued-text">{message().text}</p>}
                </For>
              </section>
            )}
          </Show>
        </div>
      </section>
      <div class="composer-wrap">
        <Show when={failed()}>
          {(task) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.threads.view.failed")}
              body={task().error || t("conversation.threads.view.failedBody")}
            />
          )}
        </Show>
        <form
          class="composer agent-thread-composer"
          data-compact="true"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent.id}
              agents={props.agents}
              skills={props.skills}
              skillsLoadFailed={props.skillsLoadFailed}
              mcpServers={props.mcpServers}
              attachments={props.draftAttachments}
              value={props.draft}
              placeholder={placeholder()}
              ariaLabel={placeholder()}
              focusRequest={props.focusRequest}
              skillPickerRequest={skillPickerRequest()}
              dictation={{ text: props.voice?.liveText ?? "", final: voicePhase() === "transcribing" }}
              disabled={sending() || voicePhase() === "transcribing"}
              sendShortcut={props.sendShortcut}
              onSubmit={() => void send()}
              onValueChange={props.onDraftChange}
              onPasteFiles={props.onPasteFiles}
              onOpenAttachment={props.onOpenDraftAttachment}
            />
          </div>
          <div class="composer-toolbar">
            <ComposerAddMenu
              open={addMenuOpen()}
              onOpenChange={setAddMenuOpen}
              disabled={sending() || voicePhase() === "transcribing"}
              onAttach={props.onAttachFiles}
              onPickSkill={() => setSkillPickerRequest((current) => current + 1)}
              onSideQuestion={props.onSideQuestion}
            />
            <div class="composer-primary-actions">
              {/* One meter for each thread: a pending Compact or an open popover stays with its thread. */}
              <Show when={props.task?.id} keyed>
                {(_taskId) => (
                  <Show when={props.context}>
                    {(usage) => <ContextUsageMeter usage={usage()} compact={props.onCompactContext} />}
                  </Show>
                )}
              </Show>
              <Show when={props.voice} fallback={sendButton()}>
                {(voice) => (
                  <ComposerVoiceControls
                    phase={voice().phase}
                    levels={voice().levels}
                    elapsedSeconds={voice().elapsedSeconds}
                    modelProgress={voice().modelProgress}
                    blocked={voice().blocked || sending()}
                    onStart={() => voice().onStart()}
                    onCancel={() => voice().onCancel()}
                    onFinish={() => voice().onFinish()}
                    send={sendButton()}
                  />
                )}
              </Show>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
