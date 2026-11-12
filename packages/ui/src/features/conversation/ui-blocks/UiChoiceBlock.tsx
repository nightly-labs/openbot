import {
  UI_BLOCK_LIMITS,
  UI_BLOCK_SUBMIT_ACTION_ID,
  UI_BLOCK_TEXT_ACTION_ID,
  UI_CHOICE_VALUES_KEY,
  type UiChoiceBlock as UiChoiceSpec,
  type UiQuickRepliesBlock as UiQuickRepliesSpec,
} from "@openbot/contracts/ui-blocks";
import { Button, Input, Kbd } from "@openbot/ui";
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

/**
 * A list of options with letter keys. A `choice` block sends the picked options with its submit
 * button. A `quick_replies` block, which agents no longer get but which stays in stored and remote
 * chats, sends an option at once: a click, Enter, Space or its letter. With `allowText`, its last row
 * takes an answer in words.
 */
export function UiChoiceBlock(props: UiBlockProps<UiChoiceSpec | UiQuickRepliesSpec>) {
  const { t } = useText();
  const hintId = createUniqueId();
  const state = () => uiBlockState(props);
  const frozen = () => state().status !== "pending";
  const locked = () => frozen() || props.disabled === true || props.busy === true;
  const replies = () => props.spec.type === "quick_replies";
  const multiple = () => props.spec.type === "choice" && props.spec.multiple === true;
  const allowText = () => props.spec.type === "quick_replies" && props.spec.allowText === true;
  const label = () => props.spec.title ?? t("uiBlock.quick.label");

  const [picked, setPicked] = createSignal<string[]>(
    props.spec.type === "choice"
      ? props.spec.options.filter((option) => option.selected === true).map((option) => option.id)
      : [],
  );
  const [draft, setDraft] = createSignal("");
  let customInput: HTMLInputElement | undefined;
  // An arrow key moves the radio selection with a click; that click must not send a reply.
  let arrowMove = false;
  // A frozen block shows the stored answer, whatever the person had picked before.
  const chosen = (): string[] => {
    const response = state().response;
    if (!frozen()) return picked();
    if (replies()) return response?.actionId ? [response.actionId] : [];
    const stored = response?.values?.[UI_CHOICE_VALUES_KEY];
    return Array.isArray(stored) ? stored : [];
  };
  const isChosen = (id: string) => chosen().includes(id);
  // A chosen row shows the answer; an answer in words has no row, so it keeps the outcome line.
  const answerInRows = () => chosen().some((id) => props.spec.options.some((option) => option.id === id));

  function toggle(id: string): void {
    if (locked()) return;
    if (!multiple()) setPicked([id]);
    else setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function reply(id: string): void {
    if (locked()) return;
    setPicked([id]);
    sendUiBlockResponse(props.spec, { actionId: id }, props.onRespond);
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

  function sendText(): void {
    const text = draft().trim();
    if (locked() || text === "") return;
    setPicked([]);
    sendUiBlockResponse(props.spec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text }, props.onRespond);
  }

  function handleKey(event: KeyboardEvent, id: string): void {
    if (locked() || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.startsWith("Arrow")) {
      arrowMove = true;
      return;
    }
    // Arrow keys only move the selection of a reply; Enter and Space send it.
    if (replies() && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      reply(id);
      return;
    }
    const index = optionIndexForKey(event.key);
    if (allowText() && index === props.spec.options.length) {
      event.preventDefault();
      customInput?.focus();
      return;
    }
    const option = props.spec.options[index];
    if (!option) return;
    event.preventDefault();
    if (replies()) reply(option.id);
    else toggle(option.id);
  }

  /**
   * A click sends a reply: from a pointer, or from assistive technology, which clicks with no key.
   * The click that an arrow key makes only selects.
   */
  function handleClick(id: string): void {
    const fromArrow = arrowMove;
    arrowMove = false;
    if (replies() && !fromArrow) reply(id);
  }

  const lastLetter = () => optionLetter(Math.min(props.spec.options.length + (allowText() ? 1 : 0), 26) - 1);
  const subtitle = () => (multiple() && !frozen() ? t("prompt.question.chooseAll") : undefined);
  const submitLabel = () => (props.spec.type === "choice" && props.spec.submit) || t("uiBlock.choice.submit");
  const submitDisabled = () => locked() || (replies() ? draft().trim() === "" : picked().length === 0);
  const onSubmit = () => (replies() ? sendText() : submit());
  // A reply block has a button only for the answer in words.
  const actions = () =>
    !replies() || allowText() ? (
      <Button type="button" size="sm" disabled={submitDisabled()} onClick={onSubmit}>
        {submitLabel()}
      </Button>
    ) : undefined;

  return (
    <UiBlockCard
      class={cx("ui-block-choice", props.class)}
      title={props.spec.title}
      subtitle={subtitle()}
      status={state().status}
      outcome={state().outcome}
      answerInBody={answerInRows()}
      busy={props.busy}
      waiting={props.disabled !== true}
      error={props.error}
      onSkip={props.disabled ? undefined : props.onSkip}
      actions={actions()}
      elementRef={props.elementRef}
    >
      <fieldset class="ui-block-options" aria-label={label()} aria-describedby={frozen() ? undefined : hintId}>
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
                onClick={() => handleClick(option.id)}
                onKeyDown={(event) => handleKey(event, option.id)}
                onKeyUp={() => (arrowMove = false)}
                aria-label={option.label}
              />
              <Kbd class="ui-block-option-key" aria-hidden="true">
                {optionLetter(index())}
              </Kbd>
              <span class="ui-block-option-label">{option.label}</span>
              <Show when={"meta" in option && option.meta}>
                {(meta) => <span class="ui-block-option-meta">{meta()}</span>}
              </Show>
            </label>
          )}
        </For>
        <Show when={allowText() && !frozen()}>
          <label
            class="ui-block-option ui-block-option-custom"
            data-checked={draft().trim() ? "" : undefined}
            data-disabled={locked() ? "" : undefined}
          >
            <Kbd class="ui-block-option-key" aria-hidden="true">
              {optionLetter(props.spec.options.length)}
            </Kbd>
            <Input
              ref={(element) => (customInput = element)}
              class="ui-block-option-custom-input"
              type="text"
              size="sm"
              value={draft()}
              maxlength={UI_BLOCK_LIMITS.fieldValue}
              placeholder={t("prompt.question.somethingElse")}
              aria-label={t("prompt.question.customAnswerFor", { question: label() })}
              disabled={locked()}
              onValueChange={(value) => {
                setDraft(value);
                setPicked([]);
              }}
              onKeyDown={(event) => {
                // The browser owns the key that commits an IME composition.
                if (event.isComposing || event.keyCode === 229 || event.key !== "Enter") return;
                event.preventDefault();
                sendText();
              }}
            />
          </label>
        </Show>
      </fieldset>
      <Show when={!frozen()}>
        <p id={hintId} class="sr-only">
          {t("uiBlock.choice.shortcutHint", { first: optionLetter(0), last: lastLetter() })}
        </p>
      </Show>
    </UiBlockCard>
  );
}
