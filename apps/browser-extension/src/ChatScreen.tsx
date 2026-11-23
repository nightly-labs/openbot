import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { ArrowLeft, Check, ChevronDown, Plus, Settings } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { toAgentProfile } from "@openbot/ui/features/agents/agent-profile";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { safeBrowserUrl } from "@openbot/ui/features/conversation/RichMessageText";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { avatarAgent, bubbleColors, composerAgents } from "./agent-look";
import { ChatComposer } from "./ChatComposer";
import { createMenuPresence } from "./menu-presence";
import { stickToBottom } from "./stick-to-bottom";
import { isChatMessage, type OpenChat, type Workspace } from "./workspace";

interface ChatScreenProps {
  workspace: Workspace;
  onBack: () => void;
  onOpenSettings: (agentId: string) => void;
  onOpen: (agentId: string, taskId: string | null) => void;
}

/** The chat: the top bar with the thread menu, the messages with their files, and the composer. */
export function ChatScreen(props: ChatScreenProps) {
  const chat = () => props.workspace.state.chat;
  const agent = createMemo(() => props.workspace.state.agents.find((entry) => entry.id === chat()?.agentId));
  return (
    <Show when={chat()}>
      {(current) => <Show when={agent()}>{(found) => <ChatView {...props} chat={current()} agent={found()} />}</Show>}
    </Show>
  );
}

