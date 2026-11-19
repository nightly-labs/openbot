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
import { children, createUniqueId, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";

export interface UiBlockCardProps {
  title?: JSX.Element | undefined;
  subtitle?: JSX.Element | undefined;
  status: UiBlockStatus;
  outcome?: string | undefined;
  icon?: JSX.Element | undefined;
  danger?: boolean | undefined;
  busy?: boolean | undefined;
  waiting?: boolean | undefined;
  waitingLabel?: string | undefined;
  outcomeBadge?: boolean | undefined;
  answerInBody?: boolean | undefined;
  error?: string | undefined;
  onSkip?: (() => void) | undefined;
  actions?: JSX.Element | undefined;
  inlineActions?: boolean | undefined;
  footerStart?: JSX.Element | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
  children?: JSX.Element;
}

function outcomeText(status: UiBlockStatus, outcome: string | undefined, t: ReturnType<typeof useText>["t"]) {
  if (outcome?.trim()) return outcome;
  if (status === "answered") return t("uiBlock.status.answered");
  if (status === "expired") return t("uiBlock.outcome.expired");
  if (status === "closed") return t("uiBlock.outcome.closed");
  return "";
}

function UiBlockOutcome(props: { status: UiBlockStatus; outcome?: string | undefined }) {
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

function filled(nodes: unknown[]): boolean {
  return nodes.some((node) => node !== undefined && node !== null && node !== false && node !== "");
}

export function UiBlockCard(props: UiBlockCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  const title = children(() => props.title);
  const subtitle = children(() => props.subtitle);
  const icon = children(() => props.icon);
  const actions = children(() => props.actions);
  const hasTitle = () => filled(title.toArray());
  const pending = () => props.status === "pending";
  const waiting = () => props.waiting === true && pending() && props.busy !== true;
  const headerOutcome = () => props.outcomeBadge === true && !pending();
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
        aria-labelledby={hasTitle() ? titleId : undefined}
        aria-busy={props.busy ? "true" : undefined}
      >
        <Show when={hasTitle() || filled(subtitle.toArray()) || filled(icon.toArray()) || waiting() || headerOutcome()}>
          <header class="ui-block-header">
            {icon()}
            <div class="ui-block-heading">
              <Show when={hasTitle()}>
                <h3 id={titleId} class="ui-block-title">
                  {title()}
                </h3>
              </Show>
              <Show when={filled(subtitle.toArray())}>
                <p class="ui-block-subtitle">{subtitle()}</p>
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
        <Show when={pending() && (filled(actions.toArray()) || props.onSkip)}>
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
                    aria-describedby={hasTitle() ? titleId : undefined}
                    disabled={props.busy === true}
                    onClick={() => skip()()}
                  >
                    {t("uiBlock.skip")}
                  </Button>
                )}
              </Show>
              {actions()}
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
