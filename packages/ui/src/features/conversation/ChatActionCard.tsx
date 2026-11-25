import { Button, Check, ChevronRight, Spinner, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";

export interface ChatActionCardAction {
  label: string;
  onClick: () => void;
}

export type ChatActionCardStatus =
  | { kind: "note"; text: string; action?: ChatActionCardAction | undefined }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

export interface ChatActionCardProps {
  icon: JSX.Element;
  eyebrow: string;
  title: string;
  removed?: boolean;
  onOpen?: (() => void) | undefined;
  openLabel?: string;
  status?: ChatActionCardStatus | undefined;
  class?: string;
  children?: JSX.Element;
  elementRef?: (element: HTMLElement) => void;
}

export function ChatActionCard(props: ChatActionCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  return (
    <article
      class={[
        "conversation-interaction-card",
        "chat-action-card",
        props.class,
        { "chat-action-card-removed": props.removed === true },
      ]}
      aria-labelledby={titleId}
      ref={(element) => props.elementRef?.(element)}
    >
      <header class="chat-action-card-header">
        <span class="chat-action-card-icon" aria-hidden="true">
          {props.icon}
        </span>
        <div class="chat-action-card-heading">
          <span class="chat-action-card-eyebrow">{props.eyebrow}</span>
          <h3 id={titleId} class="chat-action-card-title">
            {props.title}
          </h3>
        </div>
        <Show when={props.onOpen && !props.removed}>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            class="chat-action-card-open"
            aria-label={props.openLabel}
            onClick={() => props.onOpen?.()}
          >
            {t("chat.actionCard.open")}
            <ChevronRight aria-hidden="true" />
          </Button>
        </Show>
      </header>
      {props.children}
      <ChatActionCardFooter status={props.status} />
    </article>
  );
}

function ChatActionCardFooter(props: { status?: ChatActionCardStatus | undefined }) {
  const kind = () => props.status?.kind;
  const text = () => props.status?.text;
  const action = () => {
    const status = props.status;
    return status?.kind === "note" ? status.action : undefined;
  };
  return (
    <footer class={["chat-action-card-footer", { "chat-action-card-footer-empty": !props.status }]}>
      <Show when={kind() === "note"}>
        <span class="chat-action-card-note">{text()}</span>
      </Show>
      <span class="chat-action-card-status" role="status">
        <Switch>
          <Match when={kind() === "busy"}>
            <Spinner size="sm" />
            {text()}
          </Match>
          <Match when={kind() === "done"}>
            <Check aria-hidden="true" />
            {text()}
          </Match>
        </Switch>
      </span>
      <Show when={kind() === "error"}>
        <span class="chat-action-card-status chat-action-card-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          {text()}
        </span>
      </Show>
      <Show when={action()}>
        {(footerAction) => (
          <Button
            variant="ghost"
            size="xs"
            type="button"
            class="chat-action-card-footer-action"
            onClick={() => footerAction().onClick()}
          >
            {footerAction().label}
          </Button>
        )}
      </Show>
    </footer>
  );
}
