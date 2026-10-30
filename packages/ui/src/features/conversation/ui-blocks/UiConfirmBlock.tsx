import type { UiAction, UiActionStyle, UiConfirmBlock as UiConfirmSpec } from "@openbot/contracts/ui-blocks";
import { Button, NativeSelect, Spinner } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, For, flush, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";
import { UiBlockCard } from "./UiBlockCard";
import { UiHoldButton } from "./UiHoldButton";
import { sendUiBlockResponse, type UiBlockProps, uiBlockState } from "./ui-block-support";

/** How long a held button is held when the block is dangerous and gives no time. */
const DEFAULT_HOLD_MS = 800;

const BUTTON_VARIANT = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  danger: "destructive",
} as const satisfies Record<UiActionStyle, "default" | "secondary" | "ghost" | "destructive">;

export interface UiConfirmBlockProps extends UiBlockProps<UiConfirmSpec> {
  /** Draws `spec.preview` as safe Markdown. Without it the preview is plain text. */
  renderPreview?: ((markdown: string) => JSX.Element) | undefined;
}

function actionStyle(action: UiAction): UiActionStyle {
  return action.style ?? "secondary";
}

/**
 * A long draft stops at a fixed height and scrolls. A button under it opens the rest, because a
 * scroll bar that the system hides does not show that more text is there. The button is there only
 * when the text is cut off. Whether it is is a measurement, made again when the text or the width
 * changes.
 */