function ChatView(props: ChatScreenProps & { chat: OpenChat; agent: ClientAgentSummary }) {
  const { t } = useText();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const menu = createMenuPresence(menuOpen);
  let list: HTMLDivElement | undefined;
  let focusField: () => void = () => undefined;
  const state = () => props.workspace.state;
  const color = () => state().colors[props.agent.id];
  const messages = createMemo(() => props.chat.messages.filter(isChatMessage));
  const threads = createMemo(() =>
    (state().threads[props.agent.id] ?? []).filter((task) => task.state !== "closed").slice(0, 6),
  );
  const thread = createMemo(() =>
    props.chat.taskId === null
      ? null
      : (state().threads[props.agent.id] ?? []).find((task) => task.id === props.chat.taskId),
  );
  const subtitle = () =>
    props.chat.draftThread
      ? t("extension.chat.newThread")
      : props.chat.taskId === null
        ? null
        : (thread()?.title ?? null);
  /** The agent works on an answer that has not started to stream. */
  const answering = () => {
    if (props.chat.activeTurnId === null && !props.chat.sending) return false;
    const last = props.chat.messages.at(-1);
    return !(last && last.author !== "user" && last.status === "streaming");
  };
  /** The agent as the shared chat parts read it, with its exact colour. */
  const profile = createMemo(() => toAgentProfile({ ...props.agent, avatarColor: color() ?? null }));
  /** One line for each turn, as the desktop picks it; the next turn picks again. */
  const activityLabel = createMemo(() => {
    void props.chat.activeTurnId;
    return nextAgentActivityLabel();
  });
  /** The agents a mention chip can name. */
  const mentionAgents = createMemo(() => composerAgents(state().agents, state().colors));
  function openLink(url: string) {
    const safe = safeBrowserUrl(url);
    if (safe) window.open(safe, "_blank", "noopener");
  }

  // Keep the newest message in view while the answer streams in.
  createEffect(
    () => [messages().length, messages().at(-1)?.text.length, answering()] as const,
    () => {
      if (list) list.scrollTop = list.scrollHeight;
    },
  );
  onSettled(() => (list ? stickToBottom(list) : undefined));
  onSettled(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".ext-chat-menu, .ch-title")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  });

  return (
    <div class="ch-chat" style={bubbleColors(props.agent, color())}>
      {/* The top bar of the home, with the agent in place of the server: back, then the agent's mark
          and name, which open the agent's chats when the server has threads. */}
      <header class="ch-topbar">
        <button
          type="button"
          class="ch-back"
          aria-label={t("common.back")}
          onClick={() => {
            setMenuOpen(false);
            props.onBack();
          }}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="ch-title"
          aria-haspopup={props.workspace.threadsAvailable() ? "menu" : undefined}
          aria-expanded={props.workspace.threadsAvailable() ? (menuOpen() ? "true" : "false") : undefined}
          aria-label={t("extension.chat.threadsMenu", { name: props.agent.name })}
          disabled={!props.workspace.threadsAvailable()}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AgentAvatar agent={avatarAgent(props.agent, color())} motion="idle" class="ch-title-mark" />
          <span class="ch-title-name" dir="auto">
            {props.agent.name}
          </span>
          <Show when={subtitle()}>
            {(text) => (
              <span class="ch-title-sub" dir="auto">
                {text()}
              </span>
            )}
          </Show>
          <Show when={props.workspace.threadsAvailable()}>
            <ChevronDown size={14} aria-hidden="true" class="ch-title-chevron ext-menu-chevron" />
          </Show>
        </button>
        <button
          type="button"
          class="ph-create ch-settings"
          aria-label={t("conversation.header.settings")}
          onClick={() => {
            setMenuOpen(false);
            props.onOpenSettings(props.agent.id);
          }}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </header>
      <Show when={menu.mounted()}>
        <div class="ext-menu ext-chat-menu" role="menu" data-closing={menu.closing() ? "" : undefined}>
          <button
            type="button"
            role="menuitem"
            class="ext-menu-item"
            onClick={() => {
              setMenuOpen(false);
              props.onOpen(props.agent.id, null);
            }}
          >
            <span>{t("extension.chat.mainChat")}</span>
            <Show when={props.chat.taskId === null && !props.chat.draftThread}>
              <Check size={16} aria-hidden="true" />
            </Show>
          </button>
          <Show when={threads().length > 0}>
            <hr class="ext-menu-separator" />
            <p class="ext-menu-label">{t("extension.chat.threads")}</p>
            <For each={threads()}>
              {(task) => (
                <button
                  type="button"
                  role="menuitem"
                  class="ext-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onOpen(props.agent.id, task.id);
                  }}
                >
                  <span>{task.title}</span>
                  <Show when={task.id === props.chat.taskId}>
                    <Check size={16} aria-hidden="true" />
                  </Show>
                </button>
              )}
            </For>
          </Show>
          <hr class="ext-menu-separator" />
          <button
            type="button"
            role="menuitem"
            class="ext-menu-item"
            onClick={() => {
              setMenuOpen(false);
              props.workspace.newThread(props.agent.id);
              focusField();
            }}
          >
            <span>{t("extension.chat.newThread")}</span>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </Show>
      <div class="ch-list" ref={list} aria-live="polite">
        <Show
          when={messages().length > 0 || props.chat.status !== "ready"}
          fallback={
            <div class="ch-empty">
              <AgentAvatar
                agent={avatarAgent(props.agent, color())}
                motion="hover"
                style={{ width: "72px", height: "72px" }}
              />
              <strong>{props.chat.draftThread ? t("extension.chat.newThread") : props.agent.name}</strong>
              <span>{t("extension.chat.empty", { name: props.agent.name })}</span>
            </div>
          }
        >
          {/* Keyed by id: a new snapshot from the host brings new objects, and a bubble that stays must not
              play its entrance again. */}
          <For each={messages()} keyed={(message) => message.id}>
            {(message) => (
              <>
                {/* Files and images sit above their message, on the side of who sent them. */}
                <Show when={message().attachments?.length ? message().attachments : undefined}>
                  {(files) => (
                    <div class={message().author === "user" ? "ch-files ch-files-user" : "ch-files"}>
                      <AttachmentCards
                        attachments={files()}
                        mediaSource={props.workspace.media}
                        onPreview={(attachment) => {
                          const url = props.workspace.media.url(attachment.id);
                          if (url) window.open(url, "_blank", "noopener");
                          else void props.workspace.media.save(attachment).catch(() => undefined);
                        }}
                        onAction={(attachment) => void props.workspace.media.save(attachment).catch(() => undefined)}
                      />
                    </div>
                  )}
                </Show>
                <Show when={message().text.trim()}>
                  <Show
                    when={message().author !== "user"}
                    fallback={<div class="ch-bubble ch-user">{message().text}</div>}
                  >
                    {/* Markdown with mention chips, as the phone app and the desktop dock show an answer. */}
                    <div class="ch-bubble ch-agent message-markdown">
                      <MarkdownMessageText
                        body={message().text}
                        streaming={message().status === "streaming"}
                        agents={mentionAgents()}
                        attachments={message().attachments}
                        onSelectAgent={(agentId) => props.onOpen(agentId, null)}
                        onOpenLink={openLink}
                      />
                    </div>
                  </Show>
                </Show>
              </>
            )}
          </For>
        </Show>
        <Show when={answering()}>
          {/* As in the desktop chat: the agent's face in its working mood, and the line of what it does. */}
          <AgentActivityIndicator agent={profile()} label={activityLabel()} />
        </Show>
      </div>
      <ChatComposer
        placeholder={t("extension.chat.ask", { name: props.agent.name })}
        error={props.chat.error}
        conversationKey={`${props.chat.agentId}:${props.chat.taskId ?? ""}`}
        onDismissError={() => props.workspace.clearChatError()}
        sending={props.chat.sending}
        transcribe={props.workspace.transcribe}
        onSend={(text) => props.workspace.send(text)}
        onFocusReady={(focus) => {
          focusField = focus;
        }}
      />
    </div>
  );
}
