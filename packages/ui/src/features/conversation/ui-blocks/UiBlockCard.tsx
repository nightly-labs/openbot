import type { UiBlockStatus } from "@openbot/contracts/ui-blocks";
import type { AppTextKey } from "@openbot/i18n";
import { Badge, Button, Check, CircleCheck, Clock3, LoaderCircle, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, Show, Switch } from "solid-js";
import { useText } from "../../../text";

const STATUS_LABEL = {
  pending: "uiBlock.status.pending",
  answered: "uiBlock.status.answered",
  expired: "uiBlock.status.expired",
  closed: "uiBlock.status.closed",
} as const satisfies Record<UiBlockStatus, AppTextKey>;

export interface UiBlockCardProps {
  title?: string | undefined;
  subtitle?: string | undefined;
  status: UiBlockStatus;
  /** The line a frozen block shows, such as the chosen button. */
  outcome?: string | undefined;
  /** Draws the card as dangerous. */
  danger?: boolean | undefined;
  /** An answer is on its way. */
  busy?: boolean | undefined;
  /** Why the last answer did not go through. Shown while the block is open. */
  error?: string | undefined;
  /** Closes the open block without an answer. */
  onSkip?: (() => void) | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
  children?: JSX.Element;
}

/** The line under a frozen block: the answer with a check, or why there is none. */
export function UiBlockOutcome(props: { status: UiBlockStatus; outcome?: string | undefined }) {
  const { t } = useText();
  const text = () =>
    props.outcome ??
    (props.status === "expired"
      ? t("uiBlock.outcome.expired")
      : props.status === "closed"
        ? t("uiBlock.outcome.closed")
        : "");
  return (
    <Show when={props.status !== "pending" && text() !== ""}>
      <p class="ui-block-outcome" data-status={props.status}>
        <Switch>
          <Match when={props.status === "answered"}>
            <CircleCheck aria-hidden="true" />
          </Match>
          <Match when={props.status === "expired"}>
            <Clock3 aria-hidden="true" />
          </Match>
          <Match when={props.status === "closed"}>
            <X aria-hidden="true" />
          </Match>
        </Switch>
        <span class="ui-block-outcome-text">{text()}</span>
      </p>
    </Show>
  );
}

/** The end of an open block: why the last answer failed, and the button that skips the block. */
export function UiBlockFooter(props: {
  status: UiBlockStatus;
  error?: string | undefined;
  onSkip?: (() => void) | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const { t } = useText();
  return (
    <Show when={props.status === "pending" && (props.error || props.onSkip)}>
      <div class="ui-block-footer">
        <Show when={props.error}>
          <p class="ui-block-error" role="alert">
            {props.error}
          </p>
        </Show>
        <Show when={props.onSkip}>
          {(skip) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="ui-block-skip"
              disabled={props.busy === true || props.disabled === true}
              onClick={() => skip()()}
            >
              {t("uiBlock.skip")}
            </Button>
          )}
        </Show>
      </div>
    </Show>
  );
}

/**
 * The frame of a blocking block: title, subtitle, a badge for the status, the body, and, once the
 * block is answered, expired or closed, the outcome line.
 */
export function UiBlockCard(props: UiBlockCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  const statusLabel = () => t(STATUS_LABEL[props.status]);
  return (
    <article
      class={["conversation-interaction-card", "ui-block-card", props.class]}
      data-status={props.status}
      data-danger={props.danger ? "" : undefined}
      aria-labelledby={props.title ? titleId : undefined}
      aria-busy={props.busy ? "true" : undefined}
      ref={(element) => props.elementRef?.(element)}
    >
      <header class="ui-block-header">
        <div class="ui-block-heading">
          <Show when={props.title}>
            <h3 id={titleId} class="ui-block-title">
              {props.title}
            </h3>
          </Show>
          <Show when={props.subtitle}>
            <p class="ui-block-subtitle">{props.subtitle}</p>
          </Show>
        </div>
        <Badge
          variant={
            props.status === "pending" ? "warning-light" : props.status === "answered" ? "success-light" : "secondary"
          }
          class="conversation-interaction-status ui-block-status"
        >
          <Switch>
            <Match when={props.status === "pending"}>
              <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
            </Match>
            <Match when={props.status === "answered"}>
              <Check data-icon="inline-start" aria-hidden="true" />
            </Match>
          </Switch>
          {statusLabel()}
        </Badge>
      </header>
      <div class="ui-block-body">{props.children}</div>
      <UiBlockFooter status={props.status} error={props.error} onSkip={props.onSkip} busy={props.busy} />
      <UiBlockOutcome status={props.status} outcome={props.outcome} />
    </article>
  );
}