function UiConfirmPreview(props: { children: JSX.Element }) {
  const { t } = useText();
  const previewId = createUniqueId();
  const [expanded, setExpanded] = createSignal(false);
  const [clamped, setClamped] = createSignal(false);
  let preview: HTMLElement | undefined;

  // An open preview shows everything, so it cannot say whether the closed one cuts anything off.
  function measure(): void {
    if (!preview || expanded()) return;
    setClamped(preview.scrollHeight > preview.clientHeight);
  }

  // A text that fits after the card got wider while open keeps the box height on close, so no
  // resize says that nothing is cut off any more.
  function toggle(): void {
    setExpanded((open) => !open);
    flush();
    measure();
  }

  onSettled(() => {
    if (!preview || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    // The box stops growing at its limit, so a change in the text shows only on the content.
    for (const child of preview.children) observer.observe(child);
    return () => observer.disconnect();
  });

  return (
    <>
      <section
        ref={(element) => (preview = element)}
        id={previewId}
        class="ui-block-preview"
        data-expanded={expanded() ? "true" : undefined}
        aria-label={t("uiBlock.confirm.previewLabel")}
        tabindex="0"
      >
        {props.children}
      </section>
      <Show when={clamped() || expanded()}>
        <Button
          type="button"
          variant="link"
          size="xs"
          class="ui-block-preview-toggle"
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={previewId}
          onClick={toggle}
        >
          {expanded() ? t("uiBlock.confirm.hideFullPreview") : t("uiBlock.confirm.showFullPreview")}
        </Button>
      </Show>
    </>
  );
}

export function UiConfirmBlock(props: UiConfirmBlockProps) {
  const { t } = useText();
  const hintId = createUniqueId();
  const state = () => uiBlockState(props);
  const frozen = () => state().status !== "pending";
  const locked = () => frozen() || props.disabled === true || props.busy === true;
  const holdMs = () => props.spec.confirmHold ?? DEFAULT_HOLD_MS;
  const holdsPrimary = () => props.spec.danger === true || props.spec.confirmHold !== undefined;
  const isHeld = (action: UiAction) =>
    actionStyle(action) === "danger" || (holdsPrimary() && actionStyle(action) === "primary");
  const anyHeld = () => props.spec.actions.some(isHeld);
  // The host answers the block itself at `autoAnswer.at`. Its button counts down to that time.
  const autoAnswer = () => state().autoAnswer;
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => (frozen() ? undefined : autoAnswer()?.at),
    (at) => {
      if (!at) return;
      setNow(Date.now());
      const timer = window.setInterval(() => setNow(Date.now()), 1_000);
      return () => window.clearInterval(timer);
    },
  );
  const secondsLeft = () => {
    const at = autoAnswer()?.at;
    return at ? Math.max(0, Math.ceil((Date.parse(at) - now()) / 1_000)) : 0;
  };
  const actionLabel = (action: UiAction) =>
    autoAnswer()?.actionId === action.id && secondsLeft() > 0
      ? t("uiBlock.confirm.autoActionLabel", { action: action.label, seconds: secondsLeft() })
      : action.label;
  const outcome = () =>
    autoAnswer()?.done && state().outcome
      ? t("uiBlock.outcome.autoAnswered", { outcome: state().outcome ?? "" })
      : state().outcome;

  const [selected, setSelected] = createSignal<Record<string, string>>({});
  // A `confirm: true` action, or a held action that was clicked instead of held. The card asks for it
  // again before it acts.
  const [confirming, setConfirming] = createSignal<UiAction>();
  const actionButtons = new Map<string, HTMLButtonElement>();
  let confirmButton: HTMLButtonElement | undefined;

  function askAgain(action: UiAction): void {
    if (locked()) return;
    setConfirming(action);
    flush();
    confirmButton?.focus();
  }

  function stopAsking(): void {
    const action = confirming();
    setConfirming(undefined);
    flush();
    if (action) actionButtons.get(action.id)?.focus();
  }
  const selectValue = (select: string, options: string[]): string =>
    (frozen() ? state().response?.values?.[select] : undefined) !== undefined
      ? String(state().response?.values?.[select])
      : (selected()[select] ?? options[0] ?? "");

  function respond(action: UiAction): void {
    if (locked()) return;
    setConfirming(undefined);
    const values: Record<string, string> = {};
    for (const field of props.spec.fields ?? []) {
      if ("select" in field) values[field.select] = selected()[field.select] ?? field.options[0] ?? "";
    }
    sendUiBlockResponse(
      props.spec,
      { actionId: action.id, ...(Object.keys(values).length > 0 ? { values } : {}) },
      props.onRespond,
    );
  }

  return (
    <UiBlockCard
      class={cx("ui-block-confirm", props.class)}
      title={props.spec.title}
      status={state().status}
      outcome={outcome()}
      danger={props.spec.danger}
      busy={props.busy}
      error={props.error}
      onSkip={props.disabled || autoAnswer() ? undefined : props.onSkip}
      elementRef={props.elementRef}
    >
      <Show when={(props.spec.fields?.length ?? 0) > 0}>
        <dl class="ui-block-fields">
          <For each={props.spec.fields ?? []}>
            {(field) => (
              <>
                <dt>{field.label}</dt>
                <dd>
                  {"select" in field ? (
                    <NativeSelect
                      size="sm"
                      aria-label={field.label}
                      disabled={locked()}
                      value={selectValue(field.select, field.options)}
                      onChange={(event) =>
                        setSelected((current) => ({ ...current, [field.select]: event.currentTarget.value }))
                      }
                    >
                      <For each={field.options}>{(option) => <option value={option}>{option}</option>}</For>
                    </NativeSelect>
                  ) : (
                    field.value
                  )}
                </dd>
              </>
            )}
          </For>
        </dl>
      </Show>
      <Show when={props.spec.preview}>
        {(preview) => (
          <UiConfirmPreview>
            <Show when={props.renderPreview} fallback={<p class="ui-block-preview-text">{preview()}</p>}>
              {(render) => render()(preview())}
            </Show>
          </UiConfirmPreview>
        )}
      </Show>
      <Show when={!frozen() && confirming()}>
        {(action) => (
          <fieldset class="ui-block-confirm-step">
            <legend class="ui-block-confirm-question">{t("uiBlock.confirm.prompt", { action: action().label })}</legend>
            <div class="ui-block-actions">
              <Button
                type="button"
                variant={BUTTON_VARIANT[actionStyle(action())]}
                disabled={locked()}
                ref={(element: HTMLButtonElement) => {
                  confirmButton = element;
                }}
                onClick={() => respond(action())}
              >
                {t("uiBlock.confirm.accept")}
              </Button>
              <Button type="button" variant="ghost" disabled={props.busy === true} onClick={stopAsking}>
                {t("common.cancel")}
              </Button>
            </div>
          </fieldset>
        )}
      </Show>
      <Show when={!frozen() && !confirming()}>
        <div class={cx("ui-block-actions", autoAnswer() && "ui-block-actions-auto")}>
          <For each={props.spec.actions}>
            {(action) => (
              <Switch>
                <Match when={isHeld(action)}>
                  <UiHoldButton
                    holdMs={holdMs()}
                    variant={BUTTON_VARIANT[actionStyle(action)]}
                    disabled={locked()}
                    describedBy={hintId}
                    ref={(element) => actionButtons.set(action.id, element)}
                    onComplete={() => respond(action)}
                    onClickWithoutHold={() => askAgain(action)}
                  >
                    {action.label}
                  </UiHoldButton>
                </Match>
                <Match when={true}>
                  <Button
                    type="button"
                    variant={BUTTON_VARIANT[actionStyle(action)]}
                    disabled={locked()}
                    ref={(element: HTMLButtonElement) => {
                      actionButtons.set(action.id, element);
                    }}
                    onClick={() => (action.confirm === true ? askAgain(action) : respond(action))}
                  >
                    {actionLabel(action)}
                  </Button>
                </Match>
              </Switch>
            )}
          </For>
          <Show when={props.busy}>
            <span class="ui-block-sending" role="status">
              <Spinner size="sm" />
              {t("common.sending")}
            </span>
          </Show>
        </div>
        <Show when={anyHeld()}>
          <p id={hintId} class="ui-block-hint">
            {t("uiBlock.confirm.holdHint")}
          </p>
        </Show>
      </Show>
    </UiBlockCard>
  );
}
