import type { UiBlockStatus } from "@openbot/contracts/ui-blocks";
import { Bubble, BubbleContent, Button, CircleCheck, Clock3, Spinner, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, Show, Switch } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";

export interface UiBlockCardProps {
  title?: string | undefined;
  subtitle?: string | undefined;
  status: UiBlockStatus;
  /** The line a frozen block shows, such as the chosen button. */
  outcome?: string | undefined;
  /** A logo before the title, such as the key of a form that asks for a secret. */
  icon?: JSX.Element | undefined;
  /** Draws the card as dangerous. */
  danger?: boolean | undefined;
  /** An answer is on its way. */
  busy?: boolean | undefined;
  /** Why the last answer did not go through. Shown while the block is open. */
  error?: string | undefined;
  /** Closes the open block without an answer. */
  onSkip?: (() => void) | undefined;
  /** The buttons that answer the open block. The footer shows them at its end, after Skip. */
  actions?: JSX.Element | undefined;
  /** A small control at the start of the footer, such as a choice that goes with the answer. */
  footerStart?: JSX.Element | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
  children?: JSX.Element;
}

/** The line under a frozen block: the answer with a check, or why there is none. */
export function UiBlockOutcome(props: { status: UiBlockStatus; outcome?: string | undefined }) {
  const { t } = useText();
  const text = () =>
    // A blank outcome, such as a form of secret fields, still says that the block was answered.
    (props.outcome?.trim() ? props.outcome : undefined) ??
    (props.status === "answered"
      ? t("uiBlock.status.answered")
      : props.status === "expired"
        ? t("uiBlock.outcome.expired")
        : props.status === "closed"
          ? t("uiBlock.outcome.closed")
          : "");
  return (
    <Show when={props.status !== "pending" && text() !== ""}>
      <p class="ui-block-outcome" data-status={props.status}>
        <Switch>
          <Match when={props.status === "answered"}>
            <CircleCheck class="ui-block-outcome-check" aria-hidden="true" />
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
 * The frame of a blocking block, in the style of an agent question: a bubble with the title, the
 * body, and, while the block is open, a footer with Skip and the block's own buttons. Once the
 * block is answered, expired or closed, the outcome line takes the place of the footer.
 */
export function UiBlockCard(props: UiBlockCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  const pending = () => props.status === "pending";
  return (
    <Bubble
      variant="muted"
      class={cx("ui-block-card", props.class)}
      data-status={props.status}
      data-danger={props.danger ? "" : undefined}
      ref={(element: HTMLDivElement) => props.elementRef?.(element)}
    >
      <BubbleContent
        as="article"
        class="ui-block-content"
        aria-labelledby={props.title ? titleId : undefined}
        aria-busy={props.busy ? "true" : undefined}
      >
        <Show when={props.title || props.subtitle || props.icon}>
          <header class="ui-block-header">
            {props.icon}
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
          </header>
        </Show>
        <div class="ui-block-body">{props.children}</div>
        <Show when={pending() && props.error}>
          <p class="ui-block-error" role="alert">
            {props.error}
          </p>
        </Show>
        <Show when={pending() && (props.actions || props.onSkip)}>
          <footer class="ui-block-card-footer">
            {props.footerStart}
            <Show when={props.busy}>
              <span class="ui-block-sending" role="status">
                <Spinner size="sm" />
                {t("common.sending")}
              </span>
            </Show>
            <span class="ui-block-actions">
              <Show when={props.onSkip}>
                {(skip) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    class="ui-block-skip"
                    disabled={props.busy === true}
                    onClick={() => skip()()}
                  >
                    {t("uiBlock.skip")}
                  </Button>
                )}
              </Show>
              {props.actions}
            </span>
          </footer>
        </Show>
        <UiBlockOutcome status={props.status} outcome={props.outcome} />
      </BubbleContent>
    </Bubble>
  );
}
