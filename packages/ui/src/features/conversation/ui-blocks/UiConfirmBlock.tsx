import type { UiAction, UiActionStyle, UiConfirmBlock as UiConfirmSpec } from "@openbot/contracts/ui-blocks";
import { Button, NativeSelect, Spinner } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js";
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

  const [selected, setSelected] = createSignal<Record<string, string>>({});
  const selectValue = (select: string, options: string[]): string =>
    (frozen() ? state().response?.values?.[select] : undefined) !== undefined
      ? String(state().response?.values?.[select])
      : (selected()[select] ?? options[0] ?? "");

  function respond(action: UiAction): void {
    if (locked()) return;
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
      outcome={state().outcome}
      danger={props.spec.danger}
      busy={props.busy}
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
          <section class="ui-block-preview" aria-label={t("uiBlock.confirm.previewLabel")}>
            <Show when={props.renderPreview} fallback={<p class="ui-block-preview-text">{preview()}</p>}>
              {(render) => render()(preview())}
            </Show>
          </section>
        )}
      </Show>
      <Show when={!frozen()}>
        <div class="ui-block-actions">
          <For each={props.spec.actions}>
            {(action) => (
              <Switch>
                <Match when={isHeld(action)}>
                  <UiHoldButton
                    holdMs={holdMs()}
                    variant={BUTTON_VARIANT[actionStyle(action)]}
                    disabled={locked()}
                    describedBy={hintId}
                    onComplete={() => respond(action)}
                  >
                    {action.label}
                  </UiHoldButton>
                </Match>
                <Match when={true}>
                  <Button
                    type="button"
                    variant={BUTTON_VARIANT[actionStyle(action)]}
                    disabled={locked()}
                    onClick={() => respond(action)}
                  >
                    {action.label}
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
