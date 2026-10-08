import {
  UI_BLOCK_SUBMIT_ACTION_ID,
  UI_CHOICE_VALUES_KEY,
  type UiChoiceBlock as UiChoiceSpec,
} from "@openbot/contracts/ui-blocks";
import { Button, Input, Kbd, Spinner } from "@openbot/ui";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";
import { UiBlockCard } from "./UiBlockCard";
import {
  optionIndexForKey,
  optionLetter,
  sendUiBlockResponse,
  type UiBlockProps,
  uiBlockState,
} from "./ui-block-support";

export function UiChoiceBlock(props: UiBlockProps<UiChoiceSpec>) {
  const { t } = useText();
  const hintId = createUniqueId();
  const state = () => uiBlockState(props);
  const frozen = () => state().status !== "pending";
  const locked = () => frozen() || props.disabled === true || props.busy === true;
  const multiple = () => props.spec.multiple === true;

  const [picked, setPicked] = createSignal<string[]>(
    props.spec.options.filter((option) => option.selected === true).map((option) => option.id),
  );
  // A frozen block shows the stored answer, whatever the person had picked before.
  const chosen = (): string[] => {
    const stored = state().response?.values?.[UI_CHOICE_VALUES_KEY];
    return frozen() && Array.isArray(stored) ? stored : picked();
  };
  const isChosen = (id: string) => chosen().includes(id);

  function toggle(id: string): void {
    if (locked()) return;
    if (!multiple()) setPicked([id]);
    else setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function submit(): void {
    if (locked() || picked().length === 0) return;
    // The answer lists the options in the order the block shows them.
    const selected = props.spec.options.filter((option) => picked().includes(option.id)).map((option) => option.id);
    sendUiBlockResponse(
      props.spec,
      { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values: { [UI_CHOICE_VALUES_KEY]: selected } },
      props.onRespond,
    );
  }

  function handleKey(event: KeyboardEvent): void {
    if (locked() || event.metaKey || event.ctrlKey || event.altKey) return;
    const option = props.spec.options[optionIndexForKey(event.key)];
    if (!option) return;
    event.preventDefault();
    toggle(option.id);
  }

  const lastLetter = () => optionLetter(Math.min(props.spec.options.length, 26) - 1);

  return (
    <UiBlockCard
      class={cx("ui-block-choice", props.class)}
      title={props.spec.title}
      status={state().status}
      outcome={state().outcome}
      busy={props.busy}
      elementRef={props.elementRef}
    >
      <fieldset class="ui-block-options" aria-label={props.spec.title} aria-describedby={frozen() ? undefined : hintId}>
        <For each={props.spec.options}>
          {(option, index) => (
            <label
              class="ui-block-option"
              data-checked={isChosen(option.id) ? "" : undefined}
              data-disabled={locked() ? "" : undefined}
            >
              <Input
                class="ui-block-option-input"
                type={multiple() ? "checkbox" : "radio"}
                name={`${hintId}-choice`}
                checked={isChosen(option.id)}
                disabled={locked()}
                onChange={() => toggle(option.id)}
                onKeyDown={handleKey}
                aria-label={option.label}
              />
              <Kbd class="ui-block-option-key" aria-hidden="true">
                {optionLetter(index())}
              </Kbd>
              <span class="ui-block-option-label">{option.label}</span>
              <Show when={option.meta}>
                <span class="ui-block-option-meta">{option.meta}</span>
              </Show>
            </label>
          )}
        </For>
      </fieldset>
      <Show when={!frozen()}>
        <div class="ui-block-actions">
          <Button type="button" disabled={locked() || picked().length === 0} onClick={submit}>
            {props.spec.submit ?? t("uiBlock.choice.submit")}
          </Button>
          <span class="ui-block-counter" role="status">
            {picked().length === 0
              ? t("uiBlock.choice.noneSelected")
              : multiple()
                ? t("uiBlock.choice.selectedCount", { count: picked().length })
                : ""}
          </span>
          <Show when={props.busy}>
            <span class="ui-block-sending" role="status">
              <Spinner size="sm" />
              {t("common.sending")}
            </span>
          </Show>
        </div>
        <p id={hintId} class="ui-block-hint">
          {t("uiBlock.choice.shortcutHint", { first: optionLetter(0), last: lastLetter() })}
        </p>
      </Show>
    </UiBlockCard>
  );
}
