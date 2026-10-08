import {
  UI_BLOCK_LIMITS,
  UI_BLOCK_SUBMIT_ACTION_ID,
  type UiBlockValue,
  type UiFormField,
  type UiFormBlock as UiFormSpec,
} from "@openbot/contracts/ui-blocks";
import { Button, Field, Input, NativeSelect, Spinner, Textarea } from "@openbot/ui";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../../text";
import { cx } from "../../../utils";
import { UiBlockCard } from "./UiBlockCard";
import { sendUiBlockResponse, type UiBlockProps, uiBlockState } from "./ui-block-support";

function fieldLabel(field: UiFormField): string {
  return field.label ?? field.id;
}

export function UiFormBlock(props: UiBlockProps<UiFormSpec>) {
  const { t } = useText();
  const state = () => uiBlockState(props);
  const frozen = () => state().status !== "pending";
  const locked = () => frozen() || props.disabled === true || props.busy === true;

  const [draft, setDraft] = createSignal<Record<string, string>>(
    Object.fromEntries(props.spec.fields.map((field) => [field.id, field.value ?? ""])),
  );
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());

  // A frozen block shows the stored answer; an open one shows what the person has typed.
  const currentValue = (field: UiFormField): string => {
    const stored = frozen() ? state().response?.values?.[field.id] : undefined;
    return typeof stored === "string" ? stored : (draft()[field.id] ?? "");
  };
  const errorOf = (field: UiFormField) => (failed().has(field.id) ? t("uiBlock.form.required") : undefined);

  function setValue(field: UiFormField, value: string): void {
    setDraft((current) => ({ ...current, [field.id]: value }));
    if (failed().has(field.id) && value.trim() !== "") {
      setFailed((current) => new Set([...current].filter((id) => id !== field.id)));
    }
  }

  function submit(): void {
    if (locked()) return;
    const missing = props.spec.fields.filter((field) => field.required === true && currentValue(field).trim() === "");
    setFailed(new Set(missing.map((field) => field.id)));
    if (missing.length > 0) return;
    const values: Record<string, UiBlockValue> = {};
    for (const field of props.spec.fields) {
      const value = currentValue(field);
      if (value.trim() !== "") values[field.id] = field.kind === "date" ? value.trim() : value;
    }
    sendUiBlockResponse(props.spec, { actionId: UI_BLOCK_SUBMIT_ACTION_ID, values }, props.onRespond);
  }

  return (
    <UiBlockCard
      class={cx("ui-block-form", props.class)}
      title={props.spec.title}
      status={state().status}
      outcome={state().outcome}
      busy={props.busy}
      elementRef={props.elementRef}
    >
      <form
        class="ui-block-form-fields"
        novalidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <For each={props.spec.fields}>
          {(field) => (
            <Switch>
              <Match when={field.kind === "segmented" ? field : undefined}>
                {(segmented) => (
                  <fieldset class="ui-block-field" data-invalid={errorOf(field) ? "" : undefined}>
                    <legend class="ui-block-field-label">
                      {fieldLabel(field)}
                      <Show when={field.required}>
                        <span class="ui-block-required" aria-hidden="true">
                          *
                        </span>
                      </Show>
                    </legend>
                    <div class="ui-block-segmented">
                      <For each={segmented().options}>
                        {(option) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            class="ui-block-segment"
                            aria-pressed={currentValue(field) === option ? "true" : "false"}
                            disabled={locked()}
                            onClick={() =>
                              setValue(field, currentValue(field) === option && field.required !== true ? "" : option)
                            }
                          >
                            {option}
                          </Button>
                        )}
                      </For>
                    </div>
                    <Show when={errorOf(field)}>
                      {(message) => (
                        <p class="ui-block-field-error" role="alert">
                          {message()}
                        </p>
                      )}
                    </Show>
                  </fieldset>
                )}
              </Match>
              <Match when={true}>
                <Field label={fieldLabel(field)} required={field.required === true} error={errorOf(field)}>
                  <Switch>
                    <Match when={field.kind === "textarea"}>
                      <Textarea
                        value={currentValue(field)}
                        maxlength={UI_BLOCK_LIMITS.fieldValue}
                        placeholder={"placeholder" in field ? field.placeholder : undefined}
                        disabled={locked()}
                        onValueChange={(value) => setValue(field, value)}
                      />
                    </Match>
                    <Match when={field.kind === "select" ? field : undefined}>
                      {(select) => (
                        <NativeSelect
                          value={currentValue(field)}
                          disabled={locked()}
                          onChange={(event) => setValue(field, event.currentTarget.value)}
                        >
                          <option value="">
                            {field.required ? t("uiBlock.form.choose") : t("uiBlock.form.notSet")}
                          </option>
                          <For each={select().options}>{(option) => <option value={option}>{option}</option>}</For>
                        </NativeSelect>
                      )}
                    </Match>
                    <Match when={field.kind === "date"}>
                      <Input
                        type="date"
                        value={currentValue(field)}
                        disabled={locked()}
                        onValueChange={(value) => setValue(field, value)}
                      />
                    </Match>
                    <Match when={true}>
                      <Input
                        type="text"
                        value={currentValue(field)}
                        maxlength={UI_BLOCK_LIMITS.fieldValue}
                        placeholder={"placeholder" in field ? field.placeholder : undefined}
                        disabled={locked()}
                        onValueChange={(value) => setValue(field, value)}
                      />
                    </Match>
                  </Switch>
                </Field>
              </Match>
            </Switch>
          )}
        </For>
        <Show when={!frozen()}>
          <div class="ui-block-actions">
            <Button type="submit" disabled={locked()}>
              {props.spec.submit ?? t("uiBlock.form.submit")}
            </Button>
            <Show when={props.busy}>
              <span class="ui-block-sending" role="status">
                <Spinner size="sm" />
                {t("common.sending")}
              </span>
            </Show>
          </div>
        </Show>
      </form>
    </UiBlockCard>
  );
}
