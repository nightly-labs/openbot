import { Button, Check, ChevronRight, Spinner, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, Show, Switch } from "solid-js";

export interface ChatActionCardAction {
  label: string;
  onClick: () => void;
}

/**
 * The footer line. A `note` is plain text; `busy`, `done` and `error` announce a change the person
 * made from the card, so assistive technology reads them when they appear.
 */
export type ChatActionCardStatus =
  | { kind: "note"; text: string; action?: ChatActionCardAction }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

export interface ChatActionCardProps {
  /** The Lucide icon of the kind of record. */
  icon: JSX.Element;
  /** What happened, for example "Created routine". */
  eyebrow: string;
  title: string;
  /** The subject no longer exists: the title is struck through and Open is hidden. */
  removed?: boolean;
  /** Opens the subject, such as the routine in its settings. */
  onOpen?: () => void;
  /** The accessible name of Open, for example "Open routine Morning brief". */
  openLabel?: string;
  status?: ChatActionCardStatus;
  /** The class of one variant, for its own rules. */
  class?: string;
  /** The variant content between the header and the footer. */
  children?: JSX.Element;
  elementRef?: (element: HTMLElement) => void;
}

/**
 * The chat record of a change an agent made, as a card the person can act on. Variants give the
 * body, such as the schedule row of a routine, and map their own states onto `status`.
 */
export function ChatActionCard(props: ChatActionCardProps) {
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
            Open
            <ChevronRight aria-hidden="true" />
          </Button>
        </Show>
      </header>
      {props.children}
      <ChatActionCardFooter status={props.status} />
    </article>
  );
}

function ChatActionCardFooter(props: { status?: ChatActionCardStatus }) {
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
      {/* The region is in the page before its first text, so assistive technology reads each change. */}
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
