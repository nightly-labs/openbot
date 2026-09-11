import type {
  BrowserFormField,
  BrowserFormRequest,
  BrowserFormState,
  BrowserFormSubmission,
} from "@openbot/contracts/ipc";
import { createEffect, createStore, For, Match, Show, Switch } from "solid-js";
import { Button, Checkbox, Field, Input, NativeSelect, Textarea } from "../../components/ui";

type FieldValue = BrowserFormSubmission["values"][number]["value"];

/** Ephemeral form state: values go only to the local browser IPC, never to conversation stores. */
export function BrowserTakeoverFields(props: { request: BrowserFormRequest; onBusy: (busy: boolean) => void }) {
  const [state, setState] = createStore<{
    form: BrowserFormState | null;
    values: Record<string, FieldValue>;
    actions: Record<string, string>;
    busy: boolean;
    error: string;
  }>({ form: null, values: {}, actions: {}, busy: false, error: "" });
  let generation = 0;
  let pending = false;
  const key = (formId: string, fieldId: string) => `${formId}:${fieldId}`;
  const apply = (form: BrowserFormState) => {
    const values: Record<string, FieldValue> = {};
    const actions: Record<string, string> = {};
    for (const entry of form.forms) {
      actions[entry.id] = entry.requiresActionChoice ? "" : (entry.actions[0]?.id ?? "");
      for (const field of entry.fields) {
        values[key(entry.id, field.id)] =
          field.type === "select"
            ? field.options.filter((option) => option.selected).map((option) => option.id)
            : field.type === "checkbox" || field.type === "radio"
              ? field.checked
              : "";
      }
    }
    setState((draft) => {
      draft.form = form;
      draft.values = values;
      draft.actions = actions;
    });
  };
  const read = async (request: BrowserFormRequest, current: number) => {
    pending = true;
    setState((draft) => {
      draft.busy = true;
      draft.error = "";
      draft.values = {};
    });
    props.onBusy(true);
    try {
      const result = await window.openbot.browser.readTakeoverForm(request);
      if (current === generation) apply(result);
    } catch {
      if (current === generation)
        setState((draft) => {
          draft.form = null;
          draft.error = "The form is unavailable. Refresh it or open the browser.";
        });
    } finally {
      if (current === generation) {
        pending = false;
        setState((draft) => {
          draft.busy = false;
        });
        props.onBusy(false);
      }
    }
  };
  createEffect(
    () => JSON.stringify([props.request.requestId, props.request.agentId, props.request.threadId, props.request.tabId]),
    () => {
      const request = props.request;
      const current = ++generation;
      void read(request, current);
      return () => {
        generation++;
        pending = false;
        setState((draft) => {
          draft.values = {};
        });
        props.onBusy(false);
      };
    },
  );
  const submit = async (formId: string, actionId: string) => {
    const form = state.form;
    const entry = form?.forms.find((candidate) => candidate.id === formId);
    if (!form || !entry || pending) return;
    pending = true;
    const current = generation;
    const input: BrowserFormSubmission = {
      ...props.request,
      revision: form.revision,
      formId,
      actionId,
      values: entry.fields.map((field) => ({ id: field.id, value: state.values[key(formId, field.id)] ?? "" })),
    };
    setState((draft) => {
      draft.busy = true;
      draft.error = "";
      draft.values = {};
    });
    props.onBusy(true);
    try {
      const result = await window.openbot.browser.submitTakeoverForm(input);
      if (current === generation) apply(result);
    } catch {
      if (current === generation)
        setState((draft) => {
          draft.form = null;
          draft.error = "The form could not be submitted. Refresh it or open the browser to check the result.";
        });
    } finally {
      input.values = [];
      if (current === generation) {
        pending = false;
        setState((draft) => {
          draft.busy = false;
        });
        props.onBusy(false);
      }
    }
  };
  const change = (formId: string, field: BrowserFormField, value: FieldValue) => {
    setState((draft) => {
      if (field.type === "radio" && field.name && value === true) {
        for (const other of draft.form?.forms.find((form) => form.id === formId)?.fields ?? []) {
          if (other.type === "radio" && other.name === field.name) draft.values[key(formId, other.id)] = false;
        }
      }
      draft.values[key(formId, field.id)] = value;
    });
  };
  const RefreshButton = () => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="browser-takeover-refresh"
      disabled={state.busy}
      onClick={() => {
        if (!pending) void read(props.request, ++generation);
      }}
    >
      Refresh form
    </Button>
  );
  return (
    <div class="browser-takeover-fields" aria-busy={state.busy ? "true" : "false"}>
      <p>Enter the details here to send them directly to the website.</p>
      <Show when={state.form}>{(form) => <p>Website: {form().origin}</p>}</Show>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <Show when={state.form?.status === "invalid"}>
        <p role="alert">Check the required fields and their values, then submit again.</p>
      </Show>
      <Show when={state.form?.status === "manual" || state.form?.forms.length === 0}>
        <p>Some steps need the browser. Open it if the next step is not available here.</p>
      </Show>
      <For each={state.form?.forms ?? []}>
        {(form) => (
          <form
            novalidate
            class="browser-takeover-form"
            aria-label={form.label}
            onSubmit={(event) => {
              event.preventDefault();
              const actionId = state.actions[form.id];
              if (actionId) void submit(form.id, actionId);
            }}
          >
            <For each={form.fields}>
              {(field) => {
                const value = () => state.values[key(form.id, field.id)];
                const selected = (optionId: string) => {
                  const current = value();
                  return Array.isArray(current) && current.includes(optionId);
                };
                const text = () => {
                  const current = value();
                  return typeof current === "string" ? current : "";
                };
                const controlId = () => `${state.form?.revision}-${form.id}-${field.id}`;
                return (
                  <Field htmlFor={controlId()} label={`${field.label}${field.required ? " (required)" : ""}`}>
                    <Switch>
                      <Match when={field.type === "checkbox"}>
                        <Checkbox
                          id={controlId()}
                          checked={value() === true}
                          required={field.required}
                          disabled={state.busy}
                          onChange={(event) => change(form.id, field, event.currentTarget.checked)}
                        />
                      </Match>
                      <Match when={field.type === "radio"}>
                        <Input
                          id={controlId()}
                          type="radio"
                          name={`${state.form?.revision}-${form.id}-${field.name || field.id}`}
                          checked={value() === true}
                          required={field.required}
                          disabled={state.busy}
                          onChange={(event) => change(form.id, field, event.currentTarget.checked)}
                        />
                      </Match>
                      <Match when={field.type === "select"}>
                        <NativeSelect
                          id={controlId()}
                          multiple={field.multiple}
                          required={field.required}
                          disabled={state.busy}
                          onChange={(event) =>
                            change(
                              form.id,
                              field,
                              [...event.currentTarget.selectedOptions].map((option) => option.value),
                            )
                          }
                        >
                          <For each={field.options}>
                            {(option) => (
                              <option value={option.id} disabled={option.disabled} selected={selected(option.id)}>
                                {option.label}
                              </option>
                            )}
                          </For>
                        </NativeSelect>
                      </Match>
                      <Match when={field.type === "textarea"}>
                        <Textarea
                          id={controlId()}
                          value={text()}
                          required={field.required}
                          disabled={state.busy}
                          onValueChange={(next) => change(form.id, field, next)}
                        />
                      </Match>
                      <Match when={!["checkbox", "radio", "select", "textarea"].includes(field.type)}>
                        <Input
                          id={controlId()}
                          type={field.type}
                          multiple={field.multiple}
                          value={text()}
                          required={field.required}
                          min={field.min || undefined}
                          max={field.max || undefined}
                          step={field.step || undefined}
                          autocomplete="off"
                          disabled={state.busy}
                          onValueChange={(next) => change(form.id, field, next)}
                        />
                      </Match>
                    </Switch>
                  </Field>
                );
              }}
            </For>
            <Show when={form.requiresActionChoice}>
              <Field htmlFor={`${state.form?.revision}-${form.id}-action`} label="Action">
                <NativeSelect
                  id={`${state.form?.revision}-${form.id}-action`}
                  value={state.actions[form.id] ?? ""}
                  disabled={state.busy}
                  onChange={(event) =>
                    setState((draft) => {
                      draft.actions[form.id] = event.currentTarget.value;
                    })
                  }
                >
                  <option value="" disabled>
                    Choose an action
                  </option>
                  <For each={form.actions}>{(action) => <option value={action.id}>{action.label}</option>}</For>
                </NativeSelect>
              </Field>
            </Show>
            <div class="browser-takeover-form-actions">
              <Button type="submit" size="sm" class="approval-button" disabled={state.busy || !state.actions[form.id]}>
                {state.busy
                  ? "Submitting…"
                  : (form.actions.find((action) => action.id === state.actions[form.id])?.label ?? "Continue")}
              </Button>
              <Show when={form.id === state.form?.forms.at(-1)?.id}>
                <RefreshButton />
              </Show>
            </div>
          </form>
        )}
      </For>
      <Show when={!state.form?.forms.length}>
        <RefreshButton />
      </Show>
    </div>
  );
}
