import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { CUSTOM_PROVIDER_LIMITS } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, onSettled, Show, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import {
  ArrowLeft,
  Button,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Plus,
  SlidersHorizontal,
  Text,
  Trash2,
  X,
} from "../../components/ui";
import {
  type CustomProviderDraft,
  type CustomProviderErrors,
  customProviderValue,
  emptyCustomProviderDraft,
  hasCustomProviderError,
  validateCustomProvider,
} from "./custom-provider-form";

type ModelRow = CustomProviderDraft["models"][number];
type HeaderRow = CustomProviderDraft["headers"][number];

/**
 * Storybook and Solid both hand this object over as a proxy, and `structuredClone` refuses a proxy
 * with a `DataCloneError`, so the two nested lists are copied by hand.
 */
function cloneDraft(draft: CustomProviderDraft): CustomProviderDraft {
  return {
    ...draft,
    models: draft.models.map((model) => ({ ...model })),
    headers: draft.headers.map((header) => ({ ...header })),
  };
}

/**
 * One column of a repeatable row. `read` and `write` stay with the caller that knows the row shape,
 * so the shared markup below reaches a field without an index signature or a cast.
 */
interface RepeatableColumn<T> {
  /** Completes the accessible name, as `Model 1 ID`. */
  suffix: string;
  placeholder: string;
  maxlength: number;
  /** An identifier must not be autocorrected. A display name is prose and may be. */
  identifier?: boolean;
  read: (row: T) => string;
  write: (index: number, value: string) => void;
}

interface RepeatableRowsProps<T> {
  /** Names the section, as `Models`. */
  label: string;
  /** Names one row, as `Model 1 ID` and `Remove model 1`. */
  singular: string;
  columns: readonly [RepeatableColumn<T>, RepeatableColumn<T>];
  rows: readonly T[];
  limit: number;
  busy: boolean;
  sectionError?: string;
  rowError: (index: number) => string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * The models list and the headers list differ only in their two columns and their limit, so they
 * share one row, error and add-button shape instead of keeping two copies that drift apart.
 */
function RepeatableRows<T>(props: RepeatableRowsProps<T>) {
  const lower = () => props.singular.toLowerCase();
  return (
    <section class="custom-provider-rows" aria-label={props.label}>
      <div class="custom-provider-rows-heading">
        <Text variant="label-sm">{props.label}</Text>
        <Show when={props.sectionError}>
          {(message) => (
            <Text class="custom-provider-rows-error" tone="danger" variant="caption" role="alert">
              {message()}
            </Text>
          )}
        </Show>
      </div>
      <For each={props.rows}>
        {(row, index) => (
          <div class="custom-provider-row">
            <div class="custom-provider-row-inputs">
              <For each={props.columns}>
                {(column) => (
                  <Input
                    aria-label={`${props.singular} ${index() + 1} ${column.suffix}`}
                    value={column.read(row)}
                    onValueChange={(value) => column.write(index(), value)}
                    placeholder={column.placeholder}
                    autocomplete={column.identifier ? "off" : undefined}
                    spellcheck={column.identifier ? false : undefined}
                    maxlength={column.maxlength}
                    disabled={props.busy}
                  />
                )}
              </For>
              <IconButton
                label={`Remove ${lower()} ${index() + 1}`}
                variant="ghost"
                disabled={props.busy || props.rows.length < 2}
                onClick={() => props.onRemove(index())}
              >
                <Trash2 />
              </IconButton>
            </div>
            <Show when={props.rowError(index())}>
              {(message) => (
                <Text class="custom-provider-row-error" tone="danger" variant="caption" role="alert">
                  {message()}
                </Text>
              )}
            </Show>
          </div>
        )}
      </For>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.busy || props.rows.length >= props.limit}
        onClick={() => props.onAdd()}
      >
        <Plus />
        Add {lower()}
      </Button>
    </section>
  );
}

