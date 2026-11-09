import type { UiBlockStatus } from "@openbot/contracts/ui-blocks";
import {
  Badge,
  Bubble,
  BubbleContent,
  Button,
  Check,
  CircleCheck,
  Clock3,
  LoaderCircle,
  Spinner,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";

export interface UiBlockCardProps {
  /** Plain text, or a control such as a link that opens the item. */
  title?: JSX.Element | undefined;
  /** Plain text, or text with a bold part, such as the site that a code goes to. */
  subtitle?: JSX.Element | undefined;
  status: UiBlockStatus;
  /** The line a frozen block shows, such as the chosen button. */
  outcome?: string | undefined;
  /** A logo before the title, such as the key of a form that asks for a secret. */
  icon?: JSX.Element | undefined;
  /** Draws the card as dangerous. */
  danger?: boolean | undefined;
  /** An answer is on its way. */
  busy?: boolean | undefined;
  /**
   * Shows "Waiting for you" with a turning loader at the end of the header while the block is open.
   * The footer's "Sending…" takes its place while an answer is on its way.
   */
  waiting?: boolean | undefined;
  /** The text of the waiting badge, when the block waits for something more exact than "you". */
  waitingLabel?: string | undefined;
  /**
   * Shows the outcome of a frozen block as a badge at the end of the header, in the place of the
   * waiting badge, and not as a line under the block.
   */
  outcomeBadge?: boolean | undefined;
  /** The body already shows the answer, such as the chosen row: an answered block has no outcome line. */
  answerInBody?: boolean | undefined;
  /** Why the last answer did not go through. Shown while the block is open. */
  error?: string | undefined;
  /** Closes the open block without an answer. */
  onSkip?: (() => void) | undefined;
  /** The buttons that answer the open block. The footer shows them at its end, after Skip. */
  actions?: JSX.Element | undefined;
  /**
   * Puts the buttons on the title row, for a short block with no body. They go to the next line
   * when the card is too narrow.
   */
  inlineActions?: boolean | undefined;
  /** A small control at the start of the footer, such as a choice that goes with the answer. */
  footerStart?: JSX.Element | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
  children?: JSX.Element;
}

function outcomeText(status: UiBlockStatus, outcome: string | undefined, t: ReturnType<typeof useText>["t"]) {
  // A blank outcome, such as a form of secret fields, still says that the block was answered.
  if (outcome?.trim()) return outcome;
  if (status === "answered") return t("uiBlock.status.answered");
  if (status === "expired") return t("uiBlock.outcome.expired");
  if (status === "closed") return t("uiBlock.outcome.closed");
  return "";
}

/** The line under a frozen block: the answer with a check, or why there is none. */
export function UiBlockOutcome(props: { status: UiBlockStatus; outcome?: string | undefined }) {
  const { t } = useText();
  const text = () => outcomeText(props.status, props.outcome, t);
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

/**
 * The frame of a blocking block, in the style of an agent question: a bubble with the title, the
 * body, and, while the block is open, a footer with Skip and the block's own buttons. Once the
 * block is answered, expired or closed, the outcome line takes the place of the footer.
 */
export function UiBlockCard(props: UiBlockCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  const pending = () => props.status === "pending";
  const waiting = () => props.waiting === true && pending() && props.busy !== true;
  const headerOutcome = () => props.outcomeBadge === true && !pending();
  // A block that was open when it appeared and is now answered or closed. Only this change animates:
  // a closed block in the history shows at once.
  const openedPending = untrack(() => props.status === "pending");
  const settled = () => openedPending && !pending();
  return (
    <Bubble
      variant="muted"
      class={cx("ui-block-card", props.class)}
      data-status={props.status}
      data-danger={props.danger ? "" : undefined}
      data-inline-actions={props.inlineActions ? "" : undefined}
      data-settled={settled() ? "" : undefined}
      ref={(element: HTMLDivElement) => props.elementRef?.(element)}
    >
      <BubbleContent
        as="article"
        class="ui-block-content"
        aria-labelledby={props.title ? titleId : undefined}
        aria-busy={props.busy ? "true" : undefined}
      >
        <Show when={props.title || props.subtitle || props.icon || waiting() || headerOutcome()}>
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
            <Show when={waiting()}>
              <Badge variant="warning-light" class="ui-block-status conversation-interaction-status" role="status">
                <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
                {props.waitingLabel ?? t("uiBlock.status.waiting")}
              </Badge>
            </Show>
            <Show when={headerOutcome()}>
              <Badge
                variant={props.status === "answered" ? "success-light" : "outline"}
                class="ui-block-status conversation-interaction-status"
                role="status"
              >
                <Switch fallback={<X data-icon="inline-start" aria-hidden="true" />}>
                  <Match when={props.status === "answered"}>
                    <Check data-icon="inline-start" aria-hidden="true" />
                  </Match>
                  <Match when={props.status === "expired"}>
                    <Clock3 data-icon="inline-start" aria-hidden="true" />
                  </Match>
                </Switch>
                {outcomeText(props.status, props.outcome, t)}
              </Badge>
            </Show>
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
        <Show when={!headerOutcome() && !(props.answerInBody === true && props.status === "answered")}>
          <UiBlockOutcome status={props.status} outcome={props.outcome} />
        </Show>
      </BubbleContent>
    </Bubble>
  );
}
