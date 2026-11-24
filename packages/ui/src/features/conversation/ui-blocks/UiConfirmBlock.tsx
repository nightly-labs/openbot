import {
  UI_BLOCK_LIMITS,
  UI_CONFIRM_EDIT_ACTION_ID,
  type UiAction,
  type UiActionStyle,
  type UiBlockResponse,
  type UiConfirmBlock as UiConfirmSpec,
  uiConfirmPreviewEditable,
} from "@openbot/contracts/ui-blocks";
import { Button, NativeSelect, Textarea } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, For, flush, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";
import { UiBlockCard } from "./UiBlockCard";
import { UiHoldButton } from "./UiHoldButton";
import { sendUiBlockResponse, type UiBlockProps, uiBlockState } from "./ui-block-support";

const DEFAULT_HOLD_MS = 800;

const BUTTON_VARIANT = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  danger: "destructive",
} as const satisfies Record<UiActionStyle, "default" | "secondary" | "ghost" | "destructive">;

export interface UiConfirmBlockProps extends Omit<UiBlockProps<UiConfirmSpec>, "onRespond"> {
  onRespond: (response: UiBlockResponse, preview?: string) => void;
  renderPreview?: ((markdown: string) => JSX.Element) | undefined;
  canEditPreview?: boolean | undefined;
  onDraftChange?: ((draft: string | undefined) => void) | undefined;
}

function actionStyle(action: UiAction): UiActionStyle {
  return action.style ?? "secondary";
}

function UiConfirmPreview(props: { children: JSX.Element }) {
  const { t } = useText();
  const previewId = createUniqueId();
  const [expanded, setExpanded] = createSignal(false);
  const [clamped, setClamped] = createSignal(false);
  let preview: HTMLElement | undefined;

  function measure(): void {
    if (!preview || expanded()) return;
    setClamped(preview.scrollHeight > preview.clientHeight);
  }

  function toggle(): void {
    setExpanded((open) => !open);
    flush();
    measure();
  }

  function revealFocus(event: FocusEvent): void {
    if (!preview || expanded() || !clamped() || !(event.target instanceof Element)) return;
    if (event.target.getBoundingClientRect().bottom > preview.getBoundingClientRect().bottom) toggle();
  }

  onSettled(() => {
    if (!preview || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
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
        data-clamped={clamped() && !expanded() ? "true" : undefined}
        aria-label={t("uiBlock.confirm.previewLabel")}
        tabindex={clamped() && !expanded() ? undefined : "0"}
        onFocusIn={revealFocus}
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

function countdownClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
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
  const actionLabel = (action: UiAction) => {
    const left = secondsLeft();
    if (autoAnswer()?.actionId !== action.id || left <= 0) return action.label;
    return left < 60
      ? t("uiBlock.confirm.autoActionLabel", { action: action.label, seconds: left })
      : t("uiBlock.confirm.autoActionClock", { action: action.label, time: countdownClock(left) });
  };
  const outcome = () =>
    autoAnswer()?.done && state().outcome
      ? t("uiBlock.outcome.autoAnswered", { outcome: state().outcome ?? "" })
      : state().outcome;

  const [selected, setSelected] = createSignal<Record<string, string>>({});
  const [draft, setDraft] = createSignal<string>();
  const [sentDraft, setSentDraft] = createSignal<string>();
  const editing = () => !frozen() && draft() !== undefined;
  const blankDraft = () => editing() && !draft()?.trim();
  let editor: HTMLTextAreaElement | undefined;
  const opensEditor = (action: UiAction) =>
    action.id === UI_CONFIRM_EDIT_ACTION_ID && props.canEditPreview === true && uiConfirmPreviewEditable(props.spec);
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

  function changeDraft(value: string | undefined): void {
    setDraft(value);
    props.onDraftChange?.(value);
  }

  function startEditing(): void {
    changeDraft(props.spec.preview);
    flush();
    editor?.focus();
  }

  function respond(action: UiAction): void {
    if (locked() || blankDraft()) return;
    setConfirming(undefined);
    if (opensEditor(action)) {
      startEditing();
      return;
    }
    const values: Record<string, string> = {};
    for (const field of props.spec.fields ?? []) {
      if ("select" in field) values[field.select] = selected()[field.select] ?? field.options[0] ?? "";
    }
    const edited = draft();
    sendUiBlockResponse(
      props.spec,
      { actionId: action.id, ...(Object.keys(values).length > 0 ? { values } : {}) },
      (response) => {
        setSentDraft(edited);
        props.onRespond(response, edited);
      },
    );
  }

  function actionButtonsOrNone(): JSX.Element | undefined {
    if (confirming()) return undefined;
    return (
      <For each={props.spec.actions.filter((action) => !(editing() && opensEditor(action))).toReversed()}>
        {(action) => (
          <Switch>
            <Match when={isHeld(action)}>
              <UiHoldButton
                holdMs={holdMs()}
                variant={BUTTON_VARIANT[actionStyle(action)]}
                disabled={locked() || blankDraft()}
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
                size="sm"
                variant={BUTTON_VARIANT[actionStyle(action)]}
                disabled={locked() || blankDraft()}
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
      waiting={props.disabled !== true}
      error={props.error}
      onSkip={props.disabled || autoAnswer() || confirming() ? undefined : props.onSkip}
      actions={actionButtonsOrNone()}
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
      <Show
        when={editing()}
        fallback={
          <Show when={(state().status === "answered" ? sentDraft() : undefined) ?? props.spec.preview}>
            {(preview) => (
              <UiConfirmPreview>
                <Show when={props.renderPreview} fallback={<p class="ui-block-preview-text">{preview()}</p>}>
                  {(render) => render()(preview())}
                </Show>
              </UiConfirmPreview>
            )}
          </Show>
        }
      >
        <Textarea
          ref={(element: HTMLTextAreaElement) => {
            editor = element;
          }}
          rows={8}
          value={draft() ?? ""}
          maxlength={UI_BLOCK_LIMITS.preview}
          aria-label={t("uiBlock.confirm.previewLabel")}
          disabled={locked()}
          onValueChange={changeDraft}
        />
      </Show>
      <Show when={!frozen() && confirming()}>
        {(action) => (
          <fieldset class="ui-block-confirm-step">
            <legend class="ui-block-confirm-question">{t("uiBlock.confirm.prompt", { action: action().label })}</legend>
            <div class="ui-block-actions">
              <Button type="button" size="sm" variant="secondary" disabled={props.busy === true} onClick={stopAsking}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={BUTTON_VARIANT[actionStyle(action())]}
                disabled={locked()}
                ref={(element: HTMLButtonElement) => {
                  confirmButton = element;
                }}
                onClick={() => respond(action())}
              >
                {t("uiBlock.confirm.accept")}
              </Button>
            </div>
          </fieldset>
        )}
      </Show>
      <Show when={!frozen() && !confirming() && anyHeld()}>
        <p id={hintId} class="ui-block-hint">
          {t("uiBlock.confirm.holdHint")}
        </p>
      </Show>
    </UiBlockCard>
  );
}
