/**
 * A small chat over the canvas, where the user asks an agent to change the diagram. The agent's
 * reply lists the edits it made, so the user can match each line to what moved on the canvas.
 * Collapsed, it is one button, and the canvas keeps the whole area.
 */

import { ArrowUp, Bubble, BubbleContent, Button, Check, Minimize2, Spinner, Textarea } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { DiagramChatMessage } from "./diagram-model";

export interface DiagramChatPanelProps {
  agent: AgentProfile;
  messages: DiagramChatMessage[];
  /** True while the agent works on the last message. */
  working: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string) => void;
}

export function DiagramChatPanel(props: DiagramChatPanelProps) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  const mood = (): AvatarMood => (props.working ? "working" : "idle");
  const send = () => {
    const text = draft().trim();
    if (!text || props.working) return;
    props.onSend(text);
    setDraft("");
  };
  return (
    <Show
      when={props.open}
      fallback={
        <Button
          type="button"
          variant="outline"
          class="diagram-chat-launcher"
          data-diagram-overlay=""
          onClick={() => props.onOpenChange(true)}
        >
          <AgentAvatar agent={props.agent} class="diagram-chat-avatar" motion="idle" />
          {t("diagram.chat.show")}
        </Button>
      }
    >
      <section class="diagram-chat" aria-label={t("diagram.chat.label")} data-diagram-overlay="">
        <header class="diagram-chat-header">
          <AgentAvatar agent={props.agent} class="diagram-chat-avatar" motion="idle" mood={mood()} />
          <h2 class="diagram-chat-title">{t("diagram.chat.title", { name: props.agent.name })}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("diagram.chat.hide")}
            title={t("diagram.chat.hide")}
            onClick={() => props.onOpenChange(false)}
          >
            <Minimize2 aria-hidden="true" />
          </Button>
        </header>

        <div class="diagram-chat-messages" role="log" aria-live="polite">
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
                    <p>{message.text}</p>
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
          class="diagram-chat-composer"
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault();
            send();
          }}
        >
          <Textarea
            class="diagram-chat-input"
            rows={2}
            value={draft()}
            placeholder={t("diagram.chat.placeholder")}
            aria-label={t("diagram.chat.placeholder")}
            onValueChange={setDraft}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
              event.preventDefault();
              send();
            }}
          />
          <Button
            type="submit"
            size="icon-sm"
            class="diagram-chat-send"
            disabled={!draft().trim() || props.working}
            aria-label={t("diagram.chat.send")}
            title={t("diagram.chat.send")}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
      </section>
    </Show>
  );
}
