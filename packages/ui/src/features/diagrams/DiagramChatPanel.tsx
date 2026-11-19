import { ArrowUp, Bubble, BubbleContent, Button, Check, Minimize2, Spinner } from "@openbot/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ComposerEditor } from "../conversation/ComposerEditor";
import { createComposerRowsResize } from "../conversation/createComposerRowsResize";
import { MarkdownMessageText } from "../conversation/MarkdownMessageText";
import type { DiagramChatMessage } from "./diagram-model";

const DRAG_THRESHOLD_PX = 4;

export interface DiagramChatPanelProps {
  agent: AgentProfile;
  messages: DiagramChatMessage[];
  working: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string) => void;
  onOpenLink?: ((url: string) => void) | undefined;
}

export function DiagramChatPanel(props: DiagramChatPanelProps) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  const mood = (): AvatarMood => (props.working ? "working" : "idle");
  const [focusRequest, setFocusRequest] = createSignal(0);
  const [offset, setOffset] = createSignal({ x: 0, y: 0 });
  const draftRows = createComposerRowsResize();
  let launcher: HTMLElement | undefined;
  let log: HTMLDivElement | undefined;
  createEffect(
    () => [props.messages.length, props.working] as const,
    () => {
      requestAnimationFrame(() => log?.scrollTo({ top: log.scrollHeight }));
    },
  );
  let morph: HTMLDivElement | undefined;
  let dragged = false;
  const startDrag = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0 || !morph) return;
    const handle = event.currentTarget;
    const area = morph.parentElement?.offsetParent?.getBoundingClientRect();
    const box = morph.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, offset: offset() };
    dragged = false;
    const move = (moveEvent: PointerEvent) => {
      let dx = moveEvent.clientX - start.x;
      let dy = moveEvent.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      if (area) {
        dx = Math.min(Math.max(dx, area.left - box.left), area.right - box.right);
        dy = Math.min(Math.max(dy, area.top - box.top), area.bottom - box.bottom);
      }
      setOffset({ x: start.offset.x + dx, y: start.offset.y + dy });
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const setOpen = (open: boolean) => {
    props.onOpenChange(open);
    requestAnimationFrame(() => (open ? setFocusRequest((count) => count + 1) : launcher?.focus()));
  };
  const send = () => {
    const text = draft().trim();
    if (!text || props.working) return;
    props.onSend(text);
    setDraft("");
  };
  return (
    <div
      ref={(element) => (morph = element)}
      class="diagram-chat-morph"
      data-open={props.open ? "true" : "false"}
      data-diagram-overlay=""
      style={{ translate: `${offset().x}px ${offset().y}px` }}
    >
      <Button
        ref={(element) => (launcher = element)}
        type="button"
        variant="outline"
        class="diagram-chat-launcher"
        aria-expanded="false"
        aria-hidden={props.open ? "true" : undefined}
        tabindex={props.open ? -1 : 0}
        onPointerDown={startDrag}
        onClick={() => {
          if (dragged) dragged = false;
          else setOpen(true);
        }}
      >
        <AgentAvatar agent={props.agent} class="diagram-chat-avatar" motion="idle" />
        {t("diagram.chat.show")}
      </Button>
      <section class="diagram-chat" aria-label={t("diagram.chat.label")} inert={!props.open}>
        <header
          class="diagram-chat-header"
          onPointerDown={(event) => {
            if (!(event.target instanceof Element && event.target.closest("button"))) startDrag(event);
          }}
        >
          <AgentAvatar agent={props.agent} class="diagram-chat-avatar" motion="idle" mood={mood()} />
          <h2 class="diagram-chat-title">{t("diagram.chat.title", { name: props.agent.name })}</h2>
          <Button
            type="button"
            variant="ghost"
            class="header-panel-toggle"
            aria-label={t("diagram.chat.hide")}
            title={t("diagram.chat.hide")}
            onClick={() => setOpen(false)}
          >
            <Minimize2 aria-hidden="true" class="size-[14px]" />
          </Button>
        </header>

        <div ref={(element) => (log = element)} class="diagram-chat-messages" role="log" aria-live="polite">
          <Show
            when={props.messages.length > 0}
            fallback={<p class="diagram-chat-empty">{t("diagram.chat.empty", { name: props.agent.name })}</p>}
          >
            <For each={props.messages}>
              {(message) => (
                <Bubble
                  align={message.author === "user" ? "end" : "start"}
                  variant={message.author === "user" ? "secondary" : "muted"}
                  class="diagram-chat-bubble"
                >
                  <BubbleContent>
                    <Show when={message.author === "agent"} fallback={<p class="diagram-chat-text">{message.text}</p>}>
                      <div class="diagram-chat-markdown message-markdown">
                        <MarkdownMessageText
                          body={message.text}
                          agents={[]}
                          onSelectAgent={() => undefined}
                          onOpenLink={(url) => props.onOpenLink?.(url)}
                        />
                      </div>
                    </Show>
                    <Show when={message.changes?.length ? message.changes : undefined}>
                      {(changes) => (
                        <ul class="diagram-chat-changes" aria-label={t("diagram.chat.changes")}>
                          <For each={changes()}>
                            {(change) => (
                              <li>
                                <Check aria-hidden="true" />
                                <span>{change}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      )}
                    </Show>
                  </BubbleContent>
                </Bubble>
              )}
            </For>
          </Show>
          <Show when={props.working}>
            <p class="diagram-chat-working">
              <Spinner size="sm" />
              {t("diagram.chat.working", { name: props.agent.name })}
            </p>
          </Show>
        </div>

        <form
          ref={draftRows.form}
          class="composer diagram-chat-composer"
          data-compact=""
          data-small=""
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault();
            send();
          }}
        >
          <div class="composer-input-label" ref={draftRows.label}>
            <ComposerEditor
              agentId={undefined}
              agents={[]}
              value={draft()}
              placeholder={t("diagram.chat.placeholder")}
              ariaLabel={t("diagram.chat.placeholder")}
              disabled={false}
              focusRequest={focusRequest()}
              onValueChange={setDraft}
              onSubmit={send}
            />
          </div>
          <div class="composer-primary-actions">
            <Button
              type="submit"
              variant="ghost"
              class="voice-button"
              disabled={!draft().trim() || props.working}
              aria-label={t("diagram.chat.send")}
              title={t("diagram.chat.send")}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
