/**
 * Buildbot: the AI chat beside the workflow canvas, and its button at the bottom right. Each message asks the host to change the workflow; the
 * reply says what changed, or asks a question. Undo on the canvas or the version list gets the graph
 * from before a change back.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowChatMessage } from "@openbot/contracts/ipc";
import { ArrowUp, Button, LabelTooltipTrigger, LoaderCircle, Textarea, X } from "@openbot/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { HudButton } from "./WorkflowCanvasHud";
import { Hint, MOD_KEY } from "./workflow-board";

/** Buildbot's face: one seed and hue, so it looks the same on every computer. */
const BUILDBOT = { seed: "buildbot", hue: 215 } as const;

function BuildbotAvatar(props: { busy: boolean; size: string }) {
  return (
    <AgentAvatar
      seed={BUILDBOT.seed}
      hue={BUILDBOT.hue}
      motion="always"
      mood={props.busy ? "working" : "idle"}
      style={{ width: props.size, height: props.size }}
    />
  );
}

/** The Buildbot button at the bottom right. It glows, and more while Buildbot works. */
export function WorkflowBuildbotButton(props: { open: boolean; busy: boolean; onToggle: () => void }) {
  const { t } = useText();
  return (
    <div class="wfn-hud wfn-buildbot-dock" data-busy={props.busy ? "" : undefined}>
      <Hint label={t("workflow.canvas.chat.toggle")} keys={[MOD_KEY, "J"]}>
        <LabelTooltipTrigger
          as={Button}
          variant="ghost"
          size="sm"
          class="wfn-buildbot"
          aria-pressed={props.open ? "true" : "false"}
          onClick={props.onToggle}
        >
          <BuildbotAvatar busy={props.busy} size="28px" />
          {t("workflow.canvas.chat.open")}
        </LabelTooltipTrigger>
      </Hint>
    </div>
  );
}

/** A chat message. A failed reply shows the error and does not go back to the model. */
export interface DraftChatMessage extends WorkflowChatMessage {
  failed?: boolean;
}

export function WorkflowDraftChat(props: {
  messages: readonly DraftChatMessage[];
  /** True while the AI works on the last message. */
  busy: boolean;
  onSend: (request: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [text, setText] = createSignal("");
  let list: HTMLOListElement | undefined;
  const send = () => {
    const request = text().trim();
    if (!request || props.busy) return;
    props.onSend(request);
    setText("");
  };
  // The newest message shows. The body returns nothing: `scrollTo` can return a promise, which is not a cleanup.
  createEffect(
    () => [props.messages.length, props.busy],
    () => {
      list?.scrollTo({ top: list.scrollHeight });
    },
  );
  return (
    // The panel is not the canvas: the wheel scrolls the messages, and a press does not pan.
    <aside class="wfn-hud wfn-chat" aria-label={t("workflow.canvas.chat.title")} data-wfn-portal="">
      <header class="wfn-chat-head">
        <h2 class="wfn-chat-title">
          <BuildbotAvatar busy={props.busy} size="24px" />
          {t("workflow.canvas.chat.title")}
        </h2>
        <HudButton label={t("workflow.canvas.chat.close")} keys={["Esc"]} onClick={props.onClose}>
          <X />
        </HudButton>
      </header>
      <ol
        ref={(element: HTMLOListElement) => {
          list = element;
        }}
        class="wfn-chat-messages"
        aria-live="polite"
      >
        <Show when={props.messages.length === 0}>
          <li class="wfn-chat-empty">{t("workflow.canvas.chat.empty")}</li>
        </Show>
        <For each={props.messages}>
          {(message) => (
            <li class="wfn-chat-message" data-role={message.role} data-failed={message.failed ? "" : undefined}>
              {message.text}
            </li>
          )}
        </For>
        <Show when={props.busy}>
          <li class="wfn-chat-message wfn-chat-working" data-role="assistant">
            <LoaderCircle aria-hidden="true" />
            {t("workflow.canvas.chat.working")}
          </li>
        </Show>
      </ol>
      <div class="wfn-chat-composer">
        <Textarea
          ref={(element: HTMLTextAreaElement) => queueMicrotask(() => element.focus())}
          class="wfn-chat-input"
          aria-label={t("workflow.canvas.chat.field")}
          placeholder={t("workflow.canvas.chat.placeholder")}
          rows={3}
          maxlength={INPUT_LIMITS.workflowDraftRequest}
          value={text()}
          onValueChange={setText}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClose();
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button
          size="icon-sm"
          aria-label={t("workflow.canvas.chat.send")}
          disabled={props.busy || text().trim().length === 0}
          onClick={send}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
