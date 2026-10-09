import {
  UI_BLOCK_LIMITS,
  UI_BLOCK_TEXT_ACTION_ID,
  type UiQuickRepliesBlock as UiQuickRepliesSpec,
} from "@openbot/contracts/ui-blocks";
import { Button, Input } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";
import { UiBlockFooter, UiBlockOutcome } from "./UiBlockCard";
import { sendUiBlockResponse, type UiBlockProps, uiBlockState } from "./ui-block-support";

/**
 * A row of reply chips. It has no frame: it sits in the chat like a row of suggestions. Once the
 * person picks one, the other chips fade and the chosen one stays marked.
 */
export function UiQuickReplies(props: UiBlockProps<UiQuickRepliesSpec>) {
  const { t } = useText();
  const state = () => uiBlockState(props);
  const frozen = () => state().status !== "pending";
  const locked = () => frozen() || props.disabled === true || props.busy === true;
  const [picked, setPicked] = createSignal<string | undefined>();
  const [draft, setDraft] = createSignal("");
  // A reply the host refused is not chosen: the person picks again.
  const chosen = () => (frozen() ? state().response?.actionId : props.error ? undefined : picked());

  function choose(id: string): void {
    if (locked()) return;
    if (sendUiBlockResponse(props.spec, { actionId: id }, props.onRespond)) setPicked(id);
  }

  function sendText(): void {
    const text = draft().trim();
    if (locked() || text === "") return;
    if (sendUiBlockResponse(props.spec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text }, props.onRespond)) {
      setPicked(UI_BLOCK_TEXT_ACTION_ID);
    }
  }

  return (
    <section
      class={cx("ui-block-quick", props.class)}
      data-status={state().status}
      aria-label={props.spec.title ?? t("uiBlock.quick.label")}
      ref={(element) => props.elementRef?.(element)}
    >
      <Show when={props.spec.title}>
        <p class="ui-block-quick-title">{props.spec.title}</p>
      </Show>
      <div class="ui-block-chips">
        <For each={props.spec.options}>
          {(option) => (
            <Button
              type="button"
              variant="outline"
              class="ui-block-chip"
              aria-pressed={chosen() === option.id ? "true" : "false"}
              data-chosen={chosen() === option.id ? "" : undefined}
              data-faded={chosen() !== undefined && chosen() !== option.id ? "" : undefined}
              disabled={locked()}
              onClick={() => choose(option.id)}
            >
              {option.label}
            </Button>
          )}
        </For>
      </div>
      <Show when={props.spec.allowText === true && !frozen()}>
        <form
          class="ui-block-quick-text"
          novalidate
          onSubmit={(event) => {
            event.preventDefault();
            sendText();
          }}
        >
          <Input
            type="text"
            size="sm"
            value={draft()}
            maxlength={UI_BLOCK_LIMITS.fieldValue}
            placeholder={t("uiBlock.quick.textPlaceholder")}
            aria-label={t("uiBlock.quick.textLabel")}
            disabled={locked()}
            onValueChange={setDraft}
          />
          <Button type="submit" size="sm" disabled={locked() || draft().trim() === ""}>
            {t("uiBlock.quick.send")}
          </Button>
        </form>
      </Show>
      <UiBlockFooter
        status={state().status}
        error={props.error}
        onSkip={props.disabled ? undefined : props.onSkip}
        busy={props.busy}
      />
      <Show when={frozen() && (chosen() === UI_BLOCK_TEXT_ACTION_ID || state().status !== "answered")}>
        <UiBlockOutcome status={state().status} outcome={state().outcome} />
      </Show>
    </section>
  );
}