interface CustomProviderDialogProps {
  open: boolean;
  /** Prefilled fields, for editing a provider or for a story. Defaults to a blank form. */
  draft?: CustomProviderDraft;
  /** Set by a story to show the messages without typing into every field first. */
  showErrors?: boolean;
  busy?: boolean;
  submitError?: string | null;
  /**
   * The provider IDs already saved. A duplicate is a field error before a round trip; main refuses
   * one as well, because this list is only as fresh as the last list the renderer was given.
   */
  takenProviderIds?: readonly string[];
  onSubmit: (value: SaveCustomProviderInput) => void;
  onCancel: () => void;
  onBack?: () => void;
}

export function CustomProviderDialog(props: CustomProviderDialogProps) {
  // The form owns its state from here on: the incoming draft is read once, as a snapshot, so later
  // edits by the caller do not reach in and overwrite what the user is typing.
  const [draft, setDraft] = createStore<CustomProviderDraft>(
    untrack(() => (props.draft ? cloneDraft(props.draft) : emptyCustomProviderDraft())),
  );
  // Nothing is red until the user has asked OpenBot to accept the form, so a blank form does not
  // open covered in messages about fields nobody has reached yet.
  const [submitted, setSubmitted] = createSignal(untrack(() => Boolean(props.showErrors)));

  /**
   * Both hosts keep this dialog mounted after a close, and the draft above is a snapshot, so without
   * this a second "Add provider" reopens the form still holding the last endpoint - including its API
   * key. Re-snapshot on the false-to-true edge only, never while the dialog is open.
   */
  createEffect(
    () => props.open,
    (open, previous) => {
      if (!open || previous) return;
      setDraft(() => (props.draft ? cloneDraft(props.draft) : emptyCustomProviderDraft()));
      setSubmitted(Boolean(props.showErrors));
    },
  );

  const errors = () => validateCustomProvider(draft, props.takenProviderIds);
  const shown = (): CustomProviderErrors | null => (submitted() ? errors() : null);
  const busy = () => Boolean(props.busy);

  // The form itself scrolls, and its own box keeps the same size when a row is added, so the
  // helper's ResizeObserver never fires for new content. Remeasure on what changes the height.
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  createEffect(
    () => ({ models: draft.models.length, headers: draft.headers.length, errors: shown() }),
    () => fades.remeasure(),
  );

  const modelColumns: readonly [RepeatableColumn<ModelRow>, RepeatableColumn<ModelRow>] = [
    {
      suffix: "ID",
      placeholder: "model-id",
      maxlength: INPUT_LIMITS.modelName,
      identifier: true,
      read: (row) => row.id,
      write: (index, value) =>
        setDraft((state) => {
          state.models[index].id = value;
        }),
    },
    {
      suffix: "display name",
      placeholder: "Display Name",
      maxlength: INPUT_LIMITS.modelName,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          state.models[index].name = value;
        }),
    },
  ];

  const headerColumns: readonly [RepeatableColumn<HeaderRow>, RepeatableColumn<HeaderRow>] = [
    {
      suffix: "name",
      placeholder: "Header-Name",
      maxlength: INPUT_LIMITS.identifier,
      identifier: true,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          state.headers[index].name = value;
        }),
    },
    {
      suffix: "value",
      placeholder: "value",
      maxlength: CUSTOM_PROVIDER_LIMITS.apiKey,
      identifier: true,
      read: (row) => row.value,
      write: (index, value) =>
        setDraft((state) => {
          state.headers[index].value = value;
        }),
    },
  ];

  function submit(): void {
    setSubmitted(true);
    if (busy() || hasCustomProviderError(errors())) return;
    props.onSubmit(customProviderValue(draft));
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog" aria-busy={busy() ? "true" : undefined}>
            <Dialog.Title class="sr-only">Add a custom provider</Dialog.Title>
            <Dialog.Description class="sr-only">
              Describe an OpenAI-compatible endpoint and the models it serves.
            </Dialog.Description>

            <header class="custom-provider-header">
              <Show when={props.onBack}>
                <IconButton label="Back" variant="ghost" disabled={busy()} onClick={() => props.onBack?.()}>
                  <ArrowLeft />
                </IconButton>
              </Show>
              <span class="custom-provider-mark" aria-hidden="true">
                <SlidersHorizontal />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  Custom provider
                </Heading>
                <Text tone="muted" variant="caption">
                  Any OpenAI-compatible endpoint.
                </Text>
              </div>
              <IconButton
                class="custom-provider-close"
                label="Close"
                variant="ghost"
                disabled={busy()}
                onClick={props.onCancel}
              >
                <X />
              </IconButton>
            </header>

            {/*
             * The fields scroll inside the form rather than the form scrolling itself, so the footer
             * below stays reachable and outside the scroll fade. Submit is a `type="submit"` button,
             * which needs the form as an ancestor - hence the wrapper rather than a sibling footer.
             */}
            <form
              class="custom-provider-body"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div class={["custom-provider-form", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                <Field
                  label="Provider ID"
                  description="Lowercase letters, numbers, hyphens, or underscores."
                  error={shown()?.providerId}
                  required
                >
                  <Input
                    value={draft.providerId}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.providerId = value;
                      })
                    }
                    placeholder="my-provider"
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={INPUT_LIMITS.identifier}
                    disabled={busy()}
                  />
                </Field>

                <Field label="Display name" error={shown()?.displayName} required>
                  <Input
                    value={draft.displayName}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.displayName = value;
                      })
                    }
                    placeholder="My Provider"
                    maxlength={INPUT_LIMITS.agentName}
                    disabled={busy()}
                  />
                </Field>

                <Field label="Base URL" error={shown()?.baseUrl} required>
                  <Input
                    value={draft.baseUrl}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.baseUrl = value;
                      })
                    }
                    placeholder="http://127.0.0.1:11434/v1"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={CUSTOM_PROVIDER_LIMITS.baseUrl}
                    disabled={busy()}
                  />
                </Field>

                <Field
                  label="API key"
                  description="Optional. Leave empty if you manage auth via headers."
                  error={shown()?.apiKey}
                >
                  <Input
                    type="password"
                    value={draft.apiKey}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.apiKey = value;
                      })
                    }
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={CUSTOM_PROVIDER_LIMITS.apiKey}
                    disabled={busy()}
                  />
                </Field>

                <RepeatableRows
                  label="Models"
                  singular="Model"
                  columns={modelColumns}
                  rows={draft.models}
                  limit={CUSTOM_PROVIDER_LIMITS.models}
                  busy={busy()}
                  sectionError={shown()?.models}
                  rowError={(index) => shown()?.modelRows[index]}
                  onAdd={() =>
                    setDraft((state) => {
                      state.models.push({ id: "", name: "" });
                    })
                  }
                  onRemove={(index) =>
                    setDraft((state) => {
                      state.models.splice(index, 1);
                    })
                  }
                />

                <RepeatableRows
                  label="Headers"
                  singular="Header"
                  columns={headerColumns}
                  rows={draft.headers}
                  limit={CUSTOM_PROVIDER_LIMITS.headers}
                  busy={busy()}
                  rowError={(index) => shown()?.headerRows[index]}
                  onAdd={() =>
                    setDraft((state) => {
                      state.headers.push({ name: "", value: "" });
                    })
                  }
                  onRemove={(index) =>
                    setDraft((state) => {
                      state.headers.splice(index, 1);
                    })
                  }
                />
              </div>

              <footer class="custom-provider-actions">
                <Show when={props.submitError}>
                  {(message) => (
                    <Text class="custom-provider-submit-error" tone="danger" variant="caption" role="alert">
                      {message()}
                    </Text>
                  )}
                </Show>
                <Button type="submit" variant="default" loading={busy()} loadingLabel="Saving…">
                  Submit
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
